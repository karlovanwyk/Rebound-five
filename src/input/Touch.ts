/**
 * Touch.ts: on-screen joystick and buttons using Pointer Events.
 *
 * Pointer Events unify mouse, pen and touch into one API (pointerdown / pointermove /
 * pointerup). Each finger has its own pointerId, so the joystick and a button can be held
 * at the same time. setPointerCapture() keeps delivering a finger's moves to the
 * joystick even if it slides off the joystick area.
 *
 * The controls appear the first time the screen is touched (pointerType === 'touch'),
 * so desktop players never see them.
 */
import { el } from '../ui/dom';

const STICK_RADIUS = 55;
export type TouchButton = 'pass' | 'through' | 'shoot' | 'tackle' | 'sprint' | 'switch';

const BUTTONS: Array<{ id: TouchButton; label: string; className?: string }> = [
  { id: 'switch', label: 'SWITCH' },
  { id: 'through', label: 'THRU' },
  { id: 'shoot', label: 'SHOOT', className: 'shoot' },
  { id: 'sprint', label: 'SPRINT' },
  { id: 'tackle', label: 'TACKLE' },
  { id: 'pass', label: 'PASS' },
];

export class TouchControls {
  readonly root = el('div', 'touch');
  /** Joystick output: x right, y down, length 0..1. */
  stickX = 0;
  stickY = 0;
  active = false;
  private readonly base = el('div', 'stick-base');
  private readonly knob = el('div', 'stick-knob');
  private readonly held = new Set<TouchButton>();
  private readonly pressed = new Set<TouchButton>();
  private stickPointer: number | null = null;
  private originX = 0;
  private originY = 0;
  private visible = false;

  constructor(
    parent: HTMLElement,
    private readonly onFirstTouch: () => void,
  ) {
    const zone = el('div', 'stick-zone');
    zone.append(this.base, this.knob);
    zone.addEventListener('pointerdown', this.onStickDown);
    zone.addEventListener('pointermove', this.onStickMove);
    zone.addEventListener('pointerup', this.onStickUp);
    zone.addEventListener('pointercancel', this.onStickUp);

    const grid = el('div', 'buttons');
    for (const def of BUTTONS) {
      const b = el('button', `tbtn ${def.className ?? ''}`, def.label);
      b.type = 'button';
      b.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        b.setPointerCapture(event.pointerId);
        this.held.add(def.id);
        this.pressed.add(def.id);
        b.classList.add('held');
      });
      const release = (): void => {
        this.held.delete(def.id);
        b.classList.remove('held');
      };
      b.addEventListener('pointerup', release);
      b.addEventListener('pointercancel', release);
      grid.append(b);
    }
    this.root.append(zone, grid);
    parent.append(this.root);

    // Detect a touch screen from the first real touch anywhere on the page.
    window.addEventListener(
      'pointerdown',
      (event) => {
        if (event.pointerType !== 'touch' || this.active) return;
        this.active = true;
        parent.classList.add('touch-mode');
        this.applyVisibility();
        this.onFirstTouch();
      },
      { capture: true },
    );
  }

  /** Show the controls only during a match (and only on touch devices). */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.applyVisibility();
    if (!visible) this.release();
  }

  isHeld(button: TouchButton): boolean {
    return this.held.has(button);
  }

  consumePress(button: TouchButton): boolean {
    if (!this.pressed.has(button)) return false;
    this.pressed.delete(button);
    return true;
  }

  clearPresses(): void {
    this.pressed.clear();
  }

  private applyVisibility(): void {
    this.root.classList.toggle('active', this.active && this.visible);
  }

  private release(): void {
    this.held.clear();
    this.pressed.clear();
    this.stickPointer = null;
    this.stickX = 0;
    this.stickY = 0;
    this.base.style.display = 'none';
    this.knob.style.display = 'none';
  }

  // The joystick appears wherever the thumb lands ("floating" stick).
  private readonly onStickDown = (event: PointerEvent): void => {
    if (this.stickPointer !== null) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.stickPointer = event.pointerId;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.originX = event.clientX - rect.left;
    this.originY = event.clientY - rect.top;
    for (const node of [this.base, this.knob]) {
      node.style.display = 'block';
      node.style.left = `${this.originX}px`;
      node.style.top = `${this.originY}px`;
    }
  };

  private readonly onStickMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.stickPointer) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    let dx = event.clientX - rect.left - this.originX;
    let dy = event.clientY - rect.top - this.originY;
    const length = Math.hypot(dx, dy);
    if (length > STICK_RADIUS) {
      dx = (dx / length) * STICK_RADIUS;
      dy = (dy / length) * STICK_RADIUS;
    }
    this.stickX = dx / STICK_RADIUS;
    this.stickY = dy / STICK_RADIUS;
    this.knob.style.left = `${this.originX + dx}px`;
    this.knob.style.top = `${this.originY + dy}px`;
  };

  private readonly onStickUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.stickPointer) return;
    this.stickPointer = null;
    this.stickX = 0;
    this.stickY = 0;
    this.base.style.display = 'none';
    this.knob.style.display = 'none';
  };
}
