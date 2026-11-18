# Ball physics

There's no physics engine in Rebound Five. The ball is a few hundred lines of hand-written,
heavily commented maths in `src/sim/ball/` that you can read, change and test. This document explains each
piece. Every number mentioned lives in `BALL` and `PITCH` in `src/config.ts`.

## Coordinates and units

- Metres, seconds, radians. Y is up; the pitch lies on the XZ plane.
- The pitch is 40 m × 24 m (`halfLength` 20, `halfWidth` 12). Goals are 5 m wide, 2.2 m high
  and 1.4 m deep, centred on x = ±20.
- Team 0 attacks toward +x, team 1 toward -x.
- The ball has radius `r = 0.12 m`. Its state is position **p**, velocity **v** and
  angular velocity **ω** (spin, in rad/s).

## Why a fixed timestep

The simulation always advances in steps of exactly `dt = 1/60 s`, whatever the display
does (`core/Loop.ts`). That matters for physics in three ways:

1. **Reproducibility.** Floating-point results depend on the step size. A ball integrated
   with 1/144 s steps lands somewhere slightly different from one integrated with 1/60 s
   steps. With a fixed step, the same kick lands in the same place on every machine,
   which is what makes replays and the deterministic tests possible.
2. **Stability.** Integrators can blow up when a single step is too large (after a lag
   spike, say). A fixed step, plus a cap of 0.25 s of catch-up per frame, keeps every step
   in the range we've tested.
3. **Tunnelling.** At 28 m/s a ball moves 47 cm per tick, more than the 38 cm wide
   ball+post collision zone. So the ball is integrated in **4 sub-steps** per tick
   (`SIM.ballSubsteps`): about 12 cm each at full power, always less than the collision
   zone, so a shot can't jump through a post between two checks.

## Integration: semi-implicit Euler

Every sub-step of length `h` (`BallPhysics.integrate`):

```
a      = forces / mass             (gravity + drag + Magnus, below)
v(t+h) = v(t) + a h
p(t+h) = p(t) + v(t+h) h           <- uses the NEW velocity
```

