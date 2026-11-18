/**
 * DebugTools.ts: the #debug mode. Add #debug to the URL (http://localhost:5173/#debug).
 *
 *  - Stats: frames per second and milliseconds per frame (top-left).
 *  - A lil-gui panel bound directly to the objects in config.ts. Because the sim reads
 *    config every tick, dragging a slider changes the game immediately: try ball
 *    restitution, player speeds or the AI difficulty presets.
 *  - The AI overlay (render/AIOverlay.ts): every AI player's state, target and steering.
 *
 * This whole module is loaded with a dynamic import() only when #debug is present, and
 * lil-gui is imported dynamically again inside it. Vite turns each dynamic import into a
 * separate file (a "chunk"), so normal players never download any of this code.
 */
import Stats from 'three/addons/libs/stats.module.js';
import { AI, BALL, KEEPER, KICK, PLAYER, SIM, TACKLE } from '../config';
import type { MatchSession } from '../core/MatchSession';
import { AIOverlay } from '../render/AIOverlay';
import type { GameRenderer } from '../render/GameRenderer';

export interface DebugHooks {
  renderer: GameRenderer;
  getSession: () => MatchSession;
}

export class DebugTools {
  private readonly stats = new Stats();
  private readonly overlay = new AIOverlay();
  showOverlay = true;

  constructor(private readonly hooks: DebugHooks) {
    this.stats.dom.style.left = '8px';
    this.stats.dom.style.top = '60px';
    document.body.append(this.stats.dom);
    hooks.renderer.scene.add(this.overlay.group);
  }

  /** Call once per rendered frame, after the scene has been drawn. */
  update(): void {
    this.stats.update();
    const view = this.hooks.renderer.view;
    this.overlay.group.visible = this.showOverlay;
    if (!view || !this.showOverlay) return;
    const session = this.hooks.getSession();
    const agents = [...session.homeAI.debugInfo(), ...session.awayAI.debugInfo()];
    this.overlay.update(agents, view.playerPoints);
  }
}

/** Load lil-gui (its own chunk) and build the tuning panel. */
export async function installDebugTools(hooks: DebugHooks): Promise<DebugTools> {
  const { default: GUI } = await import('lil-gui');
  const tools = new DebugTools(hooks);
  const gui = new GUI({ title: 'Rebound Five (debug)' });

  gui.add(tools, 'showOverlay').name('AI overlay');

  const ball = gui.addFolder('Ball physics');
  ball.add(BALL, 'gravity', 0, 30, 0.1);
  ball.add(BALL, 'airDrag', 0, 0.05, 0.001);
  ball.add(BALL, 'magnus', 0, 0.02, 0.0005).name('magnus (curve)');
  ball.add(BALL, 'groundRestitution', 0, 1, 0.01);
  ball.add(BALL, 'boardRestitution', 0, 1, 0.01);
  ball.add(BALL, 'postRestitution', 0, 1, 0.01);
  ball.add(BALL, 'rollingDeceleration', 0, 10, 0.1);
  ball.add(BALL, 'bounceFriction', 0, 1, 0.01);
  ball.add(SIM, 'ballSubsteps', 1, 12, 1);

  const players = gui.addFolder('Players');
  players.add(PLAYER, 'runSpeed', 2, 10, 0.1);
  players.add(PLAYER, 'sprintSpeed', 2, 12, 0.1);
  players.add(PLAYER, 'acceleration', 5, 60, 1);
  players.add(PLAYER, 'turnRate', 2, 25, 0.5);
  players.add(PLAYER, 'touchSpeedFactor', 1, 2.5, 0.01);
  players.add(PLAYER, 'shotChargeTime', 0.2, 2, 0.05);
  players.close();

  const kicks = gui.addFolder('Kicks & tackles');
  kicks.add(KICK, 'shotMaxSpeed', 10, 45, 0.5);
  kicks.add(KICK, 'shotCurveSpin', 0, 80, 1);
  kicks.add(KICK, 'passAimAssist', 0, 1, 0.01);
  kicks.add(TACKLE, 'standSuccess', 0, 1, 0.01);
  kicks.add(TACKLE, 'slideSpeed', 2, 15, 0.1);
  kicks.add(KEEPER, 'catchMaxSpeed', 5, 35, 0.5);
  kicks.add(KEEPER, 'diveSpeed', 2, 12, 0.1);
  kicks.close();

  const ai = gui.addFolder('AI difficulty presets');
  for (const [name, preset] of Object.entries(AI.presets)) {
    const folder = ai.addFolder(name);
    folder.add(preset, 'reactionTime', 0, 1.5, 0.01);
    folder.add(preset, 'decisionInterval', 0.05, 2, 0.01);
    folder.add(preset, 'passError', 0, 0.8, 0.01);
    folder.add(preset, 'shotError', 0, 1, 0.01);
    folder.add(preset, 'decisionNoise', 0, 0.6, 0.01);
    folder.add(preset, 'pressIntensity', 0, 1, 0.01);
    folder.add(preset, 'tackleRange', 0.5, 2, 0.01);
    folder.add(preset, 'slideTackleChance', 0, 1, 0.01);
    folder.add(preset, 'keeperReaction', 0, 1, 0.01);
    folder.add(preset, 'keeperError', 0, 2, 0.01);
    folder.add(preset, 'keeperPositioning', 0, 1, 0.01);
    folder.add(preset, 'shootThreshold', 0, 1, 0.01);
    folder.close();
  }
  ai.close();
  return tools;
}
