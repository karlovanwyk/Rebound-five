/**
 * PlayerStates.ts: the finite state machine each outfield AI player runs.
 *
 *   States with the ball:    Dribble -> LookForPass | Shoot
 *   States without the ball: ChaseBall, Intercept, Support, Mark, ReturnToPosition
 *
 * Switching rules (applied by AIController before each update):
 *  - While a player has the ball, Dribble / LookForPass / Shoot are "sticky": the team
 *    brain can't pull them out.
 *  - Otherwise the player's role from the TeamBrain picks the state:
 *      presser -> ChaseBall      chaser, receiver -> Intercept      marker -> Mark
 *      support, cover -> Support position -> ReturnToPosition
 *  - States can also hand over directly, for example Dribble -> Shoot when a shot is the
 *    best option.
 *
 * Every state finishes by writing an Intent. Movement goes through Steering.ts, and
 * actions through the same pass/shoot/tackle flags a human presses.
 */
import type { DifficultyPreset } from '../../config';
import { PITCH, PLAYER } from '../../config';
import type { SeededRandom } from '../../core/SeededRandom';
import type { Intent } from '../../input/Intent';
import type { BallPrediction } from '../ball/BallPrediction';
import type { XZ } from '../math';
import { angleDiff, angleOf, clamp, smoothstep } from '../math';
import type { PlayerState, World } from '../types';
import type { PassOption } from './PassScoring';
import { evaluatePasses } from './PassScoring';
import { evaluateShot, positionValue } from './ShotScoring';
import type { State } from './StateMachine';
import type { Steer } from './Steering';
import { arrive, pursuit, seek, separation, toIntent, truncate } from './Steering';
import type { Role, TeamBrain } from './TeamBrain';

/** Per-player AI memory (states themselves hold no data). */
export interface AgentMemory {
  stateTime: number;
  decisionTimer: number;
  tackleTimer: number;
  /** Where the player is heading (also drawn by the #debug overlay). */
  target: XZ;
  /** Desired velocity from steering (also drawn by the #debug overlay). */
  steer: Steer;
  dribbleAngle: number;
  pass: PassOption | null;
  shotAimZ: number;
  chargeTime: number;
  aimNoise: number;
  keeperReactTimer: number;
  keeperError: number;
  dived: boolean;
}

export function createMemory(): AgentMemory {
  return {
    stateTime: 0,
    decisionTimer: 0,
    tackleTimer: 0,
    target: { x: 0, z: 0 },
    steer: { x: 0, z: 0 },
    dribbleAngle: 0,
    pass: null,
    shotAimZ: 0,
    chargeTime: 0,
    aimNoise: 0,
    keeperReactTimer: 0,
    keeperError: 0,
    dived: false,
  };
}

/** Everything a state can look at. The world is read-only: AI only writes `intent`. */
export interface AgentContext {
  world: World;
  player: PlayerState;
  brain: TeamBrain;
  memory: AgentMemory;
  intent: Intent;
  rng: SeededRandom;
  preset: DifficultyPreset;
  prediction: BallPrediction;
  dt: number;
}

export type OutfieldStateName =
  | 'ReturnToPosition'
  | 'Support'
  | 'Mark'
  | 'ChaseBall'
  | 'Intercept'
  | 'Dribble'
  | 'LookForPass'
  | 'Shoot';

/** States that belong to the player on the ball and shouldn't be interrupted by roles. */
export const ON_BALL_STATES: ReadonlySet<string> = new Set(['Dribble', 'LookForPass', 'Shoot']);

/** The state a role asks for. */
export function stateForRole(role: Role | undefined): OutfieldStateName {
  switch (role) {
    case 'carrier':
      return 'Dribble';
    case 'presser':
      return 'ChaseBall';
    case 'chaser':
    case 'receiver':
      return 'Intercept';
    case 'marker':
      return 'Mark';
    case 'support':
    case 'cover':
      return 'Support';
    default:
      return 'ReturnToPosition';
  }
}

// ---------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------

const scratch: Steer = { x: 0, z: 0 };

