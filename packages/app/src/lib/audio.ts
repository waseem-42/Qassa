// Preview sound goes through Web Audio so a clip's volume (up to 400%) and a track's mute apply
// live, every frame — media.volume can't go above 1 and was only set when a clip loaded.
// Each element plays through: high-pass → (voice cleanup, once a clip asks for it) → gain.

let ctx: AudioContext | undefined;

interface Chain { hp: BiquadFilterNode; gain: GainNode; meter: AnalyserNode; samples: Float32Array<ArrayBuffer>; gate?: AudioWorkletNode; strength: number }
const chains = new WeakMap<HTMLMediaElement, Chain>();

/** Call from a user gesture (play): browsers start audio contexts suspended. */
export function resumeAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* no Web Audio: setGain falls back to media.volume */
  }
}

function chainOf(el: HTMLMediaElement): Chain | undefined {
  if (!ctx) return;
  let ch = chains.get(el);
  if (!ch) {
    try {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 10; // off: under anything audible
      const gain = ctx.createGain();
      const meter = ctx.createAnalyser(); meter.fftSize = 1024;
      ctx.createMediaElementSource(el).connect(hp).connect(gain).connect(meter).connect(ctx.destination);
      ch = { hp, gain, meter, samples: new Float32Array(meter.fftSize), strength: 0 };
      chains.set(el, ch);
      el.volume = 1;
    } catch {
      return;
    }
  }
  return ch;
}

/** RMS after the clip gain: speech can drive the music's ducking, including fades and mute. */
export function audioLevel(el: HTMLMediaElement): number {
  const ch = chains.get(el);
  if (!ch || el.paused || el.muted) return 0;
  ch.meter.getFloatTimeDomainData(ch.samples);
  return Math.sqrt(ch.samples.reduce((sum, x) => sum + x * x, 0) / ch.samples.length);
}

/** Gain of a media element in the preview (0 = silent, 1 = as recorded, up to 4). */
export function setGain(el: HTMLMediaElement, gain: number) {
  const g = Math.max(0, Math.min(4, gain));
  const ch = chainOf(el);
  if (!ch || !ctx) {
    el.volume = Math.min(1, g);
    return;
  }
  if (Math.abs(ch.gain.gain.value - g) > 1e-3) ch.gain.gain.setTargetAtTime(g, ctx.currentTime, 0.015);
}

// A live stand-in for the renderer's afftdn: a downward expander under the noise floor, learnt as it plays (the
// quietest 100 ms of the last 3 s; digital silence — paused, between clips — doesn't count). Near the floor the
// sound comes down by `depth` dB — the same dB the renderer takes off the noise. No floor yet: no change.
const GATE = `
class QassaDenoise extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'depth', defaultValue: 0, minValue: 0, maxValue: 40, automationRate: 'k-rate' }]; }
  constructor() {
    super();
    const k = (s) => Math.exp(-1 / (s * sampleRate));
    this.env = 0; this.floor = 0; this.g = 1;
    this.envA = k(0.005); this.envR = k(0.06); this.gOpen = k(0.003); this.gClose = k(0.08);
    this.blk = Math.round(0.1 * sampleRate); this.n = -this.blk; this.low = Infinity; this.zeros = 0; this.mins = [];
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!inp.length) return true;
    const depth = params.depth[0], min = Math.pow(10, -depth / 20);
    for (let i = 0; i < inp[0].length; i++) {
      let a = 0;
      for (const ch of inp) a = Math.max(a, Math.abs(ch[i]));
      this.env = a > this.env ? this.envA * this.env + (1 - this.envA) * a : this.envR * this.env + (1 - this.envR) * a;
      // the first block only lets the envelope settle; a block with silence in it (a pause, its fade) is left out
      if (this.n >= 0) { this.low = Math.min(this.low, this.env); if (a < 1e-6) this.zeros++; }
      if (++this.n >= this.blk) {
        if (this.zeros < this.blk / 100) { this.mins.push(this.low); if (this.mins.length > 30) this.mins.shift(); this.floor = Math.min(...this.mins); }
        this.n = 0; this.low = Infinity; this.zeros = 0;
      }
      const thr = this.floor * 2.5;
      const t = depth > 0 && this.env < thr ? Math.max(min, (this.env / thr) ** 4) : 1;
      this.g = t > this.g ? this.gOpen * this.g + (1 - this.gOpen) * t : this.gClose * this.g + (1 - this.gClose) * t;
      for (let c = 0; c < out.length; c++) out[c][i] = (inp[c] ?? inp[0])[i] * this.g;
    }
    return true;
  }
}
registerProcessor('qassa-denoise', QassaDenoise);
`;
let gateModule: Promise<boolean> | undefined;
const loadGate = (c: AudioContext) =>
  (gateModule ??= c.audioWorklet
    ? c.audioWorklet.addModule(URL.createObjectURL(new Blob([GATE], { type: 'text/javascript' }))).then(() => true, () => false)
    : Promise.resolve(false));

/** Voice cleanup of a media element in the preview (a clip's `denoise`, 0 = off) — close to the export, not the same filter. */
export function setDenoise(el: HTMLMediaElement, strength: number | undefined) {
  const ch = chainOf(el);
  if (!ch || !ctx) return;
  const s = Math.max(0, Math.min(1, strength ?? 0));
  if (Math.abs(ch.strength - s) < 1e-3) return;
  ch.strength = s;
  const c = ctx;
  ch.hp.frequency.setValueAtTime(s > 0 ? 60 + 30 * s : 10, c.currentTime);
  const depth = () => ch.gate?.parameters.get('depth')?.setValueAtTime(ch.strength > 0 ? 6 + 24 * ch.strength : 0, c.currentTime);
  if (ch.gate) return depth();
  if (s > 0) void loadGate(c).then((ok) => {
    if (!ok || ch.gate) return depth();
    const gate = new AudioWorkletNode(c, 'qassa-denoise');
    ch.hp.disconnect();
    ch.hp.connect(gate).connect(ch.gain);
    ch.gate = gate;
    depth();
  });
}

const buffers = new Map<string, Promise<AudioBuffer | undefined>>();

/** Fire a short sound once (sound effects in the preview; listening to one before adding it). */
export function playOneShot(url: string, gain = 1, offset = 0) {
  resumeAudio();
  if (!ctx) {
    const a = new Audio(url);
    a.volume = Math.min(1, gain);
    a.currentTime = offset;
    void a.play().catch(() => {});
    return;
  }
  const c = ctx;
  if (!buffers.has(url)) buffers.set(url, fetch(url).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)).catch(() => undefined));
  void buffers.get(url)!.then((buf) => {
    if (!buf || offset >= buf.duration) return;
    const src = c.createBufferSource();
    const g = c.createGain();
    g.gain.value = Math.max(0, Math.min(4, gain));
    src.buffer = buf;
    src.connect(g).connect(c.destination);
    src.start(0, offset);
  });
}
