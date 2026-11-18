/**
 * World.ts: creates the simulation state and advances it by one fixed tick.
 *
 * stepWorld() is the heart of the game. main.ts calls it 60 times per second with one
 * Intent per player, and the headless tests call it in a tight loop. Everything inside
 * is deterministic: same state + same Intents = same next state.
 *
 * Order of one playing tick:
 *   1. control switching (human teams)   2. timers          3. movement
 *   4. body separation                   5. tackles start   6. kicks
 *   7. dribble touches                   8. ball physics    9. tackle contact
 *  10. possession                       11. stats          12. goal check, clock
 * The order matters. For example, kicks happen before the ball moves, so a pass leaves
 * the foot on the same tick it's pressed.
 */
import { Vector3 } from 'three';
import { MATCH, SIM } from '../config';
import { SeededRandom } from '../core/SeededRandom';
import type { Intent } from '../input/Intent';
import { createIntent, resetIntent } from '../input/Intent';
import { createBall, stepBall } from './ball/BallPhysics';
import { onBallGained, onPassPlayed, updateHumanControl } from './match/ControlAssignment';
import { detectGoal } from './match/GoalDetection';
import {
  celebrationIntent,
  createMatchState,
  enforceKickoffProtection,
  registerGoal,
  startKickoff,
  tickClock,
  tickGoalPhase,
  tickKickoff,
} from './match/Match';
import { createStats, recordPossessionGained, resolveShot, tickStats } from './match/Stats';
import { attackDirection } from './math';
import { updateDribble } from './players/Dribbling';
import { updateKeeperHolding, updateKeeperSaves } from './players/Goalkeeping';
import { processKickIntents } from './players/Kicking';
import { separatePlayers, updateMovement } from './players/Movement';
import { createPlayer, tickPlayerTimers } from './players/Player';
import { updatePossession } from './players/Possession';
import { startTackle, updateTackles } from './players/Tackling';
import type { PlayerState, TeamId, TeamState, World } from './types';

export interface WorldOptions {
  seed: number;
  /** Real minutes of playing time. */
  matchMinutes?: number;
  /** Cup matches: a draw at full time goes to golden goal. */
  goldenGoal?: boolean;
  /** Players per team (default 5 + 5). Tests sometimes use fewer. */
  playersPerTeam?: [number, number];
  teamNames?: [string, string];
  teamShorts?: [string, string];
  /** Which teams have a human on them. */
  humanTeams?: [boolean, boolean];
  /** Start in the playing phase instead of waiting for the kickoff whistle. */
  skipKickoff?: boolean;
}

export function createWorld(options: WorldOptions): World {
  const counts = options.playersPerTeam ?? [5, 5];
  const players: PlayerState[] = [];
  for (const team of [0, 1] as const) {
    for (let i = 0; i < counts[team]; i++) {
      // With a single player, make them an outfield player (index 1), not a keeper.
      const index = counts[team] === 1 ? 1 : i;
      players.push(createPlayer(players.length, team, index));
    }
  }

  const names = options.teamNames ?? ['Home', 'Away'];
  const shorts = options.teamShorts ?? ['HOM', 'AWY'];
  const humans = options.humanTeams ?? [true, false];
  const makeTeam = (id: TeamId): TeamState => ({
    id,
    name: names[id],
    short: shorts[id],
    attackDir: attackDirection(id),
    humanControlled: humans[id],
    // Start by controlling the striker (index 4), or any outfield player.
    controlledId:
      players.find((p) => p.team === id && p.index === 4)?.id ??
      players.find((p) => p.team === id && !p.isKeeper)?.id ??
      -1,
    switchCooldown: 0,
  });

  const world: World = {
    tick: 0,
    rng: new SeededRandom(options.seed),
    ball: createBall(),
    players,
    teams: [makeTeam(0), makeTeam(1)],
    match: createMatchState(
      options.matchMinutes ?? MATCH.defaultMinutes,
      options.goldenGoal ?? false,
    ),
    stats: [createStats(), createStats()],
    pendingPass: null,
    pendingShot: null,
    events: [],
  };
  startKickoff(world, 0);
  if (options.skipKickoff) world.match.phase = 'playing';
  return world;
}

const ballStart = new Vector3();
const scriptedIntent = createIntent();

/** Advance the world by one fixed tick. `intents[i]` drives `world.players[i]`. */
export function stepWorld(world: World, intents: Intent[]): void {
  const dt = SIM.dt;
  world.events.length = 0;
  world.tick++;

  switch (world.match.phase) {
    case 'kickoff':
      // Everyone holds position until the whistle.
      for (const player of world.players) player.vel.set(0, 0, 0);
      tickKickoff(world, dt);
      break;
    case 'playing':
      playTick(world, intents, dt);
      break;
    case 'goal':
      scriptedTick(world, dt, true);
      tickGoalPhase(world, dt);
      break;
    case 'fullTime':
      scriptedTick(world, dt, false);
      break;
  }
}

function playTick(world: World, intents: Intent[], dt: number): void {
  const { ball, players } = world;

  updateHumanControl(world, intents, dt);
  for (const player of players) tickPlayerTimers(player, dt);
  for (const player of players) {
    updateMovement(player, intents[player.id], ball.ownerId === player.id, dt);
  }
  separatePlayers(players);
  enforceKickoffProtection(world, dt);
  updateKeeperHolding(world, dt);

  for (const player of players) startTackle(world, player, intents[player.id]);
  for (const player of players) {
    const result = processKickIntents(world, player, intents[player.id], dt);
    if (result.kicked && result.receiver) onPassPlayed(world, player, result.receiver);
  }
  for (const player of players) updateDribble(world, player, dt);

  ballStart.copy(ball.pos);
  // A ball held in the keeper's hands isn't a free physics object.
  if (!ball.heldByKeeper) {
    const eventCount = world.events.length;
    stepBall(ball, dt, world.events);
    resolveShotsThatHitTheBoards(world, eventCount);
    updateTackles(world);
    updateKeeperSaves(world, ballStart);
  }

  const change = updatePossession(world, ballStart);
  if (change) {
    recordPossessionGained(world, change.gainedBy);
    onBallGained(world, change.gainedBy);
  }
  if (ball.ownerId !== null) ball.ownerTime += dt;
  tickStats(world, dt);

  const scoringTeam = detectGoal(ball.pos);
  if (scoringTeam !== null) {
    registerGoal(world, scoringTeam);
    return;
  }
  tickClock(world);
}

/** A shot that hits the boards has missed the target. */
function resolveShotsThatHitTheBoards(world: World, fromEvent: number): void {
  if (!world.pendingShot) return;
  for (let i = fromEvent; i < world.events.length; i++) {
    const event = world.events[i];
    if (event.type === 'bounce' && event.surface === 'board') {
      resolveShot(world, false);
      return;
    }
  }
}

/** Goal celebrations and full time: scripted movement only, the ball keeps rolling. */
function scriptedTick(world: World, dt: number, celebrating: boolean): void {
  for (const player of world.players) tickPlayerTimers(player, dt);
  for (const player of world.players) {
    if (celebrating) celebrationIntent(world, player, scriptedIntent);
    else resetIntent(scriptedIntent);
    updateMovement(player, scriptedIntent, false, dt);
  }
  separatePlayers(world.players);
  stepBall(world.ball, dt, world.events);
}
