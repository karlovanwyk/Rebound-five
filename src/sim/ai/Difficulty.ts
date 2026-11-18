/**
 * Difficulty.ts: looks up CPU difficulty presets and describes them.
 *
 * The numbers live in config.ts (AI.presets) so the #debug panel can tune them live.
 * Every AI module reads the preset from its AIController, so changing a value takes
 * effect on the next decision.
 */
import type { Difficulty, DifficultyPreset } from '../../config';
import { AI } from '../../config';

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

export function presetFor(difficulty: Difficulty): DifficultyPreset {
  return AI.presets[difficulty];
}

/** One-line descriptions for the team select screen. */
export const DIFFICULTY_BLURBS: Record<Difficulty, string> = {
  easy: 'Slow to react, sloppy passes, a nervous keeper.',
  normal: 'Sensible football. Presses when it matters.',
  hard: 'Quick, accurate and relentless. Beatable, but only just.',
};
