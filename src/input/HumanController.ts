/**
 * HumanController.ts: builds the human player's Intent from keyboard, gamepad and touch.
 *
 * main.ts calls sample() once per simulation tick, and the Intent goes to whichever
 * player the human controls. All three devices are read every tick and combined, so you
 * can switch device at any moment. The camera watches from the side of the pitch, so
 * "up" on screen (W, stick up) is -z in the world and "right" is +x.
 */
import type { GamepadInput } from './Gamepad';
import { PAD } from './Gamepad';
import type { Intent } from './Intent';
import { normaliseMove, resetIntent } from './Intent';
import type { Keyboard } from './Keyboard';
import type { TouchControls } from './Touch';

export class HumanController {
  constructor(
    private readonly keyboard: Keyboard,
    private readonly gamepad: GamepadInput | null = null,
    private readonly touch: TouchControls | null = null,
  ) {}

  sample(out: Intent): void {
    resetIntent(out);
    const kb = this.keyboard;
    const pad = this.gamepad;
    const touch = this.touch;

    // --- Movement: keyboard digital + analog stick + touch joystick, clamped to length 1.
    const right = kb.isDown('KeyD') || kb.isDown('ArrowRight');
    const left = kb.isDown('KeyA') || kb.isDown('ArrowLeft');
    const up = kb.isDown('KeyW') || kb.isDown('ArrowUp');
    const down = kb.isDown('KeyS') || kb.isDown('ArrowDown');
    out.moveX = (right ? 1 : 0) - (left ? 1 : 0);
    out.moveZ = (down ? 1 : 0) - (up ? 1 : 0);
    if (pad?.connected) {
      out.moveX += pad.stickX;
      out.moveZ += pad.stickY;
    }
    if (touch?.active) {
      out.moveX += touch.stickX;
      out.moveZ += touch.stickY;
    }
    normaliseMove(out);

    // --- Held buttons.
    out.sprint =
      kb.isDown('ShiftLeft') ||
      kb.isDown('ShiftRight') ||
      (pad?.isHeld(PAD.RT) ?? false) ||
      (pad?.isHeld(PAD.RB) ?? false) ||
      (touch?.isHeld('sprint') ?? false);
    out.shoot =
      kb.isDown('KeyK') || (pad?.isHeld(PAD.B) ?? false) || (touch?.isHeld('shoot') ?? false);

    // --- Presses (true for exactly one tick per press). Every source is consumed, so a
    // press on one device can't linger and fire later.
    out.pass = anyPress(
      kb.consumePress('KeyJ'),
      pad?.consumePress(PAD.A),
      touch?.consumePress('pass'),
    );
    out.throughBall = anyPress(
      kb.consumePress('KeyI'),
      pad?.consumePress(PAD.Y),
      touch?.consumePress('through'),
    );
    out.tackle = anyPress(
      kb.consumePress('KeyL'),
      pad?.consumePress(PAD.X),
      touch?.consumePress('tackle'),
    );
    out.switchPlayer = anyPress(
      kb.consumePress('KeyQ'),
      pad?.consumePress(PAD.LB),
      touch?.consumePress('switch'),
    );
  }

  /** Forget presses made outside the match (in menus, while paused). */
  clearPresses(): void {
    this.keyboard.clearPresses();
    this.gamepad?.clearPresses();
    this.touch?.clearPresses();
  }
}

function anyPress(...presses: Array<boolean | undefined>): boolean {
  return presses.some(Boolean);
}
