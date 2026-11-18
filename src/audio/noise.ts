/**
 * noise.ts: noise buffers, the raw material for crowd, net and scuff sounds.
 *
 * White noise is random samples: every frequency at equal strength, a harsh hiss. Pink
 * noise has less energy at high frequencies (power falls off as 1/f), which sounds much
 * more like natural sources such as wind, rain or a distant crowd. Here pink noise is
 * approximated by summing a few white-noise sources through simple low-pass filters with
 * different cut-offs (Paul Kellet's "economy" method).
 */
const cache = new Map<string, AudioBuffer>();

export function noiseBuffer(ctx: BaseAudioContext, seconds: number, pink: boolean): AudioBuffer {
  const key = `${seconds}-${pink}-${ctx.sampleRate}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (!pink) {
      data[i] = white;
      continue;
    }
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22;
  }
  cache.set(key, buffer);
  return buffer;
}
