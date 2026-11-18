/**
 * Collisions.ts: keeps the ball inside the arena. Boards, ceiling netting, goal posts,
 * crossbars and goal nets.
 *
 * BallPhysics.ts calls collideArena() after every physics sub-step. Two kinds of shapes
 * are involved:
 *
 * 1. Flat walls (boards, nets, ceiling). These are half-spaces: if the ball's surface
 *    has crossed the plane, move the ball back onto the plane and reflect the velocity
 *    component that points into the wall. Because this test only looks at position, a
 *    fast ball can never "skip over" a wall. The worst case is one sub-step of overlap,
 *    which is corrected immediately.
 *
 * 2. Posts and crossbars. Each is a cylinder, treated as a line segment with a radius
 *    (a capsule). The sphere-vs-capsule test:
 *       - find the closest point C on the segment to the ball centre P;
 *       - if |P - C| < ballRadius + postRadius, they overlap;
 *       - the contact normal is n = (P - C) / |P - C|;
 *       - push the ball out along n and reflect the normal part of the velocity:
 *             v' = v - (1 + e) (v . n) n
 *         This keeps the part of v along the surface and flips the part into it
 *         (scaled by restitution e).
 */
import { Vector3 } from 'three';
import { BALL, PITCH } from '../../config';
import type { SimEvent, Surface } from '../events';
import type { BallState } from '../types';

const segmentA = new Vector3();
const segmentB = new Vector3();
const closest = new Vector3();
const normal = new Vector3();

/** Only report impacts faster than this, so a ball resting against the boards stays quiet. */
const EVENT_MIN_SPEED = 1.5;

export function collideArena(ball: BallState, events: SimEvent[] | null): void {
  collideGoalFrames(ball, events);
  collideGoalNets(ball, events);
  collideEndBoards(ball, events);
  collideSideBoards(ball, events);
  collideCeiling(ball);
  clampInsideArena(ball);
}

/** True if a ball centre at this position is inside the goal opening (between posts, under bar). */
export function isInGoalMouth(pos: Vector3): boolean {
  return Math.abs(pos.z) < PITCH.goalHalfWidth && pos.y < PITCH.goalHeight;
}

function report(events: SimEvent[] | null, surface: Surface, speed: number, ball: BallState): void {
  if (!events || speed < EVENT_MIN_SPEED) return;
  const { x, y, z } = ball.pos;
  events.push({ type: 'bounce', surface, speed, x, y, z });
}

/** The boards along each end, except where the goal opening is. */
function collideEndBoards(ball: BallState, events: SimEvent[] | null): void {
  const { pos, vel } = ball;
  const r = BALL.radius;
  const L = PITCH.halfLength;
  if (isInGoalMouth(pos)) return;

  for (const side of [1, -1] as const) {
    const depth = pos.x * side; // how far toward this end the ball centre is
    if (depth + r > L) {
      pos.x = side * (L - r);
      const speedIntoWall = vel.x * side;
      if (speedIntoWall > 0) {
        vel.x = -side * speedIntoWall * BALL.boardRestitution;
        // A little friction along the board surface.
        vel.y *= 0.95;
        vel.z *= 0.95;
        report(events, 'board', speedIntoWall, ball);
      }
    }
  }
}

/** The long boards along each touchline. */
function collideSideBoards(ball: BallState, events: SimEvent[] | null): void {
  const { pos, vel } = ball;
  const r = BALL.radius;
  const W = PITCH.halfWidth;
  for (const side of [1, -1] as const) {
    if (pos.z * side + r > W) {
      pos.z = side * (W - r);
      const speedIntoWall = vel.z * side;
      if (speedIntoWall > 0) {
        vel.z = -side * speedIntoWall * BALL.boardRestitution;
        vel.x *= 0.95;
        vel.y *= 0.95;
        report(events, 'board', speedIntoWall, ball);
      }
    }
  }
}

function collideCeiling(ball: BallState): void {
  const { pos, vel } = ball;
  const top = PITCH.ceilingHeight - BALL.radius;
  if (pos.y > top) {
    pos.y = top;
    if (vel.y > 0) vel.y = -vel.y * 0.5;
  }
}

/**
 * Inside a goal the ball is boxed in by the back, side and roof nets. Nets are soft: they
 * absorb most of the ball's energy (low restitution) and slow it along the surface too.
 */
