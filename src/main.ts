/**
 * main.ts: entry point. Creates the renderer, input, UI and storage, wires them together
 * and starts the loop. It also owns the app flow: which screen is showing and which match
 * is running.
 *
 *   boot -> menu -> teamSelect -> kickoff/playing/goalScored -> fullTime -> menu ...
 *
 * Behind the menus a CPU vs CPU "attract mode" match keeps playing.
 *
 * Data flow each tick:  input -> HumanController -> Intent -> MatchSession.step() -> Snapshot
 * Each frame:           (previous, current snapshot, alpha) -> GameRenderer, HUD
 */
import type { CpuTeam, Difficulty, Kit } from './config';
import { BALL_DESIGNS, CPU_TEAMS, KITS, SIM } from './config';
import type { CupState } from './core/Cup';
import { createCup, cupOpponent, cupRoundName, recordCupMatch } from './core/Cup';
import type { GameStateName } from './core/GameStateMachine';
import { GameStateMachine } from './core/GameStateMachine';
import { Loop } from './core/Loop';
import { contrastingKit, MatchSession } from './core/MatchSession';
import { SaveStore } from './core/Storage';
import { HumanController } from './input/HumanController';
import { createIntent } from './input/Intent';
import { Keyboard } from './input/Keyboard';
import { GameRenderer } from './render/GameRenderer';
import type { SimEvent } from './sim/events';
import { formatClock } from './sim/match/Clock';
import { possessionPercent } from './sim/match/Stats';
import type { MatchPhase } from './sim/types';
import { el } from './ui/dom';
import { Hud } from './ui/Hud';
import type { MatchChoice } from './ui/Menus';
import { Menus } from './ui/Menus';

const PHASE_TO_STATE: Record<MatchPhase, GameStateName> = {
  kickoff: 'kickoff',
  playing: 'playing',
  goal: 'goalScored',
  fullTime: 'fullTime',
};

/** Seconds of "Full time" banner before the stats screen appears. */
const FULL_TIME_PAUSE = 2.2;
/** Seconds before a finished attract-mode match restarts. */
const ATTRACT_RESTART = 4;

type Mode = 'attract' | 'quick' | 'cup';

