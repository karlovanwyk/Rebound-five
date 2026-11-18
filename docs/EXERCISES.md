# Exercises

Ten challenges, from a one-line tweak to new game features. Each has a hint pointing at
the right file. Run `npm run dev` in one terminal and `npm run test:watch` in another
while you work; `#debug` in the URL lets you inspect and tune live.

## 1. Make the ball bouncier ⭐

Make the ball bounce higher off the grass and harder off the boards.

**Hint:** `BALL.groundRestitution` and `BALL.boardRestitution` in `src/config.ts`. Try it
live first with the lil-gui sliders in `#debug`. Then check that
`tests/ballPhysics.test.ts` still passes: the bounce test computes its expectation from
the config, so it should.

## 2. Bigger goals, wider pitch ⭐

Make the goals 6 m wide and the pitch 30 m wide.

**Hint:** `PITCH` in `src/config.ts`. Physics, rendering, the pitch markings, the minimap
and the AI all read these numbers, so nothing else needs editing. Does the AI formation
still look sensible? (Formations are stored as normalised coordinates, so they stretch
automatically: see `TeamBrain.ts`.)

## 3. Design your own team ⭐

Add a new starter kit, and a new CPU team with home and away kits.

**Hint:** `KITS` and `CPU_TEAMS` in `src/config.ts`. Kit-clash avoidance picks whichever
CPU kit contrasts most with yours (`contrastingKit` in `src/core/MatchSession.ts`).

## 4. A stamina bar ⭐⭐

Sprinting should drain stamina; when it's empty you can't sprint until it recovers. Show
the controlled player's stamina in the HUD.

**Hint:** add `stamina` to `PlayerState` (`src/sim/types.ts`, `players/Player.ts`), drain
and refill it in `players/Movement.ts` (only allow `player.sprinting` when there's stamina),
copy it into the `Snapshot` (`src/sim/Snapshot.ts`) and draw a bar in `src/ui/Hud.ts`.
Because the AI sprints through the same Intent, it gets tired too: fair play for free.
Write a test that sprints for 10 seconds and checks speed drops.

## 5. Headers ⭐⭐

Let players head lofted balls (between 1.1 m and 2.0 m high) toward goal or a teammate.

**Hint:** `canPlayBall()` in `src/sim/players/Kicking.ts` rejects balls above
`PLAYER.maxKickHeight`. Add a header path for higher balls with a weaker, less accurate
strike. Add a `'header'` value to `KickKind` in `events.ts` and a head-nod pose in
`render/PlayerModel.ts`.

## 6. A new formation ⭐⭐

Give the CPU a 2-1-1 "box" shape when defending and a flat 1-3 line when attacking. Then
make the formation a per-team setting.

**Hint:** `DEFEND_SHAPE` and `ATTACK_SHAPE` in `src/sim/ai/TeamBrain.ts` are `[u, v]`
pairs (see the table in [AI.md](AI.md)). Use `#debug`'s AI overlay to watch players
take up their new homes.

## 7. An "Ultra" difficulty ⭐⭐

Add a fourth preset that's harder than Hard, unlocked by winning the Cup.

**Hint:** `AI.presets` and the `Difficulty` type in `src/config.ts`, `DIFFICULTIES` and
`DIFFICULTY_BLURBS` in `src/sim/ai/Difficulty.ts`, the records in `src/core/Storage.ts`
(remember `sanitise()` must accept the new key) and the option group in
`src/ui/Menus.ts`. Then use `tests/simulateMatch.ts` to check Ultra beats Hard over
several seeds without breaking any rule: only change decision settings, never speeds.

## 8. Teach the CPU a long-ball tactic ⭐⭐⭐

When the CPU is chasing the game (losing in the last third of the match) or its
defenders are under heavy pressure, it should hit early lofted balls toward its striker
instead of passing short.

**Hint:** decisions happen in `decide()` in `src/sim/ai/PlayerStates.ts`, using scores
from `src/sim/ai/PassScoring.ts`. Add a "tactic" to `TeamBrain` (it can read
`world.match.score` and the clock), and when it's active give lofted options to the
striker (index 4) a bonus. Measure the effect with `simulateMatch`: do shots and goals
go up? Does possession go down?

## 9. A penalty shootout ⭐⭐⭐

Replace golden goal in the Cup with a penalty shootout: five kicks each, then sudden
death.

**Hint:** add a `'penalties'` `MatchPhase` in `src/sim/types.ts` and handle it in
`stepWorld()` (`src/sim/World.ts`) and `src/sim/match/Match.ts` (`tickClock` currently
switches to golden goal). The penalty spot is already painted 6 m from each goal
(`render/PitchTexture.ts`). Place the ball there, freeze everyone except the taker and
the keeper, and let the keeper AI's `SaveShot` state do its job. The CPU taker can use
the `Shoot` state with its aim noise. Show the kicks in the HUD, and add a
`GameStateMachine` state if you want a separate screen.

## 10. True replays from Intents ⭐⭐⭐

The instant replay stores rendered snapshots. Because the simulation is deterministic,
you could instead store only the **seed and the human's Intents per tick** and re-run the
whole match to replay it, from any camera, at any speed, even after a reload.

**Hint:** record `humanIntent` each tick in `src/core/MatchSession.ts` (one small object
per tick; about 650 kB for a 3-minute match as JSON). To replay, create a new
`MatchSession` with the same seed and feed the recorded Intents back into `step()`. The
headless test `tests/headlessMatch.test.ts` already proves the "same seed, same match"
half. Save a replay to localStorage and add a "Watch last match" menu item.

## Bonus: profile and optimise

Record a Performance profile (see [HOW_THE_WEB_WORKS.md](HOW_THE_WEB_WORKS.md)) and find
the most expensive function. Can you halve the AI's cost by updating the ball prediction
every other tick? Use `tests/headlessMatch.test.ts` and `simulateMatch` to make sure the
AI still plays as well.
