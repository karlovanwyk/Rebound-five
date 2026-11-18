/**
 * Goalkeeping.ts: what a goalkeeper may do that other players can't. These are rules,
 * not AI: the keeper AI (sim/ai/Goalkeeper.ts) decides when to dive, and this file
 * decides what happens when it does.
 *
 *  - Inside their own keeper box (a 6 m semicircle), a keeper can use their hands. A ball
 *    within reach is caught if it isn't too fast and comes at the body; otherwise it's
 *    parried away from goal.
 *  - Tackle, for a keeper in their box, means dive in the move direction. A dive stretches
 *    the reach to a long capsule along the dive direction, but diving catches only hold
 *    slower shots.
 *  - A held ball sits in the hands. Opponents can't tackle it. Pass throws it, through ball
 *    punts it, and the keeper must let go within holdMaxTime.
 */
import type { Vector3 } from 'three';
import { BALL, KEEPER, PITCH, PLAYER } from '../../config';
import type { Intent } from '../../input/Intent';
import { recordPossessionGained, resolveShot } from '../match/Stats';
import type { PlayerState, World } from '../types';
import { isBodyLocked, startAction } from './Player';

/** Height of the hands when holding the ball. */
const HOLD_HEIGHT = 1.05;

/** Is this position inside `team`'s keeper box? */
export function isInKeeperBox(
  world: World,
  player: PlayerState,
  x = player.pos.x,
  z = player.pos.z,
): boolean {
  const goalX = -world.teams[player.team].attackDir * PITCH.halfLength;
  return Math.hypot(x - goalX, z) <= PITCH.keeperBoxRadius;
}

/** A keeper pressing tackle in their box dives instead. Returns true if a dive started. */
export function tryKeeperDive(world: World, keeper: PlayerState, intent: Intent): boolean {
  if (!keeper.isKeeper || !intent.tackle || !isInKeeperBox(world, keeper)) return false;
  if (keeper.tackleCooldown > 0 || isBodyLocked(keeper) || world.ball.heldByKeeper) return false;

  let dx = intent.moveX;
  let dz = intent.moveZ;
  const length = Math.hypot(dx, dz);
  if (length < 0.2) {
    // No direction given: dive to the keeper's left.
    dx = Math.sin(keeper.facing);
    dz = -Math.cos(keeper.facing);
  } else {
    dx /= length;
    dz /= length;
  }
  startAction(keeper, 'dive', KEEPER.diveDuration, dx, dz);
  keeper.vel.x = dx * KEEPER.diveSpeed;
  keeper.vel.z = dz * KEEPER.diveSpeed;
  keeper.tackleCooldown = KEEPER.diveDuration + 0.6;
  return true;
}

/**
 * Check every keeper for a save against this tick's ball movement (from ballStart to the
 * current position). Runs after the ball has moved and before normal possession.
 */
export function updateKeeperSaves(world: World, ballStart: Vector3): void {
  const { ball } = world;
  if (ball.ownerId !== null || ball.heldByKeeper) return;
  for (const keeper of world.players) {
    if (!keeper.isKeeper || keeper.kickLockout > 0) continue;
    if (keeper.action === 'fallen' || !isInKeeperBox(world, keeper)) continue;
    if (attemptSave(world, keeper, ballStart)) return;
  }
}

function attemptSave(world: World, keeper: PlayerState, ballStart: Vector3): boolean {
  const { ball } = world;
  const diving = keeper.action === 'dive';
  if (ball.pos.y > (diving ? 2.1 : KEEPER.reachHeight)) return false;

  // The keeper's "reach" is a segment on the ground plane: just a point when standing,
  // or a line from the body along the dive direction when diving. We find the closest
  // approach between that segment and the ball's path this tick.
  const ax = keeper.pos.x;
  const az = keeper.pos.z;
  // Standing, the hands reach out in front of the body (to the foot point). Diving, the
  // body stretches out along the dive direction over the first 0.15 s.
  const elapsed = keeper.actionDuration - keeper.actionTime;
  const stretch = diving ? KEEPER.diveReach * Math.min(1, elapsed / 0.15) : PLAYER.footOffset;
  const dirX = diving ? keeper.actionDirX : Math.cos(keeper.facing);
  const dirZ = diving ? keeper.actionDirZ : Math.sin(keeper.facing);
  const bx = ax + dirX * stretch;
  const bz = az + dirZ * stretch;
  const { distance, alongReach } = closestApproach(ballStart, ball.pos, ax, az, bx, bz);
  const reach = diving ? 0.45 : KEEPER.handReach;
  if (distance > reach) return false;

  const relativeSpeed = Math.hypot(ball.vel.x - keeper.vel.x, ball.vel.z - keeper.vel.z);
  const centred = diving ? alongReach < 0.8 : distance < KEEPER.centredRadius;
  const catchLimit = diving ? KEEPER.diveCatchMaxSpeed : KEEPER.catchMaxSpeed;
  const isShot = world.pendingShot !== null && world.pendingShot.team !== keeper.team;
  if (isShot) {
    world.stats[keeper.team].saves++;
    resolveShot(world, true);
  }

  if (relativeSpeed <= catchLimit && (centred || relativeSpeed < 10)) {
    catchBall(world, keeper);
    world.events.push({ type: 'save', playerId: keeper.id, kind: 'catch' });
  } else {
    parry(world, keeper, relativeSpeed);
    world.events.push({ type: 'save', playerId: keeper.id, kind: 'parry' });
  }
  return true;
}

