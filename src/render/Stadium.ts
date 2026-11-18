/**
 * Stadium.ts: builds the static arena. Pitch, surrounding floor, boards, glass panels,
 * goals, floodlight masts and stepped stands.
 *
 * Everything here is created once from primitives and canvas textures (no external
 * assets). Only the goal nets (Goals.ts) and the crowd (Crowd.ts) animate. The stands are
 * simple stepped boxes; the crowd is placed on these same tiers.
 */
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { COLORS, PITCH } from '../config';
import { Goals } from './Goals';
import { createPitchTexture } from './PitchTexture';

/** One row of seats: where the crowd sits. Crowd.ts reads these. */
export interface StandTier {
  /** Centre of the tier's top surface. */
  x: number;
  y: number;
  z: number;
  /** Length along the tier, and whether it runs along x (a side stand) or z (an end stand). */
  length: number;
  alongX: boolean;
  /** Direction spectators face (toward the pitch): +1 or -1 on the axis across the tier. */
  facing: 1 | -1;
}

export const STAND_LAYOUT = {
  tiers: 6,
  stepHeight: 0.55,
  stepDepth: 1.1,
  /** Gap between the boards and the first tier. */
  sideGap: 2.4,
  endGap: 2.6,
};

export class Stadium {
  readonly group = new Group();
  readonly goals = new Goals();
  readonly tiers: StandTier[] = [];

  constructor(maxAnisotropy: number) {
    this.buildPitch(maxAnisotropy);
    this.buildBoards();
    this.buildGlass();
    this.group.add(this.goals.group);
    this.buildStands();
    this.buildFloodlights();
  }

  update(dt: number): void {
    this.goals.update(dt);
  }

  private buildPitch(maxAnisotropy: number): void {
    const L = PITCH.halfLength;
    const W = PITCH.halfWidth;
    const pitch = new Mesh(
      new PlaneGeometry(L * 2, W * 2),
      new MeshStandardMaterial({ map: createPitchTexture(maxAnisotropy), roughness: 0.95 }),
    );
    // PlaneGeometry is vertical (XY). Rotating -90 degrees about X lays it flat, facing up.
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    this.group.add(pitch);

    const surround = new Mesh(
      new PlaneGeometry(L * 2 + 80, W * 2 + 80),
      new MeshLambertMaterial({ color: COLORS.surround }),
    );
    surround.rotation.x = -Math.PI / 2;
    surround.position.y = -0.02;
    surround.receiveShadow = true;
    this.group.add(surround);
  }

  /** The boards around the pitch, with a gap at each end for the goal mouth. */
  private buildBoards(): void {
    const L = PITCH.halfLength;
    const W = PITCH.halfWidth;
    const H = PITCH.boardHeight;
    const T = 0.15; // thickness
    const baseMap = createBoardTexture();
    const add = (sx: number, sz: number, x: number, z: number, repeat: number): void => {
      const geometry = new BoxGeometry(sx, H, sz);
      const map = baseMap.clone();
      map.repeat.set(repeat, 1);
      map.needsUpdate = true;
      const board = new Mesh(geometry, new MeshStandardMaterial({ map, roughness: 0.6 }));
      board.position.set(x, H / 2, z);
      board.receiveShadow = true;
      this.group.add(board);
    };
    // Side boards run the full length.
    for (const side of [-1, 1]) add(L * 2 + T * 2, T, 0, side * (W + T / 2), 6);
    // End boards: two pieces each side of the goal.
    const pieceLength = W - PITCH.goalHalfWidth;
    for (const side of [-1, 1]) {
      for (const zSide of [-1, 1]) {
        const zCentre = zSide * (PITCH.goalHalfWidth + pieceLength / 2);
        add(T, pieceLength, side * (L + T / 2), zCentre, 1.5);
      }
    }
  }

