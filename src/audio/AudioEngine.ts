/**
 * AudioEngine.ts: owns the Web Audio graph and turns simulation events into sound.
 *
 * Everything is synthesised at runtime from oscillators and noise; there are no audio
 * files. The graph looks like this:
 *
 *   Sfx voices ----> sfxBus ---+
 *                              +--> master (mute) --> compressor --> speakers
 *   CrowdAudio ---> crowdBus --+
 *
 * Autoplay: browsers refuse to start an AudioContext until the user has interacted with
 * the page (a click, tap or key press). This stops websites blaring sound on load. So
 * nothing is created until unlock() is called from inside a user-gesture handler, and
 * every method here safely does nothing before that.
 */
import type { SimEvent } from '../sim/events';
import { CrowdAudio } from './CrowdAudio';
import { Sfx } from './Sfx';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: Sfx | null = null;
  private crowd: CrowdAudio | null = null;

  constructor(private muted: boolean) {}

  get isMuted(): boolean {
    return this.muted;
  }

  /** Call from a user gesture (pointerdown, keydown). Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return; // very old browser: play silently
      const ctx = new Ctor();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.ratio.value = 4;
      compressor.connect(ctx.destination);
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.9;
      master.connect(compressor);
      const sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.8;
      sfxBus.connect(master);
      const crowdBus = ctx.createGain();
      crowdBus.gain.value = 0.7;
      crowdBus.connect(master);
      this.ctx = ctx;
      this.master = master;
      this.sfx = new Sfx(ctx, sfxBus);
      this.crowd = new CrowdAudio(ctx, crowdBus);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) {
      // setTargetAtTime glides the volume instead of jumping, which avoids a click.
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.03);
    }
  }

  /** Stop all processing (tab hidden). Saves battery. */
  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Quieter crowd under menus and while paused. */
  setAmbience(level: number): void {
    this.crowd?.setAmbience(level);
  }

  /** Map one simulation event to a sound. `pan` is -1 (left) to 1 (right). */
  handleEvent(event: SimEvent, panFor: (x: number) => number): void {
    const sfx = this.sfx;
    if (!sfx) return;
    switch (event.type) {
      case 'kick':
        if (event.kind === 'touch') sfx.touch(event.power);
        else if (event.kind === 'throw') sfx.thump(0.5);
        else
          sfx.kick(
            event.kind === 'shot' || event.kind === 'punt' || event.kind === 'clearance'
              ? 0.6 + event.power * 0.4
              : 0.45,
          );
        break;
      case 'bounce':
        if (event.surface === 'post') {
          sfx.post(Math.min(1, event.speed / 20), panFor(event.x));
          this.crowd?.ooh();
        } else if (event.surface === 'net') sfx.net(Math.min(1, event.speed / 15), panFor(event.x));
        else if (event.surface === 'board')
          sfx.board(Math.min(1, event.speed / 15), panFor(event.x));
        else if (event.surface === 'ground' && event.speed > 4)
          sfx.thump(Math.min(0.5, event.speed / 30));
        else if (event.surface === 'player') sfx.thump(Math.min(0.7, event.speed / 20));
        break;
      case 'tackle':
        sfx.scuff(event.won ? 0.7 : 0.4);
        break;
      case 'save':
        sfx.thump(0.8);
        this.crowd?.ooh();
        break;
      case 'goal':
        this.crowd?.roar();
        break;
      case 'whistle':
        if (event.kind === 'fullTime') sfx.whistle([0.3, 0.3, 1.0]);
        else if (event.kind === 'goldenGoal') sfx.whistle([0.25, 0.6]);
        else sfx.whistle([0.5]);
        break;
      default:
        break;
    }
  }

  /** Per frame: the crowd swells when the ball is near either goal. */
  update(dt: number, ballX: number, halfLength: number): void {
    const nearGoal = Math.max(0, (Math.abs(ballX) - halfLength * 0.4) / (halfLength * 0.6));
    this.crowd?.update(dt, nearGoal);
  }
}
