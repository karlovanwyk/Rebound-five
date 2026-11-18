/**
 * events.ts: things that happened during a tick, for the presentation layers.
 *
 * The simulation can't play sounds or move cameras, because it's headless. Instead it
 * appends small event records to `world.events` as things happen. After each tick,
 * main.ts hands them to the audio engine (kick thuds, whistles), the renderer (kick
 * animations, net ripple) and the UI (goal banner). Tests can also read them, for
 * example to count shots.
 */
import type { TeamId } from './types';

export type KickKind = 'touch' | 'pass' | 'through' | 'shot' | 'clearance' | 'throw' | 'punt';
export type Surface = 'ground' | 'board' | 'post' | 'net' | 'player';

export type SimEvent =
  | { type: 'kick'; playerId: number; kind: KickKind; power: number }
  | { type: 'bounce'; surface: Surface; speed: number; x: number; y: number; z: number }
  | { type: 'trap'; playerId: number }
  | { type: 'tackle'; playerId: number; kind: 'stand' | 'slide'; won: boolean }
  | { type: 'save'; playerId: number; kind: 'catch' | 'parry' }
  | { type: 'goal'; team: TeamId; scorerId: number | null; ownGoal: boolean }
  | { type: 'whistle'; kind: 'kickoff' | 'fullTime' | 'goldenGoal' }
  | { type: 'switch'; team: TeamId; playerId: number };
