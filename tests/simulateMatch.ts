/**
 * simulateMatch.ts: plays a whole CPU vs CPU match headlessly. It's shared by the
 * headless match test and handy for tuning the AI (see docs/EXERCISES.md).
 */
import type { Difficulty } from '../src/config';
import { BALL, PITCH } from '../src/config';
import { createIntent } from '../src/input/Intent';
import { AIController } from '../src/sim/ai/AIController';
import { presetFor } from '../src/sim/ai/Difficulty';
import type { World } from '../src/sim/types';
import { createWorld, stepWorld } from '../src/sim/World';

export interface MatchReport {
  world: World;
  ticks: number;
  shots: number;
  saves: number;
  tackles: number;
  passes: number;
  nanDetected: boolean;
  ballLeftArena: boolean;
  /** Description of the first out-of-arena position, for debugging. */
  violation: string;
}

export function simulateMatch(
  seed: number,
  minutes = 2,
  difficulties: [Difficulty, Difficulty] = ['normal', 'normal'],
): MatchReport {
  const world = createWorld({ seed, matchMinutes: minutes, humanTeams: [false, false] });
  const ai = [
    new AIController(world, 0, presetFor(difficulties[0]), seed + 101),
    new AIController(world, 1, presetFor(difficulties[1]), seed + 202),
  ];
  const intents = world.players.map(() => createIntent());
  const report: MatchReport = {
    world,
    ticks: 0,
    shots: 0,
    saves: 0,
    tackles: 0,
    passes: 0,
    nanDetected: false,
    ballLeftArena: false,
    violation: '',
  };
  // Safety limit: the match length plus generous time for kickoffs and celebrations.
  const limit = world.match.durationTicks * 3;
  const maxX = PITCH.halfLength + PITCH.goalDepth;

  while (world.match.phase !== 'fullTime' && report.ticks < limit) {
    ai[0].update(world, intents);
    ai[1].update(world, intents);
    stepWorld(world, intents);
    report.ticks++;

    for (const event of world.events) {
      if (event.type === 'kick' && event.kind === 'shot') report.shots++;
      if (event.type === 'kick' && (event.kind === 'pass' || event.kind === 'through'))
        report.passes++;
      if (event.type === 'save') report.saves++;
      if (event.type === 'tackle' && event.won) report.tackles++;
    }

    const { pos } = world.ball;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z))
      report.nanDetected = true;
    for (const p of world.players) {
      if (!Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.z)) report.nanDetected = true;
    }
    const outside =
      Math.abs(pos.x) > maxX + 1e-6 ||
      Math.abs(pos.z) > PITCH.halfWidth + 1e-6 ||
      pos.y < BALL.radius - 1e-6 ||
      pos.y > PITCH.ceilingHeight + 1e-6;
    if (outside && !report.ballLeftArena) {
      report.ballLeftArena = true;
      report.violation = `tick ${report.ticks} phase ${world.match.phase} pos (${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)}) held=${world.ball.heldByKeeper}`;
    }
  }
  return report;
}
