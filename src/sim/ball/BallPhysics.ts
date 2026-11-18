/**
 * BallPhysics.ts: moves the ball through one tick. Gravity, air drag, curve (Magnus
 * effect), bouncing and rolling friction.
 *
 * Called by World.ts once per tick. Collisions with boards, posts, crossbar and nets live
 * in Collisions.ts. The full derivation is in docs/PHYSICS.md; the short version is in
 * the comments below.
 *
 * Integration method: semi-implicit (symplectic) Euler.
 *     v(t+h) = v(t) + a(t) * h
 *     x(t+h) = x(t) + v(t+h) * h     <- note: the NEW velocity
 * Plain ("explicit") Euler would use the old velocity for the position update. That
 * version slowly gains energy, so bounces get higher over time. Using the new velocity
 * costs nothing extra and stays stable at a fixed timestep, which is why the game uses
 * a fixed dt in the first place.
 */
import { Vector3 } from 'three';
import { BALL, SIM } from '../../config';
import type { SimEvent } from '../events';
import type { BallState } from '../types';
import { collideArena } from './Collisions';

// Scratch vectors, reused every call so the hot loop doesn't allocate garbage.
const acceleration = new Vector3();
const magnus = new Vector3();

/** Tolerance for "touching the ground" checks. */
const GROUND_EPSILON = 1e-4;

export function createBall(): BallState {
  return {
    pos: new Vector3(0, BALL.radius, 0),
    vel: new Vector3(),
    spin: new Vector3(),
    ownerId: null,
    lastTouchId: null,
    heldByKeeper: false,
  };
}

/** Put the ball on the centre spot, motionless and loose. */
export function resetBall(ball: BallState, x = 0, z = 0): void {
  ball.pos.set(x, BALL.radius, z);
  ball.vel.set(0, 0, 0);
  ball.spin.set(0, 0, 0);
  ball.ownerId = null;
  ball.heldByKeeper = false;
}

/** True when the ball is rolling along (or resting on) the grass rather than flying. */
export function isRolling(ball: BallState): boolean {
  return ball.pos.y <= BALL.radius + GROUND_EPSILON && Math.abs(ball.vel.y) <= GROUND_EPSILON;
}

/**
 * Advance the ball by one tick. The tick is split into SIM.ballSubsteps smaller steps,
 * so that at 28 m/s the ball moves about 12 cm per sub-step. That's less than the
 * combined radius of ball and post, so it can't "tunnel" through a post between two
 * checks.
 */
export function stepBall(ball: BallState, dt: number, events: SimEvent[] | null): void {
  const substeps = Math.max(1, Math.round(SIM.ballSubsteps));
  const h = dt / substeps;
  for (let i = 0; i < substeps; i++) {
    integrate(ball, h, events);
    collideArena(ball, events);
  }
}

function integrate(ball: BallState, h: number, events: SimEvent[] | null): void {
  const { pos, vel, spin } = ball;
  const rolling = isRolling(ball);

  acceleration.set(0, 0, 0);

  // Gravity. While rolling, the ground pushes back with an equal and opposite force,
  // so the two cancel and we skip gravity entirely.
  if (!rolling) acceleration.y -= BALL.gravity;

  // Air drag. Drag force grows with the square of speed: F = 0.5 * rho * Cd * A * v^2.
  // Folding the constants and the ball's mass into one coefficient k gives
  // a = -k * |v| * v. It points against the motion, and its size is k * speed^2.
  const speed = vel.length();
  acceleration.addScaledVector(vel, -BALL.airDrag * speed);

  // Magnus effect (curve). A spinning ball drags air around with it, so the air on one
  // side moves faster than on the other. The pressure difference pushes the ball
  // sideways: a = S * (spin x velocity). With spin only around Y, the push is
  // horizontal and at right angles to the flight path, so the shot bends.
  if (!rolling && spin.lengthSq() > 1e-6) {
    magnus.crossVectors(spin, vel).multiplyScalar(BALL.magnus);
    acceleration.add(magnus);
  }

  // Semi-implicit Euler: update velocity first, then position with the new velocity.
  vel.addScaledVector(acceleration, h);
  if (rolling) applyRollingFriction(ball, h);
  pos.addScaledVector(vel, h);

  // Spin fades exponentially: spin *= e^(-k h). It fades faster when the ball grips the grass.
  spin.multiplyScalar(Math.exp(-BALL.spinDecay * h * (rolling ? 4 : 1)));

  resolveGroundContact(ball, events);
}

/**
 * Rolling resistance: a constant deceleration against the direction of travel (like
 * sliding friction), so the ball stops after distance v^2 / (2 * deceleration). The
 * clamp stops friction from reversing the ball once it reaches zero speed.
 */
function applyRollingFriction(ball: BallState, h: number): void {
  const { vel } = ball;
  const horizontalSpeed = Math.hypot(vel.x, vel.z);
  const drop = BALL.rollingDeceleration * h;
  if (horizontalSpeed <= drop) {
    vel.x = 0;
    vel.z = 0;
  } else {
    const scale = (horizontalSpeed - drop) / horizontalSpeed;
    vel.x *= scale;
    vel.z *= scale;
  }
}

/**
 * Bouncing off the grass. If the ball has sunk below ground level, put it back on the
 * surface and reflect the vertical velocity, scaled by the restitution e (0 = dead,
 * 1 = perfectly elastic). Each bounce therefore reaches about e^2 of the previous height.
 * Slow bounces are turned into rolling so the ball settles instead of bouncing tiny
 * amounts forever.
 */
function resolveGroundContact(ball: BallState, events: SimEvent[] | null): void {
  const { pos, vel } = ball;
  if (pos.y >= BALL.radius) return;

  pos.y = BALL.radius;
  if (vel.y < -BALL.restBounceSpeed) {
    const impactSpeed = -vel.y;
    vel.y = impactSpeed * BALL.groundRestitution;
    // Grass grabs the ball on impact, taking away some horizontal speed.
    vel.x *= BALL.bounceFriction;
    vel.z *= BALL.bounceFriction;
    if (events && impactSpeed > 2.5) {
      events.push({
        type: 'bounce',
        surface: 'ground',
        speed: impactSpeed,
        x: pos.x,
        y: pos.y,
        z: pos.z,
      });
    }
  } else {
    vel.y = 0;
  }
}
