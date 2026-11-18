/**
 * Sfx.ts: one-shot sound effects, synthesised from scratch.
 *
 * Each sound is a tiny, short-lived audio graph: a source (oscillator or noise), maybe a
 * filter, a gain node shaped by an "envelope" (how loudness rises and falls over time),
 * and an optional stereo panner. Nodes are created per sound and stop themselves, so the
 * browser garbage-collects them.
 *
 * Envelopes use exponentialRampToValueAtTime, because our ears hear loudness
 * logarithmically: an exponential fade sounds smooth, a linear one sounds like it stops
 * suddenly. Exponential ramps can't reach 0, hence 0.0001.
 */
import { noiseBuffer } from './noise';

const SILENT = 0.0001;

export class Sfx {
  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
  ) {}

  /** Boot on ball: a sine whose pitch drops fast (the "thud") plus a short click of noise. */
  kick(volume: number): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(170, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.13);
    const gain = this.envelope(t, volume, 0.004, 0.2);
    osc.connect(gain).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.22);
    this.noiseBurst(t, volume * 0.35, 0.035, 'bandpass', 2200, 1.2);
  }

  /** A soft dribble touch. */
  touch(power: number): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.06);
    const gain = this.envelope(t, 0.06 + power * 0.08, 0.003, 0.08);
    osc.connect(gain).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /** A dull body or ground impact. */
  thump(volume: number): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.1);
    const gain = this.envelope(t, volume * 0.7, 0.004, 0.16);
    osc.connect(gain).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.18);
    this.noiseBurst(t, volume * 0.25, 0.06, 'lowpass', 600, 0.7);
  }

  /** The ball smacking the boards: low thud plus a wooden knock. */
  board(volume: number, pan: number): void {
    const t = this.ctx.currentTime;
    const panner = this.panner(pan);
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    const gain = this.envelope(t, volume * 0.6, 0.003, 0.18);
    osc.connect(gain).connect(panner);
    osc.start(t);
    osc.stop(t + 0.2);
    this.noiseBurst(t, volume * 0.3, 0.08, 'bandpass', 450, 1.5, panner);
  }

  /**
   * Ball off the woodwork: a metallic "clang". Metal rings at several frequencies that
   * aren't whole-number multiples of each other (inharmonic partials). That's what makes
   * it sound like metal rather than a musical note.
   */
  post(volume: number, pan: number): void {
    const t = this.ctx.currentTime;
    const panner = this.panner(pan);
    for (const [freq, level, decay] of [
      [523, 1, 0.9],
      [1311, 0.6, 0.6],
      [2187, 0.35, 0.4],
      [3410, 0.2, 0.25],
    ]) {
      const osc = this.ctx.createOscillator();
      osc.frequency.value = freq;
      const gain = this.envelope(t, volume * 0.22 * level, 0.002, decay);
      osc.connect(gain).connect(panner);
      osc.start(t);
      osc.stop(t + decay + 0.05);
    }
  }

  /** Ball into the net: a soft swish, filtered noise whose pitch slides down. */
  net(volume: number, pan: number): void {
    const t = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = noiseBuffer(this.ctx, 1, false);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(1600, t);
    filter.frequency.exponentialRampToValueAtTime(350, t + 0.45);
    const gain = this.envelope(t, 0.12 + volume * 0.3, 0.01, 0.5);
    source.connect(filter).connect(gain).connect(this.panner(pan));
    source.start(t);
    source.stop(t + 0.55);
  }

  /** Studs on grass during a tackle. */
  scuff(volume: number): void {
    this.noiseBurst(this.ctx.currentTime, volume * 0.35, 0.18, 'lowpass', 900, 0.8);
  }

  /**
   * The referee's pea whistle. A bright tone around 2.8 kHz whose pitch wobbles quickly
   * (frequency modulation by a 32 Hz oscillator): the pea rattling inside the whistle.
   * `blasts` lists the length of each blast in seconds.
   */
  whistle(blasts: number[]): void {
    let t = this.ctx.currentTime + 0.02;
    for (const length of blasts) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 2800;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 32;
      const depth = this.ctx.createGain();
      depth.gain.value = 140;
      lfo.connect(depth).connect(osc.frequency);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2900;
      filter.Q.value = 3;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(SILENT, t);
      gain.gain.exponentialRampToValueAtTime(0.32, t + 0.02);
      gain.gain.setValueAtTime(0.32, t + length - 0.04);
      gain.gain.exponentialRampToValueAtTime(SILENT, t + length);

      osc.connect(filter).connect(gain).connect(this.out);
      osc.start(t);
      lfo.start(t);
      osc.stop(t + length + 0.02);
      lfo.stop(t + length + 0.02);
      t += length + 0.12;
    }
  }

  // ----- building blocks -----

  /** A gain node that rises to `peak` in `attack` seconds and fades out over `decay`. */
  private envelope(t: number, peak: number, attack: number, decay: number): GainNode {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(SILENT, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, SILENT * 2), t + attack);
    gain.gain.exponentialRampToValueAtTime(SILENT, t + attack + decay);
    return gain;
  }

  private noiseBurst(
    t: number,
    volume: number,
    length: number,
    type: BiquadFilterType,
    frequency: number,
    q: number,
    destination: AudioNode = this.out,
  ): void {
    const source = this.ctx.createBufferSource();
    source.buffer = noiseBuffer(this.ctx, 1, false);
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = this.envelope(t, volume, 0.002, length);
    source.connect(filter).connect(gain).connect(destination);
    source.start(t, Math.random() * 0.5);
    source.stop(t + length + 0.02);
  }

  private panner(pan: number): AudioNode {
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(this.out);
    return panner;
  }
}
