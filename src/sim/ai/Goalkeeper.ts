/**
 * Goalkeeper.ts: the keeper's own state machine.
 *
 *   GuardGoal --(shot predicted on target)--> SaveShot --(ball gone)--> GuardGoal
 *       |  \--(loose ball keeper wins the race to)--> RushOut --(done)--/
 *       \--(holding the ball)--> Distribute --(released)--> GuardGoal
 *
 *  - GuardGoal: stand on the arc between the ball and the centre of the goal, further
 *    off the line the further away the ball is. That narrows the angle.
 *  - SaveShot: read the predicted crossing point (BallPrediction runs the real physics
 *    forward, so curve and bounces are included), wait `keeperReaction`, then move there
 *    if there's time, or dive if there isn't. The keeper's estimate is off by a random
 *    error that grows on easier presets.
 *  - RushOut: come off the line to claim through balls and loose balls the keeper can
 *    reach before any attacker.
 *  - Distribute: hold the ball briefly, then throw or punt to the best-scored teammate.
 *
 * Whether a dive catches, parries or misses is decided by the sim (players/Goalkeeping.ts),
 * using the same rules for both teams' keepers.
 */
import { PITCH, PLAYER } from '../../config';
import type { XZ } from '../math';
import { clamp } from '../math';
import { isInKeeperBox } from '../players/Goalkeeping';
import { findInterception } from './Interception';
import { evaluatePasses } from './PassScoring';
import type { AgentContext } from './PlayerStates';
import type { State } from './StateMachine';
import { arrive, seek, toIntent } from './Steering';

function goalCentre(ctx: AgentContext): XZ {
  return { x: -ctx.world.teams[ctx.player.team].attackDir * PITCH.halfLength, z: 0 };
}

function isHolding(ctx: AgentContext): boolean {
  return ctx.world.ball.heldByKeeper && ctx.world.ball.ownerId === ctx.player.id;
}

/** Is a shot heading for our goal? Uses the predicted ball path. */
function shotIncoming(ctx: AgentContext): boolean {
  const { world } = ctx;
  const { ball } = world;
  if (ball.ownerId !== null) return false;
  const goal = goalCentre(ctx);
  const towardGoal = ball.vel.x * Math.sign(goal.x) > 0;
  if (!towardGoal || Math.hypot(ball.vel.x, ball.vel.z) < 7) return false;
  const crossing = ctx.prediction.goalLineCrossing(goal.x);
  if (!crossing || crossing.time > 1.4) return false;
  return Math.abs(crossing.z) < PITCH.goalHalfWidth + 0.6 && crossing.y < PITCH.goalHeight + 0.4;
}

/** Should the keeper come out to claim a loose ball? Only if they'd win the race to it. */
function rushTarget(ctx: AgentContext): XZ | null {
  const { world, player, prediction } = ctx;
  const { ball } = world;
  if (ball.ownerId !== null || world.pendingShot) return null;
  if (world.pendingPass && world.pendingPass.team === player.team) return null;
  const mine = findInterception(
    prediction,
    player.pos,
    PLAYER.sprintSpeed,
    ctx.preset.keeperReaction,
    0.7,
    2.2,
  );
  if (!mine || !isInKeeperBox(world, player, mine.x, mine.z)) return null;
  for (const p of world.players) {
    if (p.team === player.team) continue;
    const theirs = findInterception(prediction, p.pos, PLAYER.sprintSpeed, 0.1, 0.5, 1.0);
    if (theirs && theirs.time < mine.time + 0.15) return null;
  }
  return { x: mine.x, z: mine.z };
}

const GuardGoal: State<AgentContext> = {
  name: 'GuardGoal',
  execute(ctx) {
    if (isHolding(ctx)) return 'Distribute';
    if (shotIncoming(ctx)) return 'SaveShot';
    if (rushTarget(ctx)) return 'RushOut';

    const { world, player, preset, memory } = ctx;
    const goal = goalCentre(ctx);
    const dx = world.ball.pos.x - goal.x;
    const dz = world.ball.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    // Further from goal when the ball is far away, closer as it approaches.
    const radius = 0.5 + clamp(d * 0.1, 0.2, 1.8) * preset.keeperPositioning;
    const inward = Math.sign(-goal.x);
    const target = {
      x: goal.x + Math.max((dx / d) * radius * inward, 0.4) * inward,
      z: clamp((dz / d) * radius, -PITCH.goalHalfWidth + 0.3, PITCH.goalHalfWidth - 0.3),
    };
    memory.target = target;
    const steer = arrive(player.pos, target, PLAYER.runSpeed, 1.2, memory.steer);
    toIntent(steer, ctx.intent);
    return null;
  },
};

