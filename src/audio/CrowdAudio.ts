/**
 * CrowdAudio.ts: the crowd, built entirely from filtered noise.
 *
 * Two looping layers of pink noise:
 *  - a "murmur" through a broad band-pass around 600 Hz: the constant hubbub of a crowd;
 *  - an "excitement" layer through a brighter, narrower band-pass around 1.1 kHz, whose
 *    volume follows how close the ball is to a goal. The crowd rises as an attack builds.
 * A slow oscillator nudges the murmur filter up and down so it never sounds static.
 *
 * Goals trigger a roar (the excitement layer jumps up, then decays over a few seconds).
 * Saves and woodwork trigger an "ooh": a quick upward then downward filter sweep, like
 * thousands of people drawing breath.
 */
import { noiseBuffer } from './noise';

export class CrowdAudio {
  private readonly murmurGain: GainNode;
  private readonly excitementGain: GainNode;
  private readonly excitementFilter: BiquadFilterNode;
  private ambience = 1;
  private excitement = 0;
  private roarLevel = 0;

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
  ) {
    const buffer = noiseBuffer(ctx, 4, true);

    const murmur = ctx.createBufferSource();
    murmur.buffer = buffer;
    murmur.loop = true;
    const murmurFilter = ctx.createBiquadFilter();
    murmurFilter.type = 'bandpass';
    murmurFilter.frequency.value = 600;
    murmurFilter.Q.value = 0.5;
    this.murmurGain = ctx.createGain();
    this.murmurGain.gain.value = 0.18;
    murmur.connect(murmurFilter).connect(this.murmurGain).connect(out);

    // Slow wobble of the murmur's filter: a low-frequency oscillator (LFO).
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.21;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 120;
    lfo.connect(lfoDepth).connect(murmurFilter.frequency);

    const excited = ctx.createBufferSource();
    excited.buffer = buffer;
    excited.loop = true;
    this.excitementFilter = ctx.createBiquadFilter();
    this.excitementFilter.type = 'bandpass';
    this.excitementFilter.frequency.value = 1100;
    this.excitementFilter.Q.value = 0.9;
    this.excitementGain = ctx.createGain();
    this.excitementGain.gain.value = 0;
    excited.connect(this.excitementFilter).connect(this.excitementGain).connect(out);

    // Start the second layer half-way through the buffer so the two don't sound identical.
    murmur.start();
    excited.start(ctx.currentTime, 2);
    lfo.start();
  }

  /** 1 during a match, lower under menus. */
  setAmbience(level: number): void {
    this.ambience = level;
  }

  roar(): void {
    this.roarLevel = 1;
  }

  ooh(): void {
    const t = this.ctx.currentTime;
    const f = this.excitementFilter.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    f.linearRampToValueAtTime(1700, t + 0.25);
    f.linearRampToValueAtTime(1100, t + 1.2);
    this.roarLevel = Math.max(this.roarLevel, 0.45);
  }

  /** `nearGoal` is 0 (ball in midfield) to 1 (ball at a goal line). */
  update(dt: number, nearGoal: number): void {
    // Ease toward the target, so the crowd swells rather than jumps.
    this.excitement += (nearGoal - this.excitement) * Math.min(1, dt * 1.5);
    this.roarLevel = Math.max(0, this.roarLevel - dt * 0.22);
    const t = this.ctx.currentTime;
    const excitedLevel = (this.excitement * 0.22 + this.roarLevel * 0.75) * this.ambience;
    this.excitementGain.gain.setTargetAtTime(excitedLevel, t, 0.1);
    this.murmurGain.gain.setTargetAtTime((0.14 + this.roarLevel * 0.2) * this.ambience, t, 0.2);
  }
}