  /** Transparent panels above the boards, with the netting that keeps the ball in. */
  private buildGlass(): void {
    const L = PITCH.halfLength;
    const W = PITCH.halfWidth;
    const height = 3;
    const y = PITCH.boardHeight + height / 2;
    const material = new MeshBasicMaterial({
      color: COLORS.glass,
      transparent: true,
      opacity: 0.06,
      side: DoubleSide,
      depthWrite: false,
    });
    const frame = new MeshStandardMaterial({ color: '#5d6b7a', metalness: 0.4, roughness: 0.5 });
    for (const side of [-1, 1]) {
      const sidePanel = new Mesh(new PlaneGeometry(L * 2, height), material);
      sidePanel.position.set(0, y, side * W);
      this.group.add(sidePanel);
      const endPanel = new Mesh(new PlaneGeometry(W * 2, height), material);
      endPanel.rotation.y = Math.PI / 2;
      endPanel.position.set(side * L, y, 0);
      this.group.add(endPanel);

      // No top rail on the near side (+z): it would cut across the broadcast camera's view.
      if (side < 0) {
        const rail = new Mesh(new BoxGeometry(L * 2, 0.06, 0.06), frame);
        rail.position.set(0, PITCH.boardHeight + height, side * W);
        this.group.add(rail);
      }
      const endRail = new Mesh(new BoxGeometry(0.06, 0.06, W * 2), frame);
      endRail.position.set(side * L, PITCH.boardHeight + height, 0);
      this.group.add(endRail);
    }
  }

  /** Stepped concrete tiers on all four sides. */
  private buildStands(): void {
    const L = PITCH.halfLength;
    const W = PITCH.halfWidth;
    const { tiers, stepHeight, stepDepth, sideGap, endGap } = STAND_LAYOUT;
    const material = new MeshLambertMaterial({ color: COLORS.stands });
    const edgeMaterial = new MeshLambertMaterial({
      color: new Color(COLORS.stands).multiplyScalar(1.6),
    });

    for (let i = 0; i < tiers; i++) {
      const height = (i + 1) * stepHeight;
      const sideLength = L * 2 + 6 + i * 1.2;
      const endLength = W * 2 + 2 + i * 1.2;
      for (const side of [-1, 1] as const) {
        // Long side stands (along x).
        const zCentre = side * (W + sideGap + stepDepth * (i + 0.5));
        const sideStep = new Mesh(new BoxGeometry(sideLength, height, stepDepth), material);
        sideStep.position.set(0, height / 2, zCentre);
        this.group.add(sideStep);
        const sideEdge = new Mesh(new BoxGeometry(sideLength, 0.05, 0.08), edgeMaterial);
        sideEdge.position.set(0, height + 0.02, zCentre - side * stepDepth * 0.48);
        this.group.add(sideEdge);
        this.tiers.push({
          x: 0,
          y: height,
          z: zCentre,
          length: sideLength - 2,
          alongX: true,
          facing: side === 1 ? -1 : 1,
        });

        // End stands (along z), behind the goals.
        const xCentre = side * (L + PITCH.goalDepth + endGap + stepDepth * (i + 0.5));
        const endStep = new Mesh(new BoxGeometry(stepDepth, height, endLength), material);
        endStep.position.set(xCentre, height / 2, 0);
        this.group.add(endStep);
        this.tiers.push({
          x: xCentre,
          y: height,
          z: 0,
          length: endLength - 2,
          alongX: false,
          facing: side === 1 ? -1 : 1,
        });
      }
    }
  }

  /** Four corner masts with glowing lamp banks. Only the sun-like key light casts shadows. */
  private buildFloodlights(): void {
    const L = PITCH.halfLength;
    const W = PITCH.halfWidth;
    const mastMaterial = new MeshStandardMaterial({
      color: '#7d8590',
      metalness: 0.6,
      roughness: 0.4,
    });
    const lampMaterial = new MeshStandardMaterial({
      color: '#ffffff',
      emissive: '#fff6d8',
      emissiveIntensity: 2.2,
    });
    const mastHeight = 24;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * (L + 10);
        const z = sz * (W + 10);
        const mast = new Mesh(new CylinderGeometry(0.25, 0.45, mastHeight, 8), mastMaterial);
        mast.position.set(x, mastHeight / 2, z);
        this.group.add(mast);
        const head = new Mesh(new BoxGeometry(3.2, 1.8, 0.3), lampMaterial);
        head.position.set(x, mastHeight + 0.6, z);
        head.lookAt(0, 0, 0);
        this.group.add(head);
      }
    }
  }
}

/** The advertising boards carry the game's own name and simple stripes (no sponsors). */
function createBoardTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.fillStyle = COLORS.boards;
  ctx.fillRect(0, 0, 512, 64);
  ctx.fillStyle = COLORS.boardStripe;
  ctx.fillRect(0, 52, 512, 6);
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('REBOUND', 24, 28);
  ctx.fillStyle = COLORS.boardStripe;
  ctx.fillText('FIVE', 186, 28);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText('5-A-SIDE ARENA', 290, 28);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  return texture;
}
