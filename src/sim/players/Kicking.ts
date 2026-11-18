/**
 * Kicking.ts: turns pass / through-ball / shoot Intents into ball velocities.
 *
 * Shared rules for human and CPU players:
 *  - You can only kick a ball you control, or a loose ball within reach. An opponent's
 *    ball has to be won with a tackle first.
 *  - Shot power comes from how long shoot was held (measured here, not by the
 *    controller), and stronger shots are less accurate.
 *  - A kick pressed slightly before the ball arrives is buffered, which allows
 *    first-time passes and volleys.
 */
import { BALL, KICK, PITCH, PLAYER } from '../../config';
import type { Intent } from '../../input/Intent';
import type { KickKind } from '../events';
import { recordPass, recordShot } from '../match/Stats';
import { angleDiff, angleOf, clamp, distanceXZ, lerp } from '../math';
import type { BufferedKick, PlayerState, World } from '../types';
import { isBodyLocked, startAction } from './Player';

/** Facing more than this far away from the goal turns a shot into a clearance. */
const MAX_SHOT_ANGLE = (100 * Math.PI) / 180;

/** Result of processing one player's kick intents this tick. */
export interface KickResult {
  kicked: boolean;
  /** The intended receiver if a pass was played. */
  receiver: PlayerState | null;
}

export function processKickIntents(
  world: World,
  player: PlayerState,
  intent: Intent,
  dt: number,
): KickResult {
  const result: KickResult = { kicked: false, receiver: null };

  // --- Shot charging: hold to build power, release to strike. ---
  if (intent.shoot && !isBodyLocked(player)) {
    player.charging = true;
    player.shotCharge = Math.min(1, player.shotCharge + dt / PLAYER.shotChargeTime);
  } else if (player.charging) {
    const power = player.shotCharge;
    player.charging = false;
    player.shotCharge = 0;
    queueKick(player, 'shot', power);
  }
  if (intent.pass) queueKick(player, 'pass', 0);
  if (intent.throughBall) queueKick(player, 'through', 0);

  // --- Buffered kicks fire as soon as the ball is playable. ---
  const pending = player.buffered;
  if (pending) {
    if (canPlayBall(world, player)) {
      player.buffered = null;
      result.receiver = executeKick(world, player, intent, pending);
      result.kicked = true;
    } else {
      pending.timeLeft -= dt;
      if (pending.timeLeft <= 0) player.buffered = null;
    }
  }
  return result;
}

function queueKick(player: PlayerState, kind: BufferedKick['kind'], power: number): void {
  player.buffered = { kind, power, timeLeft: PLAYER.actionBuffer };
}

/** Can this player kick the ball right now? */
export function canPlayBall(world: World, player: PlayerState): boolean {
  const { ball } = world;
  if (player.kickLockout > 0 || isBodyLocked(player)) return false;
  if (ball.ownerId !== null && ball.ownerId !== player.id) return false;
  return distanceXZ(player.pos, ball.pos) <= PLAYER.kickReach && ball.pos.y <= PLAYER.maxKickHeight;
}

function executeKick(
  world: World,
  player: PlayerState,
  intent: Intent,
  kick: BufferedKick,
): PlayerState | null {
  if (kick.kind === 'shot') {
    strikeShot(world, player, intent, kick.power);
    return null;
  }
  return strikePass(world, player, intent, kick.kind === 'through');
}

/** The direction a player is aiming: the stick if it's pushed, otherwise where they face. */
export function aimDirection(player: PlayerState, intent: Intent): { x: number; z: number } {
  const length = Math.hypot(intent.moveX, intent.moveZ);
  if (length > 0.3) return { x: intent.moveX / length, z: intent.moveZ / length };
  return { x: Math.cos(player.facing), z: Math.sin(player.facing) };
}

/**
 * Pick the teammate the pass is meant for: anyone within the pass cone around the aim
 * direction, preferring the most direct line and then the nearer player.
 */
