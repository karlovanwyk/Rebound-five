/**
 * Dribbling.ts: the ball carrier keeps the ball with small touches.
 *
 * The ball is never glued to the feet. Every so often (touchInterval), if the ball is
 * close enough, the carrier taps it forward a little faster than they're running. The
 * ball rolls ahead, friction slows it, the carrier catches up, and the cycle repeats.
 * Because the ball spends most of its time slightly ahead of the player as a real
 * physics object, a defender stepping into its path or a tackle can knock it loose.
 * Sprinting makes the touches bigger and less frequent, so the ball is easier to lose.
 */
import { PLAYER } from '../../config';
import { distanceXZ, lerp } from '../math';
import type { PlayerState, World } from '../types';
import { isBodyLocked } from './Player';

/** Below this speed the carrier is "standing" and shields the ball at their feet. */
const STANDING_SPEED = 0.8;

export function updateDribble(world: World, player: PlayerState, dt: number): void {
  const { ball } = world;
  if (ball.ownerId !== player.id || ball.heldByKeeper) return;
  if (player.touchTimer > 0) player.touchTimer -= dt;
  if (isBodyLocked(player) || player.kickLockout > 0) return;
  // Wait for a bouncing ball to come down before touching it.
  if (ball.pos.y > 0.5) return;

  const fx = Math.cos(player.facing);
  const fz = Math.sin(player.facing);
  const speed = Math.hypot(player.vel.x, player.vel.z);

  if (speed < STANDING_SPEED) {
    shieldBall(world, player, fx, fz);
    return;
  }

  if (player.touchTimer > 0) return;
  if (distanceXZ(player.pos, ball.pos) > PLAYER.kickReach) return;

  // Project the ball onto the player's facing direction (dot product) to see how far
  // ahead it is. Only touch it once it has dropped back near the feet.
  const offsetX = ball.pos.x - player.pos.x;
  const offsetZ = ball.pos.z - player.pos.z;
  const ahead = offsetX * fx + offsetZ * fz;
  if (ahead > PLAYER.footOffset + 0.35) return;

  // Sideways offset (dot product with the facing direction rotated 90 degrees). The touch
  // steers the ball back onto the line in front of the player.
  const sideways = offsetX * -fz + offsetZ * fx;
  const correction = -sideways * 3;

  const factor = player.sprinting ? PLAYER.sprintTouchSpeedFactor : PLAYER.touchSpeedFactor;
  const touchSpeed = speed * factor;
  ball.vel.x = fx * touchSpeed - fz * correction;
  ball.vel.z = fz * touchSpeed + fx * correction;
  if (ball.vel.y > 0) ball.vel.y = 0;
  ball.spin.set(0, 0, 0);
  ball.lastTouchId = player.id;

  player.touchTimer = player.sprinting ? PLAYER.sprintTouchInterval : PLAYER.touchInterval;
  world.events.push({ type: 'kick', playerId: player.id, kind: 'touch', power: touchSpeed / 12 });
}

/**
 * Standing still: ease the ball toward a spot just in front of the feet. This changes the
 * ball's velocity, not its position, so the ball is still a physical object that a
 * tackle can knock away.
 */
function shieldBall(world: World, player: PlayerState, fx: number, fz: number): void {
  const { ball } = world;
  const targetX = player.pos.x + fx * PLAYER.footOffset;
  const targetZ = player.pos.z + fz * PLAYER.footOffset;
  // Spring toward the target (velocity proportional to distance), blended in gradually
  // so it doesn't snap. A critically damped "settle".
  ball.vel.x = lerp(ball.vel.x, (targetX - ball.pos.x) * 4 + player.vel.x, 0.25);
  ball.vel.z = lerp(ball.vel.z, (targetZ - ball.pos.z) * 4 + player.vel.z, 0.25);
}
