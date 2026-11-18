/**
 * GameRenderer.ts: owns the WebGLRenderer, the scene, the lights and the camera rig.
 *
 * main.ts creates one GameRenderer, calls setMatch() whenever a new match starts and
 * render() on every animation frame. Rendering only reads snapshots; it never changes the
 * simulation.
 *
 * Performance choices for a steady 60 fps on a mid-range laptop:
 *  - devicePixelRatio is capped at 2 (a 3x phone screen would render 2.25x more pixels for
 *    almost no visible gain);
 *  - only one light casts shadows (each shadow-casting light re-renders the scene from its
 *    point of view);
 *  - geometries are shared between players, and the crowd is a single InstancedMesh.
 */
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFShadowMap,
  Scene,
  WebGLRenderer,
} from 'three';
import type { BallDesign, Kit } from '../config';
import { COLORS } from '../config';
import type { SimEvent } from '../sim/events';
import type { Snapshot } from '../sim/Snapshot';
import { CameraRig } from './CameraRig';
import { SceneView } from './SceneView';
import { Stadium } from './Stadium';

export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly cameraRig = new CameraRig();
  readonly stadium: Stadium;
  view: SceneView | null = null;
  /** Player id the celebration camera should orbit. */
  cameraSubjectId: number | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.background = new Color(COLORS.sky);
    this.scene.fog = new Fog(COLORS.fog, 70, 170);
    this.addLights();

    this.stadium = new Stadium(this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.stadium.group);

    window.addEventListener('resize', this.resize);
    this.resize();
  }

  private addLights(): void {
    // Soft light from the sky above and bounce light from the grass below.
    this.scene.add(new HemisphereLight('#c9dcff', '#24402a', 0.9));

    // The key light: the only one that casts shadows. Its shadow camera is an
    // orthographic box that just covers the pitch, to get the most out of the shadow map.
    const key = new DirectionalLight('#fff4e0', 2.4);
    key.position.set(-14, 32, 18);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const cam = key.shadow.camera;
    cam.left = -30;
    cam.right = 30;
    cam.top = 24;
    cam.bottom = -24;
    cam.near = 5;
    cam.far = 90;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    // A cooler fill light from the other side, without shadows.
    const fill = new DirectionalLight('#9fb8ff', 0.55);
    fill.position.set(16, 20, -20);
    this.scene.add(fill);
  }

  /** Build players and ball for a new match. */
  setMatch(snapshot: Snapshot, kits: [Kit, Kit], ballDesign: BallDesign): void {
    this.view?.dispose();
    this.view = new SceneView(snapshot, kits, ballDesign);
    this.scene.add(this.view.group);
  }

  /** React to simulation events that have a visual effect. */
  handleEvent(event: SimEvent): void {
    if (event.type === 'bounce' && event.surface === 'net') {
      this.stadium.goals.onNetHit(event.x, event.y, event.z, event.speed);
    }
  }

  render(prev: Snapshot, curr: Snapshot, alpha: number, dt: number): void {
    const view = this.view;
    if (view) {
      view.sync(prev, curr, alpha, dt);
      const owner = curr.players.find((p) => p.hasBall);
      const leanDir = owner ? (owner.team === 0 ? 1 : -1) : 0;
      const subject =
        this.cameraSubjectId !== null ? view.playerPoints[this.cameraSubjectId] : null;
      this.cameraRig.update(dt, view.ballPoint, leanDir, subject ?? null);
    }
    this.stadium.update(dt);
    this.renderer.render(this.scene, this.cameraRig.camera);
  }

  private readonly resize = (): void => {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    // Cap the pixel ratio at 2: sharper than that costs a lot of GPU time for little gain.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // `false` = don't touch the canvas CSS size; the stylesheet already makes it full-screen.
    this.renderer.setSize(width, height, false);
    this.cameraRig.setAspect(width / height);
  };
}
