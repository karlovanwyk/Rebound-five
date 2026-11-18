/**
 * Saved records (with an in-memory fake of localStorage) and Cup progression.
 */
import { describe, expect, it } from 'vitest';
import { CUP_ROUNDS, KITS } from '../src/config';
import { createCup, cupOpponent, recordCupMatch } from '../src/core/Cup';
import type { KeyValueStore } from '../src/core/Storage';
import { SaveStore, STORAGE_KEY } from '../src/core/Storage';
import { colourDistance, contrastingKit } from '../src/core/MatchSession';

class MemoryStore implements KeyValueStore {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('SaveStore', () => {
  it('starts with defaults and saves records that survive a reload', () => {
    const backend = new MemoryStore();
    const store = new SaveStore(backend);
    expect(store.data.records.easy.wins).toBe(0);
    store.recordMatch('easy', 'win');
    store.recordMatch('hard', 'loss');
    const reloaded = new SaveStore(backend);
    expect(reloaded.data.records.easy.wins).toBe(1);
    expect(reloaded.data.records.hard.losses).toBe(1);
  });

  it('tracks the current and longest win streak', () => {
    const store = new SaveStore(new MemoryStore());
    store.recordMatch('normal', 'win');
    store.recordMatch('normal', 'win');
    store.recordMatch('normal', 'draw');
    store.recordMatch('normal', 'win');
    expect(store.data.currentStreak).toBe(1);
    expect(store.data.longestStreak).toBe(2);
  });

  it('unlocks kits and balls by winning on each difficulty', () => {
    const store = new SaveStore(new MemoryStore());
    const voltage = KITS.find((k) => k.unlock === 'easy')!;
    expect(store.isUnlocked(voltage)).toBe(false);
    const unlocked = store.recordMatch('easy', 'win');
    expect(store.isUnlocked(voltage)).toBe(true);
    expect(unlocked.some((name) => name.includes(voltage.name))).toBe(true);
    // A second win unlocks nothing new.
    expect(store.recordMatch('easy', 'win')).toEqual([]);
  });

  it('ignores corrupt or tampered data', () => {
    const backend = new MemoryStore();
    backend.setItem(STORAGE_KEY, '{not json');
    expect(new SaveStore(backend).data.cupWins).toBe(0);
    backend.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        cupWins: -5,
        records: { easy: { wins: 'lots' } },
        settings: { kitId: 'nope', minutes: 99 },
      }),
    );
    const store = new SaveStore(backend);
    expect(store.data.cupWins).toBe(0);
    expect(store.data.records.easy.wins).toBe(0);
    expect(store.data.settings.kitId).toBe(KITS[0].id);
    expect(store.data.settings.minutes).toBe(3);
  });

  it('works without any storage at all', () => {
    const store = new SaveStore(null);
    expect(() => store.recordMatch('easy', 'win')).not.toThrow();
  });
});

describe('Cup', () => {
  it('plays three rounds against increasingly difficult opponents', () => {
    const cup = createCup();
    const difficulties = [];
    for (let i = 0; i < CUP_ROUNDS.length; i++) {
      difficulties.push(cupOpponent(cup).difficulty);
      recordCupMatch(cup, 2, 1);
    }
    expect(difficulties).toEqual(['easy', 'normal', 'hard']);
    expect(cup.status).toBe('champion');
  });

  it('knocks you out after a single defeat', () => {
    const cup = createCup();
    recordCupMatch(cup, 1, 0);
    recordCupMatch(cup, 0, 3);
    expect(cup.status).toBe('eliminated');
    recordCupMatch(cup, 5, 0); // ignored once eliminated
    expect(cup.results.length).toBe(2);
  });
});

describe('kit clash', () => {
  it('picks the CPU kit that contrasts most with yours', () => {
    const white = { ...KITS[0], shirt: '#ffffff', shorts: '#ffffff' };
    const choice = contrastingKit(white, [
      { ...KITS[1], shirt: '#f8f8f8' },
      { ...KITS[2], shirt: '#101010' },
    ]);
    expect(choice.shirt).toBe('#101010');
    expect(colourDistance('#000000', '#000000')).toBe(0);
  });
});
