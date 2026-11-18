/**
 * Instant replay: the ring buffer keeps the newest frames in order, and the player walks
 * through them and finishes.
 */
import { describe, expect, it } from 'vitest';
import { ReplayBuffer, ReplayPlayer } from '../src/core/ReplayBuffer';
import { createSnapshot } from '../src/sim/Snapshot';
import { createWorld } from '../src/sim/World';

function frameWithTick(template: ReturnType<typeof createSnapshot>, tick: number) {
  return { ...template, tick, ball: { ...template.ball, x: tick } };
}

describe('ReplayBuffer', () => {
  const template = createSnapshot(createWorld({ seed: 1 }));

  it('keeps only the newest frames, oldest first', () => {
    const buffer = new ReplayBuffer(template, 5);
    for (let t = 1; t <= 8; t++) buffer.record(frameWithTick(template, t));
    expect(buffer.length).toBe(5);
    expect([0, 1, 2, 3, 4].map((i) => buffer.at(i).tick)).toEqual([4, 5, 6, 7, 8]);
    expect(buffer.at(4).ball.x).toBe(8);
  });

  it('copies frames instead of keeping references', () => {
    const buffer = new ReplayBuffer(template, 3);
    const frame = frameWithTick(template, 1);
    buffer.record(frame);
    frame.ball.x = 999;
    expect(buffer.at(0).ball.x).toBe(1);
  });

  it('the player interpolates through the buffer and then stops', () => {
    const buffer = new ReplayBuffer(template, 10);
    for (let t = 0; t < 10; t++) buffer.record(frameWithTick(template, t));
    const player = new ReplayPlayer(60, 1);
    player.start(buffer);
    expect(player.active).toBe(true);
    player.update(2.5 / 60);
    const frames = player.frames()!;
    expect(frames.previous.tick).toBe(2);
    expect(frames.current.tick).toBe(3);
    expect(frames.alpha).toBeCloseTo(0.5);
    expect(player.update(1)).toBe(true);
    expect(player.active).toBe(false);
  });
});