function randomSeed(): number {
  // Outside src/sim, Math.random() is fine: it only picks the seed.
  return Math.floor(Math.random() * 1e9);
}

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

  const save = SaveStore.forBrowser();
  const keyboard = new Keyboard(window);
  const human = new HumanController(keyboard);
  const humanIntent = createIntent();
  const machine = new GameStateMachine();
  const hud = new Hud(uiRoot);
  const menus = new Menus(uiRoot);
  const attractTag = el('div', 'attract-tag', 'CPU vs CPU');
  uiRoot.append(attractTag);
  hud.setHelp([
    'WASD / arrows: move   Shift: sprint',
    'J: pass   I: through ball   K: shoot (hold)',
    'L: tackle (+Shift: slide)   Q: switch',
    'P / Esc: pause',
  ]);

  let mode: Mode = 'attract';
  let session = createAttractSession();
  let difficulty: Difficulty = 'normal';
  let cup: CupState | null = null;
  let cupChoice: MatchChoice | null = null;
  let lastChoice: MatchChoice | null = null;
  let fullTimeTimer = 0;
  let attractRestartTimer = 0;
  let unlocksThisMatch: string[] = [];

  // ----- sessions -----

  function createAttractSession(): MatchSession {
    const homeKit = KITS[Math.floor(Math.random() * 4)];
    const opponent = CPU_TEAMS[Math.floor(Math.random() * CPU_TEAMS.length)];
    const awayKit = contrastingKit(homeKit, opponent.kits);
    return new MatchSession({
      seed: randomSeed(),
      minutes: 2,
      goldenGoal: false,
      home: { name: homeKit.name, short: homeKit.short, kit: homeKit },
      away: { name: opponent.name, short: opponent.short, kit: awayKit },
      cpuDifficulty: 'normal',
      humanPlays: false,
    });
  }

  function useSession(next: MatchSession, ballId: string): void {
    session = next;
    const { home, away } = session.setup;
    const ball = BALL_DESIGNS.find((b) => b.id === ballId) ?? BALL_DESIGNS[0];
    renderer.setMatch(session.current, [home.kit, away.kit], ball);
    renderer.cameraSubjectId = null;
    hud.setTeams(home.short, home.kit.shirt, away.short, away.kit.shirt);
  }

  function startAttract(): void {
    mode = 'attract';
    useSession(createAttractSession(), BALL_DESIGNS[0].id);
    renderer.cameraRig.setMode('attract');
    hud.setVisible(false);
    hud.hideBanner();
    attractTag.style.display = '';
    attractRestartTimer = 0;
  }

  function startMatch(
    choice: MatchChoice,
    opponent: CpuTeam,
    cpuLevel: Difficulty,
    goldenGoal: boolean,
  ): void {
    const kit: Kit = KITS.find((k) => k.id === choice.kitId) ?? KITS[0];
    const awayKit = contrastingKit(kit, opponent.kits);
    difficulty = cpuLevel;
    useSession(
      new MatchSession({
        seed: randomSeed(),
        minutes: choice.minutes,
        goldenGoal,
        home: { name: kit.name, short: kit.short, kit },
        away: { name: opponent.name, short: opponent.short, kit: awayKit },
        cpuDifficulty: cpuLevel,
        humanPlays: true,
      }),
      choice.ballId,
    );
    menus.hide();
    hud.setVisible(true);
    hud.hideBanner();
    attractTag.style.display = 'none';
    renderer.cameraRig.setMode('broadcast');
    keyboard.clearPresses();
    fullTimeTimer = 0;
    unlocksThisMatch = [];
    machine.transition('kickoff');
    const round = mode === 'cup' && cup ? `${cupRoundName(cup)} · ` : '';
    hud.showBanner(`${kit.short} v ${opponent.short}`, `${round}${cpuLevel}`, 1.6);
  }

  // ----- menu flow -----

  function leaveBoot(): void {
    if (machine.current !== 'boot') return;
    showMainMenu();
  }

  function showMainMenu(): void {
    if (mode !== 'attract') startAttract();
    machine.transition('menu');
    menus.showMain({
      quickMatch: showQuickSelect,
      cup: showCupSelect,
      records: () => menus.showRecords(save, showMainMenu),
      controls: () => menus.showControls(showMainMenu),
    });
  }

  function showQuickSelect(): void {
    machine.transition('teamSelect');
    menus.showTeamSelect({
      mode: 'quick',
      save,
      onBack: showMainMenu,
      onStart: (choice) => {
        save.updateSettings(choice);
        lastChoice = { ...choice };
        mode = 'quick';
        const opponent = CPU_TEAMS.find((t) => t.difficulty === choice.difficulty) ?? CPU_TEAMS[1];
        startMatch(choice, opponent, choice.difficulty, false);
      },
    });
  }

  function showCupSelect(): void {
    machine.transition('teamSelect');
    menus.showTeamSelect({
      mode: 'cup',
      save,
      onBack: showMainMenu,
      onStart: (choice) => {
        save.updateSettings({
          kitId: choice.kitId,
          ballId: choice.ballId,
          minutes: choice.minutes,
        });
        cup = createCup();
        cupChoice = { ...choice };
        showCupLadder();
      },
    });
  }

  function showCupLadder(): void {
    if (!cup || !cupChoice) {
      showMainMenu();
      return;
    }
    if (mode !== 'attract') startAttract();
    machine.transition('teamSelect');
    const kitName = KITS.find((k) => k.id === cupChoice?.kitId)?.name ?? 'Your team';
    menus.showCupLadder(cup, kitName, playCupRound, () => {
      cup = null;
      showMainMenu();
    });
  }

  function playCupRound(): void {
    if (!cup || !cupChoice) return;
    mode = 'cup';
    const opponent = cupOpponent(cup);
    startMatch(cupChoice, opponent, opponent.difficulty, true);
  }

  // ----- pause -----

  function pause(): void {
    if (mode === 'attract') return;
    if (machine.pause()) menus.showPause(resume, quitToMenu);
  }

  function resume(): void {
    if (!machine.resume()) return;
    menus.hide();
    keyboard.clearPresses();
  }

  function quitToMenu(): void {
    cup = null;
    showMainMenu();
  }

  // ----- full time -----

  /** Record the result once, the moment the final whistle blows. */
  function onFinalWhistle(): void {
    if (mode === 'attract') {
      attractRestartTimer = ATTRACT_RESTART;
      return;
    }
    const [home, away] = session.world.match.score;
    unlocksThisMatch = save.recordMatch(difficulty, session.result());
    if (mode === 'cup' && cup) {
      recordCupMatch(cup, home, away);
      if (cup.status === 'champion') unlocksThisMatch.push(...save.recordCupWin());
    }
    hud.showBanner('Full time', `${home} - ${away}`, FULL_TIME_PAUSE);
    fullTimeTimer = FULL_TIME_PAUSE;
  }

  function showFullTimeScreen(): void {
    const { world, setup } = session;
    const result = session.result();
    const actions: Array<{ label: string; primary?: boolean; run: () => void }> = [];
    let title = result === 'win' ? 'YOU WIN' : result === 'draw' ? 'DRAW' : 'YOU LOSE';
    let note = `Win streak: ${save.data.currentStreak} (best ${save.data.longestStreak})`;

    if (mode === 'cup' && cup) {
      if (cup.status === 'champion') {
        title = 'CUP WINNERS!';
        note = `Cups won: ${save.data.cupWins}`;
        actions.push({ label: 'Main menu', primary: true, run: quitToMenu });
      } else if (cup.status === 'eliminated') {
        title = 'KNOCKED OUT';
        actions.push({ label: 'Main menu', primary: true, run: quitToMenu });
      } else {
        title = 'THROUGH TO THE NEXT ROUND';
        actions.push({ label: 'Main menu', run: quitToMenu });
        actions.push({ label: 'Continue', primary: true, run: showCupLadder });
      }
    } else {
      actions.push({ label: 'Main menu', run: quitToMenu });
      actions.push({
        label: 'Rematch',
        primary: true,
        run: () => {
          const opponent = CPU_TEAMS.find((t) => t.difficulty === difficulty) ?? CPU_TEAMS[1];
          if (lastChoice) startMatch(lastChoice, opponent, difficulty, false);
        },
      });
    }

    menus.showFullTime({
      title,
      homeName: setup.home.short,
      awayName: setup.away.short,
      score: [world.match.score[0], world.match.score[1]],
      possession: possessionPercent(world.stats),
      stats: world.stats,
      unlocks: unlocksThisMatch,
      note,
      actions,
    });
  }

  // ----- simulation events -----

  function onSimEvent(event: SimEvent): void {
    renderer.handleEvent(event);
    if (mode === 'attract') {
      if (event.type === 'whistle' && event.kind === 'fullTime') onFinalWhistle();
      return;
    }
    const { world } = session;
    if (event.type === 'goal') {
      const team = world.teams[event.team];
      const subtitle = event.ownGoal ? `own goal · ${team.short} score` : team.name;
      hud.showBanner('Goal!', subtitle, 2.8);
      renderer.cameraSubjectId = event.scorerId;
      renderer.cameraRig.setMode('celebration');
    } else if (event.type === 'whistle' && event.kind === 'goldenGoal') {
      hud.showBanner('Golden goal', 'next goal wins', 2.5);
    } else if (event.type === 'whistle' && event.kind === 'fullTime') {
      onFinalWhistle();
    }
  }

  // ----- loop -----

  function update(dt: number): void {
    if (machine.current === 'paused') return;

    if (mode === 'attract') {
      session.step(null);
      for (const event of session.world.events) onSimEvent(event);
      if (attractRestartTimer > 0) {
        attractRestartTimer -= dt;
        if (attractRestartTimer <= 0) startAttract();
      }
      return;
    }

    human.sample(humanIntent);
    session.step(humanIntent);
    for (const event of session.world.events) onSimEvent(event);

    const phaseState = PHASE_TO_STATE[session.world.match.phase];
    if (phaseState !== machine.current && machine.inMatch) {
      if (phaseState === 'kickoff') renderer.cameraRig.setMode('broadcast');
      machine.transition(phaseState);
    }
  }

  function render(alpha: number, frameDt: number): void {
    renderer.render(session.previous, session.current, alpha, frameDt);
    hud.update(frameDt);
    if (mode === 'attract') return;

    const { world } = session;
    const me = world.players[world.teams[0].controlledId];
    hud.setPower(me?.charging ?? false, me?.shotCharge ?? 0);
    hud.setScore(world.match.score[0], world.match.score[1]);
    hud.setClock(formatClock(world.match));
    hud.help.style.display = machine.current === 'kickoff' ? '' : 'none';

    if (fullTimeTimer > 0) {
      fullTimeTimer -= frameDt;
      if (fullTimeTimer <= 0 && machine.current === 'fullTime') showFullTimeScreen();
    }
  }

  // ----- input outside the match -----

  keyboard.onPress((code) => {
    if (machine.current === 'boot') {
      leaveBoot();
      return;
    }
    if (menus.isOpen) {
      if (code === 'ArrowDown' || code === 'ArrowRight') menus.moveFocus(1);
      else if (code === 'ArrowUp' || code === 'ArrowLeft') menus.moveFocus(-1);
      else if (code === 'Escape') menus.back();
      else if (code === 'KeyP' && machine.current === 'paused') resume();
      return;
    }
    if (code === 'KeyP' || code === 'Escape') pause();
  });

  window.addEventListener('pointerdown', () => leaveBoot());

  // Page Visibility API: pause automatically when the tab is hidden.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else loop.resetTiming();
  });

  const loop = new Loop(SIM.dt, { update, render });
  startAttract();
  menus.showBoot(leaveBoot);
  loop.start();
}

start();
