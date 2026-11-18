/**
 * Goals.ts: the two goal frames and their nets, including the ripple when the ball hits
 * the net.
 *
 * The posts and crossbar are cylinders matching the collision capsules in
 * sim/ball/Collisions.ts. The back net is a subdivided plane. When the sim reports a
 * 'net' bounce, we start a ripple: each vertex is pushed along the net's normal by a
 * decaying wave centred on the impact point:
 *     offset = A * e^(-decay * t) * sin(k * d - w * t) * e^(-d)
 * where d is the vertex's distance from the impact point.
 */
import type { BufferAttribute } from 'three';
import {
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { COLORS, PITCH } from '../config';

interface Ripple {
  localX: number;
  localY: number;
  strength: number;
  age: number;
}

class GoalView {
  readonly group = new Group();
  private readonly backNet: Mesh;
  private readonly basePositions: Float32Array;
  private ripple: Ripple | null = null;
  private readonly scratch = new Vector3();

  constructor(
    readonly side: 1 | -1,
    netTexture: CanvasTexture,
  ) {
    const L = PITCH.halfLength;
    const W = PITCH.goalHalfWidth;
    const H = PITCH.goalHeight;
    const D = PITCH.goalDepth;
    const r = PITCH.postRadius;

    const frameMaterial = new MeshStandardMaterial({ color: COLORS.posts, roughness: 0.35 });
    const postGeometry = new CylinderGeometry(r, r, H, 12);
    for (const z of [-W, W]) {
      const post = new Mesh(postGeometry, frameMaterial);
      post.position.set(side * L, H / 2, z);
      post.castShadow = true;
      this.group.add(post);
    }
    const bar = new Mesh(new CylinderGeometry(r, r, W * 2 + r * 2, 12), frameMaterial);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(side * L, H, 0);
    bar.castShadow = true;
    this.group.add(bar);

    // Thin support bars around the back of the net.
    const supportMaterial = new MeshStandardMaterial({ color: '#b8c0c8', roughness: 0.5 });
    const thin = 0.025;
    const backTop = new Mesh(new CylinderGeometry(thin, thin, W * 2, 6), supportMaterial);
    backTop.rotation.x = Math.PI / 2;
    backTop.position.set(side * (L + D), H, 0);
    this.group.add(backTop);
    for (const z of [-W, W]) {
      const backPost = new Mesh(new CylinderGeometry(thin, thin, H, 6), supportMaterial);
      backPost.position.set(side * (L + D), H / 2, z);
      this.group.add(backPost);
      const roofSide = new Mesh(new CylinderGeometry(thin, thin, D, 6), supportMaterial);
      roofSide.rotation.z = Math.PI / 2;
      roofSide.position.set(side * (L + D / 2), H, z);
      this.group.add(roofSide);
    }

    // Nets. Each plane gets its own texture copy so the mesh squares stay the same size.
    const makeNetMaterial = (repeatX: number, repeatY: number): MeshBasicMaterial => {
      const map = netTexture.clone();
      map.repeat.set(repeatX, repeatY);
      map.needsUpdate = true;
      return new MeshBasicMaterial({
        map,
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
      });
    };
    const cell = 0.18;

    this.backNet = new Mesh(
      new PlaneGeometry(W * 2, H, 24, 12),
      makeNetMaterial((W * 2) / cell, H / cell),
    );
    this.backNet.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
    this.backNet.position.set(side * (L + D), H / 2, 0);
    this.group.add(this.backNet);
    const positions = this.backNet.geometry.getAttribute('position') as BufferAttribute;
    this.basePositions = Float32Array.from(positions.array as Float32Array);

    for (const z of [-W, W]) {
      const sideNet = new Mesh(new PlaneGeometry(D, H), makeNetMaterial(D / cell, H / cell));
      sideNet.position.set(side * (L + D / 2), H / 2, z);
      this.group.add(sideNet);
    }
    const roof = new Mesh(new PlaneGeometry(D, W * 2), makeNetMaterial(D / cell, (W * 2) / cell));
    roof.rotation.x = -Math.PI / 2;
    roof.position.set(side * (L + D / 2), H, 0);
    this.group.add(roof);
  }

  /** Start a ripple at a world-space impact point. */
  rippleAt(x: number, y: number, z: number, speed: number): void {
    this.group.updateMatrixWorld();
    const local = this.backNet.worldToLocal(this.scratch.set(x, y, z));
    this.ripple = {
      localX: local.x,
      localY: local.y,
      strength: Math.min(0.35, speed * 0.03),
      age: 0,
    };
  }

  update(dt: number): void {
    if (!this.ripple) return;
    const ripple = this.ripple;
    ripple.age += dt;
    const positions = this.backNet.geometry.getAttribute('position') as BufferAttribute;
    const array = positions.array as Float32Array;
    const fade = Math.exp(-3 * ripple.age);
    for (let i = 0; i < array.length; i += 3) {
      const dx = this.basePositions[i] - ripple.localX;
      const dy = this.basePositions[i + 1] - ripple.localY;
      const d = Math.hypot(dx, dy);
      // Positive local z points back toward the pitch, so bulge outward with a minus sign.
      array[i + 2] = -ripple.strength * fade * Math.sin(9 * d - 16 * ripple.age) * Math.exp(-d);
    }
    positions.needsUpdate = true;
    if (fade < 0.01) {
      this.ripple = null;
      for (let i = 2; i < array.length; i += 3) array[i] = 0;
    }
  }
}

function createNetTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.strokeStyle = COLORS.net;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export class Goals {
  readonly group = new Group();
  private readonly goals: GoalView[];

  constructor() {
    const netTexture = createNetTexture();
    this.goals = [new GoalView(1, netTexture), new GoalView(-1, netTexture)];
    for (const goal of this.goals) this.group.add(goal.group);
  }

  /** Called for each sim 'net' bounce event. */
  onNetHit(x: number, y: number, z: number, speed: number): void {
    const goal = x > 0 ? this.goals[0] : this.goals[1];
    goal.rippleAt(x, y, z, speed);
  }

  update(dt: number): void {
    for (const goal of this.goals) goal.update(dt);
  }
}
