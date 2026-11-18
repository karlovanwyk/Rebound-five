/**
 * Cup.ts: Cup mode progress. Three knockout rounds against increasingly difficult CPU
 * teams. Drawn cup matches go to golden goal (handled by the sim's match rules), so every
 * cup match has a winner. Lose once and you're out.
 */
import type { CpuTeam } from '../config';
import { CPU_TEAMS, CUP_ROUNDS } from '../config';

export interface CupResult {
  goalsFor: number;
  goalsAgainst: number;
  won: boolean;
}

export interface CupState {
  /** Index of the round being played next (0..2). */
  round: number;
  results: CupResult[];
  status: 'inProgress' | 'eliminated' | 'champion';
}

export function createCup(): CupState {
  return { round: 0, results: [], status: 'inProgress' };
}

export function cupOpponent(cup: CupState): CpuTeam {
  const round = CUP_ROUNDS[Math.min(cup.round, CUP_ROUNDS.length - 1)];
  const team = CPU_TEAMS.find((t) => t.id === round.opponentId);
  if (!team) throw new Error(`Unknown cup opponent ${round.opponentId}`);
  return team;
}

export function cupRoundName(cup: CupState): string {
  return CUP_ROUNDS[Math.min(cup.round, CUP_ROUNDS.length - 1)].name;
}

/** Record the result of the current round and advance (or knock the player out). */
export function recordCupMatch(cup: CupState, goalsFor: number, goalsAgainst: number): void {
  if (cup.status !== 'inProgress') return;
  const won = goalsFor > goalsAgainst;
  cup.results.push({ goalsFor, goalsAgainst, won });
  if (!won) {
    cup.status = 'eliminated';
    return;
  }
  cup.round++;
  if (cup.round >= CUP_ROUNDS.length) cup.status = 'champion';
}
