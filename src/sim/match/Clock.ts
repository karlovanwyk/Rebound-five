/**
 * Clock.ts: the match clock. 90 football minutes squeezed into 2, 3 or 5 real minutes.
 *
 * The clock counts simulation ticks, never wall-clock time, so it's exact and identical
 * in the browser and in the headless tests. It only advances during the 'playing' phase:
 * kickoffs and goal celebrations don't eat into the match.
 *
 * Scaling: a 3-minute match has 3 * 60 * 60 = 10,800 ticks. The football minute shown is
 * elapsedTicks / totalTicks * 90, so each real second is 0.5 football minutes.
 */
import { SIM } from '../../config';
import type { MatchState } from '../types';

export const FOOTBALL_MINUTES = 90;

export function minutesToTicks(realMinutes: number): number {
  return Math.round(realMinutes * 60 * SIM.tickRate);
}

/** The (fractional) football minute for an elapsed tick count. Can exceed 90 in golden goal. */
export function footballMinute(clockTicks: number, durationTicks: number): number {
  return (clockTicks / durationTicks) * FOOTBALL_MINUTES;
}

export function isTimeUp(match: MatchState): boolean {
  return match.clockTicks >= match.durationTicks;
}

/** Text for the scoreboard: "37'", or "90+2'" during golden goal. */
export function formatClock(match: MatchState): string {
  const minute = Math.floor(footballMinute(match.clockTicks, match.durationTicks));
  if (minute >= FOOTBALL_MINUTES && (match.goldenGoal || isTimeUp(match))) {
    return `90+${minute - FOOTBALL_MINUTES}'`;
  }
  return `${minute}'`;
}
