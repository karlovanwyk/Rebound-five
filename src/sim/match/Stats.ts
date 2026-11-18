/**
 * Stats.ts: match statistics for the full-time screen. Possession, shots, shots on
 * target, passes and passes completed.
 *
 * Some stats can only be decided later. A pass is "completed" when the next player to
 * control the ball is a teammate. A shot is "on target" if it ends in a goal or a save.
 * So the sim keeps one pending pass and one pending shot, and resolves them when the
 * outcome is known.
 */
import { MATCH } from '../../config';
import type { PlayerState, TeamStats, World } from '../types';

export function createStats(): TeamStats {
  return {
    possessionTicks: 0,
    shots: 0,
    shotsOnTarget: 0,
    passes: 0,
    passesCompleted: 0,
    tacklesWon: 0,
    saves: 0,
  };
}

export function recordShot(world: World, shooter: PlayerState): void {
  world.stats[shooter.team].shots++;
  world.pendingShot = { team: shooter.team, shooterId: shooter.id, age: 0 };
  world.pendingPass = null;
}

export function resolveShot(world: World, onTarget: boolean): void {
  const shot = world.pendingShot;
  if (!shot) return;
  if (onTarget) world.stats[shot.team].shotsOnTarget++;
  world.pendingShot = null;
}

export function recordPass(world: World, passer: PlayerState, receiver: PlayerState | null): void {
  world.stats[passer.team].passes++;
  world.pendingPass = { team: passer.team, fromId: passer.id, toId: receiver?.id ?? null };
}

/** Someone just took control of the ball: settle any pending pass or shot. */
export function recordPossessionGained(world: World, player: PlayerState): void {
  const pass = world.pendingPass;
  if (pass) {
    if (player.team === pass.team && player.id !== pass.fromId) {
      world.stats[pass.team].passesCompleted++;
    }
    world.pendingPass = null;
  }
  // A keeper's catch is reported as a save before this runs; any other control means
  // the shot was blocked or missed.
  if (world.pendingShot) resolveShot(world, false);
}

/** Per-tick bookkeeping: possession time and shot timeouts. */
export function tickStats(world: World, dt: number): void {
  const owner = world.ball.ownerId;
  if (owner !== null) world.stats[world.players[owner].team].possessionTicks++;
  const shot = world.pendingShot;
  if (shot) {
    shot.age += dt;
    if (shot.age > MATCH.shotResolveTime) resolveShot(world, false);
  }
}

/** Possession split as whole percentages that add up to 100. */
export function possessionPercent(stats: [TeamStats, TeamStats]): [number, number] {
  const total = stats[0].possessionTicks + stats[1].possessionTicks;
  if (total === 0) return [50, 50];
  const home = Math.round((stats[0].possessionTicks / total) * 100);
  return [home, 100 - home];
}
