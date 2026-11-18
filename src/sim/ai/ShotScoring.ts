/**
 * ShotScoring.ts: how good a shot is right now, and where to aim it. Returns 0 (hopeless)
 * to 1 (open goal).
 *
 * The score multiplies four factors, each 0..1. Multiplying means one terrible factor
 * (for example a defender right in the way) sinks the whole shot, which is how a real
 * player thinks:
 *
 *   distance  1 at 7 m or closer, falling smoothly to 0 at 24 m.
 *   angle     how wide the goal looks: the angle between the lines to the two posts.
 *             Head-on from 9 m that's about 0.54 rad; from a tight angle it's much less.
 *   keeper    for each candidate aim point, how far the keeper is from the shot's line.
 *             A big gap is good.
 *   blockers  each outfield opponent standing near the shot line halves the score.
 *
 * Several aim points across the goal are tried, and the best one is kept along with its
 * aim, so the AI knows where to put the shot as well as whether to shoot. A worked
 * example is in docs/AI.md.
 */
import { PITCH } from '../../config';
import { clamp, distancePointToSegmentXZ, smoothstep } from '../math';
import type { PlayerState, World } from '../types';

export interface ShotOption {
  score: number;
  /** Where on the goal line (z) to aim. */
  aimZ: number;
  distance: number;
  openAngle: number;
  keeperFactor: number;
  blockers: number;
}

const AIM_FRACTIONS = [-0.8, -0.45, 0, 0.45, 0.8];

/**
 * How dangerous a spot on the pitch is for `team`, ignoring defenders: the distance and
 * angle factors of a shot from there, with an average keeper. Used to value pass targets
 * and dribbling directions.
 */
export function positionThreat(world: World, team: number, x: number, z: number): number {
  const attackDir = world.teams[team].attackDir;
  const goalX = attackDir * PITCH.halfLength;
  const depth = (goalX - x) * attackDir;
  if (depth < 0.5) return 0;
  const W = PITCH.goalHalfWidth;
  const distance = Math.hypot(goalX - x, z);
  const openAngle = Math.abs(Math.atan2(W - z, depth) - Math.atan2(-W - z, depth));
  return (1 - smoothstep(7, 24, distance)) * (0.35 + 0.65 * clamp(openAngle / 0.45, 0, 1)) * 0.8;
}

/**
 * The common currency for comparing options: how valuable it is for `team` to have the
 * ball at (x, z). Near goal that's the shooting threat; further out it's simply how far
 * up the pitch the ball is (u from 0 at our goal line to 1 at theirs), scaled down so a
 * real chance always beats mere territory.
 */
export function positionValue(world: World, team: number, x: number, z: number): number {
  const attackDir = world.teams[team].attackDir;
  const u = clamp(((x * attackDir) / PITCH.halfLength + 1) / 2, 0, 1);
  return Math.max(positionThreat(world, team, x, z), 0.35 * u);
}

export function evaluateShot(world: World, shooter: PlayerState): ShotOption {
  const { ball } = world;
  const attackDir = world.teams[shooter.team].attackDir;
  const goalX = attackDir * PITCH.halfLength;
  const W = PITCH.goalHalfWidth;
  // Shoot from the ball if it's at the shooter's feet, otherwise from the shooter.
  const near = Math.hypot(ball.pos.x - shooter.pos.x, ball.pos.z - shooter.pos.z) < 1.2;
  const bx = near ? ball.pos.x : shooter.pos.x;
  const bz = near ? ball.pos.z : shooter.pos.z;

  const depth = (goalX - bx) * attackDir; // distance to the goal line, straight ahead
  const empty: ShotOption = {
    score: 0,
    aimZ: 0,
    distance: Infinity,
    openAngle: 0,
    keeperFactor: 0,
    blockers: 0,
  };
  if (depth < 0.5) return empty;

  const distance = Math.hypot(goalX - bx, bz);
  const openAngle = Math.abs(Math.atan2(W - bz, depth) - Math.atan2(-W - bz, depth));
  const distanceScore = 1 - smoothstep(7, 24, distance);
  const angleScore = clamp(openAngle / 0.45, 0, 1);
  if (distanceScore <= 0) return { ...empty, distance, openAngle };

  const keeper = world.players.find((p) => p.team !== shooter.team && p.isKeeper) ?? null;
  let best: ShotOption = { ...empty, distance, openAngle };

  for (const fraction of AIM_FRACTIONS) {
    const aimZ = fraction * W;
    const from = { x: bx, z: bz };
    const to = { x: goalX, z: aimZ };

    let keeperFactor = 1;
    if (keeper) {
      const gap = distancePointToSegmentXZ(keeper.pos, from, to);
      keeperFactor = smoothstep(0.3, 2.0, gap);
    }

    let blockers = 0;
    for (const p of world.players) {
      if (p.team === shooter.team || p.isKeeper) continue;
      // Only count players between the ball and the goal, close to the line.
      const along =
        ((p.pos.x - bx) * (goalX - bx) + (p.pos.z - bz) * (aimZ - bz)) / (distance * distance);
      if (along < 0.03 || along > 0.97) continue;
      if (distancePointToSegmentXZ(p.pos, from, to) < 0.9) blockers++;
    }

    const score =
      distanceScore *
      (0.35 + 0.65 * angleScore) *
      (0.25 + 0.75 * keeperFactor) *
      Math.pow(0.45, blockers);
    if (score > best.score) {
      best = { score, aimZ, distance, openAngle, keeperFactor, blockers };
    }
  }
  return best;
}
