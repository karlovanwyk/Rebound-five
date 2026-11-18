/**
 * Interception maths: the analytic quadratic, rolling-ball kinematics, path sampling and
 * pass-lane risk.
 */
import { describe, expect, it } from 'vitest';
import { BALL } from '../src/config';
import type { PathSamples } from '../src/sim/ai/Interception';
import {
  findInterception,
  interceptTimeConstantVelocity,
  passLaneRisk,
  rollingArrivalTime,
  rollingPosition,
} from '../src/sim/ai/Interception';

/** A ball rolling along +x from the origin, sampled like BallPrediction. */
function rollingPath(speed: number): PathSamples {
  const step = 1 / 30;
  const out = { x: 0, z: 0 };
  return {
    count: 90,
    step,
    x: (i) => rollingPosition({ x: 0, z: 0 }, { x: speed, z: 0 }, i * step, out).x,
    y: () => BALL.radius,
    z: () => 0,
  };
}

describe('interceptTimeConstantVelocity (quadratic)', () => {
  it('finds the earliest meeting time', () => {
    // Ball from (0,0) at 10 m/s along x; chaser at (10, 5) running 5 m/s.
    // (|V|^2 - s^2) t^2 + 2 (D.V) t + |D|^2 = 75 t^2 - 200 t + 125 = 0 -> t = 1 or 5/3.
    const t = interceptTimeConstantVelocity({ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 5 }, 5);
    expect(t).toBeCloseTo(1, 6);
  });

  it('returns null when the ball runs away from a slower chaser', () => {
    const t = interceptTimeConstantVelocity({ x: 0, z: 0 }, { x: 10, z: 0 }, { x: -5, z: 0 }, 5);
    expect(t).toBeNull();
  });

  it('handles equal speeds (the linear case)', () => {
    const t = interceptTimeConstantVelocity({ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 10, z: 0 }, 5);
    expect(t).toBeCloseTo(1, 6);
  });
});

describe('rolling ball kinematics', () => {
  it('stops after v^2 / (2a) metres', () => {
    const end = rollingPosition({ x: 0, z: 0 }, { x: 10, z: 0 }, 100, { x: 0, z: 0 }, 2.5);
    expect(end.x).toBeCloseTo(100 / 5, 6);
  });

  it('arrival time solves d = v t - a t^2 / 2', () => {
    const t = rollingArrivalTime(10, 15, 2.5);
    expect(10 * t - 0.5 * 2.5 * t * t).toBeCloseTo(15, 6);
    expect(rollingArrivalTime(5, 100, 2.5)).toBe(Infinity); // stops after 5 m
  });
});

describe('findInterception (sampled path)', () => {
  it('a player beside the path meets the ball early', () => {
    const near = findInterception(rollingPath(10), { x: 4, z: 1 }, 7, 0);
    const far = findInterception(rollingPath(10), { x: 4, z: 6 }, 7, 0);
    expect(near).not.toBeNull();
    expect(far).not.toBeNull();
    expect(near!.time).toBeLessThan(far!.time);
    expect(far!.x).toBeGreaterThan(near!.x);
  });

  it('reaction time delays the interception', () => {
    const quick = findInterception(rollingPath(10), { x: 6, z: 3 }, 7, 0);
    const slow = findInterception(rollingPath(10), { x: 6, z: 3 }, 7, 0.5);
    expect(slow!.time).toBeGreaterThan(quick!.time);
  });
});

describe('passLaneRisk', () => {
  it('is high with a defender standing in the lane and low with nobody near', () => {
    const from = { x: 0, z: 0 };
    const to = { x: 12, z: 0 };
    expect(passLaneRisk(from, to, 12, [{ x: 6, z: 0.3 }], 7, 0.1, false)).toBeGreaterThan(0.9);
    expect(passLaneRisk(from, to, 12, [{ x: 6, z: 9 }], 7, 0.1, false)).toBeLessThan(0.1);
  });

  it('a lofted pass clears a defender standing mid-lane', () => {
    const ground = passLaneRisk(
      { x: 0, z: 0 },
      { x: 16, z: 0 },
      14,
      [{ x: 8, z: 0 }],
      7,
      0.1,
      false,
    );
    const lofted = passLaneRisk(
      { x: 0, z: 0 },
      { x: 16, z: 0 },
      14,
      [{ x: 8, z: 0 }],
      7,
      0.1,
      true,
    );
    expect(lofted).toBeLessThan(ground);
  });
});
