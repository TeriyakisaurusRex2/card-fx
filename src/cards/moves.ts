import * as THREE from 'three';
import { type Ease, Timeline, ease, lerp } from '../core/anim';
import { sfx } from '../core/audio';
import type { Stage } from '../core/stage';
import { RARITY_COLOR, type Rarity } from './data';
import type { Fx } from '../fx/fx';
import { CardLayer, type CardLayerValue, CardView } from './CardView';
import type { CardPile } from './CardPile';
import type { CardDef } from './data';
import { finishById } from './finishes';
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

// ---- Actions for a card that is already in play ----
// Each one starts from wherever the card is resting and puts it back exactly there, so a
// game can fire them without tracking any state of its own.

export interface AttackOptions {
  /** Fired on the frame of contact: the moment to apply damage and play hit effects. */
  onHit?: (at: THREE.Vector3, dir: THREE.Vector3) => void;
  /** Layer to drop back to afterwards. */
  restLayer?: CardLayerValue;
}

/**
 * A strike in three beats: rear back, lunge, return. The pull-back is the important part.
 * It tells the eye where the hit is going before it happens, which makes a very fast
 * lunge readable.
 */
export async function attack(tl: Timeline, card: CardView, target: THREE.Vector3, o: AttackOptions = {}) {
  tl.kill(card);
  const home = card.position.clone();
  const homeR = card.rotation.clone();
  const dir = target.clone().sub(home).setZ(0);
  const dist = dir.length() || 1;
  dir.divideScalar(dist);
  const s = card.scale.x;
  // Stop with the leading edge on the target rather than the two centres overlapping.
  const reach = Math.max(dist - CARD_H * s * 0.62, dist * 0.35);
  const pose = (along: number, lift: number, lean: number) => {
    card.position.set(home.x + dir.x * along, home.y + dir.y * along, home.z + lift);
    // Positive lean raises the leading edge; negative digs it in.
    card.rotation.set(homeR.x + dir.y * lean, homeR.y - dir.x * lean, homeR.z);
  };
  card.setLayer(CardLayer.air);
  const flex = card.flex;
  card.flex = 0.8;

  sfx.whoosh(0.08);
  await tl.to(0.24, (k) => pose(-0.5 * s * k, 0.75 * k, 0.4 * k), { ease: ease.outCubic, owner: card });
  await tl.to(0.11, (k) => pose(lerp(-0.5 * s, reach, k), lerp(0.75, 0.3, k), lerp(0.4, -0.5, k)), { ease: ease.inCubic, owner: card });
  o.onHit?.(tmpHit.set(home.x + dir.x * (reach + CARD_H * s * 0.4), home.y + dir.y * (reach + CARD_H * s * 0.4), home.z + 0.2), dir);
  // Bounce off the contact, then glide home.
  await tl.to(0.09, (k) => pose(reach - 0.3 * s * k, 0.3 + 0.25 * k, lerp(-0.5, 0.25, k)), { ease: ease.outQuad, owner: card });
  await tl.to(0.36, (k) => pose(lerp(reach - 0.3 * s, 0, k), 0.55 * (1 - k), 0.25 * (1 - k)), { ease: ease.inOutCubic, owner: card });
  card.position.copy(home);
  card.rotation.copy(homeR);
  card.flex = flex;
  card.setLayer(o.restLayer ?? CardLayer.table);
}

/** Being struck: knocked away from the blow, flashing, then ringing back to rest like a spring. */
export function hitReact(tl: Timeline, card: CardView, from: THREE.Vector3, strength = 1) {
  tl.kill(card);
  const home = card.position.clone();
  const homeR = card.rotation.clone();
  const dir = home.clone().sub(from).setZ(0).normalize();
  const push = 0.42 * card.scale.x * strength;
  return tl.to(0.5, (_k, raw) => {
    // A decaying cosine: full displacement on the first frame, then smaller swings back and forth.
    const w = Math.exp(-raw * 5) * Math.cos(raw * 17);
    card.position.set(home.x + dir.x * push * w, home.y + dir.y * push * w, home.z + Math.abs(w) * 0.18);
    card.rotation.set(homeR.x + dir.y * 0.34 * w * strength, homeR.y - dir.x * 0.34 * w * strength, homeR.z + Math.sin(raw * 31) * 0.05 * (1 - raw) * strength);
    card.u.uFlash.value = Math.pow(1 - raw, 3) * 0.55 * strength;
    if (raw >= 1) {
      card.position.copy(home);
      card.rotation.copy(homeR);
      card.u.uFlash.value = 0;
    }
  }, { ease: ease.linear, owner: card });
}

/**
 * Turns a card sideways (exhausted) or upright again, with a small hop so it doesn't scrape
 * the table. A sideways card is wider than its slot, so `scale` can shrink it to fit.
 */
export function tap(tl: Timeline, card: CardView, tapped: boolean, scale = card.scale.x) {
  tl.kill(card);
  const s0 = card.scale.x;
  const z0 = card.rotation.z;
  const z1 = tapped ? -Math.PI / 2 : 0;
  const h = card.position.z;
  sfx.flip();
  return tl.to(0.36, (k, raw) => {
    card.rotation.z = lerp(z0, z1, k);
    card.scale.setScalar(lerp(s0, scale, Math.min(raw * 1.5, 1)));
    card.position.z = h + Math.sin(raw * Math.PI) * 0.4;
    if (raw >= 1) card.position.z = h;
  }, { ease: ease.outBack, owner: card });
}