/** Add separation from teammates (and optionally opponents), then write the Intent. */
function move(ctx: AgentContext, desired: Steer, maxSpeed: number, avoidOpponents = false): void {
  const { world, player, memory } = ctx;
  const neighbours: XZ[] = [];
  for (const p of world.players) {
    if (p === player) continue;
    if (p.team === player.team || avoidOpponents) neighbours.push(p.pos);
  }
  separation(player.pos, neighbours, avoidOpponents ? 3 : 2.6, avoidOpponents ? 3 : 2.2, scratch);
  desired.x += scratch.x;
  desired.z += scratch.z;
  truncate(desired, maxSpeed);
  memory.steer.x = desired.x;
  memory.steer.z = desired.z;
  toIntent(desired, ctx.intent);
}

function ownGoal(ctx: AgentContext): XZ {
  return { x: -ctx.world.teams[ctx.player.team].attackDir * PITCH.halfLength, z: 0 };
}

function attackDir(ctx: AgentContext): number {
  return ctx.world.teams[ctx.player.team].attackDir;
}

function hasBall(ctx: AgentContext): boolean {
  return ctx.world.ball.ownerId === ctx.player.id;
}

function nearestOpponentDistance(world: World, team: number, point: XZ): number {
  let nearest = Infinity;
  for (const p of world.players) {
    if (p.team !== team)
      nearest = Math.min(nearest, Math.hypot(p.pos.x - point.x, p.pos.z - point.z));
  }
  return nearest;
}

// ---------------------------------------------------------------------------------
// Off-the-ball states
// ---------------------------------------------------------------------------------

/** Jog back to the formation home position. */
const ReturnToPosition: State<AgentContext> = {
  name: 'ReturnToPosition',
  execute(ctx) {
    const home = ctx.brain.homes[ctx.player.id] ?? ctx.player.pos;
    ctx.memory.target = home;
    const far = Math.hypot(home.x - ctx.player.pos.x, home.z - ctx.player.pos.z) > 9;
    const speed = far ? PLAYER.sprintSpeed : PLAYER.runSpeed;
    move(ctx, arrive(ctx.player.pos, home, speed, 3, { x: 0, z: 0 }), speed);
    return null;
  },
};

/** Move into the open space the brain picked, ready for a pass. */
const Support: State<AgentContext> = {
  name: 'Support',
  execute(ctx) {
    const spot =
      ctx.brain.supportSpots[ctx.player.id] ?? ctx.brain.homes[ctx.player.id] ?? ctx.player.pos;
    ctx.memory.target = spot;
    const far = Math.hypot(spot.x - ctx.player.pos.x, spot.z - ctx.player.pos.z) > 7;
    const speed = far ? PLAYER.sprintSpeed : PLAYER.runSpeed;
    move(ctx, arrive(ctx.player.pos, spot, speed, 2.5, { x: 0, z: 0 }), speed);
    return null;
  },
};

/**
 * Mark an attacker: stand goal-side of them (between them and our goal), nudged toward
 * the ball so a pass to them can be cut out.
 */
const Mark: State<AgentContext> = {
  name: 'Mark',
  execute(ctx) {
    const { world, player, brain } = ctx;
    const targetId = brain.markTargets[player.id];
    if (targetId === undefined || targetId < 0) return 'ReturnToPosition';
    const opponent = world.players[targetId];
    const goal = ownGoal(ctx);
    const toGoal = unit(goal.x - opponent.pos.x, goal.z - opponent.pos.z);
    const toBall = unit(world.ball.pos.x - opponent.pos.x, world.ball.pos.z - opponent.pos.z);
    const target = {
      x: opponent.pos.x + (toGoal.x * 0.7 + toBall.x * 0.3) * 1.6,
      z: opponent.pos.z + (toGoal.z * 0.7 + toBall.z * 0.3) * 1.6,
    };
    ctx.memory.target = target;
    const far = Math.hypot(target.x - player.pos.x, target.z - player.pos.z) > 4;
    const speed = far ? PLAYER.sprintSpeed : PLAYER.runSpeed;
    move(ctx, arrive(player.pos, target, speed, 1.5, { x: 0, z: 0 }), speed);
    return null;
  },
};

