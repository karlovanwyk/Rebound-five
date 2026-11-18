/**
 * SeededRandom.ts: a small, fast pseudo-random number generator with a seed.
 *
 * Math.random() can't be seeded, so two runs of the same match would differ. The
 * simulation (src/sim) uses this class instead. Given the same seed and the same Intents,
 * a match replays exactly, which is what makes the headless tests and replays possible.
 *
 * The algorithm is "mulberry32": 32 bits of state, one add and a few multiply/xor-shift
 * steps per number. It isn't cryptographically secure, but it's well distributed and fast.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    // `>>> 0` turns any number into an unsigned 32-bit integer.
    this.state = Math.floor(seed) >>> 0;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    // Math.imul does true 32-bit integer multiplication (normal * would lose bits).
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, maxExclusive). */
  int(min: number, maxExclusive: number): number {
    return min + Math.floor(this.next() * (maxExclusive - min));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Random sign: -1 or +1. */
  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  /**
   * Normally distributed number (mean 0, standard deviation 1), using the Box-Muller
   * transform. It turns two uniform numbers into one bell-curve number. That's useful
   * for aim errors, where small mistakes should be common and big ones rare.
   */
  gaussian(): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length)];
  }

  /** A new generator seeded from this one: an independent but reproducible stream. */
  fork(): SeededRandom {
    return new SeededRandom(this.next() * 4294967296);
  }

  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}
