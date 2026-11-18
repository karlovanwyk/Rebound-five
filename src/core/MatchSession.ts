/**
 * MatchSession.ts: one match in progress. The world, both AI controllers, the Intents
 * and the two snapshots the renderer interpolates between.
 *
 * main.ts creates a session for every match (and for the CPU vs CPU attract mode behind
 * the menus), calls step() once per fixed tick, and hands `previous` and `current` to the
 * renderer each frame. Like the sim, this file has no DOM access, so it could be driven
 * from a test.
 */
import type { Difficulty, Kit } from '../config';
import { AI } from '../config';
import type { Intent } from '../input/Intent';
import { createIntent } from '../input/Intent';
import { AIController } from '../sim/ai/AIController';
import { presetFor } from '../sim/ai/Difficulty';
import type { Snapshot } from '../sim/Snapshot';
import { captureSnapshot, copySnapshot, createSnapshot } from '../sim/Snapshot';
import type { World } from '../sim/types';
import { createWorld, stepWorld } from '../sim/World';

export interface TeamSetup {
  name: string;
  short: string;
  kit: Kit;
}

export interface MatchSetup {
  seed: number;
  minutes: number;
  goldenGoal: boolean;
  home: TeamSetup;
  away: TeamSetup;
  /** Difficulty of the CPU team (team 1). */
  cpuDifficulty: Difficulty;
  /** True when a human controls team 0; false for CPU vs CPU (attract mode). */
  humanPlays: boolean;
}

export class MatchSession {
  readonly world: World;
  readonly intents: Intent[];
  readonly previous: Snapshot;
  readonly current: Snapshot;
  readonly homeAI: AIController;
  readonly awayAI: AIController;

  constructor(readonly setup: MatchSetup) {
    this.world = createWorld({
      seed: setup.seed,
      matchMinutes: setup.minutes,
      goldenGoal: setup.goldenGoal,
      teamNames: [setup.home.name, setup.away.name],
      teamShorts: [setup.home.short, setup.away.short],
      humanTeams: [setup.humanPlays, false],
    });
    this.intents = this.world.players.map(() => createIntent());
    this.previous = createSnapshot(this.world);
    this.current = createSnapshot(this.world);
    // Your teammates always play at the teammate level; in attract mode both sides do.
    const homeLevel = setup.humanPlays ? AI.teammateDifficulty : 'normal';
    this.homeAI = new AIController(this.world, 0, presetFor(homeLevel), setup.seed + 1);
    this.awayAI = new AIController(this.world, 1, presetFor(setup.cpuDifficulty), setup.seed + 2);
  }

  /** Advance one fixed tick. `human` drives team 0's controlled player (null in attract mode). */
  step(human: Intent | null): void {
    copySnapshot(this.previous, this.current);
    const controlled = this.setup.humanPlays ? this.world.teams[0].controlledId : -1;
    this.homeAI.update(this.world, this.intents, controlled);
    this.awayAI.update(this.world, this.intents);
    if (human && controlled >= 0) Object.assign(this.intents[controlled], human);
    stepWorld(this.world, this.intents);
    captureSnapshot(this.world, this.current);
  }

  /** Result from the human's (team 0's) point of view. */
  result(): 'win' | 'draw' | 'loss' {
    const [home, away] = this.world.match.score;
    return home > away ? 'win' : home < away ? 'loss' : 'draw';
  }
}

/** Pick whichever of the CPU team's kits contrasts most with yours. */
export function contrastingKit(yours: Kit, options: readonly Kit[]): Kit {
  let best = options[0];
  let bestDistance = -1;
  for (const kit of options) {
    const d =
      colourDistance(yours.shirt, kit.shirt) + 0.5 * colourDistance(yours.shorts, kit.shorts);
    if (d > bestDistance) {
      best = kit;
      bestDistance = d;
    }
  }
  return best;
}

/** Rough perceptual distance between two #rrggbb colours (weighted RGB). */
export function colourDistance(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const dr = ca[0] - cb[0];
  const dg = ca[1] - cb[1];
  const db = ca[2] - cb[2];
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
