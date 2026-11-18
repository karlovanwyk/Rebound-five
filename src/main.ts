/**
 * main.ts: entry point. Wires the simulation, input, renderer and HUD together and
 * starts the loop.
 *
 * Milestone 3: a full match against the CPU (Normal difficulty), with AI teammates and
 * AI goalkeepers. You control one player; the AI runs everyone else through Intents.
 *
 * Data flow each tick:  keyboard -> HumanController -> Intent -> stepWorld() -> Snapshot
 * Each frame:           (previous, current snapshot, alpha) -> GameRenderer
 */
import { BALL_DESIGNS, KITS, SIM } from './config';
import type { GameStateName } from './core/GameStateMachine';
import { GameStateMachine } from './core/GameStateMachine';
import { Loop } from './core/Loop';
import { HumanController } from './input/HumanController';
import { createIntent } from './input/Intent';
import { Keyboard } from './input/Keyboard';
import { GameRenderer } from './render/GameRenderer';
import { AIController } from './sim/ai/AIController';
import { presetFor } from './sim/ai/Difficulty';
import type { SimEvent } from './sim/events';
import { formatClock } from './sim/match/Clock';
import { captureSnapshot, copySnapshot, createSnapshot } from './sim/Snapshot';
import type { MatchPhase, World } from './sim/types';
import { createWorld, stepWorld } from './sim/World';
import { Hud } from './ui/Hud';

const PHASE_TO_STATE: Record<MatchPhase, GameStateName> = {
  kickoff: 'kickoff',
  playing: 'playing',
  goal: 'goalScored',
  fullTime: 'fullTime',
};

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

  const homeKit = KITS[0];
  const awayKit = KITS[1];
  const keyboard = new Keyboard(window);
  const human = new HumanController(keyboard);
  const humanIntent = createIntent();
  const machine = new GameStateMachine();
  const hud = new Hud(uiRoot);
  hud.setTeams(homeKit.short, homeKit.shirt, awayKit.short, awayKit.shirt);
  hud.setHelp([
    'WASD / arrows: move   Shift: sprint',
    'J: pass   I: through ball   K: shoot (hold)',
    'L: tackle (+Shift: slide)   Q: switch',
    'P / Esc: pause',
  ]);

  // Outside src/sim, Math.random() is fine: it only picks the seed.
  let seed = Math.floor(Math.random() * 1e9);
  function createMatchWorld(): World {
    return createWorld({
      seed,
      matchMinutes: 3,
      teamNames: [homeKit.name, awayKit.name],
      teamShorts: [homeKit.short, awayKit.short],
    });
  }

  let world = createMatchWorld();
  let intents = world.players.map(() => createIntent());
  let previous = createSnapshot(world);
  let current = createSnapshot(world);
  // Your AI teammates play at Normal; the CPU opponent at the chosen difficulty.
  let teammateAI = new AIController(world, 0, presetFor('normal'), seed + 1);
  let cpuAI = new AIController(world, 1, presetFor('normal'), seed + 2);

  function newMatch(): void {
    seed = Math.floor(Math.random() * 1e9);
    world = createMatchWorld();
    intents = world.players.map(() => createIntent());
    teammateAI = new AIController(world, 0, presetFor('normal'), seed + 1);
    cpuAI = new AIController(world, 1, presetFor('normal'), seed + 2);
    previous = createSnapshot(world);
    current = createSnapshot(world);
    renderer.setMatch(current, [homeKit, awayKit], BALL_DESIGNS[0]);
    renderer.cameraRig.setMode('broadcast');
    machine.transition('kickoff');
  }

  function onSimEvent(event: SimEvent): void {
    renderer.handleEvent(event);
    if (event.type === 'goal') {
      const team = world.teams[event.team];
      hud.showBanner('Goal!', event.ownGoal ? `own goal - ${team.short}` : team.name, 2.6);
      renderer.cameraSubjectId = event.scorerId;
      renderer.cameraRig.setMode('celebration');
    } else if (event.type === 'whistle' && event.kind === 'kickoff') {
      renderer.cameraRig.setMode('broadcast');
    } else if (event.type === 'whistle' && event.kind === 'fullTime') {
      const [a, b] = world.match.score;
      hud.showBanner('Full time', `${a} - ${b}   press Enter to play again`, 999);
    }
  }

  function update(): void {
    if (!machine.inMatch && machine.current !== 'fullTime') return;
    if (machine.current === 'paused') return;

    copySnapshot(previous, current);
    // The AI fills in everyone's Intent except the player the human controls, whose
    // Intent comes from the keyboard. Both go through exactly the same sim rules.
    const controlled = world.teams[0].controlledId;
    teammateAI.update(world, intents, controlled);
    cpuAI.update(world, intents);
    human.sample(humanIntent);
    if (controlled >= 0) Object.assign(intents[controlled], humanIntent);

    stepWorld(world, intents);
    captureSnapshot(world, current);
    for (const event of world.events) onSimEvent(event);

    const phaseState = PHASE_TO_STATE[world.match.phase];
    if (phaseState !== machine.current) {
      if (phaseState === 'kickoff') renderer.cameraRig.setMode('broadcast');
      machine.transition(phaseState);
    }
  }

  function render(alpha: number, frameDt: number): void {
    renderer.render(previous, current, alpha, frameDt);
    const me = world.players[world.teams[0].controlledId];
    hud.setPower(me?.charging ?? false, me?.shotCharge ?? 0);
    hud.setScore(world.match.score[0], world.match.score[1]);
    hud.setClock(world.match.goldenGoal ? 'GOLDEN' : formatClock(world.match));
    hud.update(frameDt);
  }

  function togglePause(): void {
    if (machine.current === 'paused') {
      machine.resume();
      hud.hideBanner();
      keyboard.clearPresses();
    } else if (machine.pause()) {
      hud.showBanner('Paused', 'press P or Esc to resume', 9999);
    }
  }

  keyboard.onPress((code) => {
    if (code === 'KeyP' || code === 'Escape') togglePause();
    if (code === 'Enter' && machine.current === 'fullTime') {
      hud.hideBanner();
      newMatch();
    }
  });

  // Page Visibility API: pause automatically when the tab is hidden.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (machine.pause()) hud.showBanner('Paused', 'press P or Esc to resume', 9999);
    } else {
      loop.resetTiming();
    }
  });

  const loop = new Loop(SIM.dt, { update, render });
  newMatch();
  loop.start();
}

start();
