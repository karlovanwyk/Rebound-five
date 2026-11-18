/**
 * ControlAssignment.ts: which player the human is controlling.
 *
 * Rules (for teams with a human on them):
 *  - Switch (Q / LB) hands control to the outfield teammate closest to the ball, other
 *    than the current one.
 *  - Passing to a teammate moves control to the receiver as soon as the ball leaves your
 *    foot, so you can run onto it.
 *  - A teammate who takes control of the ball becomes the controlled player.
 *  - While defending, control auto-switches to the teammate nearest the ball, but only if
 *    they're clearly closer (a margin) and not too soon after the last switch (a
 *    cooldown). Without that hysteresis, control would flicker between two players who
 *    are about equally close.
 * Goalkeepers are always run by the AI.
 */
import { MATCH } from '../../config';
import type { Intent } from '../../input/Intent';
import { distanceXZ } from '../math';
import { isBodyLocked } from '../players/Player';
import type { PlayerState, TeamState, World } from '../types';

export function updateHumanControl(world: World, intents: Intent[], dt: number): void {
  for (const team of world.teams) {
    if (!team.humanControlled) continue;
    team.switchCooldown = Math.max(0, team.switchCooldown - dt);
    const current = world.players[team.controlledId];
    if (!current) continue;

    if (intents[current.id]?.switchPlayer) {
      const best = nearestToBall(world, team, current);
      if (best) setControlled(world, team, best);
      continue;
    }
    if (team.switchCooldown > 0 || isBodyLocked(current) || current.charging) continue;
    if (teamIsInPossession(world, team)) continue;

    const best = nearestToBall(world, team, null);
    if (!best || best === current) continue;
    const ballPos = world.ball.pos;
    if (distanceXZ(current.pos, ballPos) - distanceXZ(best.pos, ballPos) > MATCH.autoSwitchMargin) {
      setControlled(world, team, best);
    }
  }
}

/** Called when a player takes control of the ball. */
export function onBallGained(world: World, player: PlayerState): void {
  const team = world.teams[player.team];
  if (!team.humanControlled || player.isKeeper || team.controlledId === player.id) return;
  setControlled(world, team, player);
}

/** Called when a player passes. Control follows the ball to the intended receiver. */
export function onPassPlayed(
  world: World,
  passer: PlayerState,
  receiver: PlayerState | null,
): void {
  const team = world.teams[passer.team];
  if (!team.humanControlled || !receiver || receiver.isKeeper) return;
  if (team.controlledId !== passer.id) return;
  setControlled(world, team, receiver);
}

function teamIsInPossession(world: World, team: TeamState): boolean {
  const { ball } = world;
  if (ball.ownerId !== null) return world.players[ball.ownerId].team === team.id;
  // A pass in flight between teammates still counts as ours.
  return world.pendingPass !== null && world.pendingPass.team === team.id;
}

/** Closest outfield teammate to the ball, optionally excluding one player. */
function nearestToBall(
  world: World,
  team: TeamState,
  exclude: PlayerState | null,
): PlayerState | null {
  let best: PlayerState | null = null;
  let bestDistance = Infinity;
  for (const player of world.players) {
    if (player.team !== team.id || player.isKeeper || player === exclude) continue;
    const d = distanceXZ(player.pos, world.ball.pos);
    if (d < bestDistance) {
      best = player;
      bestDistance = d;
    }
  }
  return best;
}

function setControlled(world: World, team: TeamState, player: PlayerState): void {
  const previous = world.players[team.controlledId];
  if (previous) {
    // A charge in progress belongs to the old player's body; cancel it.
    previous.charging = false;
    previous.shotCharge = 0;
    previous.buffered = null;
  }
  team.controlledId = player.id;
  team.switchCooldown = MATCH.autoSwitchCooldown;
  world.events.push({ type: 'switch', team: team.id, playerId: player.id });
}