export function choosePassReceiver(
  world: World,
  passer: PlayerState,
  aimX: number,
  aimZ: number,
): PlayerState | null {
  const cone = (KICK.passConeDegrees * Math.PI) / 180;
  const aimAngle = angleOf(aimX, aimZ);
  let best: PlayerState | null = null;
  let bestScore = Infinity;
  for (const mate of world.players) {
    if (mate.team !== passer.team || mate === passer) continue;
    const dx = mate.pos.x - passer.pos.x;
    const dz = mate.pos.z - passer.pos.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1.5) continue;
    const offAngle = Math.abs(angleDiff(angleOf(dx, dz), aimAngle));
    if (offAngle > cone) continue;
    const score = offAngle / cone + distance / 60;
    if (score < bestScore) {
      best = mate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Ground pass or lofted through ball toward a teammate.
 *
 * Ground pass speed comes from constant-deceleration kinematics. The ball should still
 * be rolling at `passArriveSpeed` when it reaches the target, d metres away:
 *     v_end^2 = v0^2 - 2 a d   =>   v0 = sqrt(v_end^2 + 2 a d)
 * where a is the rolling deceleration. A 6% top-up covers air drag.
 *
 * Through balls are lofted into space ahead of the receiver. Choose a flight time T
 * (longer for longer passes); then the launch speed upward is vy = g T / 2, since the
 * ball spends half its flight rising. The horizontal speed covers 80% of the distance
 * in the air, and the ball rolls the rest.
 *
 * Aim assist: the pass goes toward the chosen receiver, but a fraction (1 - assist) of
 * the gap between your raw aim and the receiver is kept. Sloppy aim (human or CPU) gives
 * a slightly sloppy pass.
 */
export function strikePass(
  world: World,
  player: PlayerState,
  intent: Intent,
  lofted: boolean,
): PlayerState | null {
  const { ball, rng } = world;
  const aim = aimDirection(player, intent);
  const receiver = choosePassReceiver(world, player, aim.x, aim.z);
  const attackDir = world.teams[player.team].attackDir;

  let targetX: number;
  let targetZ: number;
  if (receiver) {
    const distance = distanceXZ(ball.pos, receiver.pos);
    // Lead the receiver: aim where they'll be when the ball arrives.
    const travelTime = distance / (lofted ? 14 : 13);
    targetX = receiver.pos.x + receiver.vel.x * travelTime * 0.8;
    targetZ = receiver.pos.z + receiver.vel.z * travelTime * 0.8;
    if (lofted) targetX += attackDir * KICK.throughLead;
  } else {
    targetX = ball.pos.x + aim.x * (lofted ? 16 : 10);
    targetZ = ball.pos.z + aim.z * (lofted ? 16 : 10);
  }
  targetX = clamp(targetX, -PITCH.halfLength + 1.5, PITCH.halfLength - 1.5);
  targetZ = clamp(targetZ, -PITCH.halfWidth + 1.2, PITCH.halfWidth - 1.2);

  const dx = targetX - ball.pos.x;
  const dz = targetZ - ball.pos.z;
  const distance = Math.max(1, Math.hypot(dx, dz));
  let angle = angleOf(dx, dz);
  const keptError = clamp(
    angleDiff(angleOf(aim.x, aim.z), angle) * (1 - KICK.passAimAssist),
    -0.12,
    0.12,
  );
  angle += keptError + rng.gaussian() * (player.sprinting ? 0.03 : 0.012);

  if (lofted) {
    const flightTime = clamp(distance / 15, KICK.throughMinFlight, KICK.throughMaxFlight);
    const horizontal = ((distance * 0.8) / flightTime) * 1.08;
    ball.vel.set(
      Math.cos(angle) * horizontal,
      (BALL.gravity * flightTime) / 2,
      Math.sin(angle) * horizontal,
    );
  } else {
    const ideal =
      Math.sqrt(KICK.passArriveSpeed ** 2 + 2 * BALL.rollingDeceleration * distance) * 1.06;
    const speed = clamp(ideal, KICK.passMinSpeed, KICK.passMaxSpeed);
    ball.vel.set(Math.cos(angle) * speed, 0, Math.sin(angle) * speed);
  }
  ball.spin.set(0, 0, 0);

  releaseBall(world, player, lofted ? 'through' : 'pass', lofted ? 0.7 : 0.4);
  recordPass(world, player, receiver);
  return receiver;
}

/**
 * Shoot at the goal the player's team attacks.
 *
 * Aiming: pushing the stick across the pitch (z) aims toward that post. With no
 * sideways input, the shot goes where the player is facing, clipped to the goal mouth.
 * Errors: direction error is drawn from a bell curve (SeededRandom.gaussian). Its spread
 * grows with power squared and with being off-balance (shooting across your body, or
 * sprinting).
 * Curve: striking across the ball (facing differs from shot direction) adds side spin,
 * and the Magnus effect in BallPhysics bends the flight.
 */
export function strikeShot(world: World, player: PlayerState, intent: Intent, power: number): void {
  const { ball, rng } = world;
  const attackDir = world.teams[player.team].attackDir;
  const goalX = attackDir * PITCH.halfLength;

  const angleToGoal = angleOf(goalX - ball.pos.x, -ball.pos.z);
  if (Math.abs(angleDiff(angleToGoal, player.facing)) > MAX_SHOT_ANGLE) {
    clearance(world, player, power);
    return;
  }

  const aimZ = chooseShotAimZ(player, intent, goalX);
  const aimAngle = angleOf(goalX - ball.pos.x, aimZ - ball.pos.z);

  const offBalance =
    Math.abs(angleDiff(aimAngle, player.facing)) / Math.PI + (player.sprinting ? 0.25 : 0);
  const spread =
    (KICK.shotErrorBase + KICK.shotErrorAtFullPower * power * power) * (1 + offBalance * 1.5);
  const angle = aimAngle + rng.gaussian() * spread;

  const speed = lerp(KICK.shotMinSpeed, KICK.shotMaxSpeed, power);
  const lift =
    lerp(KICK.shotLiftMin, KICK.shotLiftMax, Math.pow(power, 1.5)) + rng.gaussian() * 0.5 * power;

  ball.vel.set(Math.cos(angle) * speed, Math.max(0, lift), Math.sin(angle) * speed);

  // Side spin from striking across the ball. Positive spin around Y bends the ball toward
  // a smaller angle, so negate to bend it back toward the way the player is facing.
  const across = clamp(angleDiff(player.facing, angle) / 0.8, -1, 1);
  ball.spin.set(0, -across * KICK.shotCurveSpin, 0);

  releaseBall(world, player, 'shot', power);
  recordShot(world, player);
}

/** Where on the goal line (z) to aim. */
function chooseShotAimZ(player: PlayerState, intent: Intent, goalX: number): number {
  const W = PITCH.goalHalfWidth;
  if (Math.abs(intent.moveZ) > 0.3) {
    return Math.sign(intent.moveZ) * W * 0.8 * Math.min(1, Math.abs(intent.moveZ) * 1.25);
  }
  // Follow the facing direction to the goal line: solve pos + t * dir = goalX for t.
  const fx = Math.cos(player.facing);
  const fz = Math.sin(player.facing);
  if (Math.abs(fx) < 0.15) return 0;
  const t = (goalX - player.pos.x) / fx;
  if (t <= 0) return 0;
  return clamp(player.pos.z + fz * t, -W * 0.6, W * 0.6);
}

/** Facing away from goal: just boot it the way you're facing. */
function clearance(world: World, player: PlayerState, power: number): void {
  const { ball, rng } = world;
  const speed = lerp(KICK.clearanceMinSpeed, KICK.clearanceMaxSpeed, power);
  const angle = player.facing + rng.gaussian() * 0.08;
  ball.vel.set(Math.cos(angle) * speed, 3 + power * 4, Math.sin(angle) * speed);
  ball.spin.set(0, 0, 0);
  releaseBall(world, player, 'clearance', power);
}

/** Common bookkeeping after any kick. */
export function releaseBall(
  world: World,
  player: PlayerState,
  kind: KickKind,
  power: number,
): void {
  const { ball } = world;
  ball.ownerId = null;
  ball.heldByKeeper = false;
  ball.lastTouchId = player.id;
  player.kickLockout = PLAYER.kickLockout;
  player.touchTimer = 0;
  player.holdTime = 0;
  startAction(player, kind === 'throw' ? 'throw' : 'kick', 0.3);
  world.events.push({ type: 'kick', playerId: player.id, kind, power });
}
