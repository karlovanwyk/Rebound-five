/**
 * Storage.ts: saved records and settings, kept in the browser's localStorage.
 *
 * localStorage stores strings by key and survives page reloads. We keep one JSON document
 * under one key. Things to know when using it:
 *  - It can throw (Safari private mode, storage disabled, quota full), so every access is
 *    wrapped in try/catch and the game carries on without saving.
 *  - The saved data can be old, hand-edited or corrupt, so load() validates every field
 *    and falls back to defaults instead of trusting it.
 *  - The key includes a version number, so a future format change can migrate cleanly.
 *
 * Unlocks aren't stored separately; they're derived from the records ("has won on Easy"),
 * so they can never get out of sync.
 *
 * SaveStore takes a tiny KeyValueStore interface instead of localStorage directly, so the
 * tests can hand it an in-memory fake.
 */
import type { BallDesign, Difficulty, Kit } from '../config';
import { BALL_DESIGNS, KITS, MATCH } from '../config';

export interface RecordLine {
  wins: number;
  draws: number;
  losses: number;
}

export interface Settings {
  muted: boolean;
  kitId: string;
  ballId: string;
  difficulty: Difficulty;
  minutes: number;
}

export interface SaveData {
  version: 1;
  records: Record<Difficulty, RecordLine>;
  cupWins: number;
  currentStreak: number;
  longestStreak: number;
  settings: Settings;
}

export type MatchResult = 'win' | 'draw' | 'loss';

/** The part of the Web Storage API we use. window.localStorage satisfies it. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const STORAGE_KEY = 'rebound-five/save/v1';
const DIFFICULTY_KEYS: readonly Difficulty[] = ['easy', 'normal', 'hard'];

export function defaultSave(): SaveData {
  return {
    version: 1,
    records: {
      easy: { wins: 0, draws: 0, losses: 0 },
      normal: { wins: 0, draws: 0, losses: 0 },
      hard: { wins: 0, draws: 0, losses: 0 },
    },
    cupWins: 0,
    currentStreak: 0,
    longestStreak: 0,
    settings: {
      muted: false,
      kitId: KITS[0].id,
      ballId: BALL_DESIGNS[0].id,
      difficulty: 'normal',
      minutes: MATCH.defaultMinutes,
    },
  };
}

export class SaveStore {
  data: SaveData;

  constructor(private readonly backend: KeyValueStore | null) {
    this.data = this.load();
  }

  /** A store backed by window.localStorage, if the browser allows it. */
  static forBrowser(): SaveStore {
    try {
      // Even reading the property can throw when storage is blocked.
      return new SaveStore(window.localStorage);
    } catch {
      return new SaveStore(null); // play without saving
    }
  }

  private load(): SaveData {
    const fallback = defaultSave();
    if (!this.backend) return fallback;
    try {
      const raw = this.backend.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      return sanitise(JSON.parse(raw) as unknown, fallback);
    } catch {
      return fallback;
    }
  }

  save(): void {
    if (!this.backend) return;
    try {
      this.backend.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Quota exceeded or storage disabled: keep playing, just don't persist.
    }
  }

  /** Record a finished match. Returns the names of anything newly unlocked. */
  recordMatch(difficulty: Difficulty, result: MatchResult): string[] {
    const before = this.unlockedNames();
    const line = this.data.records[difficulty];
    if (result === 'win') {
      line.wins++;
      this.data.currentStreak++;
      this.data.longestStreak = Math.max(this.data.longestStreak, this.data.currentStreak);
    } else {
      if (result === 'draw') line.draws++;
      else line.losses++;
      this.data.currentStreak = 0;
    }
    this.save();
    return this.unlockedNames().filter((name) => !before.includes(name));
  }

  recordCupWin(): string[] {
    const before = this.unlockedNames();
    this.data.cupWins++;
    this.save();
    return this.unlockedNames().filter((name) => !before.includes(name));
  }

  isUnlocked(item: Kit | BallDesign): boolean {
    if (item.unlock === null) return true;
    if (item.unlock === 'cup') return this.data.cupWins > 0;
    return this.data.records[item.unlock].wins > 0;
  }

  updateSettings(changes: Partial<Settings>): void {
    Object.assign(this.data.settings, changes);
    this.save();
  }

  private unlockedNames(): string[] {
    const kits = KITS.filter((k) => this.isUnlocked(k)).map((k) => `${k.name} kit`);
    const balls = BALL_DESIGNS.filter((b) => this.isUnlocked(b)).map((b) => `${b.name} ball`);
    return [...kits, ...balls];
  }
}

/** Copy only valid fields from untrusted data onto the defaults. */
function sanitise(input: unknown, fallback: SaveData): SaveData {
  if (!isObject(input) || input.version !== 1) return fallback;
  const out = fallback;
  const count = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

  if (isObject(input.records)) {
    for (const key of DIFFICULTY_KEYS) {
      const line = input.records[key];
      if (isObject(line)) {
        out.records[key] = {
          wins: count(line.wins),
          draws: count(line.draws),
          losses: count(line.losses),
        };
      }
    }
  }
  out.cupWins = count(input.cupWins);
  out.currentStreak = count(input.currentStreak);
  out.longestStreak = Math.max(count(input.longestStreak), out.currentStreak);

  const s = input.settings;
  if (isObject(s)) {
    if (typeof s.muted === 'boolean') out.settings.muted = s.muted;
    if (typeof s.kitId === 'string' && KITS.some((k) => k.id === s.kitId))
      out.settings.kitId = s.kitId;
    if (typeof s.ballId === 'string' && BALL_DESIGNS.some((b) => b.id === s.ballId))
      out.settings.ballId = s.ballId;
    if (
      typeof s.difficulty === 'string' &&
      (DIFFICULTY_KEYS as readonly string[]).includes(s.difficulty)
    ) {
      out.settings.difficulty = s.difficulty as Difficulty;
    }
    if (typeof s.minutes === 'number' && MATCH.lengthOptions.includes(s.minutes))
      out.settings.minutes = s.minutes;
  }
  return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
