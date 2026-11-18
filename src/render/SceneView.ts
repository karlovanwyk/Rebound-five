/**
 * SceneView.ts: the dynamic part of the scene. Players, ball and the control ring.
 *
 * Every frame, sync() takes the previous and current tick snapshots plus the loop's
 * `alpha` and places each mesh at the blended (interpolated) position:
 *     shown = previous + (current - previous) * alpha
 * Angles are blended along the shortest way round, so a player turning from 179 degrees
 * to -179 degrees turns 2 degrees, not 358. This is the render half of the fixed-timestep
 * story in core/Loop.ts.
 */
import { Group, Mesh, MeshBasicMaterial, RingGeometry, Shape, ShapeGeometry } from 'three';
import type { BallDesign, Kit } from '../config';
import { COLORS } from '../config';
import { angleDiff, lerp } from '../sim/math';
import type { PlayerSnapshot, Snapshot } from '../sim/Snapshot';
import { BallView } from './BallModel';
import type { Point } from './CameraRig';
import { PlayerView } from './PlayerModel';

export class SceneView {
  readonly group = new Group();
  readonly players: PlayerView[] = [];
  readonly ball: BallView;
  private readonly ring = new Group();
  /** Scratch snapshot holding interpolated values for one player. */
  private readonly blended: PlayerSnapshot;
  /** Interpolated positions from the last sync, for cameras and overlays. */
  readonly ballPoint: Point = { x: 0, y: 0, z: 0 };
  readonly playerPoints: Point[] = [];

  constructor(snapshot: Snapshot, kits: [Kit, Kit], ballDesign: BallDesign) {
    for (const p of snapshot.players) {
      const kit = kits[p.team];
      const colours =
        p.index === 0
          ? { shirt: kit.keeper, shorts: kit.keeper, socks: kit.keeper }
          : { shirt: kit.shirt, shorts: kit.shorts, socks: kit.socks };
      const skin = COLORS.skin[(p.id * 3 + 1) % COLORS.skin.length];
      const hair = COLORS.hair[(p.id * 7 + 2) % COLORS.hair.length];
      const view = new PlayerView(colours, skin, hair);
      this.players.push(view);
      this.group.add(view.root);
      this.playerPoints.push({ x: p.x, y: 0, z: p.z });
    }
    this.blended = { ...snapshot.players[0] };

    this.ball = new BallView(ballDesign);
    this.group.add(this.ball.mesh, this.ball.blob);

    this.buildRing();
    this.group.add(this.ring);
  }

  /** A ring under the human-controlled player, with a small arrow showing facing. */
  private buildRing(): void {
    const material = new MeshBasicMaterial({
      color: COLORS.controlRing,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const ring = new Mesh(new RingGeometry(0.48, 0.6, 40), material);
    ring.rotation.x = -Math.PI / 2;
    this.ring.add(ring);

    const tri = new Shape();
    tri.moveTo(0.95, 0);
    tri.lineTo(0.7, 0.16);
    tri.lineTo(0.7, -0.16);
    tri.closePath();
    const pointer = new Mesh(new ShapeGeometry(tri), material);
    // ShapeGeometry is drawn in XY; rotate it flat. Shape +y maps to world -z here.
    pointer.rotation.x = -Math.PI / 2;
    this.ring.add(pointer);
    this.ring.position.y = 0.03;
    this.ring.visible = false;
  }

  sync(prev: Snapshot, curr: Snapshot, alpha: number, dt: number): void {
    let controlled: PlayerSnapshot | null = null;

    for (let i = 0; i < curr.players.length; i++) {
      const a = prev.players[i];
      const b = curr.players[i];
      const p = this.blended;
      Object.assign(p, b);
      p.x = lerp(a.x, b.x, alpha);
      p.z = lerp(a.z, b.z, alpha);
      p.facing = a.facing + angleDiff(b.facing, a.facing) * alpha;
      p.speed = lerp(a.speed, b.speed, alpha);
      this.players[i].update(p, dt);
      this.playerPoints[i].x = p.x;
      this.playerPoints[i].z = p.z;
      if (b.controlled) {
        controlled = b;
        this.ring.position.x = p.x;
        this.ring.position.z = p.z;
        this.ring.rotation.y = -p.facing;
      }
    }
    this.ring.visible = controlled !== null;

    const ba = prev.ball;
    const bb = curr.ball;
    this.ballPoint.x = lerp(ba.x, bb.x, alpha);
    this.ballPoint.y = lerp(ba.y, bb.y, alpha);
    this.ballPoint.z = lerp(ba.z, bb.z, alpha);
    this.ball.update(
      this.ballPoint.x,
      this.ballPoint.y,
      this.ballPoint.z,
      lerp(ba.vx, bb.vx, alpha),
      lerp(ba.vz, bb.vz, alpha),
      bb.spinY,
      dt,
    );
  }

  setBallDesign(design: BallDesign): void {
    this.ball.setDesign(design);
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
