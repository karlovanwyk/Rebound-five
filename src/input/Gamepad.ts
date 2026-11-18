/**
 * Gamepad.ts: reads a controller through the Gamepad API (standard mapping).
 *
 * Unlike the keyboard, gamepads don't send events for button presses. You poll them:
 * navigator.getGamepads() returns a snapshot of every pad's buttons and axes, and you
 * compare it with last frame's to see what changed. We poll once per animation frame.
 *
 * Privacy rule: a page can't see a controller until the user presses a button on it
 * while the page has focus (otherwise sites could fingerprint your hardware). That's why
 * the UI shows "press any button" until the 'gamepadconnected' event arrives.
 *
 * Standard mapping (Xbox names): 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Back/View,
 * 9 Start/Menu, 12-15 d-pad up/down/left/right. Axes 0/1 are the left stick.
 */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

/** Stick movement smaller than this is treated as zero (worn sticks never rest at 0). */
const DEADZONE = 0.2;

export class GamepadInput {
  connected = false;
  name = '';
  /** Left stick (or d-pad), deadzone applied. x right, y down. */
  stickX = 0;
  stickY = 0;
  private index: number | null = null;
  private readonly held: boolean[] = [];
  private readonly pressed = new Set<number>();
  private readonly pressListeners: Array<(button: number) => void> = [];
  private readonly connectionListeners: Array<(connected: boolean, name: string) => void> = [];

  constructor() {
    window.addEventListener('gamepadconnected', (event) => {
      this.index = event.gamepad.index;
      this.connected = true;
      this.name = event.gamepad.id;
      for (const listener of this.connectionListeners) listener(true, this.name);
    });
    window.addEventListener('gamepaddisconnected', (event) => {
      if (event.gamepad.index !== this.index) return;
      this.index = null;
      this.connected = false;
      this.held.length = 0;
      this.stickX = 0;
      this.stickY = 0;
      for (const listener of this.connectionListeners) listener(false, event.gamepad.id);
    });
  }

  onPress(listener: (button: number) => void): void {
    this.pressListeners.push(listener);
  }

  onConnectionChange(listener: (connected: boolean, name: string) => void): void {
    this.connectionListeners.push(listener);
  }

  /** Read the controller. Call once per animation frame. */
  poll(): void {
    if (this.index === null || !navigator.getGamepads) return;
    const pad = navigator.getGamepads()[this.index];
    if (!pad) return;

    pad.buttons.forEach((button, i) => {
      const down = button.pressed || button.value > 0.5;
      if (down && !this.held[i]) {
        this.pressed.add(i);
        for (const listener of this.pressListeners) listener(i);
      }
      this.held[i] = down;
    });

    // Radial deadzone: ignore small deflections, then rescale so the stick still reaches 1.
    let x = pad.axes[0] ?? 0;
    let y = pad.axes[1] ?? 0;
    const length = Math.hypot(x, y);
    if (length < DEADZONE) {
      x = 0;
      y = 0;
    } else {
      const scaled = Math.min(1, (length - DEADZONE) / (1 - DEADZONE));
      x = (x / length) * scaled;
      y = (y / length) * scaled;
    }
    // The d-pad also moves (digital, full strength).
    const dx = (this.isHeld(PAD.RIGHT) ? 1 : 0) - (this.isHeld(PAD.LEFT) ? 1 : 0);
    const dy = (this.isHeld(PAD.DOWN) ? 1 : 0) - (this.isHeld(PAD.UP) ? 1 : 0);
    if (dx !== 0 || dy !== 0) {
      x = dx;
      y = dy;
    }
    this.stickX = x;
    this.stickY = y;
  }

  isHeld(button: number): boolean {
    return this.held[button] ?? false;
  }

  /** True once per press (consumed by the next simulation tick). */
  consumePress(button: number): boolean {
    if (!this.pressed.has(button)) return false;
    this.pressed.delete(button);
    return true;
  }

  clearPresses(): void {
    this.pressed.clear();
  }

  /** Short rumble, where supported (Chrome's vibrationActuator). */
  rumble(strength: number, ms: number): void {
    if (this.index === null) return;
    const pad = navigator.getGamepads()[this.index] as
      | (Gamepad & {
          vibrationActuator?: { playEffect?: (type: string, params: object) => Promise<unknown> };
        })
      | null;
    void pad?.vibrationActuator
      ?.playEffect?.('dual-rumble', {
        duration: ms,
        strongMagnitude: strength,
        weakMagnitude: strength,
      })
      ?.catch(() => undefined);
  }
}