Plain ("explicit") Euler uses the _old_ velocity in the position update. It's equally
cheap but steadily adds energy to oscillating motion, so bounces creep higher over time.
Semi-implicit (symplectic) Euler conserves energy far better at the same cost. It's
first-order accurate: after 1 s of free fall at 240 sub-steps per second, the ball is
within 2 cm of the exact `y0 - g t²/2` (that's tested in `tests/ballPhysics.test.ts`).

## Gravity

`a.y -= g` with `g = 9.81 m/s²`, but only while the ball is in the air. When rolling, the
ground pushes up with an equal force, so gravity is skipped rather than fighting a
collision every step.

## Air drag

Real drag force is `F = ½ ρ C_d A |v|²`, pointing against the motion. Dividing by the
ball's mass and folding the constants into one coefficient k:

```
a_drag = -k |v| v           k = ρ C_d A / (2 m)
```

Its size is `k |v|²`. With air density ρ = 1.2 kg/m³, C_d ≈ 0.25, cross-section
A = π r² ≈ 0.045 m² and m = 0.43 kg, a real ball has k ≈ 0.016. The game uses
`airDrag = 0.011` so arcade shots carry a little further. At 30 m/s that's about
10 m/s² of deceleration; at 10 m/s only 1.1 m/s². Hard shots slow quickly and passes
barely notice. The test "air drag removes about k v² of speed per second" checks this.

## Curve: the Magnus effect

A spinning ball drags a thin layer of air around with it. On one side that air moves
with the airflow, on the other against it, creating a pressure difference that pushes
the ball sideways. The standard model:

```
a_magnus = S (ω × v)          S = BALL.magnus = 0.004
```

Shots only get spin around the vertical axis, `ω = (0, ω_y, 0)`. Then

```
ω × v = (ω_y v_z,  0,  -ω_y v_x)
```

which is horizontal and perpendicular to the flight: the ball bends without rising or
dipping. For a ball flying along +x with positive ω_y, the push is toward -z.

Where does spin come from? In `Kicking.strikeShot`, if your body faces a different way
from the shot (you're striking across the ball), `ω_y = -clamp(angleDiff(facing, shotAngle)
/ 0.8, -1, 1) * shotCurveSpin`. The minus sign makes the ball curl back toward where you
were facing. Spin decays exponentially, `ω *= e^(-spinDecay h)`, and four times faster
while rolling.

## Bouncing on the grass

If a sub-step leaves the ball below the ground (`p.y < r`):

```
p.y = r
if v.y < -restBounceSpeed:          a real bounce
    v.y = -v.y * e                  e = groundRestitution = 0.55
    v.x, v.z *= bounceFriction      grass grabs the ball (0.88)
else:
    v.y = 0                         too slow to bounce: start rolling
```

Restitution e is the fraction of vertical speed kept. Height goes with speed squared
(`h = v²/2g`), so each bounce reaches about **e² ≈ 0.30** of the previous height (also
tested). Without the `restBounceSpeed` cut-off the ball would bounce smaller and smaller
forever.

## Rolling friction

A rolling ball loses speed at a constant rate, `rollingDeceleration = 2.6 m/s²`, applied
against its horizontal velocity:

```
speed' = max(0, speed - 2.6 h)
```

The `max` stops friction from reversing the ball once it halts. With constant
deceleration a, kinematics gives the stopping distance:

```
v² = v0² - 2 a d   →   d_stop = v0² / (2a)        (10 m/s → 19.2 m)
```

The AI uses the same formula backwards to choose pass speeds: to arrive with speed
`v_end` after d metres, launch at `v0 = sqrt(v_end² + 2 a d)`. That's
`Kicking.groundPassSpeed`, with a 6% top-up for air drag.

## The boards and nets: half-spaces

The boards, ceiling netting and goal nets are flat. Each is a **half-space** test: if the
ball's surface has crossed the plane, put the ball back on the plane and reflect the
velocity component pointing into it:

```
if p.z + r > halfWidth:                    (side board, +z)
    p.z = halfWidth - r
    if v.z > 0: v.z = -v.z * boardRestitution     (0.70)
    v.x, v.y *= 0.95                               (a little friction along the board)
```

Because it only looks at position, a half-space can never be tunnelled through. The
worst case is one sub-step of overlap, corrected immediately.

The end boards have a hole: the goal mouth (|z| < 2.5 and y < 2.2) is open. Inside a goal
the back, side and roof nets are half-spaces too, but with `netRestitution = 0.12`, so
they swallow the ball. A last-resort clamp keeps the ball inside the arena volume no
matter what, which the fuzz test (150 random kicks) and the headless match check.

## Posts and crossbar: sphere vs capsule

A post is a cylinder, treated as a **capsule**: a line segment from `a` to `b` with
radius `R = 0.07 m`. The crossbar is the same along z. To collide a sphere (centre p,
radius r) with it (`Collisions.collideCapsule`):

1. **Closest point on the segment.** Project p onto the line and clamp to the segment:

   ```
   t = clamp( (p - a)·(b - a) / |b - a|², 0, 1 )
   c = a + t (b - a)
   ```

2. **Overlap test.** `d = |p - c|`. If `d < r + R` they overlap.
3. **Contact normal.** `n = (p - c) / d`, the direction from the post's axis to the ball.
4. **Push out.** `p = c + n (r + R)`, just touching.
5. **Reflect.** Split v into a normal part `(v·n) n` and a tangential part. Keep the
   tangential part, flip and scale the normal part by restitution e:

   ```
   v' = v - (1 + e)(v·n) n        only if v·n < 0 (moving into the post)
   ```

**Worked example** (from `tests/ballPhysics.test.ts`): a capsule along the x axis, ball
centre 0.15 m above it with v = (3, 0, -2). Then n = (0, 0, 1) and v·n = -2.
v' = (3, 0, -2) - 1.75 × (-2) × (0, 0, 1) = (3, 0, 1.5). The ball keeps its 3 m/s along
the post and bounces away at 2 × 0.75 = 1.5 m/s.

Hitting the post near its edge gives a normal at an angle, so the ball deflects sideways.
That's why some shots go in off the post and others bounce out.

## Goal detection

The rule: the **whole** ball must cross the **whole** line, between the posts and under
the bar (`match/GoalDetection.ts`):

```
|p.x| > halfLength + r   and   |p.z| < goalHalfWidth   and   p.y < goalHeight
```

A ball half over the line isn't a goal (tested). The z and y checks are safe because the
nets keep a ball that's inside the goal between the posts and under the bar.

## Player-ball interactions

These aren't rigid-body physics but simple rules (in `sim/players/`):

- **Dribbling**: the carrier taps the ball ahead at 1.32× their speed (1.62× sprinting)
  whenever it drops back near the feet, with a sideways correction. The ball is a real
  physics object between touches, so it can be nicked.
- **Trapping**: a loose ball within 0.6 m that is slower than 17 m/s relative to the
  player is controlled: its velocity becomes mostly the player's velocity.
- **Blocks**: a faster ball whose path this tick passes within body radius + ball radius
  of a player (a swept test) bounces off with restitution 0.4 and loses 30% of its speed.
- **Keepers**: a reach segment (a point standing, a line along the dive) is tested
  against the ball's path. Catch or parry depends on speed and how centred the ball is.

## Prediction reuses the physics

`BallPrediction` copies the ball and calls the same `stepBall()` 75 times (2.5 s at
1/30 s). The AI's view of the future therefore includes drag, curve, bounces and
rebounds for free, and never disagrees with what actually happens.

## Things to try

- Set `groundRestitution` to 0.9 in `#debug` and watch the ball bounce like a beach ball.
- Set `magnus` to 0.02 and strike shots across your body for banana kicks.
- Set `SIM.ballSubsteps` to 1 and fire full-power shots at the post: some will pass
  straight through. That's tunnelling.
- Write a test: from what height does a dropped ball stop bouncing? Predict it first with
  `restBounceSpeed` and `e`.
