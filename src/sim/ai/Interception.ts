/**
 * Interception.ts: "who can get to the ball first, and where?"
 *
 * Two tools:
 *
 * 1. interceptTimeConstantVelocity(): the exact answer for a ball moving at constant
 *    velocity V from P, chased by a player at Q with top speed s. We want the smallest
 *    t >= 0 where the ball is exactly s*t away from Q:
 *        |P + V t - Q| = s t
 *    Let D = P - Q and square both sides:
 *        |D|^2 + 2 (D . V) t + |V|^2 t^2 = s^2 t^2
 *        (|V|^2 - s^2) t^2 + 2 (D . V) t + |D|^2 = 0
 *    That's a quadratic a t^2 + b t + c = 0, solved with the quadratic formula. We keep
 *    the smallest positive root; no real positive root means the ball can't be caught.
 *
 * 2. findInterception(): real balls slow down (friction), bounce off boards and fly over
 *    heads, so there's no neat formula. Instead we march along a predicted path
 *    (BallPrediction or rollingPosition) and take the first sample the player can reach
 *    in time, allowing for a reaction delay:
 *        distance(sample, player) - reach <= speed * (t - reaction)
 *
 * Pass scoring uses the same question for defenders: can anyone reach the pass's path
 * before the ball goes past?
 */
import { BALL } from '../../config';
import type { XZ } from '../math';

/** Exact intercept time for a constant-velocity ball, or null if it can't be caught. */
export function interceptTimeConstantVelocity(
  ball: XZ,
  ballVel: XZ,
  chaser: XZ,
  chaserSpeed: number,
): number | null {
  const dx = ball.x - chaser.x;
  const dz = ball.z - chaser.z;
  const a = ballVel.x * ballVel.x + ballVel.z * ballVel.z - chaserSpeed * chaserSpeed;
  const b = 2 * (dx * ballVel.x + dz * ballVel.z);
  const c = dx * dx + dz * dz;
  if (c < 1e-9) return 0; // already there

  if (Math.abs(a) < 1e-9) {
    // Ball and chaser are equally fast: the equation is linear, b t + c = 0.
    if (b >= 0) return null;
    return -c / b;
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  const candidates = [t1, t2].filter((t) => t >= 0);
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

/**
 * Where a ball rolling on the ground is after t seconds, slowing at `deceleration`.
 * Distance travelled is v t - a t^2 / 2 until it stops at t_stop = v / a.
 */
export function rollingPosition(
  start: XZ,
  vel: XZ,
  t: number,
  out: XZ,
  deceleration = BALL.rollingDeceleration,
): XZ {
  const speed = Math.hypot(vel.x, vel.z);
  if (speed < 1e-6) {
    out.x = start.x;
    out.z = start.z;
    return out;
  }
  const tStop = speed / deceleration;
  const tt = Math.min(t, tStop);
  const travelled = speed * tt - 0.5 * deceleration * tt * tt;
  out.x = start.x + (vel.x / speed) * travelled;
  out.z = start.z + (vel.z / speed) * travelled;
  return out;
}

/** Time for a rolling ball to cover `distance`, or Infinity if it stops first. */
export function rollingArrivalTime(
  speed: number,
  distance: number,
  deceleration = BALL.rollingDeceleration,
): number {
  // Solve d = v t - a t^2 / 2 for the first (smaller) root: t = (v - sqrt(v^2 - 2 a d)) / a
  const disc = speed * speed - 2 * deceleration * distance;
  if (disc < 0) return Infinity;
  return (speed - Math.sqrt(disc)) / deceleration;
}

export interface Interception {
  time: number;
  x: number;
  z: number;
}

/** A sampled ball path: point i is where the ball will be at time i * step. */
export interface PathSamples {
  readonly count: number;
  readonly step: number;
  x(i: number): number;
  y(i: number): number;
  z(i: number): number;
}

/**
 * First point on a sampled path that the player can reach in time. `maxHeight` ignores
 * samples where the ball is out of reach overhead (keepers get a higher value).
 */
export function findInterception(
  path: PathSamples,
  player: XZ,
  speed: number,
  reaction: number,
  reach = 0.5,
  maxHeight = 1.0,
): Interception | null {
  for (let i = 0; i < path.count; i++) {
    if (path.y(i) > maxHeight) continue;
    const t = i * path.step;
    const run = Math.hypot(path.x(i) - player.x, path.z(i) - player.z) - reach;
    if (run <= speed * Math.max(0, t - reaction)) return { time: t, x: path.x(i), z: path.z(i) };
  }
  return null;
}

/**
 * How risky is a ground pass from `from` to `to` (launched at `speed`) with these
 * opponents around? Returns 0 (nobody can get there) to 1 (certain interception).
 *
 * For a series of moments along the pass, compare how long the ball takes to reach that
 * point with how long each opponent needs to get there. The margin (opponent's spare
 * time) goes through a smooth step, so "just about makes it" counts as partly risky.
 */
export function passLaneRisk(
  from: XZ,
  to: XZ,
  speed: number,
  opponents: readonly XZ[],
  opponentSpeed: number,
  opponentReaction: number,
  lofted: boolean,
): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-6) return 0;
  const samples = 10;
  let risk = 0;
  // Sample the lane up to 90% of the way. The last stretch is the receiver's own space:
  // a defender who can only get to the receiver is contesting, not intercepting, and
  // PassScoring measures that separately (its 'space' term).
  for (let i = 1; i < samples; i++) {
    const f = i / samples;
    // A lofted ball is over everyone's head for the middle of its flight.
    if (lofted && f > 0.15 && f < 0.8) continue;
    const px = from.x + dx * f;
    const pz = from.z + dz * f;
    const ballTime = lofted ? f * (distance / speed) : rollingArrivalTime(speed, distance * f);
    if (!Number.isFinite(ballTime)) break;
    for (const o of opponents) {
      const run = Math.max(0, Math.hypot(px - o.x, pz - o.z) - 0.6);
      const opponentTime = opponentReaction + run / opponentSpeed;
      const margin = ballTime - opponentTime; // positive = opponent gets there first
      const r = smooth01((margin + 0.25) / 0.6);
      if (r > risk) risk = r;
    }
  }
  return risk;
}

function smooth01(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}