/** Close down the ball carrier and tackle when in range and facing the ball. */
const ChaseBall: State<AgentContext> = {
  name: 'ChaseBall',
  execute(ctx) {
    const { world, player, preset, memory, rng, intent } = ctx;
    const { ball } = world;
    const owner = ball.ownerId !== null ? world.players[ball.ownerId] : null;
    const toBall = Math.hypot(ball.pos.x - player.pos.x, ball.pos.z - player.pos.z);
    memory.target = { x: ball.pos.x, z: ball.pos.z };

    // Pressing zone: a team only closes down hard once the ball is past its pressing
    // line. Higher press intensity pushes that line further up the pitch. Outside the
    // zone the presser "jockeys": stays goal-side a couple of metres off and waits.
    const ballU = (ball.pos.x * attackDir(ctx)) / PITCH.halfLength;
    const pressHard = !owner || ballU < -0.3 + preset.pressIntensity * 0.9;
    const goal = ownGoal(ctx);
    const side = unit(goal.x - ball.pos.x, goal.z - ball.pos.z);
    const standOff = pressHard ? 0.6 : 2.2;

    // Sprint to press if the team presses hard, or if the ball is far away.
    const sprint = toBall > 2.5 && ((pressHard && preset.pressIntensity > 0.45) || toBall > 7);
    const speed = sprint ? PLAYER.sprintSpeed : PLAYER.runSpeed;
    const desired: Steer = { x: 0, z: 0 };
    if (toBall > 2 || !pressHard) {
      // Approach goal-side of the ball, so the carrier can't simply run past.
      const target = { x: ball.pos.x + side.x * standOff, z: ball.pos.z + side.z * standOff };
      pursuit(player.pos, target, owner ? owner.vel : ball.vel, speed, desired);
    } else {
      seek(player.pos, ball.pos, PLAYER.runSpeed * 0.9, desired);
    }
    move(ctx, desired, speed);

    memory.tackleTimer -= ctx.dt;
    if (
      owner &&
      owner.team !== player.team &&
      !ball.heldByKeeper &&
      memory.tackleTimer <= 0 &&
      player.tackleCooldown <= 0
    ) {
      const facingBall =
        Math.abs(
          angleDiff(angleOf(ball.pos.x - player.pos.x, ball.pos.z - player.pos.z), player.facing),
        ) < 0.6;
      const range = pressHard ? preset.tackleRange : preset.tackleRange * 0.8;
      if (toBall < range && facingBall) {
        intent.tackle = true;
        const canSlide = player.sprinting && toBall > 0.9;
        intent.sprint = canSlide && rng.chance(preset.slideTackleChance);
        memory.tackleTimer = 0.45 + preset.reactionTime * rng.range(0.8, 1.6);
      }
    }
    return null;
  },
};

/** Run to where the ball can first be reached (loose balls and incoming passes). */
const Intercept: State<AgentContext> = {
  name: 'Intercept',
  execute(ctx) {
    const { world, player, brain, memory } = ctx;
    const { ball } = world;
    const point = brain.intercepts[player.id];
    const target = point ? { x: point.x, z: point.z } : ctx.prediction.restingPoint();
    const closeToBall = Math.hypot(ball.pos.x - player.pos.x, ball.pos.z - player.pos.z) < 1.5;
    const goal = closeToBall && ball.pos.y < 1 ? { x: ball.pos.x, z: ball.pos.z } : target;
    memory.target = goal;
    const far = Math.hypot(goal.x - player.pos.x, goal.z - player.pos.z) > 2.5;
    const speed = far ? PLAYER.sprintSpeed : PLAYER.runSpeed;
    move(ctx, arrive(player.pos, goal, speed, 0.8, { x: 0, z: 0 }), speed);
    return null;
  },
};

// ---------------------------------------------------------------------------------
// On-the-ball states
// ---------------------------------------------------------------------------------

/**
 * Carry the ball. Every `decisionInterval` seconds, compare shooting, the best passes and
 * carrying on, with a little difficulty-based noise on each score, and act on the best.
 */
