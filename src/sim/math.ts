/**
 * math.ts: small numeric helpers shared across the simulation.
 *
 * Players move on the ground, so most sim maths works in 2D on the XZ plane. An angle
 * `a` means the direction (cos a, sin a) in (x, z). Angle 0 points toward +x (team 0's
 * attacking direction).
 */

/** Anything with x and z, such as a Three.js Vector3 or a plain object. */
export interface XZ {
  x: number;
  z: number;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite smoothstep: 0 below edge0, 1 above edge1, smooth S-curve in between. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Wrap an angle into the range (-PI, PI]. */
export function wrapAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/** Signed smallest rotation that turns `from` into `to`. */
export function angleDiff(to: number, from: number): number {
  return wrapAngle(to - from);
}

/** Rotate `current` toward `target` by at most `maxStep` radians. */
export function rotateTowards(current: number, target: number, maxStep: number): number {
  const diff = angleDiff(target, current);
  if (Math.abs(diff) <= maxStep) return wrapAngle(target);
  return wrapAngle(current + Math.sign(diff) * maxStep);
}

export function angleOf(x: number, z: number): number {
  return Math.atan2(z, x);
}

export function distanceXZ(a: XZ, b: XZ): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function lengthXZ(v: XZ): number {
  return Math.hypot(v.x, v.z);
}

/**
 * Shortest distance from point p to the segment a-b on the XZ plane. Used to ask "how
 * close does this pass or shot travel to that defender?"
 */
export function distancePointToSegmentXZ(p: XZ, a: XZ, b: XZ): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  // Project p onto the line and clamp the projection to the segment (t in 0..1).
  const t = lengthSq > 1e-9 ? clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / lengthSq, 0, 1) : 0;
  return Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z);
}

/** Which team attacks toward +x: team 0 attacks +x, team 1 attacks -x. */
export function attackDirection(team: 0 | 1): 1 | -1 {
  return team === 0 ? 1 : -1;
}
