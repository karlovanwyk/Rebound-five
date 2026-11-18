/**
 * Intent.ts: the one and only way anything controls a player.
 *
 * Every player, human or CPU, is driven by a controller that fills in an Intent each
 * tick. HumanController builds it from keyboard, gamepad or touch. AIController
 * (src/sim/ai) builds it from its decisions. The simulation only ever reads Intents. That
 * keeps things fair: the CPU can't move faster than you, teleport, or read your inputs,
 * because it can only ask for the same things you can.
 *
 * This file is plain data with no DOM, so the headless simulation can import it.
 */
export interface Intent {
  /** Desired movement on the pitch: x along the length, z across. Length 0..1 (analog). */
  moveX: number;
  moveZ: number;
  /** Hold to run faster. */
  sprint: boolean;
  /** Pressed this tick: ground pass toward the teammate you're aiming at. */
  pass: boolean;
  /** Pressed this tick: lofted pass into space ahead of a teammate. */
  throughBall: boolean;
  /**
   * Held = charging a shot; releasing it strikes the ball. The sim measures how long
   * it's held and turns that into shot power. Both human and CPU earn power the same
   * way, and neither can ask for a full-power shot instantly.
   */
  shoot: boolean;
  /** Pressed this tick: standing tackle, or a slide tackle when sprinting. Keepers dive. */
  tackle: boolean;
  /** Pressed this tick: hand control to another teammate (human teams only). */
  switchPlayer: boolean;
}

export function createIntent(): Intent {
  return {
    moveX: 0,
    moveZ: 0,
    sprint: false,
    pass: false,
    throughBall: false,
    shoot: false,
    tackle: false,
    switchPlayer: false,
  };
}

export function resetIntent(intent: Intent): void {
  intent.moveX = 0;
  intent.moveZ = 0;
  intent.sprint = false;
  intent.pass = false;
  intent.throughBall = false;
  intent.shoot = false;
  intent.tackle = false;
  intent.switchPlayer = false;
}

export function copyIntent(target: Intent, source: Intent): void {
  Object.assign(target, source);
}

/** Clamp the move vector to length 1 so diagonal keyboard input isn't faster. */
export function normaliseMove(intent: Intent): void {
  const length = Math.hypot(intent.moveX, intent.moveZ);
  if (length > 1) {
    intent.moveX /= length;
    intent.moveZ /= length;
  }
}
