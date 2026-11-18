/**
 * PlayerModel.ts: a footballer built from capsules, spheres, cylinders and boxes, with
 * all animation done in code.
 *
 * The body is a small hierarchy of Groups ("bones"). Rotating a hip Group swings the whole
 * leg below it, because children inherit their parent's transform. Animation is just
 * setting a handful of joint angles every frame from the player's snapshot: speed drives
 * the run cycle, `action` + `actionProgress` drive kicks, slides, dives and celebrations.
 *
 * The model is built facing +x. Rotation conventions:
 *   rotation.z on a hip or shoulder swings the limb forward (+) or back (-);
 *   rotation.x on a shoulder spreads the arm sideways; rotation.x on the body rolls it.
 */
import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import type { BufferGeometry } from 'three';
import { PLAYER } from '../config';
import { clamp, lerp } from '../sim/math';
import type { PlayerSnapshot } from '../sim/Snapshot';

export interface KitColors {
  shirt: string;
  shorts: string;
  socks: string;
}

const HIP_HEIGHT = 0.92;

/** Geometries are shared by every player (built once, on first use). */
let shared: Record<string, BufferGeometry> | null = null;
function geometries(): Record<string, BufferGeometry> {
  if (!shared) {
    shared = {
      torso: new CapsuleGeometry(0.19, 0.3, 4, 12),
      head: new SphereGeometry(0.14, 16, 12),
      hair: new SphereGeometry(0.148, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
      shorts: new CylinderGeometry(0.2, 0.23, 0.26, 12),
      thigh: new CapsuleGeometry(0.075, 0.25, 4, 8),
      shin: new CapsuleGeometry(0.062, 0.3, 4, 8),
      boot: new BoxGeometry(0.25, 0.09, 0.11),
      upperArm: new CapsuleGeometry(0.055, 0.2, 4, 8),
      forearm: new CapsuleGeometry(0.05, 0.2, 4, 8),
    };
  }
  return shared;
}

interface Limb {
  upper: Group;
  lower: Group;
}

export class PlayerView {
  /** Positioned at the feet and rotated to the facing direction. */
  readonly root = new Group();
  private readonly body = new Group();
  private readonly legs: [Limb, Limb];
  private readonly arms: [Limb, Limb];
  private readonly materials: {
    shirt: MeshStandardMaterial;
    shorts: MeshStandardMaterial;
    socks: MeshStandardMaterial;
  };
  private runPhase = Math.random() * Math.PI * 2;
  private time = 0;

  constructor(kit: KitColors, skin: string, hair: string) {
    const g = geometries();
    this.materials = {
      shirt: new MeshStandardMaterial({ color: kit.shirt, roughness: 0.75 }),
      shorts: new MeshStandardMaterial({ color: kit.shorts, roughness: 0.8 }),
      socks: new MeshStandardMaterial({ color: kit.socks, roughness: 0.8 }),
    };
    const skinMaterial = new MeshStandardMaterial({ color: skin, roughness: 0.7 });
    const hairMaterial = new MeshStandardMaterial({ color: hair, roughness: 0.9 });
    const bootMaterial = new MeshStandardMaterial({ color: '#141414', roughness: 0.5 });

    this.root.add(this.body);
    this.body.position.y = HIP_HEIGHT;

    const torso = this.mesh(g.torso, this.materials.shirt, 0, 0.33, 0);
    torso.scale.set(0.82, 1, 1.12); // thinner front-to-back, broader across the shoulders
    this.body.add(torso);
    this.body.add(this.mesh(g.head, skinMaterial, 0.01, 0.82, 0));
    this.body.add(this.mesh(g.hair, hairMaterial, -0.015, 0.84, 0));
    this.body.add(this.mesh(g.shorts, this.materials.shorts, 0, -0.03, 0));

    const makeLeg = (z: number): Limb => {
      const upper = new Group();
      upper.position.set(0, -0.06, z);
      upper.add(this.mesh(g.thigh, this.materials.shorts, 0, -0.18, 0));
      const lower = new Group();
      lower.position.y = -0.4;
      lower.add(this.mesh(g.shin, this.materials.socks, 0, -0.2, 0));
      lower.add(this.mesh(g.boot, bootMaterial, 0.06, -0.41, 0));
      upper.add(lower);
      this.body.add(upper);
      return { upper, lower };
    };
    const makeArm = (z: number): Limb => {
      const upper = new Group();
      upper.position.set(0, 0.55, z);
      upper.add(this.mesh(g.upperArm, this.materials.shirt, 0, -0.14, 0));
      const lower = new Group();
      lower.position.y = -0.29;
      lower.add(this.mesh(g.forearm, skinMaterial, 0, -0.13, 0));
      upper.add(lower);
      this.body.add(upper);
      return { upper, lower };
    };
    // Facing +x, the player's right-hand side is +z.
    this.legs = [makeLeg(-0.11), makeLeg(0.11)];
    this.arms = [makeArm(-0.26), makeArm(0.26)];
  }

  setKit(kit: KitColors): void {
    this.materials.shirt.color.set(kit.shirt);
    this.materials.shorts.color.set(kit.shorts);
    this.materials.socks.color.set(kit.socks);
  }

  private mesh(
    geometry: BufferGeometry,
    material: MeshStandardMaterial,
    x: number,
    y: number,
    z: number,
  ): Mesh {
    const m = new Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  }

  /** Pose the model for this frame. `p` holds interpolated position and facing. */
  update(p: PlayerSnapshot, dt: number): void {
    this.time += dt;
    this.root.position.set(p.x, 0, p.z);
    // Three.js rotates +x toward -z for positive Y angles; our facing angle runs the
    // other way (toward +z), hence the minus sign.
    this.root.rotation.y = -p.facing;

    const pose = this.runCyclePose(p, dt);
    this.applyAction(p, pose);
    this.applyPose(pose);
  }

  private runCyclePose(p: PlayerSnapshot, dt: number): Pose {
    const stride = clamp(p.speed / PLAYER.sprintSpeed, 0, 1);
    // Advance the cycle by distance travelled, so feet don't slide at any speed.
    this.runPhase += p.speed * dt * 2.4;
    const s = Math.sin(this.runPhase);
    const c = Math.cos(this.runPhase);
    const idle = 1 - clamp(p.speed / 1.5, 0, 1);
    return {
      bodyY: HIP_HEIGHT + Math.abs(s) * 0.06 * stride + Math.sin(this.time * 2) * 0.008 * idle,
      lean: -0.22 * stride,
      roll: 0,
      legs: [s * 0.85 * stride, -s * 0.85 * stride],
      knees: [-Math.max(0, -c) * 1.3 * stride - 0.06, -Math.max(0, c) * 1.3 * stride - 0.06],
      arms: [-s * 0.75 * stride, s * 0.75 * stride],
      elbows: [0.35 + stride * 0.7, 0.35 + stride * 0.7],
      spread: [0.1, 0.1],
    };
  }

  private applyAction(p: PlayerSnapshot, pose: Pose): void {
    const t = p.actionProgress;
    switch (p.action) {
      case 'kick': {
        // Wind up, swing through, follow through. Right leg kicks; left arm balances.
        const swing =
          t < 0.3
            ? lerp(0, -0.9, t / 0.3)
            : t < 0.6
              ? lerp(-0.9, 1.5, (t - 0.3) / 0.3)
              : lerp(1.5, 0.2, (t - 0.6) / 0.4);
        pose.legs[1] = swing;
        pose.knees[1] = t < 0.45 ? -1.1 : -0.15;
        pose.arms[0] = 0.5;
        pose.spread[0] = 0.7;
        pose.lean = 0.12;
        break;
      }
      case 'standTackle':
        pose.legs[1] = Math.sin(t * Math.PI) * 1.2;
        pose.knees[1] = 0;
        pose.lean = -0.35;
        pose.spread = [0.5, 0.5];
        break;
      case 'slide':
        pose.lean = 1.15; // leaning right back
        pose.bodyY = 0.42;
        pose.legs = [-0.3, 0.45];
        pose.knees = [-1.3, 0];
        pose.arms = [-1.1, -1.1];
        pose.spread = [0.5, 0.5];
        break;
      case 'dive': {
        // Roll toward the dive side and stretch the arms past the head.
        const sideX = -Math.sin(p.facing);
        const sideZ = Math.cos(p.facing);
        const side = p.actionDirX * sideX + p.actionDirZ * sideZ >= 0 ? 1 : -1;
        const extend = clamp(t * 3, 0, 1);
        pose.roll = side * 1.35 * extend;
        pose.bodyY = 0.55 + Math.sin(clamp(t * 1.6, 0, 1) * Math.PI) * 0.35;
        pose.arms = [2.9 * extend, 2.9 * extend];
        pose.elbows = [0, 0];
        pose.legs = [0.1, -0.1];
        pose.knees = [-0.1, -0.1];
        pose.lean = 0;
        break;
      }
      case 'fallen':
        pose.lean = 1.45;
        pose.bodyY = 0.24;
        pose.arms = [-0.4, 0.4];
        pose.spread = [1.0, 1.0];
        pose.legs = [0.25, 0.1];
        pose.knees = [-0.3, -0.5];
        break;
      case 'celebrate':
        pose.arms = [2.75, 2.75];
        pose.elbows = [0.2, 0.2];
        pose.spread = [0.55, 0.55];
        pose.bodyY += Math.abs(Math.sin(this.time * 9)) * 0.28;
        pose.lean = 0.05;
        break;
      case 'throw': {
        const arm = t < 0.45 ? lerp(0.5, 3.0, t / 0.45) : lerp(3.0, 1.1, (t - 0.45) / 0.55);
        pose.arms = [arm, arm];
        pose.elbows = [0.3, 0.3];
        break;
      }
      case 'none':
        break;
    }

    if (p.holdingBall && p.action === 'none') {
      pose.arms = [1.25, 1.25];
      pose.elbows = [0.7, 0.7];
      pose.spread = [0.05, 0.05];
    }
    if (p.charging) {
      pose.legs[1] = -0.75 * p.shotCharge;
      pose.knees[1] = -0.9 * p.shotCharge;
      pose.lean = lerp(pose.lean, 0.1, p.shotCharge);
      pose.spread[0] = 0.6;
    }
  }

  private applyPose(pose: Pose): void {
    this.body.position.y = pose.bodyY;
    this.body.rotation.set(pose.roll, 0, pose.lean);
    for (let i = 0; i < 2; i++) {
      this.legs[i].upper.rotation.z = pose.legs[i];
      this.legs[i].lower.rotation.z = pose.knees[i];
      this.arms[i].upper.rotation.z = pose.arms[i];
      // Left arm (index 0, at -z) spreads with +x rotation; right arm with -x.
      this.arms[i].upper.rotation.x = i === 0 ? pose.spread[i] : -pose.spread[i];
      this.arms[i].lower.rotation.z = pose.elbows[i];
    }
  }
}

interface Pose {
  bodyY: number;
  /** Forward (-) or backward (+) lean around the hips. */
  lean: number;
  /** Sideways roll (dives). */
  roll: number;
  legs: [number, number];
  knees: [number, number];
  arms: [number, number];
  elbows: [number, number];
  spread: [number, number];
}
