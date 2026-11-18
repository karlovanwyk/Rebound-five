/**
 * AIController.ts: turns the AI's thinking into Intents for one team.
 *
 * Each tick:
 *   1. refresh the ball prediction (the real physics run forward 2.5 s);
 *   2. the TeamBrain updates mode, formation, roles and support spots;
 *   3. each player's state machine runs and writes that player's Intent.
 *
 * The CPU opponent uses one AIController at the chosen difficulty. Your own team uses
 * another at Normal, skipping whichever player you're controlling. Both only produce
 * Intents: the AI never moves a player or the ball directly, and never sees your inputs.
 *
 * Determinism: the AI has its own SeededRandom (seeded from the match seed), so the
 * same seed and the same human inputs replay the same match, CPU decisions included.
 */
import type { DifficultyPreset } from '../../config';
import { SIM } from '../../config';
import { SeededRandom } from '../../core/SeededRandom';
import type { Intent } from '../../input/Intent';
import { resetIntent } from '../../input/Intent';
import { BallPrediction } from '../ball/BallPrediction';
import type { TeamId, World } from '../types';
import { KEEPER_STATES } from './Goalkeeper';
import type { AgentContext, AgentMemory } from './PlayerStates';
import { createMemory, ON_BALL_STATES, OUTFIELD_STATES, stateForRole } from './PlayerStates';
import { StateMachine } from './StateMachine';
import { TeamBrain } from './TeamBrain';

/** What the #debug overlay draws for each AI player. */
export interface AgentDebug {
  playerId: number;
  state: string;
  role: string;
  targetX: number;
  targetZ: number;
  steerX: number;
  steerZ: number;
}

interface Agent {
  playerId: number;
  fsm: StateMachine<AgentContext>;
  memory: AgentMemory;
  /** False while a human controls this player; the FSM restarts when control returns. */
  active: boolean;
}

export class AIController {
  readonly brain: TeamBrain;
  readonly prediction = new BallPrediction();
  private readonly agents: Agent[] = [];
  private readonly rng: SeededRandom;
  private readonly ctx: AgentContext;

  constructor(
    world: World,
    readonly team: TeamId,
    public preset: DifficultyPreset,
    seed: number,
  ) {
    this.rng = new SeededRandom(seed);
    this.brain = new TeamBrain(team, () => this.preset);
    for (const player of world.players) {
      if (player.team !== team) continue;
      this.agents.push({
        playerId: player.id,
        fsm: player.isKeeper
          ? new StateMachine(KEEPER_STATES, 'GuardGoal')
          : new StateMachine(OUTFIELD_STATES, 'ReturnToPosition'),
        memory: createMemory(),
        active: true,
      });
    }
    this.ctx = {
      world,
      player: world.players[this.agents[0]?.playerId ?? 0],
      brain: this.brain,
      memory: createMemory(),
      intent: {
        moveX: 0,
        moveZ: 0,
        sprint: false,
        pass: false,
        throughBall: false,
        shoot: false,
        tackle: false,
        switchPlayer: false,
      },
      rng: this.rng,
      preset,
      prediction: this.prediction,
      dt: SIM.dt,
    };
  }

  /** Write Intents for this team's players into `intents`, except `skipId` (the human's player). */
  update(world: World, intents: Intent[], skipId = -1): void {
    for (const agent of this.agents) {
      if (agent.playerId !== skipId) resetIntent(intents[agent.playerId]);
    }
    if (world.match.phase !== 'playing') return;

    this.prediction.update(world);
    this.brain.update(world, this.prediction, SIM.dt);

    const ctx = this.ctx;
    ctx.world = world;
    ctx.preset = this.preset;
    for (const agent of this.agents) {
      if (agent.playerId === skipId) {
        agent.active = false;
        continue;
      }
      ctx.player = world.players[agent.playerId];
      ctx.memory = agent.memory;
      ctx.intent = intents[agent.playerId];

      if (!ctx.player.isKeeper) {
        const base = stateForRole(this.brain.roles[agent.playerId]);
        const stickyOnBall =
          ON_BALL_STATES.has(agent.fsm.name) && world.ball.ownerId === agent.playerId;
        if (
          !agent.active ||
          (!stickyOnBall && agent.fsm.name !== base && !isFinishing(agent, world))
        ) {
          agent.fsm.change(base, ctx);
        }
      }
      agent.active = true;
      agent.fsm.update(ctx);
    }
  }

  debugInfo(): AgentDebug[] {
    return this.agents
      .filter((a) => a.active)
      .map((a) => ({
        playerId: a.playerId,
        state: a.fsm.name,
        role: this.brain.roles[a.playerId] ?? '',
        targetX: a.memory.target.x,
        targetZ: a.memory.target.z,
        steerX: a.memory.steer.x,
        steerZ: a.memory.steer.z,
      }));
  }
}

/**
 * A shot being charged must be allowed to finish (release the button) even if the ball
 * has just rolled a little out of control, so the FSM isn't interrupted mid-strike.
 */
function isFinishing(agent: Agent, world: World): boolean {
  if (agent.fsm.name !== 'Shoot') return false;
  const player = world.players[agent.playerId];
  return player.charging;
}
