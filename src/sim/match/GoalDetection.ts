/**
 * GoalDetection.ts: decides whether the ball has gone in.
 *
 * Football's rule: the WHOLE ball must cross the WHOLE goal line, between the posts and
 * under the crossbar. The goal line is the plane |x| = halfLength, so the ball's centre
 * has to be more than one radius beyond it. Because the nets keep a ball that's inside the
 * goal between the posts and under the bar, checking the centre's z and y is enough for
 * those two conditions.
 */
import { BALL, PITCH } from '../../config';
import type { XZ } from '../math';
import type { TeamId } from '../types';

export interface Point3 extends XZ {
  y: number;
}

/** Returns the team that scored, or null. Team 0 scores in the +x goal, team 1 in the -x goal. */
export function detectGoal(pos: Point3): TeamId | null {
  const wholeBallOverLine = Math.abs(pos.x) > PITCH.halfLength + BALL.radius;
  const betweenPosts = Math.abs(pos.z) < PITCH.goalHalfWidth;
  const underBar = pos.y < PITCH.goalHeight;
  if (!wholeBallOverLine || !betweenPosts || !underBar) return null;
  return pos.x > 0 ? 0 : 1;
}
