/**
 * Crowd.ts: about 1,500 spectators drawn with a single InstancedMesh.
 *
 * Drawing 1,500 separate meshes would mean 1,500 draw calls: CPU work to tell the GPU
 * what to draw, every frame. An InstancedMesh sends ONE geometry plus a list of
 * per-instance transforms and colours, and the GPU draws all copies in a single call.
 *
 * The bouncing is done on the GPU too. We patch the standard material's vertex shader
 * (onBeforeCompile) to lift each vertex by
 *     |sin(time * speed + phase)| * (idleBounce + excitement * jumpHeight)
 * where `phase` is a random number per spectator (an InstancedBufferAttribute). The CPU
 * only updates two uniforms per frame (time and excitement), however many fans there are.
 */
import {
  CapsuleGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { Kit } from '../config';
import type { StandTier } from './Stadium';

const SEAT_SPACING = 0.62;
const NEUTRAL_COLOURS = ['#d9d9d9', '#3b3b3b', '#7a6f5d', '#2f4858', '#9a8c98', '#e0c097'];

export class Crowd {
  readonly mesh: InstancedMesh;
  private readonly uniforms = { uTime: { value: 0 }, uExcite: { value: 0 } };
  private excitement = 0;

  constructor(tiers: readonly StandTier[]) {
    const seats: Array<{ x: number; y: number; z: number }> = [];
    for (const tier of tiers) {
      const count = Math.floor(tier.length / SEAT_SPACING);
      for (let i = 0; i < count; i++) {
        if (Math.random() < 0.18) continue; // some empty seats
        const along = -tier.length / 2 + (i + 0.5) * SEAT_SPACING + (Math.random() - 0.5) * 0.15;
        const across = (Math.random() - 0.5) * 0.25;
        seats.push(
          tier.alongX
            ? { x: tier.x + along, y: tier.y, z: tier.z + across }
            : { x: tier.x + across, y: tier.y, z: tier.z + along },
        );
      }
    }

    const geometry = new CapsuleGeometry(0.2, 0.5, 2, 6);
    geometry.translate(0, 0.45, 0); // stand on the tier rather than sink into it
    const phases = new Float32Array(seats.length);
    for (let i = 0; i < phases.length; i++) phases[i] = Math.random();
    geometry.setAttribute('aPhase', new InstancedBufferAttribute(phases, 1));

    const material = new MeshLambertMaterial();
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uExcite = this.uniforms.uExcite;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aPhase;\nuniform float uTime;\nuniform float uExcite;',
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float speed = 3.0 + aPhase * 3.0 + uExcite * 4.0;
          float bounce = abs(sin(uTime * speed + aPhase * 6.2831));
          transformed.y += bounce * (0.02 + uExcite * 0.5);`,
        );
    };

    this.mesh = new InstancedMesh(geometry, material, seats.length);
    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();
    const rotation = new Quaternion();
    seats.forEach((seat, i) => {
      position.set(seat.x, seat.y, seat.z);
      const size = 0.9 + Math.random() * 0.25;
      scale.set(size, size, size);
      matrix.compose(position, rotation, scale);
      this.mesh.setMatrixAt(i, matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.setColours(null, null);
  }

  /** Dress the crowd in a mix of both teams' colours and neutral clothes. */
  setColours(home: Kit | null, away: Kit | null): void {
    const colour = new Color();
    const palette = [...NEUTRAL_COLOURS];
    if (home) palette.push(home.shirt, home.shirt, home.shirt, home.shorts);
    if (away) palette.push(away.shirt, away.shirt, away.shorts);
    for (let i = 0; i < this.mesh.count; i++) {
      colour.set(palette[Math.floor(Math.random() * palette.length)]);
      this.mesh.setColorAt(i, colour);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Make the whole crowd jump (on a goal). */
  celebrate(): void {
    this.excitement = 1;
  }

  update(dt: number): void {
    this.uniforms.uTime.value += dt;
    this.excitement = Math.max(0, this.excitement - dt * 0.28);
    this.uniforms.uExcite.value = this.excitement;
  }
}
