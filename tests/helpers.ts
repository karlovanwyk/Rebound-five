/**
 * helpers.ts: shared utilities for the Vitest suites.
 */
import { BALL } from '../src/config';
import { createBall } from '../src/sim/ball/BallPhysics';
import type { BallState } from '../src/sim/types';

/** A fresh ball at a position with a velocity. */
export function ballAt(x: number, y: number, z: number, vx = 0, vy = 0, vz = 0): BallState {
  const ball = createBall();
  ball.pos.set(x, y, z);
  ball.vel.set(vx, vy, vz);
  return ball;
}

/**
 * Temporarily override config values for one test. Config objects are mutable on purpose
 * (so the #debug panel can tune them), which also makes isolated physics tests easy.
 */
export function withConfig<T extends object>(
  target: T,
  overrides: Partial<T>,
  run: () => void,
): void {
  const saved: Partial<T> = {};
  for (const key of Object.keys(overrides) as Array<keyof T>) saved[key] = target[key];
  Object.assign(target, overrides);
  try {
    run();
  } finally {
    Object.assign(target, saved);
  }
}

export const r = BALL.radius;
