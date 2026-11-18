/**
 * Menus.ts: every full-screen menu. Boot, main menu, team select, cup ladder, pause,
 * full time, records and controls.
 *
 * One screen is shown at a time inside a container over the canvas (the CPU vs CPU
 * attract match keeps playing behind the menus). Screens are plain <button> elements, so
 * mouse, touch and screen readers work out of the box. For keyboard and gamepad,
 * moveFocus() walks the focusable elements in order, activate() clicks the focused one
 * and back() runs the screen's back action.
 */
import type { Difficulty } from '../config';
import { BALL_DESIGNS, CUP_ROUNDS, KITS, MATCH } from '../config';
import type { CupState } from '../core/Cup';
import { cupOpponent } from '../core/Cup';
import type { SaveStore } from '../core/Storage';
import { DIFFICULTIES, DIFFICULTY_BLURBS } from '../sim/ai/Difficulty';
import type { TeamStats } from '../sim/types';
import { button, el } from './dom';

export interface MatchChoice {
  kitId: string;
  ballId: string;
  difficulty: Difficulty;
  minutes: number;
}

export interface FullTimeSummary {
  title: string;
  homeName: string;
  awayName: string;
  score: [number, number];
  possession: [number, number];
  stats: [TeamStats, TeamStats];
  unlocks: string[];
  note: string;
  actions: Array<{ label: string; primary?: boolean; run: () => void }>;
}

interface Option<T> {
  value: T;
  label: string;
  swatch?: string;
  ball?: { base: string; panel: string };
  disabled?: boolean;
  title?: string;
}

const UNLOCK_HINT: Record<string, string> = {
  easy: 'Win a match on Easy',
  normal: 'Win a match on Normal',
  hard: 'Win a match on Hard',
  cup: 'Win the Cup',
};