function collideGoalNets(ball: BallState, events: SimEvent[] | null): void {
  const { pos, vel } = ball;
  const r = BALL.radius;
  const L = PITCH.halfLength;
  const side = pos.x >= 0 ? 1 : -1;
  if (pos.x * side <= L) return; // not inside a goal

  const back = L + PITCH.goalDepth - r;
  if (pos.x * side > back) {
    pos.x = side * back;
    const speedIn = vel.x * side;
    if (speedIn > 0) {
      vel.x = -side * speedIn * BALL.netRestitution;
      vel.y *= 0.6;
      vel.z *= 0.6;
      report(events, 'net', speedIn, ball);
    }
  }

  const sideLimit = PITCH.goalHalfWidth - r;
  if (Math.abs(pos.z) > sideLimit) {
    const zSign = Math.sign(pos.z);
    pos.z = zSign * sideLimit;
    const speedIn = vel.z * zSign;
    if (speedIn > 0) {
      vel.z = -zSign * speedIn * BALL.netRestitution;
      vel.x *= 0.7;
      report(events, 'net', speedIn, ball);
    }
  }

  const roof = PITCH.goalHeight - r;
  if (pos.y > roof) {
    pos.y = roof;
    if (vel.y > 0) {
      report(events, 'net', vel.y, ball);
      vel.y = -vel.y * BALL.netRestitution;
    }
  }
}

/** Both posts and the crossbar of both goals. */
function collideGoalFrames(ball: BallState, events: SimEvent[] | null): void {
  const L = PITCH.halfLength;
  const W = PITCH.goalHalfWidth;
  const H = PITCH.goalHeight;
  // Cheap early-out: the frames are only near the ends of the pitch.
  if (Math.abs(ball.pos.x) < L - 1) return;

  for (const side of [1, -1]) {
    const x = side * L;
    for (const zPost of [W, -W]) {
      segmentA.set(x, 0, zPost);
      segmentB.set(x, H, zPost);
      collideCapsule(ball, segmentA, segmentB, PITCH.postRadius, events);
    }
    segmentA.set(x, H, -W);
    segmentB.set(x, H, W);
    collideCapsule(ball, segmentA, segmentB, PITCH.postRadius, events);
  }
}

/**
 * Sphere (the ball) vs capsule (segment a-b with a radius). Exported for unit tests.
 * Returns true if they touched.
 */
export function collideCapsule(
  ball: BallState,
  a: Vector3,
  b: Vector3,
  radius: number,
  events: SimEvent[] | null,
): boolean {
  const { pos, vel } = ball;

  // Closest point on the segment: project P onto the line through a and b, then clamp
  // the parameter t to [0, 1] so the point stays between the ends.
  normal.subVectors(b, a); // reused here as the segment direction
  const lengthSq = normal.lengthSq();
  const t =
    lengthSq > 0 ? Math.min(1, Math.max(0, closest.subVectors(pos, a).dot(normal) / lengthSq)) : 0;
  closest.copy(a).addScaledVector(normal, t);

  normal.subVectors(pos, closest);
  const distance = normal.length();
  const minDistance = BALL.radius + radius;
  if (distance >= minDistance || distance < 1e-9) return false;

  normal.divideScalar(distance);
  // Push the ball out so it just touches the post.
  pos.copy(closest).addScaledVector(normal, minDistance);

  // Reflect only if moving into the post (v . n < 0); otherwise it's already leaving.
  const vn = vel.dot(normal);
  if (vn < 0) {
    vel.addScaledVector(normal, -(1 + BALL.postRestitution) * vn);
    report(events, 'post', -vn, ball);
  }
  return true;
}

/**
 * Last line of defence: whatever happens, the ball stays inside the arena volume. With the
 * half-space walls above this should never trigger, but it makes "the ball never leaves
 * the arena" something we can rely on.
 */
function clampInsideArena(ball: BallState): void {
  const { pos } = ball;
  const r = BALL.radius;
  const maxX = PITCH.halfLength + PITCH.goalDepth - r;
  const maxZ = PITCH.halfWidth - r;
  if (pos.x > maxX) pos.x = maxX;
  if (pos.x < -maxX) pos.x = -maxX;
  if (pos.z > maxZ) pos.z = maxZ;
  if (pos.z < -maxZ) pos.z = -maxZ;
  if (pos.y < r) pos.y = r;
}
