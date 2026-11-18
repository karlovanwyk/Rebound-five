/**
 * ReplayBuffer.ts: the last few seconds of the match, for instant replays.
 *
 * A ring buffer is a fixed-size array used as a loop. `head` marks where the next frame
 * goes. When the buffer is full, the newest frame overwrites the oldest one. Nothing is
 * ever allocated after construction: frames are copied into snapshots created up front,
 * so recording 60 frames a second creates no garbage.
 *
 * It stores renderer Snapshots rather than full sim state. A replay only needs to be
 * drawn, not re-simulated, and the renderer already knows how to draw (and interpolate)
 * snapshots.
 */
import type { Snapshot } from '../sim/Snapshot';
import { cloneSnapshot, copySnapshot } from '../sim/Snapshot';

export class ReplayBuffer {
  private readonly frames: Snapshot[];
  private head = 0;
  private size = 0;

  constructor(
    template: Snapshot,
    readonly capacity: number,
  ) {
    this.frames = Array.from({ length: capacity }, () => cloneSnapshot(template));
  }

  get length(): number {
    return this.size;
  }

  record(snapshot: Snapshot): void {
    copySnapshot(this.frames[this.head], snapshot);
    this.head = (this.head + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
  }

  /** Frame `i`, where 0 is the oldest frame still stored and length - 1 the newest. */
  at(i: number): Snapshot {
    const index = (this.head - this.size + i + this.capacity * 2) % this.capacity;
    return this.frames[index];
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
  }
}

/**
 * Plays a ReplayBuffer back, slightly slowed down. Like the main loop, it moves through
 * the frames at a fractional position, and the renderer interpolates between frame
 * floor(position) and the next one, so slow motion stays smooth.
 */
export class ReplayPlayer {
  active = false;
  private buffer: ReplayBuffer | null = null;
  private position = 0;

  constructor(
    private readonly ticksPerSecond: number,
    private readonly speed = 0.8,
  ) {}

  start(buffer: ReplayBuffer): void {
    if (buffer.length < 2) return;
    this.buffer = buffer;
    this.position = 0;
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  /** Advance by real time. Returns true when the replay has finished. */
  update(dt: number): boolean {
    if (!this.active || !this.buffer) return true;
    this.position += dt * this.ticksPerSecond * this.speed;
    if (this.position >= this.buffer.length - 1) {
      this.active = false;
      return true;
    }
    return false;
  }

  /** The two frames to blend and how far between them we are. */
  frames(): { previous: Snapshot; current: Snapshot; alpha: number } | null {
    if (!this.buffer) return null;
    const index = Math.min(Math.floor(this.position), this.buffer.length - 2);
    return {
      previous: this.buffer.at(index),
      current: this.buffer.at(index + 1),
      alpha: this.position - index,
    };
  }
}
