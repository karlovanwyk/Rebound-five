/**
 * CameraRig.ts: moves the camera like a TV director would.
 *
 * Modes:
 *  - broadcast:   high side-on view that follows the ball and leans toward the goal the
 *                 team in possession is attacking, so you see where the play is going.
 *  - celebration: a closer camera that slowly orbits the goal scorer.
 *  - attract:     a slow, wide drift for the menu background.
 *  - replay:      low angle from behind the goal for instant replays.
 *
 * Smoothing: rather than snapping to its target, the camera moves a fraction of the
 * remaining distance each frame. The fraction is k = 1 - e^(-rate * dt). Using e^(-rate*dt)
 * instead of a fixed fraction like 0.1 makes the motion identical at 60 Hz and 144 Hz:
 * two small steps compound to exactly one bigger step.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import { PITCH } from '../config';
import { clamp } from '../sim/math';

export type CameraMode = 'broadcast' | 'celebration' | 'attract' | 'replay';

export interface Point {
  x: number;
  y: number;
  z: number;
}

/** Fraction to move toward a target this frame, frame-rate independent. */
export function smoothingFactor(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export class CameraRig {
  readonly camera = new PerspectiveCamera(40, 16 / 9, 0.1, 400);
  mode: CameraMode = 'broadcast';
  private readonly position = new Vector3(0, 15, 24);
  private readonly look = new Vector3();
  private readonly targetPosition = new Vector3();
  private readonly targetLook = new Vector3();
  private lean = 0;
  private orbit = 0;
  private time = 0;
  /** Narrow (portrait) screens need the camera further back to fit the pitch in. */
  private distanceScale = 1;
  /** -1 or +1: which end a replay is filmed from. */
  replaySide: 1 | -1 = 1;
  private pendingCut = false;

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.distanceScale = clamp(1.6 / aspect, 1, 2.3);
  }

  /**
   * Switch shot. With cut = true the camera jumps straight to the new framing (a TV "cut")
   * instead of gliding there.
   */
  setMode(mode: CameraMode, cut = false): void {
    if (cut) this.pendingCut = true;
    if (mode === this.mode) return;
    this.mode = mode;
    this.orbit = mode === 'celebration' ? 0.6 : 0;
  }

  /**
   * @param ball      interpolated ball position
   * @param leanDir   +1/-1 toward the goal being attacked, 0 if nobody has the ball
   * @param subject   point of interest for celebrations (the scorer)
   */
  update(dt: number, ball: Point, leanDir: number, subject: Point | null): void {
    this.time += dt;
    switch (this.mode) {
      case 'broadcast':
        this.broadcast(dt, ball, leanDir);
        break;
      case 'celebration':
        this.celebration(dt, subject ?? ball);
        break;
      case 'attract':
        this.attract(dt, ball);
        break;
      case 'replay':
        this.replay(dt, ball);
        break;
    }
    if (this.pendingCut) {
      this.snap();
      this.pendingCut = false;
    }
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.look);
  }

  private broadcast(dt: number, ball: Point, leanDir: number): void {
    this.lean += (leanDir * 3.5 - this.lean) * smoothingFactor(1.5, dt);
    const limit = PITCH.halfLength - 12;
    const fx = clamp(ball.x + this.lean, -limit, limit);
    const fz = ball.z * 0.3;
    const s = this.distanceScale;
    this.targetPosition.set(fx * 0.95, 14.5 * s, fz + 21 * s);
    this.targetLook.set(fx, 0, fz - 1);
    this.follow(dt, 3.5, 5);
  }

  private celebration(dt: number, subject: Point): void {
    this.orbit += dt * 0.35;
    const radius = 6;
    this.targetPosition.set(
      subject.x + Math.sin(this.orbit) * radius,
      2.4,
      subject.z + Math.cos(this.orbit) * radius,
    );
    this.targetLook.set(subject.x, 1.2, subject.z);
    this.follow(dt, 2.2, 4);
  }

  private attract(dt: number, ball: Point): void {
    const t = this.time * 0.06;
    this.targetPosition.set(Math.sin(t) * 16, 17 + Math.sin(t * 0.7) * 3, 26 + Math.cos(t) * 4);
    this.targetLook.set(ball.x * 0.5, 0, ball.z * 0.3);
    this.follow(dt, 0.8, 1.5);
  }

  private replay(dt: number, ball: Point): void {
    const side = this.replaySide;
    // "Net cam": just behind the back of the net, in the gap before the end stand.
    this.targetPosition.set(
      side * (PITCH.halfLength + PITCH.goalDepth + 1.1),
      1.9,
      ball.z * 0.25 + 1.2,
    );
    this.targetLook.set(ball.x, ball.y * 0.5 + 0.5, ball.z);
    this.follow(dt, 3, 8);
  }

  /** Jump straight to the target (used when changing to a completely different shot). */
  snap(): void {
    this.position.copy(this.targetPosition);
    this.look.copy(this.targetLook);
  }

  private follow(dt: number, positionRate: number, lookRate: number): void {
    this.position.lerp(this.targetPosition, smoothingFactor(positionRate, dt));
    this.look.lerp(this.targetLook, smoothingFactor(lookRate, dt));
  }
}