/**
 * Closest distance between the ball's path segment (s -> e) and the keeper's reach
 * segment (a -> b) on the XZ plane. Sampling a few points along the ball path is plenty,
 * because the ball moves less than half a metre per tick.
 */
function closestApproach(
  s: Vector3,
  e: Vector3,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { distance: number; alongReach: number } {
  let best = Infinity;
  let bestAlong = 0;
  const abx = bx - ax;
  const abz = bz - az;
  const abLengthSq = abx * abx + abz * abz;
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const px = s.x + (e.x - s.x) * t;
    const pz = s.z + (e.z - s.z) * t;
    const u =
      abLengthSq > 1e-9
        ? Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / abLengthSq))
        : 0;
    const cx = ax + abx * u;
    const cz = az + abz * u;
    const d = Math.hypot(px - cx, pz - cz);
    if (d < best) {
      best = d;
      bestAlong = u * Math.sqrt(abLengthSq);
    }
  }
  return { distance: best, alongReach: bestAlong };
}

function catchBall(world: World, keeper: PlayerState): void {
  const { ball } = world;
  ball.ownerId = keeper.id;
  ball.ownerTime = 0;
  ball.heldByKeeper = true;
  ball.lastTouchId = keeper.id;
  ball.vel.set(0, 0, 0);
  ball.spin.set(0, 0, 0);
  keeper.holdTime = 0;
  recordPossessionGained(world, keeper);
}

/**
 * Push the ball away from goal. The new direction blends "away from the keeper's body"
 * with "straight out of the goal", and the ball pops up a little. The shooter keeps
 * last-touch credit, so a parry that still goes in is the shooter's goal, not an own goal.
 */
function parry(world: World, keeper: PlayerState, relativeSpeed: number): void {
  const { ball, rng } = world;
  const outX = world.teams[keeper.team].attackDir;
  let nx = ball.pos.x - keeper.pos.x;
  let nz = ball.pos.z - keeper.pos.z;
  const length = Math.hypot(nx, nz) || 1;
  nx = (nx / length) * 0.6 + outX * 0.8;
  nz = (nz / length) * 0.6 + rng.range(-0.25, 0.25);
  const blend = Math.hypot(nx, nz) || 1;
  const speed = relativeSpeed * KEEPER.parrySpeedFactor + 2;
  ball.vel.set((nx / blend) * speed, 2.5, (nz / blend) * speed);
  ball.spin.set(0, 0, 0);
  keeper.kickLockout = 0.35;
}

/** When a keeper takes control with their feet inside the box, they pick the ball up. */
export function pickUpIfKeeper(world: World, player: PlayerState): void {
  if (!player.isKeeper || !isInKeeperBox(world, player)) return;
  world.ball.heldByKeeper = true;
  player.holdTime = 0;
  // Gathering a shot that was heading in still counts as a save.
  if (world.pendingShot && world.pendingShot.team !== player.team) {
    world.stats[player.team].saves++;
    resolveShot(world, true);
    world.events.push({ type: 'save', playerId: player.id, kind: 'catch' });
  }
}

/** Keep a held ball in the keeper's hands and keep the keeper in their box. */
export function updateKeeperHolding(world: World, dt: number): void {
  const { ball } = world;
  if (!ball.heldByKeeper || ball.ownerId === null) return;
  const keeper = world.players[ball.ownerId];

  // Holding keepers can't leave the box: pull them back onto its edge.
  const goalX = -world.teams[keeper.team].attackDir * PITCH.halfLength;
  const dx = keeper.pos.x - goalX;
  const dz = keeper.pos.z;
  const d = Math.hypot(dx, dz);
  const limit = PITCH.keeperBoxRadius - 0.2;
  if (d > limit) {
    keeper.pos.x = goalX + (dx / d) * limit;
    keeper.pos.z = (dz / d) * limit;
  }

  ball.pos.set(
    keeper.pos.x + Math.cos(keeper.facing) * 0.35,
    HOLD_HEIGHT,
    keeper.pos.z + Math.sin(keeper.facing) * 0.35,
  );
  ball.vel.set(keeper.vel.x, 0, keeper.vel.z);

  keeper.holdTime += dt;
  if (keeper.holdTime > KEEPER.holdMaxTime || isBodyLocked(keeper)) {
    // Time's up: drop the ball and roll it out.
    ball.heldByKeeper = false;
    ball.ownerId = null;
    ball.pos.y = BALL.radius;
    ball.vel.set(Math.cos(keeper.facing) * 3, 0, Math.sin(keeper.facing) * 3);
    keeper.kickLockout = PLAYER.kickLockout;
  }
}
