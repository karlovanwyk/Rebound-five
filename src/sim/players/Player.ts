/**
 * Player.ts: creating player state and small helpers about a player's body.
 *
 * The other files in this folder each handle one part of a player's turn:
 * Movement (running), Dribbling (touches), Possession (who has the ball),
 * Kicking (passes and shots) and Tackling. World.ts calls them in a fixed order every tick.
 */
import { Vector3 } from 'three';
import { PLAYER } from '../../config';
import type { PlayerAction, PlayerState, TeamId } from '../types';

export function createPlayer(id: number, team: TeamId, index: number): PlayerState {
  return {
    id,
    team,
    index,
    isKeeper: index === 0,
    pos: new Vector3(),
    vel: new Vector3(),
    facing: team === 0 ? 0 : Math.PI,
    action: 'none',
    actionTime: 0,
    actionDuration: 0,
    actionDirX: 0,
    actionDirZ: 0,
    actionResolved: false,
    kickLockout: 0,
    touchTimer: 0,
    tackleCooldown: 0,
    charging: false,
    shotCharge: 0,
    buffered: null,
    holdTime: 0,
    sprinting: false,
  };
}

/** Start a timed action such as a kick animation, a slide or a dive. */
export function startAction(
  player: PlayerState,
  action: PlayerAction,
  duration: number,
  dirX = 0,
  dirZ = 0,
): void {
  player.action = action;
  player.actionTime = duration;
  player.actionDuration = duration;
  player.actionDirX = dirX;
  player.actionDirZ = dirZ;
  player.actionResolved = false;
}

/** Slides, dives, falls and celebrations take over the body: movement input is ignored. */
export function isBodyLocked(player: PlayerState): boolean {
  const a = player.action;
  return a === 'slide' || a === 'dive' || a === 'fallen' || a === 'celebrate';
}

/** Count down action and cooldown timers. Actions end by returning to 'none'. */
export function tickPlayerTimers(player: PlayerState, dt: number): void {
  if (player.kickLockout > 0) player.kickLockout = Math.max(0, player.kickLockout - dt);
  if (player.tackleCooldown > 0) player.tackleCooldown = Math.max(0, player.tackleCooldown - dt);
  if (player.actionTime > 0) {
    player.actionTime -= dt;
    if (player.actionTime <= 0) {
      player.actionTime = 0;
      // A slide or a dive ends with the player on the ground for a moment.
      const recovering = player.action === 'slide' || player.action === 'dive';
      player.action = 'none';
      if (recovering) startAction(player, 'fallen', PLAYER.kickLockout + 0.2);
    }
  }
}

/** World-space x of the point in front of the body where the ball is played. */
export function footX(player: PlayerState): number {
  return player.pos.x + Math.cos(player.facing) * PLAYER.footOffset;
}

export function footZ(player: PlayerState): number {
  return player.pos.z + Math.sin(player.facing) * PLAYER.footOffset;
}
