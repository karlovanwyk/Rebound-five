/**
 * Goal detection: the whole ball must cross the line, between the posts, under the bar.
 */
import { describe, expect, it } from 'vitest';
import { PITCH } from '../src/config';
import { detectGoal } from '../src/sim/match/GoalDetection';
import { r } from './helpers';

const L = PITCH.halfLength;

describe('goal detection', () => {
  it('counts a ball wholly over the line in the +x goal for team 0', () => {
    expect(detectGoal({ x: L + r + 0.01, y: r, z: 0 })).toBe(0);
  });

  it('counts a ball in the -x goal for team 1', () => {
    expect(detectGoal({ x: -(L + r + 0.01), y: 1, z: 1.5 })).toBe(1);
  });

  it('does not count a ball that is only partly over the line', () => {
    expect(detectGoal({ x: L + r * 0.5, y: r, z: 0 })).toBeNull();
    expect(detectGoal({ x: L, y: r, z: 0 })).toBeNull();
  });

  it('does not count a ball wide of the posts', () => {
    expect(detectGoal({ x: L + 0.5, y: r, z: PITCH.goalHalfWidth + 0.2 })).toBeNull();
  });

  it('does not count a ball over the bar', () => {
    expect(detectGoal({ x: L + 0.5, y: PITCH.goalHeight + 0.1, z: 0 })).toBeNull();
  });
});
