/**
 * Steering.ts: classic steering behaviours (after Craig Reynolds) that turn "where do I
 * want to be" into "which way should I run, and how fast".
 *
 * Each behaviour writes a desired velocity (m/s on the XZ plane) into `out`. They can be
 * added together: for example arrive at a spot plus separation from teammates. Finally
 * toIntent() converts the desired velocity into an Intent's move vector and sprint flag,
 * the same inputs a human gives. Steering can never make a CPU player faster than a human.
 */
import { PLAYER } from '../../config';
import type { Intent } from '../../input/Intent';
import type { XZ } from '../math';

export interface Steer {
  x: number;
  z: number;
}

/** Run straight at the target at full speed. */
export function seek(from: XZ, target: XZ, maxSpeed: number, out: Steer): Steer {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) {
    out.x = 0;
    out.z = 0;
  } else {
    out.x = (dx / d) * maxSpeed;
    out.z = (dz / d) * maxSpeed;
  }
  return out;
}

/**
 * Like seek, but slow down inside `slowRadius` so the player stops on the spot instead of
 * overshooting and oscillating around it. Speed scales linearly with remaining distance.
 */
export function arrive(
  from: XZ,
  target: XZ,
  maxSpeed: number,
  slowRadius: number,
  out: Steer,
): Steer {
  const d = Math.hypot(target.x - from.x, target.z - from.z);
  if (d < 0.2) {
    out.x = 0;
    out.z = 0;
    return out;
  }
  return seek(from, target, maxSpeed * Math.min(1, d / slowRadius), out);
}

/**
 * Chase a moving target by aiming where it will be, not where it is. The look-ahead time
 * is distance / closing speed: the further away, the further ahead we aim.
 */
export function pursuit(
  from: XZ,
  targetPos: XZ,
  targetVel: XZ,
  maxSpeed: number,
  out: Steer,
): Steer {
  const d = Math.hypot(targetPos.x - from.x, targetPos.z - from.z);
  const lookAhead = Math.min(1.2, d / (maxSpeed + Math.hypot(targetVel.x, targetVel.z) + 1e-6));
  const predicted = {
    x: targetPos.x + targetVel.x * lookAhead,
    z: targetPos.z + targetVel.z * lookAhead,
  };
  return seek(from, predicted, maxSpeed, out);
}

/**
 * Get between a and b, at `ratio` of the way from a to b (0.5 = midway). Defenders use it
 * to stand between an attacker and the goal, or between the ball and a man they mark.
 */
export function interpose(
  from: XZ,
  a: XZ,
  b: XZ,
  ratio: number,
  maxSpeed: number,
  out: Steer,
): Steer {
  const point = { x: a.x + (b.x - a.x) * ratio, z: a.z + (b.z - a.z) * ratio };
  return arrive(from, point, maxSpeed, 2.5, out);
}

/**
 * Push away from nearby neighbours, more strongly the closer they are (1/d falloff). Added
 * to other behaviours, this stops teammates bunching around the ball.
 */
export function separation(
  from: XZ,
  neighbours: readonly XZ[],
  radius: number,
  strength: number,
  out: Steer,
): Steer {
  out.x = 0;
  out.z = 0;
  for (const n of neighbours) {
    const dx = from.x - n.x;
    const dz = from.z - n.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6 || d > radius) continue;
    const push = (strength * (radius - d)) / (radius * d);
    out.x += dx * push;
    out.z += dz * push;
  }
  return out;
}

/** Limit a desired velocity to `maxSpeed`. */
export function truncate(v: Steer, maxSpeed: number): Steer {
  const speed = Math.hypot(v.x, v.z);
  if (speed > maxSpeed) {
    v.x *= maxSpeed / speed;
    v.z *= maxSpeed / speed;
  }
  return v;
}

/**
 * Convert a desired velocity into Intent inputs. Faster than running pace means sprint.
 * The move vector's length (0..1) asks for a fraction of top speed, exactly like tilting
 * an analog stick part of the way.
 */
export function toIntent(v: Steer, out: Intent): void {
  const speed = Math.hypot(v.x, v.z);
  if (speed < 0.05) {
    out.moveX = 0;
    out.moveZ = 0;
    out.sprint = false;
    return;
  }
  const sprint = speed > PLAYER.runSpeed * 1.02;
  const top = sprint ? PLAYER.sprintSpeed : PLAYER.runSpeed;
  const magnitude = Math.min(1, speed / top);
  out.moveX = (v.x / speed) * magnitude;
  out.moveZ = (v.z / speed) * magnitude;
  out.sprint = sprint;
}
