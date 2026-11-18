/**
 * Match.ts: the referee. Kickoffs, goals, celebrations and full time.
 *
 * The match moves through phases (see MatchPhase in types.ts):
 *
 *   kickoff --(whistle)--> playing --(goal)--> goal --(celebration over)--> kickoff
 *                             |                  |
 *                             +--(time up)--> fullTime <--(golden goal scored)
 *
 * World.ts asks this module what to do each tick. The phases live in the sim, not in the
 * UI, so the headless test can play a whole match, kickoffs included.
 */
import { MATCH, PITCH } from '../../config';
import type { Intent } from '../../input/Intent';
import { resetIntent } from '../../input/Intent';
import { resetBall } from '../ball/BallPhysics';
import { startAction } from '../players/Player';
import type { MatchState, PlayerState, TeamId, World } from '../types';
import { isTimeUp, minutesToTicks } from './Clock';
import { resolveShot } from './Stats';

export function createMatchState(realMinutes: number, goldenGoalEnabled: boolean): MatchState {
  return {
    phase: 'kickoff',
    phaseTime: MATCH.kickoffDelay,
    clockTicks: 0,
    durationTicks: minutesToTicks(realMinutes),
    score: [0, 0],
    kickoffTeam: 0,
    kickoffProtection: 0,
    goldenGoalEnabled,
    goldenGoal: false,
    goals: [],
    winner: null,
  };
}

/**
 * Kickoff formation, in metres, for a team attacking toward +x. Mirrored for the other
 * team. The kicking team's striker stands by the ball; the other team waits outside the
 * centre circle.
 */
const KICKOFF_LAYOUT: Array<{ x: number; z: number }> = [
  { x: -(PITCH.halfLength - 0.8), z: 0 }, // 0: goalkeeper
  { x: -11, z: 0 }, // 1: defender
  { x: -6, z: -5 }, // 2: left
  { x: -6, z: 5 }, // 3: right
  { x: -4, z: 0 }, // 4: striker
];

export function kickoffPosition(
  player: PlayerState,
  kickingTeam: TeamId,
): { x: number; z: number } {
  const dir = player.team === 0 ? 1 : -1;
  const base = KICKOFF_LAYOUT[player.index] ?? KICKOFF_LAYOUT[1];
  let { x, z } = base;
  if (player.team === kickingTeam) {
    if (player.index === 4) x = -0.55; // right behind the ball
    if (player.index === 3) {
      x = -2.5;
      z = 3;
    }
  }
  return { x: x * dir, z };
}

/** Reset everyone for a kickoff by `team`. */
export function startKickoff(world: World, team: TeamId): void {
  const { match } = world;
  match.phase = 'kickoff';
  match.phaseTime = MATCH.kickoffDelay;
  match.kickoffTeam = team;
  resetBall(world.ball);
  world.pendingPass = null;
  world.pendingShot = null;

  for (const player of world.players) {
    const spot = kickoffPosition(player, team);
    player.pos.set(spot.x, 0, spot.z);
    player.vel.set(0, 0, 0);
    player.facing = player.team === 0 ? 0 : Math.PI;
    player.action = 'none';
    player.actionTime = 0;
    player.charging = false;
    player.shotCharge = 0;
    player.buffered = null;
    player.kickLockout = 0;
    player.tackleCooldown = 0;
  }
}

/** Called each tick of the kickoff phase. Returns true when the whistle blows. */
export function tickKickoff(world: World, dt: number): boolean {
  const { match } = world;
  match.phaseTime -= dt;
  if (match.phaseTime > 0) return false;
  match.phase = 'playing';
  match.kickoffProtection = MATCH.kickoffProtection;
  world.events.push({ type: 'whistle', kind: 'kickoff' });
  return true;
}

/**
 * Until the kicking team has touched the ball, opponents are held outside the centre
 * circle. This stops a CPU from stealing the ball before the kickoff is even taken.
 */
