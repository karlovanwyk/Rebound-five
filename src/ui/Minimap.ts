/**
 * Minimap.ts: a top-down radar of the pitch, drawn with the Canvas 2D API.
 *
 * Every frame we clear a small canvas and draw the pitch, every player as a dot in their
 * team colour, a ring around the player you control, and the ball. The canvas is sized
 * by devicePixelRatio so it stays crisp on high-DPI screens: the backing store is
 * width * dpr pixels, and ctx.setTransform scales drawing back into CSS pixels.
 */
import { COLORS, PITCH } from '../config';
import type { Snapshot } from '../sim/Snapshot';
import { el } from './dom';

const WIDTH = 190;
const HEIGHT = 120;
const PAD = 8;

export class Minimap {
  readonly canvas = el('canvas', 'minimap');
  private readonly ctx: CanvasRenderingContext2D;
  private colours: [string, string] = ['#ffffff', '#000000'];

  constructor(parent: HTMLElement) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = WIDTH * dpr;
    this.canvas.height = HEIGHT * dpr;
    this.canvas.style.width = `${WIDTH}px`;
    this.canvas.style.height = `${HEIGHT}px`;
    this.canvas.setAttribute('aria-hidden', 'true');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx = ctx;
    parent.append(this.canvas);
  }

  setTeamColours(home: string, away: string): void {
    this.colours = [home, away];
  }

  setVisible(visible: boolean): void {
    this.canvas.style.display = visible ? '' : 'none';
  }

  draw(snapshot: Snapshot): void {
    const { ctx } = this;
    const L = PITCH.halfLength;
    const W = PITCH.halfWidth;
    const scaleX = (WIDTH - PAD * 2) / (L * 2);
    const scaleZ = (HEIGHT - PAD * 2) / (W * 2);
    const sx = (x: number): number => PAD + (x + L) * scaleX;
    const sz = (z: number): number => PAD + (z + W) * scaleZ;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = COLORS.grassDark;
    ctx.fillRect(sx(-L), sz(-W), L * 2 * scaleX, W * 2 * scaleZ);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx(-L), sz(-W), L * 2 * scaleX, W * 2 * scaleZ);
    ctx.beginPath();
    ctx.moveTo(sx(0), sz(-W));
    ctx.lineTo(sx(0), sz(W));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx(0), sz(0), PITCH.centreCircleRadius * scaleX, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (const side of [-1, 1]) {
      const x = side > 0 ? sx(L) : sx(-L) - 3;
      ctx.fillRect(x, sz(-PITCH.goalHalfWidth), 3, PITCH.goalHalfWidth * 2 * scaleZ);
    }

    for (const p of snapshot.players) {
      const x = sx(p.x);
      const y = sz(p.z);
      ctx.beginPath();
      ctx.arc(x, y, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = this.colours[p.team];
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = p.index === 0 ? '#ffffff' : 'rgba(0,0,0,0.7)';
      ctx.stroke();
      if (p.controlled) {
        ctx.beginPath();
        ctx.arc(x, y, 6.5, 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.controlRing;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    }

    ctx.beginPath();
    ctx.arc(sx(snapshot.ball.x), sz(snapshot.ball.z), 2.6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
