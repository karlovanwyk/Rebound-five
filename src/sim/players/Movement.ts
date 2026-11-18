/**
 * Movement.ts: turns an Intent's move direction into running, for every player.
 *
 * Players don't move straight to the requested velocity; they accelerate toward it with
 * a limited acceleration. That gives weight: you can't reverse instantly, and a CPU
 * defender who commits the wrong way needs time to recover, just like you. The same
 * limits apply to every player, so the CPU has no speed advantage.
 */
import { PITCH, PLAYER } from '../../config';
import type { Intent } from '../../input/Intent';
import { angleOf, rotateTowards } from '../math';
import type { PlayerState } from '../types';
import { isBodyLocked } from './Player';

/** How quickly a slide or dive bleeds off speed (m/s^2). */
const SLIDE_FRICTION = 9;
/** How quickly a fallen or celebrating player comes to rest. */
const GROUND_FRICTION = 18;

export function updateMovement(
  player: PlayerState,
  intent: Intent,
  hasBall: boolean,
  dt: number,
): void {
  if (isBodyLocked(player)) {
    updateLockedMovement(player, dt);
    return;
  }

  // Input direction, clamped to length 1 (analog sticks can report slightly more).
  let mx = intent.moveX;
  let mz = intent.moveZ;
  const inputLength = Math.hypot(mx, mz);
  if (inputLength > 1) {
    mx /= inputLength;
    mz /= inputLength;
  }

  player.sprinting = intent.sprint && inputLength > 0.1;
  let topSpeed = player.sprinting ? PLAYER.sprintSpeed : PLAYER.runSpeed;
  if (hasBall) topSpeed *= PLAYER.dribbleSpeedFactor;
  if (player.charging) topSpeed *= PLAYER.chargingSpeedFactor;
  if (player.action === 'standTackle' || player.action === 'kick' || player.action === 'throw') {
    topSpeed *= 0.55;
  }

  const desiredX = mx * topSpeed;
  const desiredZ = mz * topSpeed;
  accelerateTowards(player, desiredX, desiredZ, dt);

  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;

  // Turn to face the input direction, at a limited rate (slower while dribbling).
  if (inputLength > 0.15) {
    const turnRate = hasBall ? PLAYER.turnRateDribbling : PLAYER.turnRate;
    player.facing = rotateTowards(player.facing, angleOf(mx, mz), turnRate * dt);
  }
  clampToArena(player);
}

/**
 * Move velocity toward the desired velocity, changing it by at most a * dt this tick.
 * Speeding up uses `acceleration`; slowing down or changing direction uses the larger
 * `deceleration`, because stopping is easier than starting.
 */
function accelerateTowards(
  player: PlayerState,
  desiredX: number,
  desiredZ: number,
  dt: number,
): void {
  const dvx = desiredX - player.vel.x;
  const dvz = desiredZ - player.vel.z;
  const change = Math.hypot(dvx, dvz);
  if (change < 1e-6) return;

  const speedingUp = Math.hypot(desiredX, desiredZ) >= Math.hypot(player.vel.x, player.vel.z);
  const maxChange = (speedingUp ? PLAYER.acceleration : PLAYER.deceleration) * dt;
  const scale = change > maxChange ? maxChange / change : 1;
  player.vel.x += dvx * scale;
  player.vel.z += dvz * scale;
}

/** During slides, dives and falls the player can't steer; they just slow down. */
function updateLockedMovement(player: PlayerState, dt: number): void {
  const sliding = player.action === 'slide' || player.action === 'dive';
  const friction = sliding ? SLIDE_FRICTION : GROUND_FRICTION;
  const speed = Math.hypot(player.vel.x, player.vel.z);
  const drop = friction * dt;
  const scale = speed > drop ? (speed - drop) / speed : 0;
  player.vel.x *= scale;
  player.vel.z *= scale;
  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  player.sprinting = false;
  clampToArena(player);
}

/** Players stay inside the boards. They can stand on the goal line but not inside the goal. */
export function clampToArena(player: PlayerState): void {
  const maxX = PITCH.halfLength - 0.3;
  const maxZ = PITCH.halfWidth - 0.3;
  const { pos, vel } = player;
  if (pos.x > maxX) {
    pos.x = maxX;
    if (vel.x > 0) vel.x = 0;
  } else if (pos.x < -maxX) {
    pos.x = -maxX;
    if (vel.x < 0) vel.x = 0;
  }
  if (pos.z > maxZ) {
    pos.z = maxZ;
    if (vel.z > 0) vel.z = 0;
  } else if (pos.z < -maxZ) {
    pos.z = -maxZ;
    if (vel.z < 0) vel.z = 0;
  }
}

/**
 * Stop bodies overlapping. For each pair closer than two body radii, push both apart
 * equally along the line between them. Pairs are visited in a fixed order, so the result
 * is deterministic.
 */
export function separatePlayers(players: PlayerState[]): void {
  const minDistance = PLAYER.bodyRadius * 2;
  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j];
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const distSq = dx * dx + dz * dz;
      if (distSq >= minDistance * minDistance) continue;
      const dist = Math.sqrt(distSq);
      // Perfectly overlapping players are pushed apart along x by convention.
      const nx = dist > 1e-6 ? dx / dist : 1;
      const nz = dist > 1e-6 ? dz / dist : 0;
      const push = (minDistance - dist) / 2;
      a.pos.x -= nx * push;
      a.pos.z -= nz * push;
      b.pos.x += nx * push;
      b.pos.z += nz * push;
    }
  }
}
