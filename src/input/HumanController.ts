/**
 * HumanController.ts: builds the human player's Intent from the keyboard.
 *
 * main.ts calls sample() once per simulation tick and gives the Intent to whichever
 * player the human currently controls. The camera watches from the side of the pitch,
 * so "up" on screen is -z in the world and "right" is +x.
 */
import type { Intent } from './Intent';
import { normaliseMove, resetIntent } from './Intent';
import type { Keyboard } from './Keyboard';

export class HumanController {
  constructor(private readonly keyboard: Keyboard) {}

  sample(out: Intent): void {
    resetIntent(out);
    const kb = this.keyboard;

    const right = kb.isDown('KeyD') || kb.isDown('ArrowRight');
    const left = kb.isDown('KeyA') || kb.isDown('ArrowLeft');
    const up = kb.isDown('KeyW') || kb.isDown('ArrowUp');
    const down = kb.isDown('KeyS') || kb.isDown('ArrowDown');
    out.moveX = (right ? 1 : 0) - (left ? 1 : 0);
    out.moveZ = (down ? 1 : 0) - (up ? 1 : 0);
    normaliseMove(out);

    out.sprint = kb.isDown('ShiftLeft') || kb.isDown('ShiftRight');
    out.shoot = kb.isDown('KeyK');
    out.pass = kb.consumePress('KeyJ');
    out.throughBall = kb.consumePress('KeyI');
    out.tackle = kb.consumePress('KeyL');
    out.switchPlayer = kb.consumePress('KeyQ');
  }
}
