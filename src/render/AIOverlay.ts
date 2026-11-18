/**
 * AIOverlay.ts: #debug only. Draws what each AI player is thinking, inside the 3D scene.
 *
 *  - a label above the head with the current state and role (e.g. "ChaseBall / presser");
 *  - a thin line from the player to their target point;
 *  - a short yellow line showing their steering direction (desired velocity / 4).
 *
 * Labels are sprites (always face the camera) with a canvas texture. The texture is only
 * redrawn when the text changes, because uploading textures to the GPU is relatively slow.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  LineBasicMaterial,
  LineSegments,
  Sprite,
  SpriteMaterial,
} from 'three';
import type { AgentDebug } from '../sim/ai/AIController';
import type { Point } from './CameraRig';

interface Label {
  sprite: Sprite;
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  text: string;
}

const MAX_PLAYERS = 16;

export class AIOverlay {
  readonly group = new Group();
  private readonly positions = new Float32Array(MAX_PLAYERS * 4 * 3);
  private readonly colours = new Float32Array(MAX_PLAYERS * 4 * 3);
  private readonly geometry = new BufferGeometry();
  private readonly labels = new Map<number, Label>();

  constructor() {
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new BufferAttribute(this.colours, 3));
    const lines = new LineSegments(
      this.geometry,
      new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }),
    );
    lines.renderOrder = 999;
    lines.frustumCulled = false;
    this.group.add(lines);
  }

  update(agents: readonly AgentDebug[], players: readonly Point[]): void {
    const seen = new Set<number>();
    let v = 0;
    const push = (x: number, y: number, z: number, r: number, g: number, b: number): void => {
      this.positions.set([x, y, z], v * 3);
      this.colours.set([r, g, b], v * 3);
      v++;
    };
    for (const agent of agents.slice(0, MAX_PLAYERS)) {
      const p = players[agent.playerId];
      if (!p) continue;
      seen.add(agent.playerId);
      push(p.x, 0.1, p.z, 0.4, 0.9, 1);
      push(agent.targetX, 0.1, agent.targetZ, 0.4, 0.9, 1);
      push(p.x, 0.15, p.z, 1, 0.85, 0.2);
      push(p.x + agent.steerX / 4, 0.15, p.z + agent.steerZ / 4, 1, 0.85, 0.2);
      this.label(agent.playerId, `${agent.state} / ${agent.role}`, p);
    }
    this.geometry.setDrawRange(0, v);
    (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
    for (const [id, label] of this.labels) label.sprite.visible = seen.has(id);
  }

  private label(id: number, text: string, at: Point): void {
    let label = this.labels.get(id);
    if (!label) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 48;
      const texture = new CanvasTexture(canvas);
      const sprite = new Sprite(
        new SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
      );
      sprite.scale.set(2.6, 0.49, 1);
      sprite.renderOrder = 1000;
      this.group.add(sprite);
      label = { sprite, canvas, texture, text: '' };
      this.labels.set(id, label);
    }
    if (label.text !== text) {
      label.text = text;
      const ctx = label.canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 256, 48);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 4, 256, 40);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 22px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 128, 25);
      }
      label.texture.needsUpdate = true;
    }
    label.sprite.position.set(at.x, 2.4, at.z);
  }
}