/** Turns a card over where it lies: up, over with a slight curl, and down with a tap. */
export async function flipOver(tl: Timeline, card: CardView) {
  tl.kill(card);
  const y0 = card.rotation.y;
  const h = card.position.z;
  const lift = CARD_W * card.scale.x * 0.62;
  sfx.flip();
  await tl.to(0.46, (k, raw) => {
    const arc = Math.sin(raw * Math.PI);
    card.rotation.y = y0 + Math.PI * k;
    card.position.z = h + arc * lift;
    card.bendExtra.x = arc * 0.07;
  }, { ease: ease.inOutCubic, owner: card });
  // Keep the angle small, so repeated flips don't wind it up.
  card.rotation.y = Math.abs(Math.sin(y0 / 2)) > 0.5 ? 0 : Math.PI;
  card.position.z = h;
  card.bendExtra.x = 0;
  sfx.thud(0.05);
}

/** A shake of the head for an illegal move. Small, quick, and it ends exactly where it began. */
export function refuse(tl: Timeline, card: CardView) {
  tl.kill(card);
  const home = card.position.clone();
  const z = card.rotation.z;
  const amp = 0.16 * card.scale.x;
  sfx.deny();
  return tl.to(0.38, (_k, raw) => {
    const w = Math.sin(raw * Math.PI * 5) * (1 - raw);
    card.position.x = home.x + w * amp;
    card.rotation.z = z - w * 0.07;
    if (raw >= 1) {
      card.position.copy(home);
      card.rotation.z = z;
    }
  }, { ease: ease.linear, owner: card });
}

/** A stat gain: the card swells and snaps back while light gathers and rises off it. */
export function buff(tl: Timeline, fx: Fx, card: CardView, color = 0x9dffb0) {
  tl.kill(card);
  const s = card.scale.x;
  const at = card.position;
  sfx.shimmer(-0.2);
  fx.ring(at, { color, size: 5.5 * s, dur: 0.5, width: 0.05, amount: 1.2 });
  fx.light.emit(34, {
    kind: 'star', at, jitter: [CARD_W * 0.42 * s, CARD_H * 0.42 * s, 0.05], dir: UP, cone: 0.35, speed: [0.6, 2.2],
    life: [0.5, 1.1], size: [0.05, 0.14], color: [color, 0xffffff], bright: [1.5, 3.2], drag: 1.2,
  });
  return tl.to(0.5, (_k, raw) => {
    // Fast swell, slow settle: most of the growth happens in the first fifth.
    const swell = Math.sin(Math.min(raw * 2.4, 1) * Math.PI) * 0.16 * (1 - raw * 0.4);
    card.scale.setScalar(s * (1 + swell));
    card.u.uFlash.value = Math.pow(1 - raw, 2) * 0.32;
    if (raw >= 1) {
      card.scale.setScalar(s);
      card.u.uFlash.value = 0;
    }
  }, { ease: ease.linear, owner: card });
}

/**
 * A riffle shuffle for a deck: packets peel off to alternate sides and drop back in.
 * The cards are short-lived stand-ins showing only their backs, so the pile itself never changes.
 */
export async function shufflePile(tl: Timeline, pile: CardPile, scene: THREE.Object3D, backDef: CardDef, count = 8) {
  const top = pile.topWorld();
  const s = pile.top?.scale.x ?? 1;
  const matte = finishById('matte').finish;
  sfx.riffle(count, 0.055);
  const jobs: Promise<void>[] = [];
  for (let i = 0; i < count; i++) {
    const side = i % 2 ? 1 : -1;
    const c = new CardView(backDef, matte, { faceDown: true, bare: true });
    c.scale.setScalar(s);
    c.position.copy(top);
    c.visible = false;
    scene.add(c);
    const out = new THREE.Vector3(top.x + side * CARD_W * s * (0.62 + Math.random() * 0.2), top.y + (Math.random() - 0.5) * 0.3, top.z + 0.55 + i * 0.05);
    const lean = side * (0.2 + Math.random() * 0.15);
    jobs.push(
      tl.to(0.4, (_k, raw) => {
        c.visible = true;
        // Out and back along the same line, lifting through the middle.
        const w = Math.sin(raw * Math.PI);
        c.position.lerpVectors(top, out, w);
        c.rotation.z = lean * w;
        c.bendExtra.y = 0.06 * w;
        c.update(1 / 60);
      }, { ease: ease.inOutSine, delay: i * 0.055, owner: c }).then(() => c.dispose()),
    );
  }
  // The pile jumps a little as each packet lands.
  const z = pile.position.z;
  void tl.to(0.4 + count * 0.055, (_k, raw) => {
    pile.position.z = z + Math.abs(Math.sin(raw * Math.PI * count * 0.5)) * 0.03;
    if (raw >= 1) pile.position.z = z;
  }, { ease: ease.linear });
  await Promise.all(jobs);
}

const tmpHit = new THREE.Vector3();
const ZERO = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion();
