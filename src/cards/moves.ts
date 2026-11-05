import * as THREE from 'three';
import { type Ease, Timeline, ease, lerp } from '../core/anim';
import { sfx } from '../core/audio';
import type { Stage } from '../core/stage';
import { RARITY_COLOR, type Rarity } from './data';
import type { Fx } from '../fx/fx';
import type { CardView } from './CardView';
import { CARD_H, CARD_W } from './geometry';

// Reusable card choreography. These are the verbs a game would call:
// fly a card somewhere, slam it down, or remove it in style.

export interface FlyTarget {
  pos: THREE.Vector3;
  quat?: THREE.Quaternion;
  scale?: number;
}

export interface FlyOptions {
  dur?: number;
  ease?: Ease;
  /** Offset from the straight-line midpoint, bending the path into an arc. */
  arc?: THREE.Vector3;
  /** Extra turns around the card's own y axis, ending at zero. PI = a flip, landing face up. */
  spinY?: number;
  /** Called every frame in flight with the current position, for trails. */
  onStep?: (pos: THREE.Vector3, k: number) => void;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Moves a card along a quadratic Bézier while blending its rotation. The flip is handled
 * separately from the blend, because a 180° slerp has no preferred direction and can turn
 * the card a surprising way. Separating them keeps every flip visibly turning over.
 */
export function flyTo(tl: Timeline, card: CardView, target: FlyTarget, o: FlyOptions = {}) {
  tl.kill(card);
  const p0 = card.position.clone();
  const p2 = target.pos.clone();
  const p1 = p0.clone().add(p2).multiplyScalar(0.5).add(o.arc ?? ZERO);
  const q0 = card.quaternion.clone();
  const q1 = target.quat?.clone() ?? q0.clone();
  const s0 = card.scale.x;
  const s1 = target.scale ?? s0;
  const spin = o.spinY ?? 0;
  // q0 absorbs the spin, and the frame loop unwinds it, so the card starts exactly as it was
  // and finishes exactly on the target.
  if (spin !== 0) q0.multiply(tmpQ.setFromAxisAngle(Y_AXIS, spin));

  return tl.to(
    o.dur ?? 0.5,
    (k) => {
      const u = 1 - k;
      card.position.set(
        u * u * p0.x + 2 * u * k * p1.x + k * k * p2.x,
        u * u * p0.y + 2 * u * k * p1.y + k * k * p2.y,
        u * u * p0.z + 2 * u * k * p1.z + k * k * p2.z,
      );
      card.quaternion.copy(q0).slerp(q1, k);
      if (spin !== 0) card.quaternion.multiply(tmpQ.setFromAxisAngle(Y_AXIS, -spin * (1 - k)));
      card.scale.setScalar(lerp(s0, s1, k));
      o.onStep?.(card.position, k);
    },
    { ease: o.ease ?? ease.inOutCubic, owner: card },
  );
}

/** A soft trail of motes behind a moving card, coloured by rarity. Skipped for commons. */
export function trail(fx: Fx, rarity: Rarity) {
  if (rarity === 'common') return undefined;
  const color = RARITY_COLOR[rarity];
  const rate = rarity === 'legendary' ? 3 : 1;
  return (pos: THREE.Vector3) => {
    fx.light.emit(rate, {
      kind: 'star', at: pos, jitter: [0.5, 0.7, 0.05], speed: [0.05, 0.3], life: [0.35, 0.8],
      size: [0.05, 0.14], color: [color, 0xffffff], bright: [1.5, 3],
    });
  };
}

const HEAVY: Record<Rarity, number> = { common: 0.25, rare: 0.45, epic: 0.7, legendary: 1 };

/**
 * The impact half of playing a card: everything that happens on the frame it lands.
 * Effects scale with rarity, so the same call covers a quiet common and a legendary.
 */
export function impact(stage: Stage, fx: Fx, at: THREE.Vector3, rarity: Rarity, opts: { scale?: number } = {}) {
  const w = HEAVY[rarity];
  const color = RARITY_COLOR[rarity];
  const s = opts.scale ?? 1;

  stage.shake(0.14 + w * 0.42);
  stage.ripple(at, 0.45 + w * 0.8, 0.55 + w * 0.3, 0.32 + w * 0.5);
  stage.aberrationPulse = Math.max(stage.aberrationPulse, w * 0.9);
  sfx.thud(w);

  fx.ring(at, { color: rarity === 'common' ? 0xcfc6b0 : color, size: (4 + w * 7) * s, dur: 0.45 + w * 0.35, width: 0.06, amount: 0.8 + w * 1.5 });

  // Dust puffed out from under the card's edges along the table.
  const dustN = Math.round(18 + w * 40);
  fx.dust.emit(dustN, {
    kind: 'smoke',
    at: (o, i) => {
      const a = (i / dustN) * Math.PI * 2;
      o.set(at.x + Math.cos(a) * CARD_W * 0.33 * s, at.y + Math.sin(a) * CARD_H * 0.33 * s, at.z + 0.05);
    },
    speed: [0.5, 1.6 + w * 1.4], flatten: 0.12, life: [0.5, 1 + w * 0.5], size: [0.3, 0.7 + w * 0.5],
    color: [0x4a4238, 0x2e2822], drag: 3,
  });
  fx.light.emit(Math.round(10 + w * 70), {
    kind: 'spark', at, jitter: [CARD_W * 0.3 * s, CARD_H * 0.3 * s, 0.05], speed: [2, 6 + w * 6], flatten: 0.4,
    life: [0.2, 0.55 + w * 0.3], size: [0.018, 0.04], color: [color, 0xffe9b8], bright: [2, 4.5], gravity: [0, 0, -9], drag: 2.2,
  });
  if (w >= 0.7) {
    fx.flash(at, { color, size: 9 + w * 6, amount: 1.1 + w, dur: 0.3 });
    fx.light.emit(Math.round(w * 50), {
      kind: 'star', at, jitter: [1, 1, 0.1], speed: [0.5, 3], flatten: 0.5, life: [0.5, 1.2], size: [0.07, 0.2],
      color: [color, 0xffffff], bright: [2, 4], drag: 1.5,
    });
  }
}

export type ExitStyle = 'burn' | 'shatter' | 'sand';

/** Removes a card with a dissolve. Resolves once it is fully gone; the caller disposes it. */
export async function dissolveOut(tl: Timeline, fx: Fx, card: CardView, style: ExitStyle) {
  tl.kill(card);
  const mode = style === 'burn' ? 0 : style === 'shatter' ? 1 : 2;
  card.u.uDissolveMode.value = mode;
  card.setHalo(0);
  card.setShadow(0);

  const scale = card.scale.x;
  const w = (CARD_W * scale) / 2;
  const h = (CARD_H * scale) / 2;
  // A point on the card's face in world space, even if the card is angled.
  const onCard = (o: THREE.Vector3, u = Math.random() * 2 - 1, v = Math.random() * 2 - 1) => {
    o.set(u * w, v * h, 0.03).applyQuaternion(card.quaternion).add(card.position);
  };

  if (style === 'burn') {
    (card.u.uBurnColor.value as THREE.Color).setRGB(1, 0.42, 0.1);
    sfx.burn();
    let lastK = 0;
    await tl.to(1.05, (k) => {
      card.u.uDissolve.value = k;
      // Emit from wherever the burn front has reached this frame.
      const n = Math.round((k - lastK) * 170);
      lastK = k;
      if (n > 0) {
        fx.light.emit(n, {
          kind: 'ember', at: (o) => onCard(o), speed: [0.2, 0.8], dir: UP, cone: 0.8, life: [0.7, 1.6], size: [0.025, 0.07],
          color: [0xffa050, 0xff6a20, 0xffd080], bright: [2, 4], gravity: [0, 1.2, 0.2], drag: 0.8,
        });
        fx.dust.emit(Math.ceil(n / 5), {
          kind: 'smoke', at: (o) => onCard(o), speed: [0.1, 0.5], dir: UP, cone: 0.7, life: [0.8, 1.6], size: [0.2, 0.5],
          color: [0x221c18, 0x171310], gravity: [0, 0.5, 0.3], drag: 0.6,
        });
      }
    }, { ease: ease.inOutSine, owner: card });
  } else if (style === 'shatter') {
    (card.u.uBurnColor.value as THREE.Color).setRGB(0.75, 0.9, 1.3);
    sfx.shatter();
    fx.flash(card.position, { color: 0xcfe6ff, size: 3.6 * scale + 1.2, amount: 1, dur: 0.2 });
    fx.light.emit(150, {
      kind: 'shard', at: (o) => onCard(o), speed: [1.5, 6], flatten: 0.8, life: [0.5, 1.2], size: [0.05, 0.16],
      color: [0xcfe6ff, 0xffffff], bright: [1, 2], gravity: [0, -7, -2], drag: 1.2,
    });
    fx.ring(card.position, { color: 0xcfe6ff, size: 8 * scale, dur: 0.4, amount: 1 });
    await tl.to(0.28, (k) => (card.u.uDissolve.value = k), { ease: ease.outQuad, owner: card });
  } else {
    (card.u.uBurnColor.value as THREE.Color).setRGB(0.7, 0.6, 0.42);
    sfx.sand();
    let lastK = 0;
    // The sand mode dissolves across u, so the grains leave from a moving vertical front.
    await tl.to(1.2, (k) => {
      card.u.uDissolve.value = k;
      const n = Math.round((k - lastK) * 520);
      const front = k * 2 - 1;
      lastK = k;
      if (n > 0) {
        fx.light.emit(n, {
          kind: 'glow', at: (o) => onCard(o, front + Math.random() * 0.12), speed: [0.2, 0.7], life: [0.8, 1.7], size: [0.012, 0.03],
          color: [0xd6c39a, 0xfff0cf, 0xa89874], bright: [0.8, 1.5], gravity: [1.5, 0.35, 0.2], drag: 0.5,
        });
      }
    }, { ease: ease.inOutSine, owner: card });
  }
}

const ZERO = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion();