const Dribble: State<AgentContext> = {
  name: 'Dribble',
  enter(ctx) {
    // Take a moment to look up after receiving the ball.
    ctx.memory.decisionTimer = Math.max(ctx.memory.decisionTimer, ctx.preset.reactionTime * 0.6);
    ctx.memory.dribbleAngle = angleOf(attackDir(ctx), 0);
  },
  execute(ctx) {
    const { player, preset, memory, rng } = ctx;
    if (!hasBall(ctx)) return null;

    memory.decisionTimer -= ctx.dt;
    if (memory.decisionTimer <= 0) {
      memory.decisionTimer = preset.decisionInterval * rng.range(0.8, 1.2);
      const next = decide(ctx);
      if (next) return next;
    }

    const open = openSpaceAhead(ctx, memory.dribbleAngle);
    const speed = open > 4.5 ? PLAYER.sprintSpeed : PLAYER.runSpeed;
    const desired = {
      x: Math.cos(memory.dribbleAngle) * speed,
      z: Math.sin(memory.dribbleAngle) * speed,
    };
    memory.target = { x: player.pos.x + desired.x, z: player.pos.z + desired.z };
    move(ctx, desired, speed, true);
    return null;
  },
};

/** Turn toward the chosen receiver for a split second, then pass. */
const LookForPass: State<AgentContext> = {
  name: 'LookForPass',
  enter(ctx) {
    ctx.memory.stateTime = 0;
    ctx.memory.aimNoise = ctx.rng.gaussian() * ctx.preset.passError;
  },
  execute(ctx) {
    const { world, memory, intent, preset } = ctx;
    const option = memory.pass;
    if (!option || !hasBall(ctx)) return 'Support';
    const receiver = world.players[option.receiverId];
    // Aim at the receiver; the sim leads the pass automatically.
    const angle =
      angleOf(receiver.pos.x - world.ball.pos.x, receiver.pos.z - world.ball.pos.z) +
      memory.aimNoise;
    intent.moveX = Math.cos(angle) * 0.45;
    intent.moveZ = Math.sin(angle) * 0.45;
    memory.target = { x: receiver.pos.x, z: receiver.pos.z };
    memory.stateTime += ctx.dt;
    if (memory.stateTime >= 0.06 + preset.reactionTime * 0.25) {
      if (option.lofted) intent.throughBall = true;
      else intent.pass = true;
      return 'Support';
    }
    return null;
  },
};

/** Line up the shot, hold shoot for the chosen power, then release. */
const Shoot: State<AgentContext> = {
  name: 'Shoot',
  enter(ctx) {
    const { memory, rng, preset } = ctx;
    const shot = evaluateShot(ctx.world, ctx.player);
    memory.shotAimZ = shot.aimZ;
    memory.stateTime = 0;
    // Further out needs more power, but with a defender closing in there's no time to
    // wind up: settle for a quicker, softer strike. A little randomness so it isn't robotic.
    const pressure = smoothstep(
      3,
      1,
      nearestOpponentDistance(ctx.world, ctx.player.team, ctx.player.pos),
    );
    const wanted = ((shot.distance - 4) / 16) * (1 - 0.6 * pressure);
    const power = clamp(wanted + rng.gaussian() * 0.05, 0.25, 0.95);
    memory.chargeTime = power * PLAYER.shotChargeTime;
    memory.aimNoise = rng.gaussian() * preset.shotError * PITCH.goalHalfWidth;
  },
  execute(ctx) {
    const { world, player, memory, intent } = ctx;
    const { ball } = world;
    const nearBall =
      Math.hypot(ball.pos.x - player.pos.x, ball.pos.z - player.pos.z) < PLAYER.kickReach + 0.3;
    if (!hasBall(ctx) && !nearBall) return 'Support';

    const goalX = attackDir(ctx) * PITCH.halfLength;
    const aimZ = memory.shotAimZ + memory.aimNoise;
    const angle = angleOf(goalX - ball.pos.x, aimZ - ball.pos.z);
    intent.moveX = Math.cos(angle) * 0.8;
    intent.moveZ = Math.sin(angle) * 0.8;
    memory.target = { x: goalX, z: aimZ };

    memory.stateTime += ctx.dt;
    if (memory.stateTime < memory.chargeTime) {
      intent.shoot = true;
      return null;
    }
    // Releasing shoot (intent.shoot = false) strikes the ball.
    return 'Support';
  },
};

