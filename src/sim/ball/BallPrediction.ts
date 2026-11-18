/**
 * BallPrediction.ts: where will the ball be over the next 2.5 seconds?
 *
 * Rather than approximating the flight with formulas, we copy the ball into a "ghost" and
 * run the real physics (BallPhysics.stepBall) forward, recording positions as we go. The
 * prediction therefore includes drag, curve, bounces, boards and posts. The AI knows
 * that a ball played against the boards comes back, and the keeper can tell where a
 * curling shot will cross the line.
 *
 * The AIController refreshes one prediction per team each tick (75 samples at 1/30 s).
 * Because it runs the same deterministic code, it doesn't break replays.
 */
import { BALL } from '../../config';
import type { PathSamples } from '../ai/Interception';
import type { World } from '../types';
import { createBall, stepBall } from './BallPhysics';

export interface GoalLineCrossing {
  time: number;
  z: number;
  y: number;
}

export class BallPrediction implements PathSamples {
  readonly step = 1 / 30;
  readonly count = 75;
  private readonly data = new Float32Array(this.count * 3);
  private readonly ghost = createBall();

  update(world: World): void {
    const { ball } = world;
    const owner = ball.ownerId !== null ? world.players[ball.ownerId] : null;

    if (owner) {
      // A carried ball goes wherever the carrier goes: assume they keep running the
      // same way for a moment.
      for (let i = 0; i < this.count; i++) {
        const t = Math.min(i * this.step, 0.6);
        this.set(i, ball.pos.x + owner.vel.x * t, ball.pos.y, ball.pos.z + owner.vel.z * t);
      }
      return;
    }

    this.ghost.pos.copy(ball.pos);
    this.ghost.vel.copy(ball.vel);
    this.ghost.spin.copy(ball.spin);
    for (let i = 0; i < this.count; i++) {
      this.set(i, this.ghost.pos.x, this.ghost.pos.y, this.ghost.pos.z);
      stepBall(this.ghost, this.step, null);
    }
  }

  x(i: number): number {
    return this.data[i * 3];
  }

  y(i: number): number {
    return this.data[i * 3 + 1];
  }

  z(i: number): number {
    return this.data[i * 3 + 2];
  }

  /** Where the ball comes to rest (or is at the end of the prediction). */
  restingPoint(): { x: number; z: number } {
    const last = this.count - 1;
    return { x: this.x(last), z: this.z(last) };
  }

  /**
   * First time the predicted path crosses the goal line x = goalX heading into the goal.
   * Linear interpolation between the two samples either side gives the exact crossing.
   */
  goalLineCrossing(goalX: number): GoalLineCrossing | null {
    const side = Math.sign(goalX);
    const lineX = goalX - side * BALL.radius;
    for (let i = 1; i < this.count; i++) {
      const before = (this.x(i - 1) - lineX) * side;
      const after = (this.x(i) - lineX) * side;
      if (before < 0 && after >= 0) {
        const f = before / (before - after);
        return {
          time: (i - 1 + f) * this.step,
          z: this.z(i - 1) + (this.z(i) - this.z(i - 1)) * f,
          y: this.y(i - 1) + (this.y(i) - this.y(i - 1)) * f,
        };
      }
    }
    return null;
  }

  private set(i: number, x: number, y: number, z: number): void {
    this.data[i * 3] = x;
    this.data[i * 3 + 1] = y;
    this.data[i * 3 + 2] = z;
  }
}
