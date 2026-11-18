/**
 * GameStateMachine: allowed transitions, pause and resume.
 */
import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../src/core/GameStateMachine';

describe('GameStateMachine', () => {
  it('follows the normal flow from boot to full time', () => {
    const machine = new GameStateMachine();
    for (const state of [
      'menu',
      'teamSelect',
      'kickoff',
      'playing',
      'goalScored',
      'kickoff',
      'playing',
      'fullTime',
    ] as const) {
      expect(machine.transition(state)).toBe(true);
    }
    expect(machine.current).toBe('fullTime');
  });

  it('rejects transitions that are not in the table', () => {
    const machine = new GameStateMachine();
    expect(machine.transition('playing')).toBe(false);
    expect(machine.current).toBe('boot');
  });

  it('pauses and resumes to the state it came from', () => {
    const machine = new GameStateMachine();
    machine.transition('kickoff');
    machine.transition('playing');
    machine.transition('goalScored');
    expect(machine.pause()).toBe(true);
    expect(machine.current).toBe('paused');
    expect(machine.resume()).toBe(true);
    expect(machine.current).toBe('goalScored');
  });

  it('cannot pause from a menu', () => {
    const machine = new GameStateMachine();
    machine.transition('menu');
    expect(machine.pause()).toBe(false);
    expect(machine.current).toBe('menu');
  });

  it('notifies listeners with the old and new state', () => {
    const machine = new GameStateMachine();
    const seen: string[] = [];
    machine.onChange((to, from) => seen.push(`${from}->${to}`));
    machine.transition('menu');
    expect(seen).toEqual(['boot->menu']);
  });
});
