/**
 * SeededRandom: reproducible sequences and sane distributions.
 */
import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../src/core/SeededRandom';

describe('SeededRandom', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('produces different sequences for different seeds', () => {
    const a = new SeededRandom(1);
    const b = new SeededRandom(2);
    const same = Array.from({ length: 20 }, () => a.next() === b.next()).filter(Boolean);
    expect(same.length).toBeLessThan(2);
  });

  it('keeps range() and int() inside their bounds', () => {
    const rng = new SeededRandom(7);
    for (let i = 0; i < 1000; i++) {
      const f = rng.range(-3, 5);
      expect(f).toBeGreaterThanOrEqual(-3);
      expect(f).toBeLessThan(5);
      const n = rng.int(0, 4);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(4);
    }
  });

  it('gaussian() has mean ~0 and standard deviation ~1', () => {
    const rng = new SeededRandom(123);
    const samples = Array.from({ length: 20000 }, () => rng.gaussian());
    const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
    const variance = samples.reduce((s, x) => s + (x - mean) ** 2, 0) / samples.length;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.sqrt(variance)).toBeGreaterThan(0.97);
    expect(Math.sqrt(variance)).toBeLessThan(1.03);
  });

  it('can save and restore its state', () => {
    const rng = new SeededRandom(5);
    rng.next();
    const state = rng.getState();
    const expected = [rng.next(), rng.next()];
    rng.setState(state);
    expect([rng.next(), rng.next()]).toEqual(expected);
  });
});