export function enforceKickoffProtection(world: World, dt: number): void {
  const { match, ball } = world;
  if (match.kickoffProtection <= 0) return;
  match.kickoffProtection -= dt;
  const touchedBy = ball.lastTouchId !== null ? world.players[ball.lastTouchId] : null;
  if (touchedBy && touchedBy.team === match.kickoffTeam) {
    match.kickoffProtection = 0;
    return;
  }
  const radius = PITCH.centreCircleRadius + 0.2;
  for (const player of world.players) {
    if (player.team === match.kickoffTeam) continue;
    const d = Math.hypot(player.pos.x, player.pos.z);
    if (d < radius) {
      const scale = d > 1e-6 ? radius / d : 1;
      player.pos.x = d > 1e-6 ? player.pos.x * scale : -radius * (player.team === 0 ? 1 : -1);
      player.pos.z *= scale;
    }
  }
}

/** A goal went in: update the score and start the celebration. */
export function registerGoal(world: World, scoringTeam: TeamId): void {
  const { match, ball } = world;
  const lastTouch = ball.lastTouchId !== null ? world.players[ball.lastTouchId] : null;
  const ownGoal = lastTouch !== null && lastTouch.team !== scoringTeam;
  match.score[scoringTeam]++;
  match.goals.push({
    team: scoringTeam,
    scorerId: lastTouch?.id ?? null,
    ownGoal,
    clockTicks: match.clockTicks,
  });
  match.phase = 'goal';
  match.phaseTime = MATCH.goalCelebration;
  if (world.pendingShot) resolveShot(world, world.pendingShot.team === scoringTeam);
  world.pendingPass = null;
  ball.ownerId = null;

  if (lastTouch && !ownGoal) startAction(lastTouch, 'celebrate', MATCH.goalCelebration);
  world.events.push({ type: 'goal', team: scoringTeam, scorerId: lastTouch?.id ?? null, ownGoal });
}

/** Called each tick of the goal phase. Decides between another kickoff and full time. */
export function tickGoalPhase(world: World, dt: number): void {
  const { match } = world;
  match.phaseTime -= dt;
  if (match.phaseTime > 0) return;
  if (match.goldenGoal || isTimeUp(match)) {
    endMatch(world);
    return;
  }
  const lastGoal = match.goals[match.goals.length - 1];
  // The team that conceded kicks off.
  startKickoff(world, lastGoal ? (lastGoal.team === 0 ? 1 : 0) : 0);
}

/** Advance the clock by one playing tick and handle the final whistle. */
export function tickClock(world: World): void {
  const { match } = world;
  match.clockTicks++;
  if (!isTimeUp(match) || match.goldenGoal) return;
  const drawn = match.score[0] === match.score[1];
  if (drawn && match.goldenGoalEnabled) {
    match.goldenGoal = true;
    world.events.push({ type: 'whistle', kind: 'goldenGoal' });
    return;
  }
  endMatch(world);
}

function endMatch(world: World): void {
  const { match } = world;
  match.phase = 'fullTime';
  const [home, away] = match.score;
  match.winner = home > away ? 0 : away > home ? 1 : null;
  world.ball.ownerId = null;
  world.events.push({ type: 'whistle', kind: 'fullTime' });
}

/**
 * During celebrations nobody is controlled. The scorer's teammates jog over to join in,
 * and everyone else wanders to a stop. These are still Intents, so movement follows the
 * normal rules.
 */
export function celebrationIntent(world: World, player: PlayerState, out: Intent): void {
  resetIntent(out);
  const lastGoal = world.match.goals[world.match.goals.length - 1];
  if (!lastGoal || lastGoal.ownGoal || lastGoal.scorerId === null) return;
  const scorer = world.players[lastGoal.scorerId];
  if (player.team !== scorer.team || player === scorer || player.isKeeper) return;
  const dx = scorer.pos.x - player.pos.x;
  const dz = scorer.pos.z - player.pos.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1.6) return;
  const speed = Math.min(1, (distance - 1.6) / 3);
  out.moveX = (dx / distance) * speed;
  out.moveZ = (dz / distance) * speed;
}
