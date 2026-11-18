/**
 * GameStateMachine.ts: which screen or stage the app is in.
 *
 *   boot -> menu -> teamSelect -> kickoff <-> playing <-> goalScored -> fullTime
 *                                    \           |            /
 *                                     +----- paused ---------+
 *
 * The match states (kickoff, playing, goalScored, fullTime) mirror the simulation's match
 * phases; main.ts moves this machine whenever the sim's phase changes. The menu states
 * and `paused` exist only at the app level: the sim simply isn't stepped while paused.
 *
 * Only transitions listed in TRANSITIONS are allowed. Anything else is a bug, and
 * transition() returns false instead of silently ending up in a broken state.
 */
export type GameStateName =
  'boot' | 'menu' | 'teamSelect' | 'kickoff' | 'playing' | 'goalScored' | 'paused' | 'fullTime';

const TRANSITIONS: Record<GameStateName, readonly GameStateName[]> = {
  boot: ['menu', 'kickoff'],
  menu: ['teamSelect', 'kickoff'],
  teamSelect: ['menu', 'kickoff'],
  kickoff: ['playing', 'paused', 'menu'],
  playing: ['goalScored', 'paused', 'fullTime', 'kickoff', 'menu'],
  goalScored: ['kickoff', 'fullTime', 'paused', 'menu'],
  paused: ['kickoff', 'playing', 'goalScored', 'menu'],
  fullTime: ['menu', 'teamSelect', 'kickoff'],
};

const PAUSABLE: readonly GameStateName[] = ['kickoff', 'playing', 'goalScored'];

export type StateListener = (to: GameStateName, from: GameStateName) => void;

export class GameStateMachine {
  private state: GameStateName = 'boot';
  private resumeTo: GameStateName | null = null;
  private readonly listeners: StateListener[] = [];

  get current(): GameStateName {
    return this.state;
  }

  can(to: GameStateName): boolean {
    return TRANSITIONS[this.state].includes(to);
  }

  /** Move to `to`. Returns false (and stays put) if that transition isn't allowed. */
  transition(to: GameStateName): boolean {
    if (to === this.state) return true;
    if (!this.can(to)) return false;
    const from = this.state;
    this.state = to;
    if (to !== 'paused') this.resumeTo = null;
    for (const listener of this.listeners) listener(to, from);
    return true;
  }

  /** Pause a match, remembering where to resume. */
  pause(): boolean {
    if (!PAUSABLE.includes(this.state)) return false;
    const from = this.state;
    if (!this.transition('paused')) return false;
    this.resumeTo = from;
    return true;
  }

  resume(): boolean {
    if (this.state !== 'paused' || !this.resumeTo) return false;
    return this.transition(this.resumeTo);
  }

  /** True while a match is on screen, paused or not. */
  get inMatch(): boolean {
    return PAUSABLE.includes(this.state) || this.state === 'paused';
  }

  onChange(listener: StateListener): void {
    this.listeners.push(listener);
  }
}
