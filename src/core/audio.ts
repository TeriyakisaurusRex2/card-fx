// All sounds are synthesized, so there are no assets to ship. Good enough to judge timing
// by; a game would likely replace these calls with real samples behind the same names.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try {
  muted = localStorage.getItem('cardfx.muted') === '1';
} catch {
  /* storage unavailable: fall back to unmuted */
}

/** Browsers only allow audio after a user gesture, so main.ts calls this on first input. */
export function unlockAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  }
  void ctx.resume();
}

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.5;
  try {
    localStorage.setItem('cardfx.muted', m ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function noiseBuffer(sec: number) {
  const c = ctx!;
  const b = c.createBuffer(1, Math.max(1, sec * c.sampleRate), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** Filtered noise with a filter sweep: the basis of whooshes, thuds and rips. */
function noise(o: { dur: number; from: number; to: number; gain: number; q?: number; type?: BiquadFilterType; delay?: number; attack?: number }) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + (o.delay ?? 0);
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(o.dur + 0.05);
  const f = ctx.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.from, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(o.to, 20), t + o.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.012));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + o.dur + 0.05);
}

function tone(o: { freq: number; to?: number; dur: number; gain: number; type?: OscillatorType; delay?: number }) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + (o.delay ?? 0);
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + o.dur + 0.05);
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export const sfx = {
  /** Card sliding off a deck. */
  draw: () => noise({ dur: 0.2, from: rand(1800, 2400), to: 5200, gain: 0.16, q: 0.8 }),
  flip: () => {
    noise({ dur: 0.08, from: 3200, to: 1500, gain: 0.15, q: 1.2 });
    noise({ dur: 0.07, from: 2200, to: 3800, gain: 0.1, q: 1.2, delay: 0.08 });
  },
  hover: () => noise({ dur: 0.05, from: 4200, to: 3000, gain: 0.025, q: 2 }),
  whoosh: (gain = 0.2) => noise({ dur: 0.32, from: 500, to: 2600, gain, q: 0.7, attack: 0.12 }),
  /** Card hitting the table. Weight scales with rarity. */
  thud: (weight = 0.5) => {
    noise({ dur: 0.1, from: 2200, to: 500, gain: 0.3, q: 0.8 });
    tone({ freq: 95 + 60 * (1 - weight), to: 38, dur: 0.18 + 0.32 * weight, gain: 0.5 * (0.5 + weight) });
    if (weight > 0.6) noise({ dur: 0.7 * weight, from: 900, to: 90, gain: 0.26 * weight, type: 'lowpass', q: 0.3 });
  },
  rip: (intensity = 1) => {
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) noise({ dur: 0.03 + Math.random() * 0.02, from: rand(2200, 6800), to: rand(900, 3200), gain: 0.14 * intensity, q: 3.4, delay: i * 0.018 });
  },
  burst: () => {
    noise({ dur: 1.2, from: 7000, to: 200, gain: 0.45, type: 'lowpass', q: 0.3 });
    tone({ freq: 70, to: 26, dur: 0.75, gain: 0.7 });
    sfx.shimmer(1);
  },
  /** Rising chime. Level lifts it through the scale, for rarity. */
  shimmer: (level = 0) => {
    const scale = [523.25, 659.25, 783.99, 987.77, 1174.66, 1567.98];
    const base = 1 + level * 0.25;
    scale.forEach((f, i) => tone({ freq: f * base, dur: 0.55, gain: 0.07, delay: i * 0.055 }));
  },
  charge: (dur = 1) => {
    tone({ freq: 90, to: 480, dur, gain: 0.11, type: 'sawtooth' });
    noise({ dur, from: 300, to: 3800, gain: 0.14, q: 1.8, attack: dur * 0.7 });
  },
  burn: () => {
    noise({ dur: 0.9, from: 900, to: 2600, gain: 0.18, q: 0.5, attack: 0.25 });
    noise({ dur: 0.45, from: 4800, to: 3000, gain: 0.05, q: 4, delay: 0.1 });
  },
  shatter: () => {
    for (let i = 0; i < 6; i++) tone({ freq: rand(1800, 5200), dur: rand(0.06, 0.2), gain: 0.05, delay: i * 0.025, type: 'triangle' });
    noise({ dur: 0.3, from: 6000, to: 2000, gain: 0.25, q: 0.7 });
  },
  /** Two flat blips: "you can't do that". */
  deny: () => {
    tone({ freq: 170, to: 150, dur: 0.09, gain: 0.16, type: 'square' });
    tone({ freq: 150, to: 120, dur: 0.12, gain: 0.16, type: 'square', delay: 0.11 });
  },
  /** A short strike, lighter than a card landing. */
  hit: (weight = 0.5) => {
    noise({ dur: 0.09, from: 3800, to: 700, gain: 0.3, q: 0.9 });
    tone({ freq: 150, to: 55, dur: 0.14 + 0.1 * weight, gain: 0.35 + 0.25 * weight });
  },
  /** Cards riffling together. */
  riffle: (n = 7, gap = 0.05) => {
    for (let i = 0; i < n; i++) noise({ dur: 0.045, from: rand(2600, 4200), to: rand(1400, 2200), gain: 0.09, q: 1.6, delay: i * gap });
  },
  sand: () => noise({ dur: 1, from: 5000, to: 8200, gain: 0.08, q: 0.6, attack: 0.3 }),
};
