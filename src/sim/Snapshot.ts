/**
 * Snapshot.ts: a compact copy of everything the renderer needs from one tick.
 *
 * main.ts keeps two snapshots, the previous tick and the current tick, and the renderer
 * blends between them using the loop's `alpha` (see core/Loop.ts). Snapshots are plain
 * numbers, so they're cheap to copy. That also makes them easy to store in a ring buffer
 * for instant replays.
 *
 * The renderer only ever reads snapshots, never the live World. That keeps the
 * one-way flow: sim -> snapshot -> render.
 */
import type { PlayerAction, World } from './types';

export interface PlayerSnapshot {
  id: number;
  team: 0 | 1;
  index: number;
  x: number;
  z: number;
  facing: number;
  speed: number;
  action: PlayerAction;
  /** 0 at the start of the action, 1 at the end. */
  actionProgress: number;
  actionDirX: number;
  actionDirZ: number;
  hasBall: boolean;
  holdingBall: boolean;
  charging: boolean;
  shotCharge: number;
  sprinting: boolean;
  controlled: boolean;
}

export interface BallSnapshot {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spinY: number;
}

export interface Snapshot {
  tick: number;
  ball: BallSnapshot;
  players: PlayerSnapshot[];
}

export function createSnapshot(world: World): Snapshot {
  const snapshot: Snapshot = {
    tick: 0,
    ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spinY: 0 },
    players: world.players.map((p) => ({
      id: p.id,
      team: p.team,
      index: p.index,
      x: 0,
      z: 0,
      facing: 0,
      speed: 0,
      action: 'none',
      actionProgress: 0,
      actionDirX: 0,
      actionDirZ: 0,
      hasBall: false,
      holdingBall: false,
      charging: false,
      shotCharge: 0,
      sprinting: false,
      controlled: false,
    })),
  };
  captureSnapshot(world, snapshot);
  return snapshot;
}

/** Fill `out` from the world without allocating. */
export function captureSnapshot(world: World, out: Snapshot): void {
  const { ball } = world;
  out.tick = world.tick;
  const b = out.ball;
  b.x = ball.pos.x;
  b.y = ball.pos.y;
  b.z = ball.pos.z;
  b.vx = ball.vel.x;
  b.vy = ball.vel.y;
  b.vz = ball.vel.z;
  b.spinY = ball.spin.y;

  for (const p of world.players) {
    const s = out.players[p.id];
    s.x = p.pos.x;
    s.z = p.pos.z;
    s.facing = p.facing;
    s.speed = Math.hypot(p.vel.x, p.vel.z);
    s.action = p.action;
    s.actionProgress = p.actionDuration > 0 ? 1 - p.actionTime / p.actionDuration : 0;
    s.actionDirX = p.actionDirX;
    s.actionDirZ = p.actionDirZ;
    s.hasBall = ball.ownerId === p.id;
    s.holdingBall = s.hasBall && ball.heldByKeeper;
    s.charging = p.charging;
    s.shotCharge = p.shotCharge;
    s.sprinting = p.sprinting;
    s.controlled = world.teams[p.team].controlledId === p.id && world.teams[p.team].humanControlled;
  }
}

export function copySnapshot(out: Snapshot, source: Snapshot): void {
  out.tick = source.tick;
  Object.assign(out.ball, source.ball);
  for (let i = 0; i < source.players.length; i++) Object.assign(out.players[i], source.players[i]);
}
