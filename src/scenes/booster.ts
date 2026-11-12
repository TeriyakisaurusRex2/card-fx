import * as THREE from 'three';
import { BoosterPack, PACK_H, PACK_W, TEAR_Y } from '../cards/BoosterPack';
import { CardView, sharedCardUniforms } from '../cards/CardView';
import { type CardDef, type Faction, FACTION_COLOR, RARITY_COLOR, type Rarity, ofRarity } from '../cards/data';
import { rollFinish } from '../cards/finishes';
import { CARD_H, CARD_W } from '../cards/geometry';
import { flyTo } from '../cards/moves';
import { Spring, Timeline, clamp, ease } from '../core/anim';
import { sfx } from '../core/audio';
import { button, el, panel, section, toggle } from '../core/ui';
import { Fx, makeBackdrop } from '../fx/fx';
import { Listeners, onCanvas, type SceneFactory } from './scene';

type Phase = 'choose' | 'moving' | 'tear' | 'bursting' | 'reveal' | 'busy' | 'summary';

const FACTIONS: Faction[] = ['ember', 'cairn', 'veil'];
const RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };
const TOP_SCALE = 1.12;
const CHOOSE_Z = 20;
/** The face-down stack sits a little above centre, leaving room for the tray below it. */
const STACK_Y = 0.5;
const REVEAL_Z = 1;
/**
 * Where a face-down card waits, n places back from the top of the stack. Each one is stepped
 * up and to the right of the one in front, so the cards still to come peek out from behind
 * the card being shown and the player can count them.
 */
const stackPos = (n: number) => new THREE.Vector3(n * 0.2, STACK_Y + n * 0.12, -n * 0.05);
const FACE_DOWN = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));

const anyOf = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/** Three commons and a rare, then a slot that can upgrade. Sorted so the best comes last. */
function rollPack(f: Faction, god: boolean): CardDef[] {
  const roll = Math.random();
  const hit: Rarity = god || roll < 0.12 ? 'legendary' : roll < 0.4 ? 'epic' : 'rare';
  const picks = new Set<CardDef>();
  while (picks.size < 3) picks.add(anyOf(ofRarity('common', f)));
  while (picks.size < 4) picks.add(anyOf(ofRarity('rare', f)));
  while (picks.size < 5) picks.add(anyOf(ofRarity(hit, f)));
  return [...picks].sort((a, b) => RANK[a.rarity] - RANK[b.rarity]);
}

