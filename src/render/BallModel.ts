/**
 * BallModel.ts: the ball mesh, its procedural texture and its rolling rotation.
 *
 * The sim doesn't track the ball's orientation (it doesn't affect gameplay), so the
 * renderer works it out from the velocity. A ball rolling without slipping turns by
 * angle = distance / radius, around the axis up x velocity. Each frame we apply that
 * small rotation, plus the sim's side spin around Y.
 *
 * A soft dark "blob" is drawn directly under the ball. The real shadow falls at an angle
 * from the key light, and the blob makes the height of lofted balls easy to read.
 */
import {
  CanvasTexture,
  CircleGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
} from 'three';
import type { BallDesign } from '../config';
import { BALL } from '../config';
import { clamp } from '../sim/math';

const UP = new Vector3(0, 1, 0);

export class BallView {
  readonly mesh: Mesh;
  readonly blob: Mesh;
  private readonly material: MeshStandardMaterial;
  private readonly axis = new Vector3();
  private readonly step = new Quaternion();

  constructor(design: BallDesign) {
    this.material = new MeshStandardMaterial({ map: createBallTexture(design), roughness: 0.45 });
    this.mesh = new Mesh(new SphereGeometry(BALL.radius, 32, 20), this.material);
    this.mesh.castShadow = true;

    this.blob = new Mesh(
      new CircleGeometry(0.22, 20),
      new MeshBasicMaterial({
        color: '#000000',
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.015;
  }

  setDesign(design: BallDesign): void {
    this.material.map?.dispose();
    this.material.map = createBallTexture(design);
    this.material.needsUpdate = true;
  }

  update(x: number, y: number, z: number, vx: number, vz: number, spinY: number, dt: number): void {
    this.mesh.position.set(x, y, z);

    // Rolling: rotate by (distance / radius) around up x velocity = (vz, 0, -vx).
    const speed = Math.hypot(vx, vz);
    if (speed > 0.01) {
      this.axis.set(vz / speed, 0, -vx / speed);
      this.step.setFromAxisAngle(this.axis, (speed * dt) / BALL.radius);
      this.mesh.quaternion.premultiply(this.step);
    }
    if (Math.abs(spinY) > 0.01) {
      this.step.setFromAxisAngle(UP, spinY * dt);
      this.mesh.quaternion.premultiply(this.step);
    }

    // The blob fades and spreads out as the ball rises.
    const height = clamp((y - BALL.radius) / 6, 0, 1);
    this.blob.position.x = x;
    this.blob.position.z = z;
    this.blob.scale.setScalar(1 + height * 0.8);
    (this.blob.material as MeshBasicMaterial).opacity = 0.38 * (1 - height * 0.75);
  }
}

/**
 * Draw a panel pattern on an equirectangular canvas (longitude across, latitude down).
 * The twelve pentagons sit roughly where they are on a real ball. Each is stretched
 * horizontally by 1 / cos(latitude), which cancels the squashing near the poles when the
 * texture is wrapped around a sphere.
 */
export function createBallTexture(design: BallDesign): CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');

  ctx.fillStyle = design.base;
  ctx.fillRect(0, 0, w, h);

  const pentagon = (lonDeg: number, latDeg: number, size: number): void => {
    const cx = ((lonDeg % 360) / 360) * w;
    const cy = ((90 - latDeg) / 180) * h;
    const stretch = 1 / Math.max(0.35, Math.cos((latDeg * Math.PI) / 180));
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const px = cx + Math.cos(a) * size * stretch;
      const py = cy + Math.sin(a) * size;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  };

  ctx.fillStyle = design.panel;
  ctx.fillRect(0, 0, w, h * 0.06);
  ctx.fillRect(0, h * 0.94, w, h * 0.06);
  for (let i = 0; i < 5; i++) {
    for (const offset of [0, w]) {
      // Draw twice (shifted by the texture width) so pentagons wrap across the seam.
      ctx.save();
      ctx.translate(offset - w, 0);
      pentagon(i * 72 + 360, 26.6, 22);
      pentagon(i * 72 + 36 + 360, -26.6, 22);
      ctx.restore();
    }
  }
  // Seam lines between the panels.
  ctx.strokeStyle = design.panel;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 2;
  for (let i = 0; i < 10; i++) {
    const x = (i / 10) * w;
    ctx.beginPath();
    ctx.moveTo(x, h * 0.2);
    ctx.lineTo(x + w * 0.05, h * 0.8);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
