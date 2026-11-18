/**
 * Keyboard.ts: tracks which keys are held and which were pressed since the last check.
 *
 * Browsers deliver keydown/keyup as events, whenever they happen, but the game samples
 * input once per tick. Two kinds of question need answering:
 *   - "Is K held right now?" (charging a shot)      -> isDown()
 *   - "Was J pressed since I last asked?" (a pass)  -> consumePress()
 * A press is remembered until a tick consumes it, so a quick tap between two ticks (easy
 * on a 144 Hz screen) is never lost.
 *
 * We use KeyboardEvent.code (the physical key, e.g. "KeyW"), not .key (the character).
 * That way WASD works in the same place on AZERTY or Dvorak keyboards.
 */

/** Keys whose default browser action (scrolling, find-in-page) should be blocked. */
const GAME_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyJ',
  'KeyI',
  'KeyK',
  'KeyL',
  'KeyQ',
]);

export class Keyboard {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly listeners: Array<(code: string) => void> = [];

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    // If the window loses focus while a key is held, we'd never see its keyup.
    target.addEventListener('blur', this.onBlur);
  }

  isDown(code: string): boolean {
    return this.held.has(code);
  }

  /** True once per physical press of `code`. */
  consumePress(code: string): boolean {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  /** Throw away presses nobody consumed (e.g. keys pressed while paused). */
  clearPresses(): void {
    this.pressed.clear();
  }

  /** Get told about every new key press (used for menus and global shortcuts). */
  onPress(listener: (code: string) => void): void {
    this.listeners.push(listener);
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (GAME_KEYS.has(event.code) && !isTypingTarget(event.target)) event.preventDefault();
    this.held.add(event.code);
    // Holding a key makes the OS repeat keydown events. Those aren't new presses.
    if (!event.repeat) {
      this.pressed.add(event.code);
      for (const listener of this.listeners) listener(event.code);
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.held.clear();
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
