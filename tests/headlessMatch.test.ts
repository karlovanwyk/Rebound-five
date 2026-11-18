/**
 * A full CPU vs CPU match, simulated headlessly from a fixed seed.
 *
 * This is the strongest test in the project: it runs every system (AI, physics,
 * possession, keepers, match flow) together for thousands of ticks and checks:
 *  - nothing ever becomes NaN;
 *  - the ball never leaves the arena;
 *  - the CPU actually plays football (at least one shot);
 *  - the simulation is deterministic: the same seed gives exactly the same match.
 */
import { describe, expect, it } from 'vitest';
import { simulateMatch } from './simulateMatch';

describe('headless CPU vs CPU match', () => {
  const SEED = 20260;

  it('plays a full match with no NaNs, the ball in the arena and shots taken', () => {
    const report = simulateMatch(SEED, 2);
    expect(report.world.match.phase).toBe('fullTime');
    expect(report.nanDetected).toBe(false);
    expect(report.ballLeftArena, report.violation).toBe(false);
    expect(report.shots).toBeGreaterThanOrEqual(1);
    expect(report.passes).toBeGreaterThan(5);
  });

  it('is deterministic: the same seed gives the same result', () => {
    const first = simulateMatch(SEED, 2);
    const second = simulateMatch(SEED, 2);
    expect(second.world.match.score).toEqual(first.world.match.score);
    expect(second.ticks).toBe(first.ticks);
    expect(second.shots).toBe(first.shots);
    expect(second.world.ball.pos.toArray()).toEqual(first.world.ball.pos.toArray());
  });

  it('a different seed gives a different match', () => {
    const a = simulateMatch(1, 1);
    const b = simulateMatch(2, 1);
    const sameEverything =
      a.ticks === b.ticks && a.shots === b.shots && a.world.ball.pos.equals(b.world.ball.pos);
    expect(sameEverything).toBe(false);
  });
});
