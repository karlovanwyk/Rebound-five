/**
 * Possession.ts: who controls the ball. Trapping, losing it, nicking it, and blocks.
 *
 * Rules, checked every tick after the ball has moved:
 *  1. The carrier loses the ball if it gets too far away, flies too high, or they fall.
 *  2. An opponent who gets clearly closer to the ball than the carrier steals it. This is
 *     why a heavy touch can be punished.
 *  3. A loose ball is trapped by the nearest eligible player, if it's slow enough
 *     (relative to them) to control.
 *  4. A ball arriving too fast to control hits the player's body and deflects. That's a
 *     block.
 */
import type { Vector3 } from 'three';
import { BALL, PLAYER } from '../../config';
import { resolveShot } from '../match/Stats';
import { distanceXZ } from '../math';
import type { PlayerState, World } from '../types';
import { footX, footZ, isBodyLocked } from './Player';

/** The ball must be lower than this to be trapped with the feet. */
const TRAP_HEIGHT = 0.9;
/** Bodies block balls up to about head height. */
const BLOCK_HEIGHT = 1.9;
/** An opponent must be this much closer than the carrier to nick the ball. */
const STEAL_MARGIN = 0.18;

export type PossessionChange = { gainedBy: PlayerState } | null;

/**
 * Update possession. `ballStart` is where the ball was at the start of this tick. It's
 * used for a swept test, so a fast ball can't jump past a body between two ticks.
 * Returns the player who just gained control, if anyone did.
 */
export function updatePossession(world: World, ballStart: Vector3): PossessionChange {
  const { ball, players } = world;
  if (ball.heldByKeeper) return null;

  if (ball.ownerId !== null) {
    const owner = players[ball.ownerId];
    const tooFar = distanceXZ(owner.pos, ball.pos) > PLAYER.keepRadius;
    if (tooFar || ball.pos.y > 1.6 || isBodyLocked(owner)) ball.ownerId = null;
  }

  if (ball.ownerId !== null) {
    const thief = findThief(world, players[ball.ownerId]);
    if (thief) {
      gainControl(world, thief);
      return { gainedBy: thief };
    }
    return null;
  }

  // Loose ball: find the closest player who could play it.
  let best: PlayerState | null = null;
  let bestDistance = Infinity;
  for (const player of players) {
    if (!canTouchBall(player)) continue;
    const d = touchDistance(player, ball.pos);
    if (d < PLAYER.pickupRadius && ball.pos.y < TRAP_HEIGHT && d < bestDistance) {
      best = player;
      bestDistance = d;
    }
  }

  if (best) {
    const relativeSpeed = Math.hypot(ball.vel.x - best.vel.x, ball.vel.z - best.vel.z);
    if (relativeSpeed <= PLAYER.trapMaxSpeed) {
      gainControl(world, best);
      return { gainedBy: best };
    }
  }

  blockFastBalls(world, ballStart);
  return null;
}

export function canTouchBall(player: PlayerState): boolean {
  return player.kickLockout <= 0 && !isBodyLocked(player);
}

/** Distance from the ball to whichever is closer: the player's body or their foot point. */
function touchDistance(player: PlayerState, ballPos: Vector3): number {
  const toBody = distanceXZ(player.pos, ballPos);
  const toFoot = Math.hypot(footX(player) - ballPos.x, footZ(player) - ballPos.z);
  return Math.min(toBody, toFoot);
}

function findThief(world: World, owner: PlayerState): PlayerState | null {
  const { ball } = world;
  if (ball.pos.y > TRAP_HEIGHT) return null;
  const ownerDistance = touchDistance(owner, ball.pos);
  let thief: PlayerState | null = null;
  let thiefDistance = Infinity;
  for (const player of world.players) {
    if (player.team === owner.team || !canTouchBall(player)) continue;
    const d = touchDistance(player, ball.pos);
    if (d < PLAYER.pickupRadius * 0.85 && d < ownerDistance - STEAL_MARGIN && d < thiefDistance) {
      thief = player;
      thiefDistance = d;
    }
  }
  return thief;
}

/** Take control: cushion the ball so it moves with the player. */
export function gainControl(world: World, player: PlayerState): void {
  const { ball } = world;
  ball.ownerId = player.id;
  ball.lastTouchId = player.id;
  // Keep 15% of the ball's own velocity so the first touch isn't perfectly dead.
  ball.vel.x = player.vel.x * 0.85 + ball.vel.x * 0.15;
  ball.vel.z = player.vel.z * 0.85 + ball.vel.z * 0.15;
  ball.vel.y = Math.min(ball.vel.y, 0) * 0.3;
  ball.spin.set(0, 0, 0);
  player.touchTimer = 0.12;
  world.events.push({ type: 'trap', playerId: player.id });
}

/**
 * A ball too fast to trap bounces off any body in its path. "In its path" means the
 * segment the ball travelled this tick passes within bodyRadius + ballRadius of the
 * player's centre line.
 */
function blockFastBalls(world: World, ballStart: Vector3): void {
  const { ball } = world;
  if (ball.pos.y > BLOCK_HEIGHT) return;
  const reach = PLAYER.bodyRadius + BALL.radius;

  for (const player of world.players) {
    if (player.kickLockout > 0 || player.action === 'dive') continue;
    // Closest point on this tick's ball path to the player (swept test).
    const sx = ballStart.x;
    const sz = ballStart.z;
    const ex = ball.pos.x - sx;
    const ez = ball.pos.z - sz;
    const lengthSq = ex * ex + ez * ez;
    const t =
      lengthSq > 1e-9
        ? Math.max(0, Math.min(1, ((player.pos.x - sx) * ex + (player.pos.z - sz) * ez) / lengthSq))
        : 1;
    const cx = sx + ex * t;
    const cz = sz + ez * t;
    const dx = cx - player.pos.x;
    const dz = cz - player.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist >= reach) continue;

    // Contact normal from the body to the ball. Reflect the inward part of the velocity
    // (restitution 0.4) and lose some energy into the body.
    const nx = dist > 1e-6 ? dx / dist : -ex / Math.sqrt(lengthSq || 1);
    const nz = dist > 1e-6 ? dz / dist : -ez / Math.sqrt(lengthSq || 1);
    const vn = ball.vel.x * nx + ball.vel.z * nz;
    if (vn < 0) {
      ball.vel.x -= 1.4 * vn * nx;
      ball.vel.z -= 1.4 * vn * nz;
    }
    ball.vel.multiplyScalar(0.7);
    ball.spin.set(0, 0, 0);
    ball.pos.x = player.pos.x + nx * reach;
    ball.pos.z = player.pos.z + nz * reach;
    ball.lastTouchId = player.id;
    // A blocked shot did not hit the target.
    if (world.pendingShot) resolveShot(world, false);
    player.kickLockout = 0.12;
    world.events.push({
      type: 'bounce',
      surface: 'player',
      speed: Math.abs(vn),
      x: ball.pos.x,
      y: ball.pos.y,
      z: ball.pos.z,
    });
    return;
  }
}
