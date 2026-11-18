/**
 * Loop.ts: the main loop, with a fixed simulation timestep and variable-rate rendering.
 *
 * Why a fixed timestep? Monitors refresh at 60, 120, 144 Hz or more, and frames
 * sometimes arrive late. If the physics advanced by "however long the last frame took",
 * a ball would bounce differently on different machines, tunnel through posts after a
 * long frame, and a recorded match could never replay identically. So the simulation
 * always advances in identical steps of exactly 1/60 s (one "tick").
 *
 * How it works (the "accumulator" pattern):
 *   1. Each animation frame, add the real time that passed to an accumulator.
 *   2. While the accumulator holds at least one tick's worth of time, run one tick
 *      and subtract dt. A 144 Hz screen will often run zero ticks in a frame; a
 *      30 Hz screen runs two.
 *   3. Whatever is left over (less than one tick) becomes `alpha`: how far we are
 *      between the previous tick and the next one, from 0 to 1.
 *
 * Why interpolate? On a 144 Hz screen most frames fall between two ticks. Drawing the
 * latest tick as-is would make objects move in visible 60 Hz jumps. Instead, the
 * renderer blends the previous and current tick states by `alpha`, so motion is
 * smooth at any refresh rate. The cost is that what you see lags reality by under one
 * tick (about 16 ms), which nobody notices.
 */
export interface LoopCallbacks {
  /** Advance the simulation by exactly `dt` seconds. */
  update(dt: number): void;
  /**
   * Draw a frame. `alpha` is the 0..1 blend between the previous and current tick.
   * `frameDt` is the real time since the last frame (for camera smoothing and effects).
   */
  render(alpha: number, frameDt: number): void;
}

export class Loop {
  /** Longest real frame time we accept. Prevents the "spiral of death" after a stall. */
  maxFrameTime = 0.25;
  /** Scales real time (0.5 = slow motion). The tick size itself never changes. */
  timeScale = 1;

  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;

  constructor(
    private readonly dt: number,
    private readonly callbacks: LoopCallbacks,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Forget elapsed time, for example after the tab was hidden for a while. */
  resetTiming(): void {
    this.lastTime = performance.now();
    this.accumulator = 0;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;

    // requestAnimationFrame passes a high-resolution timestamp (same clock as performance.now()).
    let frameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // If the tab stalled (breakpoint, slow device), don't try to catch up on seconds of
    // simulation in one frame. That would make the next frame even slower, and so on.
    if (frameTime > this.maxFrameTime) frameTime = this.maxFrameTime;
    if (frameTime < 0) frameTime = 0;

    this.accumulator += frameTime * this.timeScale;
    while (this.accumulator >= this.dt) {
      this.callbacks.update(this.dt);
      this.accumulator -= this.dt;
    }

    this.callbacks.render(this.accumulator / this.dt, frameTime);
    this.rafId = requestAnimationFrame(this.frame);
  };
}
