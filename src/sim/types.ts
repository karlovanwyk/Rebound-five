/**
 * types.ts: the shape of the simulation state.
 *
 * Everything the match "is" at a given tick lives in one World object made of plain data
 * (numbers, booleans, Three.js Vector3s). No meshes, no DOM. The renderer reads this
 * state (through snapshots, see Snapshot.ts) and draws it; it never changes it.
 */
import type { Vector3 } from 'three';
import type { SeededRandom } from '../core/SeededRandom';
import type { SimEvent } from './events';

export type TeamId = 0 | 1;

/** What a player's body is busy doing. Drives both gameplay rules and animation. */
export type PlayerAction =
  'none' | 'kick' | 'standTackle' | 'slide' | 'dive' | 'fallen' | 'celebrate' | 'throw';

/** A kick that was pressed just before the ball arrived, waiting to be executed. */
export interface BufferedKick {
  kind: 'pass' | 'through' | 'shot';
  power: number;
  timeLeft: number;
}

export interface PlayerState {
  id: number;
  team: TeamId;
  /** 0 is the goalkeeper, 1..4 are outfield players. */
  index: number;
  isKeeper: boolean;
  /** Feet position. y is always 0. */
  pos: Vector3;
  vel: Vector3;
  /** Facing angle in radians: direction (cos, sin) on (x, z). */
  facing: number;
  action: PlayerAction;
  /** Seconds left in the current action, and its total length (for animation progress). */
  actionTime: number;
  actionDuration: number;
  /** Direction of a slide or dive (unit vector on XZ). */
  actionDirX: number;
  actionDirZ: number;
  /** Set once a tackle has made contact, so it only affects the ball once. */
  actionResolved: boolean;
  /** Seconds until this player may touch the ball again after kicking it. */
  kickLockout: number;
  /** Seconds until the next dribble touch. */
  touchTimer: number;
  tackleCooldown: number;
  /** Shot charging: true while shoot is held. Charge goes 0..1. */
  charging: boolean;
  shotCharge: number;
  buffered: BufferedKick | null;
  /** Seconds a keeper has been holding the ball. */
  holdTime: number;
  /** Whether the latest intent asked for a sprint (used by dribbling and animation). */
  sprinting: boolean;
}

export interface BallState {
  pos: Vector3;
  vel: Vector3;
  /** Angular velocity in rad/s. Only spin around Y (side spin) is used, for curve. */
  spin: Vector3;
  /** Player currently in control of the ball, or null when it's loose. */
  ownerId: number | null;
  /** Last player to touch the ball (for goal credit and pass statistics). */
  lastTouchId: number | null;
  /** True while a goalkeeper holds the ball in their hands. */
  heldByKeeper: boolean;
}

export interface TeamState {
  id: TeamId;
  name: string;
  /** Three-letter scoreboard code. */
  short: string;
  /** +1 if this team attacks toward +x, -1 otherwise. */
  attackDir: 1 | -1;
  /** True if a human controls one of this team's players. */
  humanControlled: boolean;
  /** Player id the human currently controls, or -1. */
  controlledId: number;
  /** Seconds until control may auto-switch again (stops flickering between players). */
  switchCooldown: number;
}

export interface World {
  /** Number of ticks simulated so far. */
  tick: number;
  rng: SeededRandom;
  ball: BallState;
  /** All players. Ids equal their index in this array. */
  players: PlayerState[];
  teams: [TeamState, TeamState];
  score: [number, number];
  /** Practice mode: seconds until the ball is re-spotted after a goal. */
  resetTimer: number;
  /** Events produced during the most recent tick. Cleared at the start of each tick. */
  events: SimEvent[];
}
