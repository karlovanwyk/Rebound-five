/**
 * World.ts: creates the simulation state and advances it by one fixed tick.
 *
 * stepWorld() is the heart of the game. main.ts calls it 60 times per second with one
 * Intent per player, and the headless tests call it in a tight loop. Everything inside
 * is deterministic: same state + same Intents = same next state.
 *
 * Order of one tick:
 *   1. timers  2. movement  3. body separation  4. kicks  5. dribble touches
 *   6. ball physics  7. possession  8. goal check
 */
import { Vector3 } from 'three';
import { SIM } from '../config';
import { SeededRandom } from '../core/SeededRandom';
import type { Intent } from '../input/Intent';
import { createBall, resetBall, stepBall } from './ball/BallPhysics';
import { detectGoal } from './match/GoalDetection';
import { attackDirection } from './math';
import { updateDribble } from './players/Dribbling';
import { processKickIntents } from './players/Kicking';
import { separatePlayers, updateMovement } from './players/Movement';
import { createPlayer, tickPlayerTimers } from './players/Player';
import { updatePossession } from './players/Possession';
import type { PlayerState, TeamId, TeamState, World } from './types';

export interface WorldOptions {
  seed: number;
  /** Players per team. Milestone 1 uses a single outfield player. */
  playersPerTeam: [number, number];
  teamNames?: [string, string];
  teamShorts?: [string, string];
  humanTeams?: [boolean, boolean];
}

/** Seconds before the ball is re-spotted after a practice goal. */
const PRACTICE_RESET_TIME = 2;

export function createWorld(options: WorldOptions): World {
  const players: PlayerState[] = [];
  for (const team of [0, 1] as const) {
    const count = options.playersPerTeam[team];
    for (let i = 0; i < count; i++) {
      // With a single player, make them an outfield player (index 1), not a keeper.
      const index = count === 1 ? 1 : i;
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
    controlledId: players.find((p) => p.team === id && !p.isKeeper)?.id ?? -1,
    switchCooldown: 0,
  });

  const world: World = {
    tick: 0,
    rng: new SeededRandom(options.seed),
    ball: createBall(),
    players,
    teams: [makeTeam(0), makeTeam(1)],
    score: [0, 0],
    resetTimer: 0,
    events: [],
  };
  placeForPractice(world);
  return world;
}

/** Practice layout: the ball on the centre spot, each player just behind it in their own half. */
function placeForPractice(world: World): void {
  resetBall(world.ball);
  for (const player of world.players) {
    const dir = world.teams[player.team].attackDir;
    player.pos.set(-dir * (1 + player.index * 2), 0, 0);
    player.vel.set(0, 0, 0);
    player.facing = dir === 1 ? 0 : Math.PI;
  }
}

const ballStart = new Vector3();

/** Advance the world by one fixed tick. `intents[i]` drives `world.players[i]`. */
export function stepWorld(world: World, intents: Intent[]): void {
  const dt = SIM.dt;
  const { ball, players } = world;
  world.events.length = 0;
  world.tick++;

  for (const player of players) tickPlayerTimers(player, dt);

  for (const player of players) {
    updateMovement(player, intents[player.id], ball.ownerId === player.id, dt);
  }
  separatePlayers(players);

  for (const player of players) processKickIntents(world, player, intents[player.id], dt);
  for (const player of players) updateDribble(world, player, dt);

  ballStart.copy(ball.pos);
  stepBall(ball, dt, world.events);
  updatePossession(world, ballStart);

  updatePracticeGoals(world, dt);
}

function updatePracticeGoals(world: World, dt: number): void {
  if (world.resetTimer > 0) {
    world.resetTimer -= dt;
    if (world.resetTimer <= 0) placeForPractice(world);
    return;
  }
  const scoringTeam = detectGoal(world.ball.pos);
  if (scoringTeam === null) return;
  world.score[scoringTeam]++;
  world.resetTimer = PRACTICE_RESET_TIME;
  world.events.push({
    type: 'goal',
    team: scoringTeam,
    scorerId: world.ball.lastTouchId,
    ownGoal: false,
  });
}
