/**
 * main.ts: entry point. Wires the simulation, input, renderer and HUD together and
 * starts the loop.
 *
 * Milestone 1: a practice pitch with one player. Move, dribble and shoot.
 *
 * Data flow each tick:  keyboard -> HumanController -> Intent -> stepWorld() -> Snapshot
 * Each frame:           (previous, current snapshot, alpha) -> GameRenderer
 */
import { BALL_DESIGNS, KITS, SIM } from './config';
import { Loop } from './core/Loop';
import { HumanController } from './input/HumanController';
import { createIntent } from './input/Intent';
import { Keyboard } from './input/Keyboard';
import { GameRenderer } from './render/GameRenderer';
import { captureSnapshot, copySnapshot, createSnapshot } from './sim/Snapshot';
import { createWorld, stepWorld } from './sim/World';
import { Hud } from './ui/Hud';

function start(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui-root') as HTMLElement;

  let renderer: GameRenderer;
  try {
    renderer = new GameRenderer(canvas);
  } catch (error) {
    uiRoot.textContent = 'WebGL is not available in this browser, so Rebound Five cannot run.';
    console.error(error);
    return;
  }

  const world = createWorld({ seed: 2026, playersPerTeam: [1, 0] });
  const keyboard = new Keyboard(window);
  const human = new HumanController(keyboard);
  const intents = world.players.map(() => createIntent());

  const previous = createSnapshot(world);
  const current = createSnapshot(world);
  renderer.setMatch(current, [KITS[0], KITS[1]], BALL_DESIGNS[0]);

  const hud = new Hud(uiRoot);
  hud.setTeams('YOU', KITS[0].shirt, 'GOAL', '#ffffff');
  hud.setClock('PRACTICE');
  hud.setHelp(['WASD / arrows: move', 'Shift: sprint', 'K: shoot (hold to charge)']);

  const loop = new Loop(SIM.dt, {
    update() {
      copySnapshot(previous, current);
      human.sample(intents[0]);
      stepWorld(world, intents);
      captureSnapshot(world, current);
      for (const event of world.events) {
        renderer.handleEvent(event);
        if (event.type === 'goal') hud.showBanner('Goal!', 'practice', 1.8);
      }
    },
    render(alpha, frameDt) {
      renderer.render(previous, current, alpha, frameDt);
      const me = world.players[0];
      hud.setPower(me.charging, me.shotCharge);
      hud.setScore(world.score[0], world.score[1]);
      hud.update(frameDt);
    },
  });

  // Page Visibility API: when the tab comes back, forget the time spent hidden.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loop.resetTiming();
  });

  loop.start();
}

start();
