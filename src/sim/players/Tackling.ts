/**
 * Tackling.ts: standing tackles and slide tackles.
 *
 * Standing tackle (tackle): a quick poke with the foot. A fraction of a second after it
 * starts, the sim checks whether the ball is within reach in front of the tackler. If it
 * is, success is a dice roll on the seeded RNG. The odds are good from the front and poor
 * from behind. A miss leaves the tackler off balance for a moment.
 *
 * Slide tackle (sprint + tackle): the tackler launches along their facing direction and
 * can't steer. While the slide is "active", the ball is knocked away if it comes within
 * reach of the leading foot. Sliding through a player knocks them over: there are no
 * fouls in this game, so it's a gamble, not a crime. A slide that misses leaves you on
 * the floor while the attacker runs off.
 *
 * Goalkeepers use tackle to dive instead; that's handled in Goalkeeping.ts.
 */
import { PLAYER, TACKLE } from '../../config';
import type { Intent } from '../../input/Intent';
import { angleDiff, angleOf } from '../math';
import type { PlayerState, World } from '../types';
import { isBodyLocked, startAction } from './Player';

/** Start a tackle if one was requested and allowed. */
export function startTackle(world: World, player: PlayerState, intent: Intent): void {
  if (!intent.tackle || player.tackleCooldown > 0 || isBodyLocked(player)) return;
  if (player.action === 'standTackle' || world.ball.ownerId === player.id) return;

  const fx = Math.cos(player.facing);
  const fz = Math.sin(player.facing);
  const speed = Math.hypot(player.vel.x, player.vel.z);
  player.charging = false;
  player.shotCharge = 0;

  if (intent.sprint && speed > PLAYER.runSpeed * 0.7) {
    startAction(player, 'slide', TACKLE.slideDuration, fx, fz);
    // Launch along the facing direction, never slower than the current speed.
    const launch = Math.max(TACKLE.slideSpeed, speed);
    player.vel.x = fx * launch;
    player.vel.z = fz * launch;
    player.tackleCooldown = TACKLE.slideDuration + TACKLE.cooldown;
  } else {
    startAction(player, 'standTackle', TACKLE.standDuration, fx, fz);
    player.tackleCooldown = TACKLE.cooldown;
  }
}

/** Resolve tackles in progress. Runs after the ball has moved this tick. */
export function updateTackles(world: World): void {
  for (const player of world.players) {
    if (player.action === 'standTackle' && !player.actionResolved) {
      const elapsed = player.actionDuration - player.actionTime;
      if (elapsed >= TACKLE.standContactTime) resolveStandingTackle(world, player);
    } else if (player.action === 'slide') {
      updateSlide(world, player);
    }
  }
}

function resolveStandingTackle(world: World, tackler: PlayerState): void {
  const { ball, rng } = world;
  tackler.actionResolved = true;
  const fx = Math.cos(tackler.facing);
  const fz = Math.sin(tackler.facing);
  // The foot lunges out to roughly half the reach, so measure from there.
  const footX = tackler.pos.x + fx * TACKLE.standReach * 0.5;
  const footZ = tackler.pos.z + fz * TACKLE.standReach * 0.5;
  const reach = Math.hypot(ball.pos.x - footX, ball.pos.z - footZ);
  const owner = ball.ownerId !== null ? world.players[ball.ownerId] : null;

  const inReach = reach <= TACKLE.standReach * 0.6 && ball.pos.y < 1 && !ball.heldByKeeper;
  if (!inReach || (owner && owner.team === tackler.team)) {
    world.events.push({ type: 'tackle', playerId: tackler.id, kind: 'stand', won: false });
    tackler.tackleCooldown += TACKLE.missPenalty;
    return;
  }

  let chance = 0.95; // a loose ball is easy to poke away
  if (owner) {
    // Coming from behind: the angle from the carrier to the tackler is far from the
    // direction the carrier is facing.
    const fromCarrier = angleOf(tackler.pos.x - owner.pos.x, tackler.pos.z - owner.pos.z);
    const fromBehind = Math.abs(angleDiff(fromCarrier, owner.facing)) > 2.2;
    chance = fromBehind ? TACKLE.standFromBehindSuccess : TACKLE.standSuccess;
  }

  if (!rng.chance(chance)) {
    world.events.push({ type: 'tackle', playerId: tackler.id, kind: 'stand', won: false });
    tackler.tackleCooldown += TACKLE.missPenalty;
    return;
  }

  knockBall(world, tackler, fx, fz, 0.35);
  if (owner) startAction(owner, 'fallen', TACKLE.stumbleTime);
  world.stats[tackler.team].tacklesWon++;
  world.events.push({ type: 'tackle', playerId: tackler.id, kind: 'stand', won: true });
}

function updateSlide(world: World, slider: PlayerState): void {
  const { ball } = world;
  const progress = 1 - slider.actionTime / slider.actionDuration;
  const dx = slider.actionDirX;
  const dz = slider.actionDirZ;
  const footX = slider.pos.x + dx * 0.7;
  const footZ = slider.pos.z + dz * 0.7;

  // Bodies in the way go down (once each).
  for (const other of world.players) {
    if (other.team === slider.team || other.isKeeper || isBodyLocked(other)) continue;
    if (Math.hypot(other.pos.x - footX, other.pos.z - footZ) < 0.6) {
      startAction(other, 'fallen', TACKLE.knockdownTime);
    }
  }

  if (slider.actionResolved || progress > TACKLE.slideActiveFraction) return;
  if (ball.heldByKeeper || ball.pos.y > 0.8) return;
  if (Math.hypot(ball.pos.x - footX, ball.pos.z - footZ) > TACKLE.slideReach) return;
  const owner = ball.ownerId !== null ? world.players[ball.ownerId] : null;
  if (owner && owner.team === slider.team) return;

  slider.actionResolved = true;
  knockBall(world, slider, dx, dz, 0.5);
  if (owner && !isBodyLocked(owner)) startAction(owner, 'fallen', TACKLE.knockdownTime);
  world.stats[slider.team].tacklesWon++;
  world.events.push({ type: 'tackle', playerId: slider.id, kind: 'slide', won: true });
}

/** Send the ball away roughly along (dirX, dirZ) with a bit of random spread. */
function knockBall(
  world: World,
  tackler: PlayerState,
  dirX: number,
  dirZ: number,
  spread: number,
): void {
  const { ball, rng } = world;
  const angle = angleOf(dirX, dirZ) + rng.gaussian() * spread;
  const speed = TACKLE.knockSpeed * rng.range(0.75, 1.15);
  ball.vel.set(Math.cos(angle) * speed, 0.6, Math.sin(angle) * speed);
  ball.spin.set(0, 0, 0);
  ball.ownerId = null;
  ball.lastTouchId = tackler.id;
  world.pendingPass = null;
  world.events.push({ type: 'kick', playerId: tackler.id, kind: 'touch', power: 0.5 });
}
