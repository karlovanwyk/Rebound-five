/**
 * PitchTexture.ts: paints the grass stripes and line markings onto a 2D canvas.
 *
 * The Canvas 2D API draws the markings once, at startup, and Three.js uploads the canvas
 * to the GPU as a texture (CanvasTexture). Drawing lines in 2D and texturing one plane is
 * much simpler and cheaper than building every line as 3D geometry.
 *
 * Mapping: canvas column u = (x + halfLength) * pxPerMetre, row v = (z + halfWidth) *
 * pxPerMetre. Stadium.ts lays the plane flat so canvas row 0 is the far touchline (z = -halfWidth).
 */
import { CanvasTexture, SRGBColorSpace } from 'three';
import { COLORS, PITCH } from '../config';

const PX_PER_METRE = 48;

export function createPitchTexture(maxAnisotropy: number): CanvasTexture {
  const length = PITCH.halfLength * 2;
  const width = PITCH.halfWidth * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(length * PX_PER_METRE);
  canvas.height = Math.round(width * PX_PER_METRE);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');

  paintStripes(ctx, canvas.width, canvas.height);
  paintGrassNoise(ctx, canvas.width, canvas.height);
  paintMarkings(ctx);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  // Anisotropic filtering keeps the lines sharp when the pitch is seen at a shallow angle.
  texture.anisotropy = Math.min(8, maxAnisotropy);
  return texture;
}

/** Mown stripes across the pitch, alternating light and dark every 4 m. */
function paintStripes(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const stripes = 10;
  const stripeWidth = w / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? COLORS.grassLight : COLORS.grassDark;
    ctx.fillRect(i * stripeWidth, 0, stripeWidth + 1, h);
  }
}

/** Thousands of tiny translucent specks so the grass doesn't look like flat plastic. */
function paintGrassNoise(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  for (let i = 0; i < 9000; i++) {
    const light = Math.random() > 0.5;
    ctx.fillStyle = light ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(
      Math.random() * w,
      Math.random() * h,
      2 + Math.random() * 3,
      1 + Math.random() * 2,
    );
  }
}

function paintMarkings(ctx: CanvasRenderingContext2D): void {
  const L = PITCH.halfLength;
  const W = PITCH.halfWidth;
  const px = (metres: number): number => metres * PX_PER_METRE;
  const u = (x: number): number => px(x + L);
  const v = (z: number): number => px(z + W);

  ctx.strokeStyle = COLORS.lines;
  ctx.fillStyle = COLORS.lines;
  ctx.lineWidth = px(0.1);

  // Boundary, a little inside the boards.
  const inset = 0.3;
  ctx.strokeRect(u(-L + inset), v(-W + inset), px(2 * (L - inset)), px(2 * (W - inset)));

  // Halfway line, centre circle and centre spot.
  line(ctx, u(0), v(-W + inset), u(0), v(W - inset));
  circle(ctx, u(0), v(0), px(PITCH.centreCircleRadius), false);
  circle(ctx, u(0), v(0), px(0.15), true);

  for (const side of [-1, 1]) {
    const goalLineX = side * (L - inset);
    // Keeper area: a semicircle around the goal, opening toward the pitch.
    const start = side < 0 ? -Math.PI / 2 : Math.PI / 2;
    ctx.beginPath();
    ctx.arc(u(goalLineX), v(0), px(PITCH.keeperBoxRadius), start, start + Math.PI);
    ctx.stroke();
    // Penalty spot 6 m out (ready for a penalty shootout exercise).
    circle(ctx, u(side * (L - 6)), v(0), px(0.12), true);
    // Goal line between the posts, drawn thicker.
    ctx.lineWidth = px(0.16);
    line(ctx, u(goalLineX), v(-PITCH.goalHalfWidth), u(goalLineX), v(PITCH.goalHalfWidth));
    ctx.lineWidth = px(0.1);
    // Corner arcs.
    for (const zSide of [-1, 1]) {
      ctx.beginPath();
      const cx = u(goalLineX);
      const cz = v(zSide * (W - inset));
      const a0 = Math.atan2(-zSide, -side);
      ctx.arc(cx, cz, px(0.7), a0 - Math.PI / 4, a0 + Math.PI / 4);
      ctx.stroke();
    }
  }
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function circle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: boolean,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) ctx.fill();
  else ctx.stroke();
}