export class Menus {
  readonly root = el('div');
  private screen: HTMLElement | null = null;
  private onBack: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return this.screen !== null;
  }

  hide(): void {
    this.screen?.remove();
    this.screen = null;
    this.onBack = null;
  }

  // ----- navigation (keyboard / gamepad) -----

  moveFocus(delta: number): void {
    if (!this.screen) return;
    const items = Array.from(
      this.screen.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = index < 0 ? 0 : (index + delta + items.length) % items.length;
    items[next].focus();
  }

  activate(): void {
    const focused = document.activeElement;
    if (focused instanceof HTMLButtonElement && this.screen?.contains(focused)) focused.click();
  }

  back(): void {
    this.onBack?.();
  }

  // ----- screens -----

  showBoot(onStart: () => void): void {
    const card = this.open('screen', null);
    const inner = el('div', 'card boot-prompt');
    inner.append(title(), el('p', 'subtitle', 'Arcade 5-a-side. Boards, no throw-ins, no mercy.'));
    const start = button('Press any key or tap to start', 'btn primary pulse', onStart);
    inner.append(
      start,
      el('p', 'note', 'Sound starts after this first press, because browsers block autoplay.'),
    );
    card.append(inner);
    start.focus();
  }

  showMain(handlers: {
    quickMatch: () => void;
    cup: () => void;
    records: () => void;
    controls: () => void;
  }): void {
    const screen = this.open('screen', null);
    const card = el('div', 'card');
    const list = el('div', 'menu-list');
    list.append(
      button('Quick Match', 'btn primary', handlers.quickMatch),
      button('Cup', 'btn', handlers.cup),
      button('Records', 'btn', handlers.records),
      button('Controls', 'btn', handlers.controls),
    );
    card.append(title(), el('p', 'subtitle', 'Choose a mode'), list);
    screen.append(card);
    this.focusFirst();
  }

  showTeamSelect(options: {
    mode: 'quick' | 'cup';
    save: SaveStore;
    onStart: (choice: MatchChoice) => void;
    onBack: () => void;
  }): void {
    const { save } = options;
    const choice: MatchChoice = { ...save.data.settings };
    const screen = this.open('screen', options.onBack);
    const card = el('div', 'card');
    card.append(el('h2', '', options.mode === 'quick' ? 'Quick Match' : 'Cup: pick your kit'));

    card.append(
      this.optionGroup(
        'Your kit',
        KITS.map((k) => ({
          value: k.id,
          label: k.name,
          swatch: k.shirt,
          disabled: !save.isUnlocked(k),
          title: k.unlock ? `Unlock: ${UNLOCK_HINT[k.unlock]}` : undefined,
        })),
        choice.kitId,
        (v) => (choice.kitId = v),
      ),
    );

    if (options.mode === 'quick') {
      const blurb = el('p', 'note', DIFFICULTY_BLURBS[choice.difficulty]);
      card.append(
        this.optionGroup(
          'CPU difficulty',
          DIFFICULTIES.map((d) => ({ value: d, label: d[0].toUpperCase() + d.slice(1) })),
          choice.difficulty,
          (v) => {
            choice.difficulty = v;
            blurb.textContent = DIFFICULTY_BLURBS[v];
          },
        ),
        blurb,
      );
    }

    card.append(
      this.optionGroup(
        'Match length (real minutes)',
        MATCH.lengthOptions.map((m) => ({ value: m, label: `${m} min` })),
        choice.minutes,
        (v) => (choice.minutes = v),
      ),
      this.optionGroup(
        'Ball',
        BALL_DESIGNS.map((b) => ({
          value: b.id,
          label: b.name,
          ball: { base: b.base, panel: b.panel },
          disabled: !save.isUnlocked(b),
          title: b.unlock ? `Unlock: ${UNLOCK_HINT[b.unlock]}` : undefined,
        })),
        choice.ballId,
        (v) => (choice.ballId = v),
      ),
    );

    const row = el('div', 'row');
    row.append(
      button('Back', 'btn', options.onBack),
      button(options.mode === 'quick' ? 'Kick off' : 'Enter the Cup', 'btn primary', () =>
        options.onStart(choice),
      ),
    );
    card.append(row);
    screen.append(card);
    (card.querySelector('.btn.primary') as HTMLButtonElement | null)?.focus();
  }

  showCupLadder(cup: CupState, kitName: string, onPlay: () => void, onQuit: () => void): void {
    const screen = this.open('screen', onQuit);
    const card = el('div', 'card');
    card.append(el('h2', '', `The Cup: ${kitName}`));
    const ladder = el('ul', 'cup-ladder');
    CUP_ROUNDS.forEach((round, i) => {
      const item = el('li');
      const result = cup.results[i];
      const opponent = cupOpponent({ ...cup, round: i });
      item.append(el('span', '', `${round.name}: vs ${opponent.name}`));
      if (result) {
        item.className = 'done';
        item.append(
          el('strong', '', `${result.goalsFor}-${result.goalsAgainst} ${result.won ? 'W' : 'L'}`),
        );
      } else if (i === cup.round && cup.status === 'inProgress') {
        item.className = 'current';
        item.append(el('strong', '', opponent.difficulty.toUpperCase()));
      } else {
        item.append(el('span', 'note', opponent.difficulty));
      }
      ladder.append(item);
    });
    card.append(ladder);
    card.append(
      el('p', 'note', 'Knockout: lose once and you are out. Drawn matches go to golden goal.'),
    );
    const row = el('div', 'row');
    row.append(
      button('Abandon cup', 'btn', onQuit),
      button('Play next round', 'btn primary', onPlay),
    );
    card.append(row);
    screen.append(card);
    (card.querySelector('.btn.primary') as HTMLButtonElement | null)?.focus();
  }

  showPause(onResume: () => void, onQuit: () => void): void {
    const screen = this.open('screen dim', onResume);
    const card = el('div', 'card');
    const list = el('div', 'menu-list');
    list.append(button('Resume', 'btn primary', onResume), button('Quit to menu', 'btn', onQuit));
    card.append(
      el('h2', '', 'Paused'),
      list,
      el('p', 'note', 'P or Esc to resume. M toggles sound.'),
    );
    screen.append(card);
    this.focusFirst();
  }

  showFullTime(summary: FullTimeSummary): void {
    const screen = this.open('screen dim', null);
    const card = el('div', 'card');
    card.append(el('div', 'result-tag', summary.title));
    card.append(el('div', 'final-score', `${summary.score[0]} - ${summary.score[1]}`));

    const table = el('table', 'stats-table');
    const head = el('tr');
    head.append(el('th', '', summary.homeName), el('th', '', ''), el('th', '', summary.awayName));
    table.append(head);
    const [a, b] = summary.stats;
    const rows: Array<[string, string, string]> = [
      [`${summary.possession[0]}%`, 'Possession', `${summary.possession[1]}%`],
      [`${a.shots}`, 'Shots', `${b.shots}`],
      [`${a.shotsOnTarget}`, 'On target', `${b.shotsOnTarget}`],
      [`${a.passesCompleted}/${a.passes}`, 'Passes completed', `${b.passesCompleted}/${b.passes}`],
      [`${a.tacklesWon}`, 'Tackles won', `${b.tacklesWon}`],
      [`${a.saves}`, 'Saves', `${b.saves}`],
    ];
    for (const [left, label, right] of rows) {
      const tr = el('tr');
      tr.append(el('td', '', left), el('td', '', label), el('td', '', right));
      table.append(tr);
    }
    card.append(table);

    if (summary.unlocks.length > 0) {
      const box = el('div', 'unlock-list');
      box.append(
        el('strong', '', 'Unlocked: '),
        document.createTextNode(summary.unlocks.join(', ')),
      );
      card.append(box);
    }
    if (summary.note) card.append(el('p', 'note', summary.note));
    const row = el('div', 'row');
    for (const action of summary.actions) {
      row.append(button(action.label, action.primary ? 'btn primary' : 'btn', action.run));
    }
    card.append(row);
    screen.append(card);
    (card.querySelector('.btn.primary') as HTMLButtonElement | null)?.focus();
  }

  showRecords(save: SaveStore, onBack: () => void): void {
    const screen = this.open('screen', onBack);
    const card = el('div', 'card');
    card.append(el('h2', '', 'Records'));
    const table = el('table', 'stats-table');
    const head = el('tr');
    for (const h of ['Difficulty', 'W', 'D', 'L']) head.append(el('th', '', h));
    table.append(head);
    for (const d of DIFFICULTIES) {
      const r = save.data.records[d];
      const tr = el('tr');
      tr.append(
        el('td', '', d),
        el('td', '', `${r.wins}`),
        el('td', '', `${r.draws}`),
        el('td', '', `${r.losses}`),
      );
      table.append(tr);
    }
    card.append(table);
    const unlockedKits = KITS.filter((k) => save.isUnlocked(k)).length;
    const unlockedBalls = BALL_DESIGNS.filter((b) => save.isUnlocked(b)).length;
    const list = el('div', 'menu-list');
    list.append(
      el('div', '', `Cups won: ${save.data.cupWins}`),
      el(
        'div',
        '',
        `Longest win streak: ${save.data.longestStreak} (current ${save.data.currentStreak})`,
      ),
      el(
        'div',
        '',
        `Kits unlocked: ${unlockedKits}/${KITS.length}   Balls unlocked: ${unlockedBalls}/${BALL_DESIGNS.length}`,
      ),
    );
    card.append(list, el('p', 'note', 'Records are saved in this browser (localStorage).'));
    const row = el('div', 'row');
    row.append(button('Back', 'btn primary', onBack));
    card.append(row);
    screen.append(card);
    this.focusFirst();
  }

  showControls(onBack: () => void): void {
    const screen = this.open('screen', onBack);
    const card = el('div', 'card');
    card.append(el('h2', '', 'Controls'));
    const table = el('table', 'stats-table');
    const rows: Array<[string, string, string]> = [
      ['Action', 'Keyboard', 'Gamepad'],
      ['Move', 'WASD / arrows', 'Left stick / d-pad'],
      ['Sprint', 'Shift', 'RT / RB'],
      ['Pass', 'J', 'A'],
      ['Through ball', 'I', 'Y'],
      ['Shoot (hold to charge)', 'K', 'B'],
      ['Tackle (sprint = slide)', 'L', 'X'],
      ['Switch player', 'Q', 'LB'],
      ['Pause', 'P / Esc', 'Start'],
      ['Mute', 'M', 'Back / View'],
    ];
    rows.forEach((cells, i) => {
      const tr = el('tr');
      for (const cell of cells) tr.append(el(i === 0 ? 'th' : 'td', '', cell));
      table.append(tr);
    });
    card.append(
      table,
      el('p', 'note', 'On touch screens: drag on the left to move, buttons on the right.'),
    );
    const row = el('div', 'row');
    row.append(button('Back', 'btn primary', onBack));
    card.append(row);
    screen.append(card);
    this.focusFirst();
  }

  // ----- helpers -----

  private open(className: string, onBack: (() => void) | null): HTMLElement {
    this.hide();
    const screen = el('div', className);
    this.screen = screen;
    this.onBack = onBack;
    this.root.append(screen);
    return screen;
  }

  private focusFirst(): void {
    this.screen?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  /** A labelled row of toggle buttons; exactly one is pressed (aria-pressed). */
  private optionGroup<T>(
    label: string,
    options: Option<T>[],
    selected: T,
    onChange: (value: T) => void,
  ): HTMLElement {
    const field = el('div', 'field');
    field.append(el('span', 'label', label));
    const group = el('div', 'option-group');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    const buttons: HTMLButtonElement[] = [];
    for (const option of options) {
      const b = el('button', 'option');
      b.type = 'button';
      if (option.swatch) {
        const swatch = el('span', 'swatch');
        swatch.style.background = option.swatch;
        b.append(swatch);
      }
      if (option.ball) {
        const swatch = el('span', 'ball-swatch');
        swatch.style.background = option.ball.base;
        swatch.style.borderColor = option.ball.panel;
        b.append(swatch);
      }
      b.append(
        document.createTextNode(option.disabled ? `${option.label} (locked)` : option.label),
      );
      b.disabled = option.disabled ?? false;
      if (option.title) b.title = option.title;
      b.setAttribute('aria-pressed', String(option.value === selected));
      b.addEventListener('click', () => {
        for (const other of buttons) other.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
        onChange(option.value);
      });
      buttons.push(b);
      group.append(b);
    }
    field.append(group);
    return field;
  }
}

function title(): HTMLElement {
  const h = el('h1', 'title');
  h.append(document.createTextNode('REBOUND '), el('span', '', 'FIVE'));
  return h;
}
