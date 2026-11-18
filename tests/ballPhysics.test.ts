/**
 * Ball physics: integration, drag, friction, bounces, boards, posts, crossbar and curve.
 */
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { BALL, PITCH, SIM } from '../src/config';
import { SeededRandom } from '../src/core/SeededRandom';
import { isRolling, stepBall } from '../src/sim/ball/BallPhysics';
import { collideCapsule } from '../src/sim/ball/Collisions';
import type { SimEvent } from '../src/sim/events';
import { detectGoal } from '../src/sim/match/GoalDetection';
import { ballAt, r, withConfig } from './helpers';

function simulate(seconds: number, ball = ballAt(0, r, 0), events: SimEvent[] | null = null): void {
  const ticks = Math.round(seconds / SIM.dt);
  for (let i = 0; i < ticks; i++) stepBall(ball, SIM.dt, events);
}

describe('ball physics', () => {
  it('falls under gravity like y = y0 - g t^2 / 2 (no drag)', () => {
    withConfig(BALL, { airDrag: 0 }, () => {
      const ball = ballAt(0, 10, 0);
      simulate(1, ball);
      const expected = 10 - 0.5 * BALL.gravity * 1 * 1;
      // Semi-implicit Euler is first-order accurate: within a few centimetres at 240 Hz.
      expect(ball.pos.y).toBeCloseTo(expected, 1);
    });
  });

  it('bounces to roughly e^2 of the drop height', () => {
    withConfig(BALL, { airDrag: 0 }, () => {
      const dropHeight = 4;
      const ball = ballAt(0, r + dropHeight, 0);
      let bounced = false;
      let apex = 0;
      for (let i = 0; i < 300; i++) {
        const before = ball.vel.y;
        stepBall(ball, SIM.dt, null);
        if (before < 0 && ball.vel.y > 0) bounced = true;
        if (bounced) apex = Math.max(apex, ball.pos.y - r);
        if (bounced && ball.vel.y < 0 && ball.pos.y - r < apex - 0.01) break;
      }
      const expected = dropHeight * BALL.groundRestitution ** 2;
      expect(apex).toBeGreaterThan(expected * 0.9);
      expect(apex).toBeLessThan(expected * 1.1);
    });
  });

  it('rolling friction stops the ball after v^2 / (2a) metres', () => {
    withConfig(BALL, { airDrag: 0 }, () => {
      const v0 = 10;
      const ball = ballAt(-15, r, 0, v0, 0, 0);
      simulate(6, ball);
      const expectedDistance = (v0 * v0) / (2 * BALL.rollingDeceleration);
      expect(ball.vel.length()).toBe(0);
      expect(ball.pos.x + 15).toBeCloseTo(expectedDistance, 0);
      expect(isRolling(ball)).toBe(true);
    });
  });

  it('air drag removes about k v^2 of speed per second', () => {
    withConfig(BALL, { gravity: 0 }, () => {
      const ball = ballAt(0, 5, 0, 30, 0, 0);
      simulate(0.1, ball);
      const expectedLoss = BALL.airDrag * 30 * 30 * 0.1;
      expect(30 - ball.vel.x).toBeGreaterThan(expectedLoss * 0.9);
      expect(30 - ball.vel.x).toBeLessThan(expectedLoss * 1.1);
    });
  });

  it('rebounds off the side boards with board restitution', () => {
    const ball = ballAt(0, r, PITCH.halfWidth - 1, 0, 0, 10);
    const events: SimEvent[] = [];
    simulate(0.3, ball, events);
    expect(ball.vel.z).toBeLessThan(0);
    expect(Math.abs(ball.vel.z)).toBeLessThan(10 * BALL.boardRestitution + 0.01);
    expect(events.some((e) => e.type === 'bounce' && e.surface === 'board')).toBe(true);
  });

  it('rebounds off the end boards beside the goal', () => {
    const ball = ballAt(PITCH.halfLength - 2, r, PITCH.goalHalfWidth + 2, 12, 0, 0);
    simulate(0.4, ball);
    expect(ball.vel.x).toBeLessThan(0);
    expect(ball.pos.x).toBeLessThan(PITCH.halfLength);
  });

  it('rolls through the goal mouth and is held by the net', () => {
    const ball = ballAt(PITCH.halfLength - 3, r, 0, 15, 0, 0);
    simulate(2, ball);
    expect(ball.pos.x).toBeGreaterThan(PITCH.halfLength + r);
    expect(ball.pos.x).toBeLessThanOrEqual(PITCH.halfLength + PITCH.goalDepth);
    expect(detectGoal(ball.pos)).toBe(0);
  });

  it('bounces back off the post when struck head-on', () => {
    const ball = ballAt(PITCH.halfLength - 2, 0.5, PITCH.goalHalfWidth, 15, 0, 0);
    const events: SimEvent[] = [];
    simulate(0.3, ball, events);
    expect(ball.vel.x).toBeLessThan(0);
    expect(events.some((e) => e.type === 'bounce' && e.surface === 'post')).toBe(true);
  });

  it('sphere-vs-capsule reflects only the normal component', () => {
    const ball = ballAt(0, 0, 0.15, 3, 0, -2);
    const a = new Vector3(-1, 0, 0);
    const b = new Vector3(1, 0, 0); // capsule along x, ball just above it in z
    const hit = collideCapsule(ball, a, b, 0.07, null);
    expect(hit).toBe(true);
    expect(ball.vel.x).toBeCloseTo(3); // tangential part unchanged
    expect(ball.vel.z).toBeCloseTo(2 * BALL.postRestitution); // normal part reflected
    expect(ball.pos.z).toBeCloseTo(r + 0.07);
  });

  it('deflects off the crossbar', () => {
    const ball = ballAt(PITCH.halfLength - 2, PITCH.goalHeight + 0.05, 0, 15, 0, 0);
    withConfig(BALL, { gravity: 0 }, () => simulate(0.3, ball));
    expect(ball.vel.x).toBeLessThan(0);
    expect(detectGoal(ball.pos)).toBeNull();
  });

  it('side spin curves the ball (Magnus effect)', () => {
    withConfig(BALL, { gravity: 0 }, () => {
      const plain = ballAt(-10, 5, 0, 25, 0, 0);
      const curling = ballAt(-10, 5, 0, 25, 0, 0);
      curling.spin.set(0, 30, 0);
      simulate(0.6, plain);
      simulate(0.6, curling);
      expect(plain.pos.z).toBeCloseTo(0);
      // Positive Y spin with +x velocity: spin x v = (0, 0, -30*25) -> bends toward -z.
      expect(curling.pos.z).toBeLessThan(-0.3);
    });
  });

  it('never leaves the arena, whatever the kick (fuzz test)', () => {
    const rng = new SeededRandom(99);
    const maxX = PITCH.halfLength + PITCH.goalDepth;
    for (let k = 0; k < 150; k++) {
      const ball = ballAt(rng.range(-19, 19), rng.range(r, 3), rng.range(-11, 11));
      ball.vel.set(rng.range(-35, 35), rng.range(-5, 20), rng.range(-35, 35));
      ball.spin.set(0, rng.range(-40, 40), 0);
      for (let i = 0; i < 180; i++) {
        stepBall(ball, SIM.dt, null);
        expect(Math.abs(ball.pos.x)).toBeLessThanOrEqual(maxX);
        expect(Math.abs(ball.pos.z)).toBeLessThanOrEqual(PITCH.halfWidth);
        expect(ball.pos.y).toBeGreaterThanOrEqual(r - 1e-9);
        expect(ball.pos.y).toBeLessThanOrEqual(PITCH.ceilingHeight);
      }
    }
  });
});
