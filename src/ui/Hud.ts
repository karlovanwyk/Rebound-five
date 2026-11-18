/**
 * Hud.ts: the in-match overlay. Scoreboard, clock, shot power bar, banners and toasts.
 *
 * It's plain HTML and CSS positioned over the WebGL canvas (see styles.css). Updating
 * text in a few DOM nodes is cheap, as long as we only touch the DOM when a value has
 * actually changed. That's what the `last*` fields are for, so we don't trigger
 * style/layout work 60 times a second for nothing.
 */
import { el } from './dom';

export class Hud {
  readonly root = el('div', 'hud');
  private readonly scoreboard = el('div', 'scoreboard');
  private readonly homeName = el('span');
  private readonly awayName = el('span');
  private readonly homeChip = el('span', 'chip');
  private readonly awayChip = el('span', 'chip');
  private readonly scoreText = el('div', 'score', '0 - 0');
  private readonly clockText = el('div', 'clock', "0'");
  private readonly banner = el('div', 'banner');
  private readonly power = el('div', 'power');
  private readonly powerFill = el('div', 'fill');
  private readonly toastBox = el('div', 'toast');
  readonly help = el('div', 'help');
  private lastScore = '';
  private lastClock = '';
  private lastPower = -1;
  private bannerTimer = 0;
  private toastTimer = 0;

  constructor(parent: HTMLElement) {
    const home = el('div', 'team');
    home.append(this.homeChip, this.homeName);
    const away = el('div', 'team');
    away.append(this.awayName, this.awayChip);
    this.scoreboard.append(home, this.scoreText, away, this.clockText);
    this.power.append(this.powerFill);
    this.root.append(this.scoreboard, this.banner, this.power, this.toastBox, this.help);
    parent.append(this.root);
  }

  setTeams(homeShort: string, homeColour: string, awayShort: string, awayColour: string): void {
    this.homeName.textContent = homeShort;
    this.awayName.textContent = awayShort;
    this.homeChip.style.background = homeColour;
    this.awayChip.style.background = awayColour;
  }

  setScore(home: number, away: number): void {
    const text = `${home} - ${away}`;
    if (text === this.lastScore) return;
    this.lastScore = text;
    this.scoreText.textContent = text;
  }

  setClock(text: string): void {
    if (text === this.lastClock) return;
    this.lastClock = text;
    this.clockText.textContent = text;
  }

  setScoreboardVisible(visible: boolean): void {
    this.scoreboard.style.display = visible ? '' : 'none';
  }

  /** Shot power bar: visible while charging, value 0..1. */
  setPower(visible: boolean, value: number): void {
    const rounded = visible ? Math.round(value * 100) : -1;
    if (rounded === this.lastPower) return;
    this.lastPower = rounded;
    this.power.classList.toggle('show', visible);
    if (visible) this.powerFill.style.width = `${rounded}%`;
  }

  showBanner(text: string, subtitle = '', seconds = 2): void {
    this.banner.replaceChildren(document.createTextNode(text));
    if (subtitle) this.banner.append(el('small', '', subtitle));
    this.banner.classList.add('show');
    this.bannerTimer = seconds;
  }

  hideBanner(): void {
    this.banner.classList.remove('show');
    this.bannerTimer = 0;
  }

  toast(text: string, seconds = 3): void {
    this.toastBox.textContent = text;
    this.toastBox.classList.add('show');
    this.toastTimer = seconds;
  }

  setHelp(lines: string[]): void {
    this.help.replaceChildren(...lines.map((line) => el('div', '', line)));
  }

  /** Count down banner and toast timers. Called every frame with real time. */
  update(dt: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastBox.classList.remove('show');
    }
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }
}