// ---------------------------------------------------------------------------------
// Decision making
// ---------------------------------------------------------------------------------

/**
 * Score every option on the same 0..1 scale and return the state to switch to, or null to
 * keep dribbling.
 *   shoot    the shot score (only if it clears the preset's shootThreshold);
 *   pass     PassScoring: (1 - risk) * (0.9 value + 0.1 space);
 *   dribble  the value of the spot 3.5 m ahead, reduced when there's no space or when
 *            an opponent is breathing down your neck (pressure).
 * Gaussian noise (scaled by decisionNoise) on each score makes weaker CPUs pick
 * second-best options more often.
 */
function decide(ctx: AgentContext): OutfieldStateName | null {
  const { world, player, preset, memory, rng } = ctx;
  const noise = (): number => rng.gaussian() * preset.decisionNoise;
  const pressure = smoothstep(2.5, 0.8, nearestOpponentDistance(world, player.team, player.pos));

  const dribble = evaluateDribble(ctx);
  memory.dribbleAngle = dribble.angle;
  let bestScore = dribble.score * (1 - 0.5 * pressure) + noise();
  let choice: OutfieldStateName | null = null;

  const shot = evaluateShot(world, player);
  if (shot.score >= preset.shootThreshold) {
    const shotScore = shot.score + noise();
    if (shotScore > bestScore) {
      bestScore = shotScore;
      choice = 'Shoot';
    }
  }

  const passes = evaluatePasses(world, player);
  for (const option of passes.slice(0, 3)) {
    const score = option.score + noise();
    if (score > bestScore) {
      bestScore = score;
      choice = 'LookForPass';
      memory.pass = option;
    }
  }
  return choice;
}

/**
 * Try a fan of directions around "straight at goal" and keep the one leading to the most
 * valuable spot with room to get there. The boards are allowed, but discouraged.
 */
function evaluateDribble(ctx: AgentContext): { score: number; angle: number } {
  const { world, player } = ctx;
  const goalX = attackDir(ctx) * PITCH.halfLength;
  const toGoal = angleOf(goalX - player.pos.x, -player.pos.z * 0.6);
  let best = { score: 0, angle: toGoal };
  for (const offset of [0, -0.5, 0.5, -1.0, 1.0]) {
    const angle = toGoal + offset;
    const px = player.pos.x + Math.cos(angle) * 3.5;
    const pz = player.pos.z + Math.sin(angle) * 3.5;
    const nearBoards = Math.abs(px) > PITCH.halfLength - 1 || Math.abs(pz) > PITCH.halfWidth - 1;
    const room = smoothstep(1, 5, openSpaceAhead(ctx, angle));
    const value =
      positionValue(world, player.team, px, pz) * (0.55 + 0.45 * room) * (nearBoards ? 0.6 : 1);
    if (value > best.score) best = { score: value, angle };
  }
  return best;
}

/** Distance from a point 3.5 m ahead (in this direction) to the nearest opponent. */
function openSpaceAhead(ctx: AgentContext, angle: number): number {
  const p = ctx.player.pos;
  const probe = { x: p.x + Math.cos(angle) * 3.5, z: p.z + Math.sin(angle) * 3.5 };
  return nearestOpponentDistance(ctx.world, ctx.player.team, probe);
}

function unit(x: number, z: number): XZ {
  const length = Math.hypot(x, z) || 1;
  return { x: x / length, z: z / length };
}

export const OUTFIELD_STATES: readonly State<AgentContext>[] = [
  ReturnToPosition,
  Support,
  Mark,
  ChaseBall,
  Intercept,
  Dribble,
  LookForPass,
  Shoot,
];
