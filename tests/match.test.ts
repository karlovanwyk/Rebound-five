/**
 * Match flow: the compressed clock, kickoffs, goals, full time and golden goal.
 */
import { describe, expect, it } from 'vitest';
import { BALL, MATCH, PITCH, SIM } from '../src/config';
import { createIntent } from '../src/input/Intent';
import { footballMinute, formatClock, minutesToTicks } from '../src/sim/match/Clock';
import type { World } from '../src/sim/types';
import { createWorld, stepWorld } from '../src/sim/World';

function idleIntents(world: World) {
  return world.players.map(() => createIntent());
}

function stepSeconds(world: World, seconds: number): void {
  const intents = idleIntents(world);
  for (let i = 0; i < Math.round(seconds / SIM.dt); i++) stepWorld(world, intents);
}

describe('match clock', () => {
  it('converts real minutes to ticks', () => {
    expect(minutesToTicks(2)).toBe(2 * 60 * SIM.tickRate);
  });

  it('squeezes 90 minutes into the real match length', () => {
    const duration = minutesToTicks(2);
    expect(footballMinute(duration / 2, duration)).toBeCloseTo(45);
    // In a 2-minute match each real second is 0.75 football minutes.
    expect(footballMinute(SIM.tickRate, duration)).toBeCloseTo(0.75);
  });

  it('formats the clock, including stoppage during golden goal', () => {
    const world = createWorld({ seed: 1, matchMinutes: 2 });
    world.match.clockTicks = minutesToTicks(1);
    expect(formatClock(world.match)).toBe("45'");
    world.match.clockTicks = minutesToTicks(2) + minutesToTicks(2) / 45;
    world.match.goldenGoal = true;
    expect(formatClock(world.match)).toBe("90+2'");
  });

  it('does not run during the kickoff wait', () => {
    const world = createWorld({ seed: 1 });
    stepSeconds(world, MATCH.kickoffDelay * 0.5);
    expect(world.match.phase).toBe('kickoff');
    expect(world.match.clockTicks).toBe(0);
    stepSeconds(world, MATCH.kickoffDelay);
    expect(world.match.phase).toBe('playing');
    expect(world.match.clockTicks).toBeGreaterThan(0);
  });

  it('blows the final whistle when time is up', () => {
    const world = createWorld({ seed: 1, matchMinutes: 0.05 }); // 3 real seconds
    stepSeconds(world, MATCH.kickoffDelay + 3.2);
    expect(world.match.phase).toBe('fullTime');
    expect(world.match.winner).toBeNull();
  });

  it('goes to golden goal when a cup match is drawn', () => {
    const world = createWorld({ seed: 1, matchMinutes: 0.05, goldenGoal: true });
    stepSeconds(world, MATCH.kickoffDelay + 4);
    expect(world.match.phase).toBe('playing');
    expect(world.match.goldenGoal).toBe(true);
  });
});

describe('goals and kickoffs', () => {
  it('scores, celebrates, then the conceding team kicks off', () => {
    const world = createWorld({ seed: 3, skipKickoff: true });
    const shooter = world.players[4]; // team 0 striker
    world.ball.lastTouchId = shooter.id;
    world.ball.pos.set(PITCH.halfLength - 1, BALL.radius, 1.6); // beside the keeper
    world.ball.vel.set(10, 0, 0);
    stepSeconds(world, 0.5);
    expect(world.match.score).toEqual([1, 0]);
    expect(world.match.phase).toBe('goal');
    expect(world.match.goals[0].scorerId).toBe(shooter.id);
    expect(shooter.action).toBe('celebrate');

    stepSeconds(world, MATCH.goalCelebration);
    expect(world.match.phase).toBe('kickoff');
    expect(world.match.kickoffTeam).toBe(1);
    expect(world.ball.pos.x).toBe(0);
  });

  it('credits an own goal to the other team', () => {
    const world = createWorld({ seed: 3, skipKickoff: true });
    world.ball.lastTouchId = world.players[6].id; // a team 1 defender
    world.ball.pos.set(PITCH.halfLength - 1, BALL.radius, 1.6); // beside the keeper
    world.ball.vel.set(10, 0, 0);
    stepSeconds(world, 0.5);
    expect(world.match.score).toEqual([1, 0]);
    expect(world.match.goals[0].ownGoal).toBe(true);
  });

  it('a golden goal ends the match immediately after the celebration', () => {
    const world = createWorld({ seed: 3, skipKickoff: true, goldenGoal: true });
    world.match.goldenGoal = true;
    world.match.clockTicks = world.match.durationTicks;
    world.ball.lastTouchId = world.players[4].id;
    world.ball.pos.set(PITCH.halfLength - 1, BALL.radius, 1.6); // beside the keeper
    world.ball.vel.set(10, 0, 0);
    stepSeconds(world, 0.5 + MATCH.goalCelebration);
    expect(world.match.phase).toBe('fullTime');
    expect(world.match.winner).toBe(0);
  });
});
