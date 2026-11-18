/**
 * PassScoring.ts: rates every possible pass from the ball carrier, 0 (terrible) to 1.
 *
 * For each teammate, both a ground pass and (for forward runs) a lofted through ball are
 * scored:
 *
 *   risk   chance an opponent intercepts. From Interception.passLaneRisk: can any
 *          defender reach a point on the pass before the ball does? Through balls are
 *          also a race between the receiver and the nearest defender to the landing spot.
 *   value  how good it is to have the ball at the target (ShotScoring.positionValue):
 *          shooting threat near goal, otherwise progress up the pitch.
 *   space  how much room the receiver has: distance from the target spot to the
 *          nearest opponent (1 m = none, 6 m+ = plenty).
 *
 *   score = (1 - risk) * (0.9 value + 0.1 space)
 *
 * (1 - risk) multiplies everything: a pass that will probably be intercepted is bad,
 * however good the receiver's position. Because value is the same currency as a shot's
 * score, the carrier can compare passing, shooting and dribbling fairly. A worked
 * example is in docs/AI.md.
 */
import { KICK, PITCH, PLAYER } from '../../config';
import { clamp, smoothstep } from '../math';
import { groundPassSpeed, throughBallFlightTime } from '../players/Kicking';
import type { PlayerState, World } from '../types';
import { passLaneRisk } from './Interception';
import { positionValue } from './ShotScoring';

export interface PassOption {
  receiverId: number;
  lofted: boolean;
  targetX: number;
  targetZ: number;
  score: number;
  risk: number;
  space: number;
  progress: number;
}

/** Defenders are assumed to react this quickly when judging lanes. */
const OPPONENT_REACTION = 0.12;

export function scorePass(
  world: World,
  passer: PlayerState,
  receiver: PlayerState,
  lofted: boolean,
): PassOption {
  const { ball } = world;
  const attackDir = world.teams[passer.team].attackDir;
  const from = { x: ball.pos.x, z: ball.pos.z };
  let tx = receiver.pos.x + receiver.vel.x * 0.35;
  let tz = receiver.pos.z + receiver.vel.z * 0.35;
  if (lofted) tx += attackDir * KICK.throughLead;
  tx = clamp(tx, -PITCH.halfLength + 1.5, PITCH.halfLength - 1.5);
  tz = clamp(tz, -PITCH.halfWidth + 1.2, PITCH.halfWidth - 1.2);

  const option: PassOption = {
    receiverId: receiver.id,
    lofted,
    targetX: tx,
    targetZ: tz,
    score: 0,
    risk: 1,
    space: 0,
    progress: 0,
  };

  const distance = Math.hypot(tx - from.x, tz - from.z);
  const forward = (tx - from.x) * attackDir;
  if (distance < 3.5 || distance > (lofted ? 26 : 22)) return option;
  if (lofted && (receiver.isKeeper || forward < 4)) return option;

  const opponents = world.players.filter((p) => p.team !== passer.team);
  const speed = lofted ? distance / throughBallFlightTime(distance) : groundPassSpeed(distance);
  let risk = passLaneRisk(
    from,
    { x: tx, z: tz },
    speed,
    opponents.map((o) => o.pos),
    PLAYER.sprintSpeed * 0.9,
    OPPONENT_REACTION,
    lofted,
  );

  if (lofted) {
    // A through ball is a race to the landing spot: receiver against the nearest defender.
    const ballTime = throughBallFlightTime(distance) / 0.8;
    const receiverTime = Math.hypot(tx - receiver.pos.x, tz - receiver.pos.z) / PLAYER.sprintSpeed;
    let defenderTime = Infinity;
    for (const o of opponents) {
      defenderTime = Math.min(
        defenderTime,
        Math.hypot(tx - o.pos.x, tz - o.pos.z) / PLAYER.sprintSpeed + OPPONENT_REACTION,
      );
    }
    const arrival = Math.max(ballTime, receiverTime);
    risk = Math.max(risk, smoothstep(-0.4, 0.4, arrival - defenderTime));
  }

  let nearest = Infinity;
  for (const o of opponents) nearest = Math.min(nearest, Math.hypot(tx - o.pos.x, tz - o.pos.z));
  const space = smoothstep(1, 6, nearest);
  const progress = clamp(forward / 16, -1, 1) * 0.5 + 0.5;
  const value = positionValue(world, passer.team, tx, tz);

  option.risk = risk;
  option.space = space;
  option.progress = progress;
  option.score = (1 - risk) * (0.9 * value + 0.1 * space);
  if (receiver.isKeeper) option.score *= 0.5; // back to the keeper only when nothing else is on
  return option;
}

/** All pass options for this carrier, best first. */
export function evaluatePasses(world: World, passer: PlayerState): PassOption[] {
  const options: PassOption[] = [];
  for (const mate of world.players) {
    if (mate.team !== passer.team || mate === passer) continue;
    options.push(scorePass(world, passer, mate, false));
    if (!mate.isKeeper) options.push(scorePass(world, passer, mate, true));
  }
  options.sort((a, b) => b.score - a.score);
  return options;
}