const SaveShot: State<AgentContext> = {
  name: 'SaveShot',
  enter(ctx) {
    const { memory, preset, rng, world } = ctx;
    memory.keeperReactTimer = preset.keeperReaction;
    const speed = Math.hypot(world.ball.vel.x, world.ball.vel.z);
    // Harder (faster) shots are harder to read.
    memory.keeperError =
      rng.gaussian() * preset.keeperError * (0.5 + 0.5 * clamp(speed / 25, 0, 1));
    memory.dived = false;
  },
  execute(ctx) {
    if (isHolding(ctx)) return 'Distribute';
    const { world, player, memory, intent } = ctx;
    const goal = goalCentre(ctx);
    const crossing = ctx.prediction.goalLineCrossing(goal.x);
    if (!crossing || crossing.time > 1.6 || world.ball.ownerId !== null) return 'GuardGoal';

    memory.keeperReactTimer -= ctx.dt;
    if (memory.keeperReactTimer > 0) {
      memory.steer.x = 0;
      memory.steer.z = 0;
      return null; // still reading the shot
    }

    // Where will the ball pass the keeper's own position along the pitch? Use the
    // predicted path at the moment it reaches the keeper's x (or the goal line).
    const pass = pathAtX(ctx, player.pos.x) ?? { time: crossing.time, z: crossing.z };
    const targetZ = clamp(
      pass.z + memory.keeperError,
      -PITCH.goalHalfWidth - 0.4,
      PITCH.goalHalfWidth + 0.4,
    );
    const target = { x: player.pos.x, z: targetZ };
    memory.target = target;
    const lateral = Math.abs(targetZ - player.pos.z);

    if (lateral < 0.5 || lateral / PLAYER.sprintSpeed + 0.08 < pass.time) {
      toIntent(
        seek(player.pos, target, lateral < 0.3 ? 0 : PLAYER.sprintSpeed, memory.steer),
        intent,
      );
    } else if (!memory.dived && pass.time <= diveLeadTime(lateral)) {
      // Not enough time to get there on foot: dive.
      intent.tackle = true;
      intent.moveX = 0;
      intent.moveZ = Math.sign(targetZ - player.pos.z);
      memory.dived = true;
    } else {
      toIntent(seek(player.pos, target, PLAYER.sprintSpeed, memory.steer), intent);
    }
    return null;
  },
};

/** Roughly how long before the ball arrives a keeper must dive to cover `lateral` metres. */
function diveLeadTime(lateral: number): number {
  return clamp(0.1 + lateral * 0.09, 0.12, 0.42);
}

/** Time and z when the predicted path reaches pitch position x, if it does. */
function pathAtX(ctx: AgentContext, x: number): { time: number; z: number } | null {
  const path = ctx.prediction;
  for (let i = 1; i < path.count; i++) {
    const before = path.x(i - 1) - x;
    const after = path.x(i) - x;
    if (before === 0 || Math.sign(before) !== Math.sign(after)) {
      const f = before / (before - after || 1);
      return { time: (i - 1 + f) * path.step, z: path.z(i - 1) + (path.z(i) - path.z(i - 1)) * f };
    }
  }
  return null;
}

const RushOut: State<AgentContext> = {
  name: 'RushOut',
  execute(ctx) {
    if (isHolding(ctx)) return 'Distribute';
    if (shotIncoming(ctx)) return 'SaveShot';
    const target = rushTarget(ctx);
    if (!target) return 'GuardGoal';
    ctx.memory.target = target;
    toIntent(seek(ctx.player.pos, target, PLAYER.sprintSpeed, ctx.memory.steer), ctx.intent);
    return null;
  },
};

const Distribute: State<AgentContext> = {
  name: 'Distribute',
  enter(ctx) {
    ctx.memory.stateTime = 0;
    ctx.memory.decisionTimer = ctx.rng.range(0.6, 1.3) + ctx.preset.reactionTime;
  },
  execute(ctx) {
    if (!isHolding(ctx)) return 'GuardGoal';
    const { world, player, memory, intent, rng, preset } = ctx;
    memory.stateTime += ctx.dt;
    memory.steer.x = 0;
    memory.steer.z = 0;
    if (memory.stateTime < memory.decisionTimer) return null;

    const options = evaluatePasses(world, player);
    const best = options[0];
    if (!best || best.score <= 0) {
      // Nothing on: punt it long, straight up the pitch.
      intent.moveX = world.teams[player.team].attackDir * 0.6;
      intent.throughBall = true;
      return 'GuardGoal';
    }
    const receiver = world.players[best.receiverId];
    const angle =
      Math.atan2(receiver.pos.z - world.ball.pos.z, receiver.pos.x - world.ball.pos.x) +
      rng.gaussian() * preset.passError;
    intent.moveX = Math.cos(angle) * 0.5;
    intent.moveZ = Math.sin(angle) * 0.5;
    memory.target = { x: receiver.pos.x, z: receiver.pos.z };
    if (best.lofted) intent.throughBall = true;
    else intent.pass = true;
    return 'GuardGoal';
  },
};

export const KEEPER_STATES: readonly State<AgentContext>[] = [
  GuardGoal,
  SaveShot,
  RushOut,
  Distribute,
];