export const boosterScene: SceneFactory = ({ stage, ui }) => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const backdrop = makeBackdrop({ inner: 0x1d1712, outer: 0x050404, glow: 0xffffff });
  scene.add(backdrop);
  const backU = (backdrop.material as THREE.ShaderMaterial).uniforms;
  const tl = new Timeline();
  const fx = new Fx(scene, tl, camera);
  const listeners = new Listeners();

  let phase: Phase = 'choose';
  let god = false;

  // ---- DOM ----
  const prompt = el('div', { class: 'prompt', text: 'Choose a pack' });
  const actions = el('div', { class: 'center-actions off' }, button('Open another', () => reset(), 'primary'));
  const { root, body } = panel('Booster');
  body.append(
    section(
      'Odds',
      toggle('Guarantee a legendary', false, (v) => (god = v)),
      el('div', { class: 'hint', text: 'Otherwise the last slot is 60% rare, 28% epic, 12% legendary.' }),
    ),
    section(
      'Controls',
      el('div', { class: 'hint', text: 'Drag along the seal to tear, or click the pack to tear it automatically. Click or press Space to move through the cards.' }),
    ),
    section('Restart', el('div', { class: 'btn-grid' }, button('New pack', () => reset()))),
  );
  ui.append(prompt, actions, root);
  const say = (t: string) => {
    prompt.textContent = t;
    prompt.classList.toggle('off', !t);
  };

  // ---- camera ----
  const camZ = new Spring(CHOOSE_Z, 40, 11);
  const camY = new Spring(0, 40, 11);

  // ---- packs on offer ----
  interface Offer {
    pack: BoosterPack;
    faction: Faction;
    hover: Spring;
    rx: Spring;
    ry: Spring;
    baseX: number;
    phase: number;
    gone: boolean;
  }
  let offers: Offer[] = [];
  let active: Offer | null = null;
  let cards: CardView[] = [];
  let leak: ReturnType<Fx['rays']> | null = null;
  let revealRays: ReturnType<Fx['rays']> | null = null;
  let topIndex = 0;
  const tilt = { x: new Spring(0, 90, 12), y: new Spring(0, 90, 12) };
  let flippedDown = false; // top card is still waiting to be turned over

  // Cards in the summary row, which respond to hover.
  let hoverCard: CardView | null = null;
  const rowState = new Map<CardView, { s: Spring; y: Spring; z: Spring; x: number; baseS: number; baseY: number; rx: Spring; ry: Spring }>();

  const buildOffers = () => {
    offers = FACTIONS.map((f, i) => {
      const pack = new BoosterPack(f);
      const baseX = (i - 1) * 4.4;
      pack.position.set(baseX, -9, 0);
      scene.add(pack);
      const o: Offer = { pack, faction: f, hover: new Spring(0, 200, 20), rx: new Spring(0, 70, 11), ry: new Spring(0, 70, 11), baseX, phase: i * 1.7, gone: false };
      void tl.to(0.7, (k) => (pack.position.y = -9 * (1 - k)), { ease: ease.outBack, delay: 0.07 * i });
      return o;
    });
  };

  function clearAll() {
    for (const o of offers) o.pack.dispose();
    offers = [];
    active = null;
    for (const c of cards) c.dispose();
    cards = [];
    rowState.clear();
    hoverCard = null;
    void leak?.remove(0.1);
    leak = null;
    void revealRays?.remove(0.1);
    revealRays = null;
    backU.uGlowAmt.value = 0;
    flippedDown = false;
    topIndex = 0;
  }

  function reset() {
    tl.clear();
    clearAll();
    tl.timeScale = 1;
    phase = 'choose';
    camZ.target = CHOOSE_Z;
    camY.target = 0;
    actions.classList.add('off');
    say('Choose a pack');
    buildOffers();
  }

  const packUnderPointer = () => {
    const ray = stage.ray();
    for (const o of offers) {
      if (o.gone) continue;
      const hitPoint = ray.intersectPlane(PLANE, tmpA);
      if (!hitPoint) continue;
      if (Math.abs(hitPoint.x - o.pack.position.x) < PACK_W / 2 && Math.abs(hitPoint.y - o.pack.position.y) < PACK_H / 2) return o;
    }
    return null;
  };

  async function choose(o: Offer) {
    phase = 'moving';
    say('');
    active = o;
    sfx.whoosh();
    for (const other of offers) {
      if (other === o) continue;
      other.gone = true;
      const p = other.pack;
      const from = p.position.clone();
      const dir = Math.sign(other.baseX - o.baseX);
      void tl.to(0.5, (k) => {
        p.position.x = from.x + dir * 12 * k;
        p.position.y = from.y - 6 * k;
        p.rotation.z = -dir * k * 0.7;
      }, { ease: ease.inCubic }).then(() => (p.visible = false));
    }

    // The cards go inside the wrapper now, hidden until it opens.
    const defs = rollPack(o.faction, god);
    cards = defs.map((d, i) => {
      // Face down from the start, so the burst can't give away what's in the pack.
      const c = new CardView(d, rollFinish(d.rarity), { res: 2, faceDown: true });
      c.scale.setScalar(0.98);
      c.position.set(0, -0.15, (2 - i) * 0.018);
      c.setShadow(0);
      c.setPainted(false);
      c.flex = 0;
      o.pack.add(c);
      return c;
    });

    const from = o.pack.position.clone();
    await tl.to(0.55, (k) => {
      o.pack.position.lerpVectors(from, tmpB.set(0, -0.3, 0), k);
      o.pack.scale.setScalar(1 + k * 0.32);
    }, { ease: ease.inOutCubic });
    camZ.target = 15;
    phase = 'tear';
    say('Drag across the top to tear — or just click');
    o.pack.uniforms.uGuide.value = 1;
  }

  // ---- tearing ----
  let tearing = false;
  let downX = 0;
  let moved = 0;
  let lastRip = 0;
  let tearGoal = -Infinity;

  const packLocal = (out: THREE.Vector3) => {
    const hit = stage.pointOnPlane(PLANE, out);
    if (!hit || !active) return null;
    return active.pack.worldToLocal(hit);
  };

  const emitTearSparks = (x: number, power: number) => {
    if (!active) return;
    const w = tmpC.set(x, TEAR_Y, 0.15);
    active.pack.localToWorld(w);
    const color = RARITY_COLOR[cards[cards.length - 1].def.rarity];
    fx.light.emit(Math.round(8 * power), {
      kind: 'spark', at: w, speed: [1.5, 5], dir: UP, cone: 1.4, life: [0.2, 0.6], size: [0.015, 0.035],
      color: [0xfff0c8, color], bright: [2.5, 5], gravity: [0, -7, 0], drag: 1.6,
    });
    fx.light.emit(Math.round(4 * power), {
      kind: 'shard', at: w, speed: [0.8, 2.6], dir: UP, cone: 1.2, life: [0.5, 1.1], size: [0.025, 0.06],
      color: [0xe8e8f0, 0xffffff], bright: [0.8, 1.4], gravity: [0, -5, 0], drag: 1,
    });
  };

  function moveTear(x: number) {
    if (!active) return;
    const pack = active.pack;
    const prev = pack.tear;
    if (x <= prev) return;
    pack.setTear(x);
    pack.uniforms.uGuide.value = 0;
    // A touch of light grows behind the opening as it widens.
    const progress = clamp((x + PACK_W / 2) / PACK_W);
    pack.uniforms.uLeak.value = progress * 0.7;
    pack.uniforms.uLeakColor.value.set(RARITY_COLOR[cards[cards.length - 1].def.rarity]);
    const moved = x - prev;
    emitTearSparks(x, clamp(moved * 26, 0.4, 2));
    stage.shake(moved * 0.3);
    if (performance.now() - lastRip > 30) {
      sfx.rip(0.6 + clamp(moved * 6, 0, 0.8));
      lastRip = performance.now();
    }
    if (x >= PACK_W / 2) void burst();
  }

  function autoTear() {
    if (!active || phase !== 'tear') return;
    const start = active.pack.tear < -PACK_W / 2 ? -PACK_W / 2 - 0.01 : active.pack.tear;
    void tl.to(0.65, (k) => moveTear(start + (PACK_W / 2 + 0.02 - start) * k), { ease: ease.inOutQuad });
    tearing = false;
    phase = 'bursting';
    say('');
  }

  // ---- the explosion ----
  let bursting = false;
  async function burst() {
    if (bursting || !active) return;
    bursting = true;
    phase = 'bursting';
    say('');
    const pack = active.pack;
    const best = cards[cards.length - 1].def;
    const color = RARITY_COLOR[best.rarity];
    const heavy = RANK[best.rarity] / 3;

    // 1. The strip flies off, spinning, on its own.
    const strip = pack.strip;
    const v = new THREE.Vector3(1.1, 2.4, 1.4);
    let t0 = 0;
    void tl.to(1.3, (_k, raw) => {
      t0 = raw * 1.3;
      strip.position.set(v.x * t0, v.y * t0 - 3.2 * t0 * t0, v.z * t0);
      strip.rotation.set(t0 * 3.3, t0 * 1.3, -t0 * 2.2);
      if (raw > 0.97) strip.visible = false;
    }, { ease: ease.linear });

    // 2. Anticipation: everything holds its breath while the pack shakes and light builds.
    const leakAt = tmpD.set(0, TEAR_Y, -0.35);
    pack.localToWorld(leakAt);
    leak = fx.rays(leakAt.clone(), { color, size: 10 + heavy * 5, amount: 0, order: 2, depthTest: true, billboard: false });
    leak.mesh.position.z = -0.6;
    sfx.charge(0.85);
    camZ.target = 12.8;
    await tl.to(0.85, (k) => {
      const a = k * k * 0.055;
      pack.position.x = Math.sin(fx.time * 66) * a;
      pack.position.y = -0.3 + Math.cos(fx.time * 79) * a;
      pack.rotation.z = Math.sin(fx.time * 53) * a * 0.5;
      pack.uniforms.uLeak.value = 0.7 + k * 1.6;
      leak!.amount(k * k * (1.3 + heavy * 0.9));
      backU.uGlowAmt.value = k * k * 0.05;
      (backU.uGlow.value as THREE.Color).set(color);
      // Sparks spill out of the opening faster and faster.
      if (Math.random() < 0.2 + k) {
        fx.light.emit(2 + Math.round(k * 5), {
          kind: 'glow', at: tmpE.set(leakAt.x + (Math.random() - 0.5) * PACK_W * 1.2, leakAt.y, 0.2), jitter: [0.1, 0.02, 0.05],
          speed: [1, 3 + k * 3], dir: UP, cone: 0.5, life: [0.3, 0.75], size: [0.025, 0.07], color: [color, 0xffffff], bright: [2, 4], drag: 1.2,
        });
      }
    }, { ease: ease.linear });

    // 3. Boom. Slow time for a moment so the eye can take it in.
    const center = new THREE.Vector3(0, 0.6, 0.6);
    tl.timeScale = 0.3;
    tl.after(0.14, () => void tl.to(0.22, (k) => (tl.timeScale = 0.3 + 0.7 * k)));
    sfx.burst();
    stage.shake(0.75 + heavy * 0.25);
    stage.ripple(center, 1.5, 0.9, 1);
    stage.ripple(center, 0.8, 1.2, 1.3);
    stage.aberrationPulse = 1.6;
    fx.flash(center, { color: 0xffffff, size: 18, amount: 1.8, dur: 0.3 });
    fx.flash(center, { color, size: 30, amount: 0.9, dur: 0.6 });
    fx.ring(center, { color: 0xffffff, size: 22, dur: 0.85, width: 0.04, amount: 2.5 });
    fx.ring(center, { color, size: 32, dur: 1.15, width: 0.1, amount: 1.8 });
    fx.light.emit(460, {
      kind: 'spark', at: center, jitter: [0.6, 0.6, 0.2], speed: [4, 22], flatten: 0.55, life: [0.4, 1.3], size: [0.02, 0.06],
      color: [color, 0xffffff, 0xfff0c0], bright: [2.5, 6], gravity: [0, -3, 0], drag: 1.8,
    });
    fx.light.emit(150, {
      kind: 'star', at: center, jitter: [0.8, 0.8, 0.2], speed: [1, 11], flatten: 0.55, life: [0.7, 1.9], size: [0.1, 0.34],
      color: [color, 0xffffff], bright: [2.5, 5], drag: 1.6,
    });
    fx.light.emit(420, {
      kind: 'shard', at: center, jitter: [1, 1, 0.3], speed: [2.5, 13], flatten: 0.6, life: [1.4, 3.2], size: [0.05, 0.13],
      color: [0xffffff, color, 0xffe9a8], bright: [1, 1.8], gravity: [0, -3.4, 0], drag: 1.3,
    });
    fx.light.emit(26, {
      kind: 'glow', at: center, jitter: [0.4, 0.4, 0.1], speed: [0.5, 5], life: [0.4, 0.9], size: [0.4, 1],
      color: [color], bright: [0.2, 0.45], drag: 2.2,
    });

    // The wrapper is blown downward; the cards keep their world pose as it leaves.
    for (const c of cards) scene.attach(c);
    const from = pack.position.clone();
    const startRot = pack.rotation.z;
    // Fast at first, so the wrapper is clear of the cards almost at once.
    void tl.to(0.6, (k) => {
      pack.position.set(from.x + k * 0.7, from.y - k * 11, from.z - k * 1.8);
      pack.rotation.set(k * 0.8, 0, startRot - k * 0.75);
      pack.uniforms.uLeak.value = 2.3 * (1 - k);
    }, { ease: ease.outCubic }).then(() => (pack.visible = false));
    void leak.fadeTo(0.55 + heavy * 0.5, 0.5);
    void tl.to(0.7, (k) => (backU.uGlowAmt.value = 0.05 + (1 - k) * 0.1), { ease: ease.outQuad });

    // 4. Cards are thrown up in a spread, backs showing, then gather into a stack.
    camZ.target = 12.5;
    camY.target = 0;
    const n = cards.length;
    // First the cards rise straight up as one block while the wrapper drops away. They are
    // still hidden by the wrapper's front during this, so they come out of its torn top
    // instead of appearing through the foil.
    await Promise.all(
      cards.map((c) => flyTo(tl, c, { pos: c.position.clone().add(tmpE.set(0, 1, 0)) }, { dur: 0.12, ease: ease.outQuad })),
    );
    for (const c of cards) c.setPainted(true);
    await Promise.all(
      cards.map((c, i) => {
        const sx = (i - (n - 1) / 2) * 1.5;
        c.flex = 1;
        return flyTo(tl, c, {
          // Nearest-first in the same order as inside the pack and in the stack afterwards,
          // so no two cards ever swap which one is in front while they overlap.
          pos: new THREE.Vector3(sx, 0.9 + Math.random() * 0.5, 0.4 + (n - 1 - i) * 0.04),
          quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, (i - (n - 1) / 2) * -0.2)),
          scale: 0.92,
        }, { dur: 0.46, ease: ease.outCubic, arc: new THREE.Vector3(sx * 0.6, 0.9, 0.6) });
      }),
    );
    await tl.wait(0.1);
    sfx.whoosh(0.2);
    await Promise.all(
      cards.map((c, i) => {
        // Face down, stacked, with the first card on top.
        c.setShadow(0.4);
        return flyTo(tl, c, { pos: stackPos(i), quat: FACE_DOWN, scale: TOP_SCALE },
          { dur: 0.42, ease: ease.inOutCubic, arc: new THREE.Vector3(0, -0.2, 0.3) });
      }),
    );
    void leak.remove(0.5);
    leak = null;
    void tl.to(0.4, (k) => (backU.uGlowAmt.value = 0.05 * (1 - k)));
    bursting = false;
    pack.dispose();
    active = null;
    offers = [];
    camZ.target = 12.6;
    topIndex = 0;
    await presentTop();
  }

  // ---- cycling through the cards ----
  /** Sets the top of the stack up: commons flip at once, high rarities wait for a click. */
  async function presentTop() {
    const card = cards[topIndex];
    const r = card.def.rarity;
    const rank = RANK[r];
    phase = 'busy';
    if (rank >= 2) {
      // Tease: the back glows and trembles until the player turns it.
      flippedDown = true;
      phase = 'reveal';
      card.setHalo(1.5, RARITY_COLOR[r]);
      sfx.charge(0.45);
      say(r === 'legendary' ? 'Something is stirring…' : 'Click to reveal');
      return;
    }
    await turnOver(card);
    phase = 'reveal';
    say(topIndex === 0 ? 'Click or press Space for the next card' : '');
  }

  async function turnOver(card: CardView) {
    const r = card.def.rarity;
    const rank = RANK[r];
    const color = RARITY_COLOR[r];
    flippedDown = false;
    sfx.flip();
    await flyTo(tl, card, {
      // Well in front of the stack, so the tilt can't swing the card through it.
      pos: new THREE.Vector3(0, STACK_Y, REVEAL_Z),
      quat: new THREE.Quaternion(),
      scale: TOP_SCALE,
    }, { dur: 0.42 - rank * 0.03, ease: ease.outCubic, spinY: Math.PI, arc: new THREE.Vector3(0, 0, 0.5) });

    tilt.x.snap(0);
    tilt.y.snap(0);
    if (rank === 0) return;
    sfx.shimmer(rank - 1);
    card.setHalo(0.7 + rank * 0.35, color);
    fx.flash(card.position, { color, size: 9 + rank * 5, amount: 1 + rank * 0.55, dur: 0.4 });
    fx.ring(card.position, { color, size: 9 + rank * 5, dur: 0.75, amount: 1.4 });
    fx.light.emit(40 + rank * 60, {
      kind: 'star', at: card.position, jitter: [1.5, 2, 0.2], speed: [0.5, 3 + rank * 1.5], flatten: 0.4, life: [0.6, 1.6], size: [0.08, 0.26],
      color: [color, 0xffffff], bright: [2, 4], drag: 1.4,
    });
    if (rank >= 2) {
      stage.shake(0.25 + (rank - 2) * 0.35);
      stage.ripple(card.position, 0.8 + (rank - 2) * 0.7, 0.8, 0.9);
      stage.aberrationPulse = 0.8;
      fx.light.emit(rank === 3 ? 220 : 90, {
        kind: 'spark', at: card.position, jitter: [1, 1.4, 0.1], speed: [3, 14], flatten: 0.5, life: [0.3, 1], size: [0.02, 0.05],
        color: [color, 0xffffff], bright: [2.5, 5], drag: 2,
      });
      revealRays = fx.rays(tmpA.set(0, STACK_Y, -1), { color, size: 15 + (rank - 2) * 7, amount: 0.7 + (rank - 2) * 0.8, order: 2, depthTest: true, billboard: false });
      // A blast on the reveal, then a calmer glow while the card is being read.
      void revealRays.fadeTo(0.3 + (rank - 2) * 0.1, 1.5);
      (backU.uGlow.value as THREE.Color).set(color);
      void tl.to(0.5, (k) => (backU.uGlowAmt.value = k * 0.035 * rank));
    }
  }

  /** Sends the current card to the tray at the bottom and brings up the next. */
  async function advance(dir: number) {
    if (phase !== 'reveal') return;
    const card = cards[topIndex];
    if (flippedDown) {
      phase = 'busy';
      say('');
      await turnOver(card);
      phase = 'reveal';
      return;
    }
    phase = 'busy';
    say('');
    sfx.whoosh(0.16);
    card.setHalo(0);
    void revealRays?.remove(0.3);
    revealRays = null;
    void tl.to(0.3, (k) => {
      const from = backU.uGlowAmt.value as number;
      backU.uGlowAmt.value = from * (1 - k);
    });

    // The tray fills left to right along the bottom of the screen.
    const slotX = (topIndex - 2) * 1.02;
    void flyTo(tl, card, {
      pos: new THREE.Vector3(slotX, -2.42, 0.5),
      quat: new THREE.Quaternion(),
      scale: 0.31,
    }, { dur: 0.48, ease: ease.inOutCubic, arc: new THREE.Vector3(dir * 2.6, 0.6, 1) });
    topIndex++;

    if (topIndex >= cards.length) {
      await tl.wait(0.5);
      void toSummary();
      return;
    }
    for (let i = topIndex; i < cards.length; i++) {
      void flyTo(tl, cards[i], { pos: stackPos(i - topIndex), quat: FACE_DOWN, scale: TOP_SCALE }, { dur: 0.26, ease: ease.outCubic });
    }
    await tl.wait(0.2);
    await presentTop();
  }

  // ---- final spread ----
  async function toSummary() {
    phase = 'busy';
    sfx.whoosh(0.2);
    const n = cards.length;
    const scale = 0.84;
    // Back the camera up until the whole row fits in the space beside the panel.
    const rowHalf = (n / 2) * (CARD_W * scale + 0.28) + 0.35;
    const freeWidth = 1 - (2 * stage.panelShift) / stage.width;
    const fit = Math.max(1, 1.5 / camera.aspect);
    camZ.target = Math.max(12.6, rowHalf / (Math.tan((camera.fov * Math.PI) / 360) * camera.aspect * freeWidth) / fit);
    await Promise.all(
      cards.map((c, i) => {
        const x = (i - (n - 1) / 2) * (CARD_W * scale + 0.28);
        const y = 0.25;
        c.flex = 1;
        rowState.set(c, {
          s: new Spring(scale, 170, 20), y: new Spring(y, 170, 20), z: new Spring(i * 0.01, 170, 22),
          rx: new Spring(0, 90, 12), ry: new Spring(0, 90, 12), x, baseS: scale, baseY: y,
        });
        return flyTo(tl, c, { pos: new THREE.Vector3(x, y, i * 0.01), quat: new THREE.Quaternion(), scale }, { dur: 0.5 + i * 0.04, ease: ease.outCubic });
      }),
    );
    for (const c of cards) c.setHalo(0.55 * RANK[c.def.rarity], RARITY_COLOR[c.def.rarity]);
    phase = 'summary';
    say('');
    actions.classList.remove('off');
  }

  // ---- input ----
  listeners.on('pointerdown', (e) => {
    if (!onCanvas(e)) return;
    downX = e.clientX;
    moved = 0;
    if (phase === 'tear' && active) {
      tearing = true;
      const l = packLocal(tmpA);
      if (l && active.pack.tear < -PACK_W / 2 && Math.abs(l.y - TEAR_Y) < 0.7 && l.x < 0) {
        // The tear starts from the left edge wherever the first grab lands.
        active.pack.setTear(-PACK_W / 2 - 0.01);
      }
    }
  });
  listeners.on('pointermove', (e) => {
    if (!tearing || phase !== 'tear' || !active) return;
    moved = Math.max(moved, Math.abs(e.clientX - downX));
    if (moved < 6) return;
    const l = packLocal(tmpA);
    if (!l) return;
    if (active.pack.tear < -PACK_W / 2) active.pack.setTear(-PACK_W / 2 - 0.01);
    tearGoal = Math.min(l.x, PACK_W / 2 + 0.02);
  });
  listeners.on('pointerup', (e) => {
    if (!onCanvas(e)) {
      tearing = false;
      return;
    }
    if (phase === 'choose') {
      const o = packUnderPointer();
      if (o) void choose(o);
    } else if (phase === 'tear') {
      tearing = false;
      tearGoal = -Infinity;
      // A plain click, or a tear already most of the way along, finishes by itself.
      if (moved < 6 || (active && active.pack.tear > 0.45 * PACK_W / 2)) autoTear();
    } else if (phase === 'reveal') {
      void advance(e.clientX < stage.width / 2 ? -1 : 1);
    }
  });
  listeners.on('keydown', (e) => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (phase === 'tear') autoTear();
    else if (phase === 'reveal') void advance(1);
    else if (phase === 'summary') reset();
  });

  buildOffers();

  const layout = () => {
    stage.centerBesidePanel(camera);
    backU.uAspect.value = camera.aspect;
  };

  return {
    scene,
    camera,
    resize: layout,
    update(dt, t) {
      // Slow-motion only touches the timeline; pointer response and the camera stay real time.
      tl.update(dt);
      fx.update(t);

      // Narrow windows back the camera up so the content still fits.
      const fit = Math.max(1, 1.5 / camera.aspect);
      camera.position.set(0, camY.update(dt), camZ.update(dt) * fit);
      camera.lookAt(0, camY.value, 0);

      const pw = stage.pointOnPlane(PLANE, tmpA);
      const px = pw?.x ?? 0;
      const py = pw?.y ?? 0;
      sharedCardUniforms.uLightPos.value.set(stage.pointer.x * 7, stage.pointer.y * 5 + 1.5, 10);

      if (phase === 'choose' || phase === 'moving') {
        const over = phase === 'choose' ? packUnderPointer() : null;
        stage.canvas.style.cursor = over ? 'pointer' : '';
        for (const o of offers) {
          if (o.gone) continue;
          const isActive = o === active;
          o.hover.target = o === over ? 1 : 0;
          const h = o.hover.update(dt);
          o.ry.target = clamp((px - o.pack.position.x) * 0.1, -0.45, 0.45) + Math.sin(t * 0.7 + o.phase) * 0.07;
          o.rx.target = clamp(-(py - o.pack.position.y) * 0.1, -0.35, 0.35) + Math.cos(t * 0.6 + o.phase) * 0.05;
          o.pack.rotation.y = o.ry.update(dt);
          o.pack.rotation.x = o.rx.update(dt);
          if (phase === 'choose') {
            o.pack.scale.setScalar(1 + h * 0.07);
            if (!isActive) o.pack.position.z = h * 0.4;
          }
        }
      } else if (phase === 'tear' && active) {
        // Foil resists a little: the tear chases the pointer instead of jumping to it.
        if (tearing && tearGoal > active.pack.tear) moveTear(Math.min(tearGoal, active.pack.tear + dt * 7));
        // Before the first rip, the pack still leans toward the pointer.
        stage.canvas.style.cursor = 'grab';
        tilt.y.target = clamp(px * 0.07, -0.3, 0.3);
        tilt.x.target = clamp(-(py - 0.3) * 0.07, -0.25, 0.25);
        active.pack.rotation.y = tilt.y.update(dt);
        active.pack.rotation.x = tilt.x.update(dt);
      } else {
        stage.canvas.style.cursor = phase === 'reveal' ? 'pointer' : '';
      }

      // The current top card follows the pointer, like holding it up to the light.
      if (phase === 'reveal') {
        const card = cards[topIndex];
        if (card) {
          if (flippedDown) {
            const a = RANK[card.def.rarity] === 3 ? 0.03 : 0.015;
            card.position.x = Math.sin(t * 58) * a;
            card.position.y = STACK_Y + Math.cos(t * 47) * a;
            card.setShimmer(Math.sin(t * 3) * 0.1, Math.cos(t * 2.3) * 0.1);
            const color = RARITY_COLOR[card.def.rarity];
            if (Math.random() < dt * 22) {
              fx.light.emit(1, {
                kind: 'star', at: card.position, jitter: [CARD_W * 0.6, CARD_H * 0.6, 0.1], speed: [0.4, 1.3], flatten: 0.3, life: [0.4, 0.9],
                size: [0.05, 0.14], color: [color, 0xffffff], bright: [2, 3.5],
              });
            }
          } else {
            tilt.y.target = clamp(stage.pointer.x * 0.5, -0.5, 0.5);
            tilt.x.target = clamp(-stage.pointer.y * 0.42, -0.42, 0.42);
            card.rotation.set(tilt.x.update(dt), tilt.y.update(dt), 0);
            card.setShimmer(stage.pointer.x * 0.08, stage.pointer.y * 0.08);
          }
        }
      }

      if (phase === 'summary') {
        let over: CardView | null = null;
        const ray = stage.ray();
        for (const c of cards) if (c.hitTest(ray) !== null) over = c;
        if (over !== hoverCard) {
          hoverCard = over;
          if (over) sfx.hover();
        }
        for (const c of cards) {
          const st = rowState.get(c);
          if (!st) continue;
          const on = c === hoverCard;
          st.s.target = on ? st.baseS * 1.28 : st.baseS;
          st.y.target = on ? st.baseY + 0.35 : st.baseY;
          st.z.target = on ? 1 : 0;
          st.ry.target = on ? clamp((px - st.x) * 0.3, -0.45, 0.45) : 0;
          st.rx.target = on ? clamp(-(py - st.baseY) * 0.25, -0.35, 0.35) : 0;
          c.position.set(st.x, st.y.update(dt), st.z.update(dt));
          c.rotation.set(st.rx.update(dt), st.ry.update(dt), 0);
          c.scale.setScalar(st.s.update(dt));
          c.setShimmer(on ? stage.pointer.x * 0.06 : Math.sin(t * 0.7 + st.x) * 0.04, on ? stage.pointer.y * 0.06 : Math.cos(t * 0.6 + st.x) * 0.04);
        }
      }

      // Ambient drifting dust, which ties every phase together.
      if (Math.random() < dt * 7) {
        const c = active ? FACTION_COLOR[active.faction] : 0xffe0b0;
        fx.light.emit(1, {
          kind: 'glow', at: tmpB.set((Math.random() - 0.5) * 18, -6.5, -2.2 + Math.random() * 1.5), dir: UP, cone: 0.25,
          speed: [0.3, 0.8], life: [6, 11], size: [0.02, 0.06], color: c, bright: [0.7, 1.5], drag: 0.02,
        });
      }

      for (const c of cards) c.update(dt);
    },
    dispose() {
      tl.clear();
      tl.timeScale = 1;
      listeners.clear();
      clearAll();
      fx.dispose();
      stage.canvas.style.cursor = '';
    },
  };
};

const PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpE = new THREE.Vector3();
