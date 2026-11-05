// Tiny animation kit: easings, a tween scheduler you await, and springs.
// Nothing here knows about three.js or cards, so it ports to any game loop:
// call `timeline.update(dt)` once per frame.

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inQuart: (t: number) => t * t * t * t,
  outQuart: (t: number) => 1 - Math.pow(1 - t, 4),
  inExpo: (t: number) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  inBack: (t: number) => 2.70158 * t * t * t - 1.70158 * t * t,
  outBack: (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  outElastic: (t: number) =>
    t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1,
} satisfies Record<string, Ease>;

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential smoothing. Higher `rate` = snappier. */
export const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt));

interface Job {
  remaining: number; // delay left before the job starts
  dur: number;
  t: number;
  ease: Ease;
  step: (k: number, raw: number) => void;
  resolve: () => void;
  owner?: object;
}

/**
 * Runs tweens. `to()` returns a promise, so choreography reads top-to-bottom:
 *   await tl.to(0.4, k => card.scale.setScalar(k), { ease: ease.outBack });
 *   tl.shake(0.2);
 *
 * `clear()` drops all running jobs. Their promises never resolve, which is what
 * we want on scene teardown: awaiting sequences simply stop and get collected.
 */
export class Timeline {
  private jobs: Job[] = [];
  private tickers = new Set<(dt: number) => void>();
  timeScale = 1;

  to(
    dur: number,
    step: (k: number, raw: number) => void,
    opts: { ease?: Ease; delay?: number; owner?: object } = {},
  ): Promise<void> {
    return new Promise((resolve) => {
      this.jobs.push({
        remaining: opts.delay ?? 0,
        dur: Math.max(dur, 1e-4),
        t: 0,
        ease: opts.ease ?? ease.inOutQuad,
        step,
        resolve,
        owner: opts.owner,
      });
    });
  }

  wait(sec: number): Promise<void> {
    return this.to(sec, () => {});
  }

  /** Fire and forget: run `fn` after `sec`. */
  after(sec: number, fn: () => void) {
    void this.wait(sec).then(fn);
  }

  /** Cancels running tweens tagged with this owner, so a new move can take over. */
  kill(owner: object) {
    this.jobs = this.jobs.filter((j) => j.owner !== owner);
  }

  /** A per-frame callback, returning a function that removes it. */
  tick(fn: (dt: number) => void) {
    this.tickers.add(fn);
    return () => this.tickers.delete(fn);
  }

  update(rawDt: number) {
    const dt = rawDt * this.timeScale;
    // Copy: a finishing tween's continuation may add new jobs during this loop.
    const running = this.jobs;
    this.jobs = [];
    const keep: Job[] = [];
    for (const j of running) {
      if (j.remaining > 0) {
        j.remaining -= dt;
        keep.push(j);
        continue;
      }
      j.t += dt;
      const raw = clamp(j.t / j.dur);
      j.step(j.ease(raw), raw);
      if (raw >= 1) j.resolve();
      else keep.push(j);
    }
    this.jobs = keep.concat(this.jobs);
    for (const fn of this.tickers) fn(dt);
  }

  clear() {
    this.jobs = [];
    this.tickers.clear();
  }
}

/** Critically-tunable 1D spring. Hand layouts use these so interruption stays smooth. */
export class Spring {
  value: number;
  target: number;
  velocity = 0;
  constructor(
    value = 0,
    public stiffness = 170,
    public damping = 20,
  ) {
    this.value = value;
    this.target = value;
  }
  update(dt: number) {
    // Semi-implicit Euler, sub-stepped so a dropped frame can't explode the spring.
    const steps = Math.min(4, Math.ceil(dt / (1 / 120)));
    const h = dt / Math.max(steps, 1);
    for (let i = 0; i < steps; i++) {
      this.velocity += (this.stiffness * (this.target - this.value) - this.damping * this.velocity) * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  snap(v: number) {
    this.value = this.target = v;
    this.velocity = 0;
  }
}

/** Seedable RNG so a "random" pack or layout can be replayed. */
export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
