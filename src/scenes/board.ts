import * as THREE from 'three';
import { CardPile } from '../cards/CardPile';
import { CardLayer, CardView, sharedCardUniforms } from '../cards/CardView';
import { HandController } from '../cards/HandController';
import { CARDS, type CardDef, RARITY_COLOR, type Rarity } from '../cards/data';
import { type Finish, rollFinish } from '../cards/finishes';
import { CARD_H, CARD_W } from '../cards/geometry';
import { type ExitStyle, attack, buff, dissolveOut, flipOver, flyTo, hitReact, impact, refuse, shufflePile, tap, trail } from '../cards/moves';
import { GLSL_COMMON } from '../cards/shaders';
import { Timeline, ease, lerp } from '../core/anim';
import { sfx } from '../core/audio';
import { button, chips, el, panel, section, toggle } from '../core/ui';
import { Fx, makeBackdrop } from '../fx/fx';
import { Listeners, onCanvas, type SceneFactory } from './scene';

// The table is the z = 0 plane and everything on it faces +z. The camera sits low and
// leans in, which gives the Arena/Hearthstone perspective without any special cases:
// cards on the table are just cards with no rotation.

const TABLE_SCALE = 0.62;
const SLOTS = 5;
const SLOT_GAP = 1.86;
const PLAYER_Y = -1.5;
const ENEMY_Y = 1.25;
const PILE_X = 6.1;
const LOOK_AT = new THREE.Vector3(0, -0.35, 0);
const HAND_DISTANCE = 9;

const RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

const TABLE_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}
uniform vec3 uLightPos;
uniform float uDim;
varying vec2 vP;
float box(vec2 p,vec2 b,float r){ vec2 d=abs(p)-b+r; return length(max(d,0.))+min(max(d.x,d.y),0.)-r; }
void main(){
  vec2 p=vP;
  // Worn slate: broad mottling, fine grain and a few long cracks.
  float big=fbm(p*.55);
  float fine=fbm(p*5.5);
  vec3 stone=mix(vec3(.052,.046,.04),vec3(.13,.115,.095),big);
  stone*=.82+.36*fine;
  float crack=smoothstep(.012,.0,abs(fbm(p*.9+7.)-.5));
  stone*=1.-crack*.16;

  // Two inlaid playing fields with a brass edge.
  for(int i=0;i<2;i++){
    float cy=i==0?${PLAYER_Y.toFixed(2)}:${ENEMY_Y.toFixed(2)};
    float d=box(p-vec2(0.,cy),vec2(5.05,1.24),.14);
    stone=mix(stone,stone*.5+vec3(.012,.012,.016),smoothstep(.02,-.02,d));
    float edge=smoothstep(.028,.0,abs(d));
    stone=mix(stone,vec3(.52,.38,.17),edge*.6);
  }
  // Centre rune line, faint.
  float line=smoothstep(.016,.0,abs(p.y-(${((PLAYER_Y + ENEMY_Y) / 2).toFixed(3)})))*smoothstep(5.2,4.,abs(p.x));
  stone+=vec3(.26,.19,.08)*line*.55;

  // A light pooled by distance; it follows the pointer in the scene.
  vec2 lp=uLightPos.xy;
  float pool=exp(-dot(p-lp,p-lp)*.022);
  vec3 c=stone*(.5+1.05*pool);
  c*=smoothstep(14.,4.,length(p*vec2(.74,1.)));
  gl_FragColor=vec4(c*uDim,1.);
}`;

const SLOT_FRAG = /* glsl */ `
uniform float uGlow,uTime;
uniform vec3 uColor;
varying vec2 vUv;
float box(vec2 p,vec2 b,float r){ vec2 d=abs(p)-b+r; return length(max(d,0.))+min(max(d.x,d.y),0.)-r; }
void main(){
  vec2 p=(vUv-.5)*vec2(${(CARD_W * 1.1).toFixed(2)},${(CARD_H * 1.1).toFixed(2)});
  float d=box(p,vec2(${(CARD_W / 2).toFixed(2)},${(CARD_H / 2).toFixed(2)}),.14);
  float line=smoothstep(.035,.0,abs(d));
  float fill=smoothstep(.0,-.05,d);
  float out_=exp(-max(d,0.)*9.);
  float pulse=.75+.25*sin(uTime*5.);
  vec3 col=uColor*(line*(.09+uGlow*1.5*pulse)+fill*uGlow*.14+out_*uGlow*.3*pulse);
  gl_FragColor=vec4(col,1.);
}`;

interface BoardCard {
  card: CardView;
  slot: number;
  side: 'player' | 'enemy';
  tapped?: boolean;
  /** Set while an action is playing, so a second click can't start another on top of it. */
  busy?: boolean;
}

type ClickMode = 'destroy' | 'attack' | 'tap' | 'buff' | 'flip' | 'refuse';

const anyOf = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/** Deck order with some rarity spread, so a demo shows a bit of everything early. */
function makeDeck() {
  return [...CARDS].sort(() => Math.random() - 0.5);
}

export const boardScene: SceneFactory = ({ stage, ui }) => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 200);
  const backdrop = makeBackdrop({ inner: 0x0c0a08, outer: 0x030302 });
  scene.add(backdrop);
  const tl = new Timeline();
  const fx = new Fx(scene, tl, camera);
  const listeners = new Listeners();

  // ---- table ----
  const tableMat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: TABLE_FRAG,
    uniforms: { uLightPos: sharedCardUniforms.uLightPos, uDim: { value: 1 } },
  });
  const table = new THREE.Mesh(new THREE.PlaneGeometry(50, 34), tableMat);
  table.position.z = -0.02;
  table.renderOrder = -10;
  scene.add(table);

  const slotGeo = new THREE.PlaneGeometry(CARD_W * 1.1, CARD_H * 1.1);
  const makeSlot = (x: number, y: number) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: SLOT_FRAG,
      uniforms: { uGlow: { value: 0 }, uTime: sharedCardUniforms.uTime, uColor: { value: new THREE.Color(0xf0d894) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(slotGeo, mat);
    m.position.set(x, y, 0.002);
    m.scale.setScalar(TABLE_SCALE);
    m.renderOrder = -5; // under every card layer
    scene.add(m);
    return { mesh: m, mat, pos: new THREE.Vector3(x, y, 0.016), glow: 0 };
  };
  const slotX = (i: number) => (i - (SLOTS - 1) / 2) * SLOT_GAP;
  const playerSlots = Array.from({ length: SLOTS }, (_, i) => makeSlot(slotX(i), PLAYER_Y));
  const enemySlots = Array.from({ length: SLOTS }, (_, i) => makeSlot(slotX(i), ENEMY_Y));
  const onBoard: BoardCard[] = [];

  // ---- piles ----
  let deckOrder = makeDeck();
  let deckIdx = 0;
  const nextDef = (): CardDef => {
    if (deckIdx >= deckOrder.length) {
      deckOrder = makeDeck();
      deckIdx = 0;
    }
    return deckOrder[deckIdx++];
  };
  const deck = new CardPile(TABLE_SCALE, 0xd8c9a8, CARDS[0]);
  deck.position.set(PILE_X, PLAYER_Y - 0.15, 0);
  deck.setCount(30);
  const grave = new CardPile(TABLE_SCALE, 0x8e8474);
  grave.position.set(-PILE_X, PLAYER_Y - 0.15, 0);
  const enemyDeck = new CardPile(TABLE_SCALE, 0xd8c9a8, CARDS[0]);
  enemyDeck.position.set(-PILE_X, ENEMY_Y + 0.15, 0);
  enemyDeck.setCount(26);
  const enemyGrave = new CardPile(TABLE_SCALE, 0x8e8474);
  enemyGrave.position.set(PILE_X, ENEMY_Y + 0.15, 0);
  scene.add(deck, grave, enemyDeck, enemyGrave);

  // ---- hands ----
  // The hand floats in front of the camera, facing it, whatever angle the table is at.
  const hand = new HandController(stage, {
    radius: 12,
    stepDeg: 5.4,
    maxSpreadDeg: 36,
    cardScale: 0.52,
    hoverScale: 0.86,
    tuck: 0.34,
  });
  scene.add(hand.root);

  const enemyHand = new HandController(stage, { radius: 9, stepDeg: 5, maxSpreadDeg: 26, cardScale: 0.4, baseY: 0, curl: 0, tuck: 0 });
  enemyHand.interactive = false;
  enemyHand.faceDown = true;
  enemyHand.root.position.set(0, 4.75, 0.5);
  enemyHand.root.rotation.z = Math.PI;
  scene.add(enemyHand.root);

  const handHeight = () => HAND_DISTANCE * Math.tan((camera.fov * Math.PI) / 360);
  // Where a drawn card pauses, right of centre. Set in layout, as it depends on the window.
  let revealX = 1.5;

  const finishFor = new Map<CardDef, Finish>();
  const finishOf = (d: CardDef) => {
    if (!finishFor.has(d)) finishFor.set(d, rollFinish(d.rarity));
    return finishFor.get(d)!;
  };

  // Inspect-on-hover preview, like Arena's: a big readable copy, off to the side.
  const preview = new CardView(CARDS[0], finishOf(CARDS[0]), { bare: true });
  preview.flex = 0;
  preview.visible = false;
  preview.setLayer(CardLayer.top);
  hand.root.add(preview);
  let previewFor: CardView | null = null;
  let previewK = 0;

  // ---- flash the world darker for a big moment ----
  const dim = { v: 1 };
  const setDim = (v: number, dur: number) => {
    const from = dim.v;
    return tl.to(dur, (k) => (dim.v = lerp(from, v, k)), { ease: ease.inOutQuad });
  };

  const allCardsLive = () => {
    const list: CardView[] = [...hand.cards, ...enemyHand.cards];
    for (const b of onBoard) list.push(b.card);
    for (const o of scene.children) if (o instanceof CardView) list.push(o);
    return list;
  };

  const handQuat = () => hand.root.quaternion;
  const handForward = () => tmpB.set(0, 0, -1).applyQuaternion(hand.root.quaternion);

  // ---- DRAW ----
  /** Off the deck, turned over mid-flight, a beat in front of the camera, then into the hand. */
  async function draw(delay = 0) {
    if (delay) await tl.wait(delay);
    const def = nextDef();
    const card = new CardView(def, finishOf(def));
    card.scale.setScalar(TABLE_SCALE);
    card.position.copy(deck.topWorld());
    card.rotation.y = Math.PI;
    scene.add(card);
    deck.setCount(deck.size - 1);
    if (deck.size === 0) deck.setCount(30);
    sfx.draw();

    await flyTo(tl, card, { pos: card.position.clone().add(new THREE.Vector3(-0.25, 0.1, 0.85)) }, { dur: 0.16, ease: ease.outCubic });
    sfx.flip();
    const rank = RANK[def.rarity];
    const reveal = hand.root.localToWorld(new THREE.Vector3(revealX + (Math.random() - 0.5) * 0.7, 0.05, 0.1));
    await flyTo(tl, card, { pos: reveal, quat: handQuat(), scale: 0.72 }, {
      dur: 0.44, ease: ease.inOutCubic, spinY: Math.PI, arc: new THREE.Vector3(0, -0.4, 0.5), onStep: trail(fx, def.rarity),
    });
    if (rank >= 2) {
      card.setHalo(1.3);
      sfx.shimmer(rank - 2);
      fx.flash(reveal, { color: RARITY_COLOR[def.rarity], size: 4, amount: 0.9 + rank * 0.25, dur: 0.3 });
    }
    await tl.wait(rank >= 2 ? 0.34 : 0.13);
    sfx.whoosh(0.1);
    hand.add(card);
  }

  // ---- PLAY ----
  const freeSlot = (slots: typeof playerSlots, side: BoardCard['side'], nearX = 0) => {
    let best = -1;
    let bestD = Infinity;
    slots.forEach((s, i) => {
      if (onBoard.some((b) => b.side === side && b.slot === i)) return;
      const d = Math.abs(s.pos.x - nearX);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  /** Neighbours on the table flinch away from an impact, then spring back. */
  function recoil(at: THREE.Vector3, strength: number, except: CardView) {
    for (const b of onBoard) {
      const c = b.card;
      if (c === except || b.busy) continue;
      const dx = c.position.x - at.x;
      const dy = c.position.y - at.y;
      const dist = Math.hypot(dx, dy) || 1;
      const amt = (strength * 0.34) / Math.max(dist, 1);
      const home = c.position.clone();
      const homeR = c.rotation.clone();
      const dir = new THREE.Vector2(dx / dist, dy / dist);
      void tl.to(0.42, (_k, raw) => {
        const w = Math.sin(raw * Math.PI) * (1 - raw * 0.25);
        c.position.set(home.x + dir.x * amt * w, home.y + dir.y * amt * w, home.z + amt * 0.9 * w);
        c.rotation.set(homeR.x - dir.y * amt * 1.1 * w, homeR.y + dir.x * amt * 1.1 * w, homeR.z);
        if (raw >= 1) {
          c.position.copy(home);
          c.rotation.copy(homeR);
        }
      }, { ease: ease.linear, owner: c });
    }
  }

  /**
   * Hero moment, then slam. Weight scales with rarity: a common just lands, a legendary
   * dims the table, gathers light and hits with everything.
   */
  async function playUnit(card: CardView, slotIndex: number, side: BoardCard['side'], slowRead = false) {
    const def = card.def;
    const rank = RANK[def.rarity];
    const slots = side === 'player' ? playerSlots : enemySlots;
    const slot = slots[slotIndex];
    const entry: BoardCard = { card, slot: slotIndex, side };
    onBoard.push(entry); // claim the slot right away, so it can't be double-booked

    scene.attach(card);
    card.setHalo(rank > 0 ? 0.9 : 0.25);
    const hoverPos = new THREE.Vector3(slot.pos.x, slot.pos.y - 0.25, 3.6);
    sfx.whoosh(0.2);
    await flyTo(tl, card, { pos: hoverPos, quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.32, 0, 0)), scale: 0.95 }, {
      dur: slowRead ? 0.5 : 0.28, ease: ease.outCubic,
    });

    // Opponent's actions get held on screen, so they can actually be read.
    if (slowRead) await tl.wait(0.85);

    let rays: ReturnType<Fx['rays']> | null = null;
    if (rank >= 2) {
      void setDim(0.45, 0.25);
      sfx.charge(0.38 + (rank - 2) * 0.27);
      rays = fx.rays(hoverPos.clone().setZ(0.5), { color: RARITY_COLOR[def.rarity], size: 10 + rank * 2.2, amount: 0, order: 4 });
      void rays.fadeTo(0.55 + (rank - 2) * 0.5, 0.3);
      const hold = 0.4 + (rank - 2) * 0.28;
      const color = RARITY_COLOR[def.rarity];
      let t = 0;
      await tl.to(hold, (k, raw) => {
        t += 1;
        card.position.x = hoverPos.x + Math.sin(raw * 90) * 0.015 * k;
        card.position.z = hoverPos.z + k * 0.35;
        // Motes get pulled inward from around the card.
        if (t % 2 === 0) {
          const a = Math.random() * Math.PI * 2;
          const r = 2.4;
          const from = tmpA.set(card.position.x + Math.cos(a) * r, card.position.y + Math.sin(a) * r, card.position.z - 0.3);
          const vel = tmpB.copy(card.position).sub(from).multiplyScalar(2.8);
          fx.light.emit(1, { kind: 'glow', at: from, dir: vel.clone().normalize(), cone: 0.02, speed: vel.length(), life: 0.36, size: [0.03, 0.08], color: [color, 0xffffff], bright: [2, 3.5], drag: 0.01 });
        }
      }, { ease: ease.inQuad });
    } else {
      await tl.wait(0.05);
    }

    // The slam: down fast, accelerating into the table.
    const land = slot.pos.clone();
    await flyTo(tl, card, { pos: land, quat: new THREE.Quaternion(), scale: TABLE_SCALE }, { dur: 0.15 + rank * 0.012, ease: ease.inQuart });

    card.position.copy(land);
    card.setLayer(CardLayer.table);
    impact(stage, fx, land, def.rarity, { scale: TABLE_SCALE * 1.5 });
    recoil(land, 0.3 + rank * 0.28, card);
    void rays?.remove(0.4);
    if (rank >= 2) void setDim(1, 0.35);

    // Squash and settle: the card flashes white and overshoots its scale.
    void tl.to(0.3, (k, raw) => {
      card.u.uFlash.value = (1 - raw) * (0.3 + rank * 0.12);
      const over = 1 + Math.sin(k * Math.PI) * 0.07;
      card.scale.setScalar(TABLE_SCALE * over);
    }, { ease: ease.outCubic, owner: card }).then(() => {
      card.u.uFlash.value = 0;
      card.scale.setScalar(TABLE_SCALE);
    });
    card.setHalo(rank > 0 ? 0.32 + rank * 0.12 : 0);
    card.flex = 0;
    card.setShadow(0.42);
  }

  /** A spell doesn't stay: it hangs in the air, charges, then bursts into motes. */
  async function castSpell(card: CardView, side: BoardCard['side'] = 'player') {
    const def = card.def;
    const color = RARITY_COLOR[def.rarity] === RARITY_COLOR.common ? 0xffd9a0 : RARITY_COLOR[def.rarity];
    scene.attach(card);
    // In front of the camera, so it reads the same whatever the table's perspective is.
    const at = hand.root.localToWorld(new THREE.Vector3(0, 0.45, 0.3));
    sfx.whoosh(0.2);
    await flyTo(tl, card, { pos: at, quat: handQuat(), scale: 0.72 }, { dur: 0.32, ease: ease.outCubic });
    card.setHalo(1.3, color);
    void setDim(0.55, 0.25);
    sfx.charge(0.5);
    const rays = fx.rays(at.clone().addScaledVector(handForward(), 0.6), { color, size: 7, amount: 0, order: 4 });
    void rays.fadeTo(0.75, 0.4);
    await tl.to(0.55, (k) => {
      card.position.y = at.y + k * 0.1;
      card.u.uFlash.value = k * k * 0.22;
    }, { ease: ease.inQuad, owner: card });

    fx.flash(card.position, { color, size: 7, amount: 1.4, dur: 0.3 });
    fx.ring(new THREE.Vector3(0, -0.2, 0.05), { color, size: 11, dur: 0.6, amount: 1.2 });
    stage.ripple(card.position, 0.7, 0.6, 0.6);
    stage.shake(0.2);
    sfx.shimmer(1);
    (card.u.uBurnColor.value as THREE.Color).set(color);
    card.u.uFlash.value = 0;
    const scale = card.scale.x;
    fx.light.emit(170, {
      kind: 'star', at: card.position, jitter: [CARD_W * scale * 0.5, CARD_H * scale * 0.5, 0.05], speed: [1, 6], flatten: 0.5, life: [0.5, 1.4],
      size: [0.04, 0.14], color: [color, 0xffffff], bright: [2, 4], drag: 1.4,
    });
    void rays.remove(0.4);
    void setDim(1, 0.4);
    await tl.to(0.36, (k) => (card.u.uDissolve.value = k), { ease: ease.outQuad, owner: card });
    card.dispose();

    // A spent spell ends in the graveyard, represented by a pile getting taller.
    const pile = side === 'player' ? grave : enemyGrave;
    const graveDef = def;
    const stub = new CardView(graveDef, finishOf(graveDef), { bare: true });
    stub.scale.setScalar(TABLE_SCALE);
    stub.rotation.z = (Math.random() - 0.5) * 0.14;
    stub.position.copy(pile.position);
    pile.setCount(pile.size + 1);
    pile.placeOnTop(stub);
  }

  // ---- DISCARD / DESTROY ----
  let exitStyle: ExitStyle | 'grave' = 'grave';

  /** Arc to the graveyard, turn in flight, land on the pile with a bit of messiness. */
  async function toGrave(card: CardView, pile: CardPile) {
    scene.attach(card);
    card.setLayer(CardLayer.air);
    card.setHalo(0);
    card.flex = 1;
    tl.kill(card);
    const land = pile.topWorld();
    const faceTwist = (Math.random() - 0.5) * 0.24;
    sfx.whoosh(0.14);
    await flyTo(tl, card, {
      pos: land,
      quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, faceTwist)),
      scale: TABLE_SCALE,
    }, { dur: 0.55, ease: ease.inOutCubic, arc: new THREE.Vector3(0, 0.5, 2.4) });
    sfx.thud(0.12);
    fx.dust.emit(14, {
      kind: 'smoke', at: land, jitter: [0.5, 0.7, 0], speed: [0.3, 1], flatten: 0.1, life: [0.4, 0.9], size: [0.2, 0.45], color: 0x3a342c, drag: 3,
    });
    pile.setCount(pile.size + 1);
    card.setShadow(0);
    pile.placeOnTop(card);
    card.position.set(0, 0, pile.height + 0.008);
  }

  async function removeCard(card: CardView, pile: CardPile) {
    if (exitStyle === 'grave') return toGrave(card, pile);
    scene.attach(card);
    // Raised slightly, so a dissolve isn't lost in the table's own texture.
    const up = card.position.z + 0.3;
    await tl.to(0.12, (k) => (card.position.z = lerp(card.position.z, up, k)), { owner: card });
    await dissolveOut(tl, fx, card, exitStyle);
    card.dispose();
  }

  /** Forces a discard from hand: the chosen card shudders, pops up and is gone. */
  async function discardFromHand() {
    if (!hand.slots.length) return;
    const card = anyOf(hand.cards);
    hand.remove(card, scene);
    const start = card.position.clone();
    const up = start.clone().add(new THREE.Vector3(0, 0.55, 0.5));
    await tl.to(0.26, (k, raw) => {
      card.position.lerpVectors(start, up, k);
      card.rotation.z = Math.sin(raw * 34) * 0.05 * (1 - raw);
    }, { ease: ease.outCubic, owner: card });
    await removeCard(card, grave);
  }

  async function destroyOnBoard(b: BoardCard) {
    onBoard.splice(onBoard.indexOf(b), 1);
    b.card.setHalo(0);
    b.card.setShadow(0);
    // Hit reaction: red flash and a rattle before it goes.
    (b.card.u.uBurnColor.value as THREE.Color).setRGB(1, 0.2, 0.1);
    const home = b.card.position.clone();
    await tl.to(0.24, (_k, raw) => {
      b.card.position.x = home.x + Math.sin(raw * 44) * 0.05 * (1 - raw);
      b.card.u.uFlash.value = (1 - raw) * 0.35;
    }, { ease: ease.linear, owner: b.card });
    b.card.u.uFlash.value = 0;
    await removeCard(b.card, b.side === 'player' ? grave : enemyGrave);
  }

  // ---- ACTIONS ON CARDS IN PLAY ----
  let clickMode: ClickMode = 'attack';

  // A tapped card lies sideways, so it is shrunk just enough to stay inside its slot.
  const scaleOf = (b: BoardCard) => TABLE_SCALE * (b.tapped ? 0.84 : 1);

  /** Puts a card squarely back on its slot, in case a flinch or landing bounce was still playing. */
  const rest = (b: BoardCard) => {
    tl.kill(b.card);
    const home = (b.side === 'player' ? playerSlots : enemySlots)[b.slot].pos;
    b.card.position.copy(home);
    b.card.rotation.x = 0;
    b.card.scale.setScalar(scaleOf(b));
    b.card.u.uFlash.value = 0;
  };

  /** One unit strikes another, or the opposing player if their side is empty. */
  async function attackWith(b: BoardCard, target?: BoardCard) {
    const foes = onBoard.filter((o) => o.side !== b.side && !o.busy);
    const victim = target ?? (foes.length ? anyOf(foes) : null);
    const at = victim
      ? victim.card.position.clone()
      : new THREE.Vector3(b.card.position.x * 0.4, b.side === 'player' ? ENEMY_Y + 2.6 : PLAYER_Y - 2.8, 0.016);
    const heavy = RANK[b.card.def.rarity];
    if (victim) {
      victim.busy = true;
      rest(victim);
    }
    await attack(tl, b.card, at, {
      onHit: (point, dir) => {
        sfx.hit(0.3 + heavy * 0.2);
        stage.shake(0.16 + heavy * 0.08);
        fx.flash(point, { color: 0xfff0d0, size: 2.6 + heavy * 0.5, amount: 1.2, dur: 0.16 });
        fx.ring(point, { color: 0xffe2b0, size: 3 + heavy, dur: 0.3, width: 0.05, amount: 1 });
        // Sparks carry on in the direction of the blow.
        fx.light.emit(26 + heavy * 12, {
          kind: 'spark', at: point, jitter: [0.2, 0.2, 0.05], dir, cone: 0.9, speed: [2, 8], flatten: 0.5,
          life: [0.2, 0.5], size: [0.018, 0.04], color: [0xffe9b8, 0xffffff, RARITY_COLOR[b.card.def.rarity]], bright: [2, 4.5], gravity: [0, 0, -8], drag: 2,
        });
        if (victim) void hitReact(tl, victim.card, b.card.position, 0.8 + heavy * 0.15).then(() => (victim.busy = false));
        else stage.aberrationPulse = Math.max(stage.aberrationPulse, 0.5);
      },
    });
  }

  /** Runs whichever action the panel has selected on a clicked card. */
  async function act(b: BoardCard) {
    if (clickMode === 'destroy') return destroyOnBoard(b);
    if (b.busy) return;
    b.busy = true;
    rest(b);
    if (clickMode === 'attack') await attackWith(b);
    else if (clickMode === 'tap') {
      b.tapped = !b.tapped;
      await tap(tl, b.card, b.tapped, scaleOf(b));
    }
    else if (clickMode === 'buff') await buff(tl, fx, b.card, b.side === 'player' ? 0x9dffb0 : 0xff9d8a);
    else if (clickMode === 'flip') await flipOver(tl, b.card);
    else await refuse(tl, b.card);
    b.busy = false;
  }

  // ---- OPPONENT ----
  async function enemyDraw(delay = 0) {
    if (delay) await tl.wait(delay);
    const def = nextDef();
    const card = new CardView(def, finishOf(def), { faceDown: true });
    card.scale.setScalar(TABLE_SCALE);
    card.position.copy(enemyDeck.topWorld());
    scene.add(card);
    enemyDeck.setCount(enemyDeck.size - 1);
    if (enemyDeck.size === 0) enemyDeck.setCount(26);
    sfx.draw();
    enemyHand.add(card);
  }

  async function enemyPlay() {
    if (!enemyHand.slots.length) await enemyDraw();
    const slot = freeSlot(enemySlots, 'enemy');
    if (slot < 0) return;
    const units = enemyHand.cards.filter((c) => c.def.type !== 'Spell');
    const card = units.length ? anyOf(units) : anyOf(enemyHand.cards);
    enemyHand.remove(card, scene);
    if (card.def.type === 'Spell') {
      await flyTo(tl, card, { pos: new THREE.Vector3(0, 3, 3), quat: handQuat(), scale: 0.8 }, { dur: 0.55, spinY: Math.PI, ease: ease.inOutCubic });
      await tl.wait(0.8);
      await castSpell(card, 'enemy');
    } else {
      // Turn it over on the way out, then give the player time to read it.
      await flyTo(tl, card, { pos: new THREE.Vector3(enemySlots[slot].pos.x * 0.6, 2.6, 3.2), quat: handQuat(), scale: 0.88 }, { dur: 0.55, spinY: Math.PI, ease: ease.inOutCubic });
      await playUnit(card, slot, 'enemy', true);
    }
    void enemyDraw(0.1);
  }

  // ---- input and panel ----
  let hoverSlot = -1;
  const snap = { x: 0, y: 0 };

  hand.events.onDrag = (card) => {
    // Project the dragged card onto the table to find which slot it's over.
    const ray = stage.ray();
    const hit = ray.intersectPlane(TABLE_PLANE, tmpA);
    snap.x = hit?.x ?? 0;
    snap.y = hit?.y ?? 0;
    const overBoard = (hit?.y ?? -99) > PLAYER_Y - 2.2;
    hoverSlot = card.def.type !== 'Spell' && overBoard ? freeSlot(playerSlots, 'player', snap.x) : -1;
  };
  hand.events.onRelease = (card) => {
    const overBoard = snap.y > PLAYER_Y - 2.2;
    const isSpell = card.def.type === 'Spell';
    const target = hoverSlot;
    hoverSlot = -1;
    if (!overBoard) return false;
    if (isSpell) {
      hand.remove(card, scene);
      void castSpell(card);
      return true;
    }
    if (target < 0) return false;
    hand.remove(card, scene);
    void playUnit(card, target, 'player');
    return true;
  };

  listeners.on('pointerdown', (e) => {
    if (!onCanvas(e)) return;
    if (hand.pointerDown()) return;
    const b = boardUnderPointer();
    if (b) void act(b);
  });
  listeners.on('pointerup', () => hand.pointerUp());

  const boardUnderPointer = () => {
    const ray = stage.ray();
    for (const b of onBoard) if (b.card.hitTest(ray) !== null && tl && !tlBusy(b.card)) return b;
    return null;
  };

  const { root, body } = panel('Board');
  ui.append(root);
  let auto = false;
  const clearBoard = () => {
    for (const b of [...onBoard]) void destroyOnBoard(b);
  };

  body.append(
    section(
      'Draw',
      el('div', { class: 'btn-grid' },
        button('Draw 1', () => void draw()),
        button('Draw 3', () => { for (let i = 0; i < 3; i++) void draw(i * 0.2); }),
      ),
    ),
    section(
      'Play',
      el('div', { class: 'hint', text: 'Drag a card onto the board. Units land in the nearest free slot; spells go anywhere.' }),
      el('div', { class: 'btn-grid' }, button('Auto-play', () => autoPlay())),
    ),
    section(
      'Cards in play',
      chips<ClickMode>(
        [
          { id: 'attack', label: 'Attack' },
          { id: 'tap', label: 'Tap' },
          { id: 'buff', label: 'Buff' },
          { id: 'flip', label: 'Flip' },
          { id: 'refuse', label: 'Refuse' },
          { id: 'destroy', label: 'Destroy' },
        ],
        clickMode,
        (id) => (clickMode = id),
      ).root,
      el('div', { class: 'hint', text: 'Click a card on the table to do this. Attacks pick a random opposing unit, or go for the player if there is none.' }),
      el('div', { class: 'btn-grid' },
        button('Shuffle deck', () => void shufflePile(tl, deck, scene, CARDS[0])),
      ),
    ),
    section(
      'Leaving play',
      chips<ExitStyle | 'grave'>(
        [
          { id: 'grave', label: 'Graveyard' },
          { id: 'burn', label: 'Burn' },
          { id: 'shatter', label: 'Shatter' },
          { id: 'sand', label: 'Sand' },
        ],
        exitStyle,
        (id) => (exitStyle = id),
      ).root,
      el('div', { class: 'hint', text: 'How a destroyed card leaves the table.' }),
      el('div', { class: 'btn-grid' },
        button('Discard', () => void discardFromHand()),
        button('Clear board', clearBoard),
      ),
    ),
    section(
      'Opponent',
      el('div', { class: 'btn-grid' }, button('Opponent plays', () => void enemyPlay())),
      el('div', { class: 'hint', text: 'Held on screen longer, so their move can be read.' }),
    ),
    section('Demo', toggle('Run on a loop', false, (v) => {
      auto = v;
      if (v) void demoLoop();
    })),
  );

  function autoPlay() {
    const units = hand.cards.filter((c) => c.def.type !== 'Spell');
    const spell = hand.cards.find((c) => c.def.type === 'Spell');
    const slot = freeSlot(playerSlots, 'player');
    if (units.length && slot >= 0) {
      const card = anyOf(units);
      hand.remove(card, scene);
      return playUnit(card, slot, 'player');
    }
    if (spell) {
      hand.remove(spell, scene);
      return castSpell(spell);
    }
    return Promise.resolve();
  }

  async function demoLoop() {
    while (auto) {
      if (hand.slots.length < 3) {
        for (let i = 0; i < 3; i++) void draw(i * 0.2);
        await tl.wait(1.2);
      }
      await autoPlay();
      await tl.wait(0.7);
      if (!auto) break;
      await enemyPlay();
      await tl.wait(0.7);
      // Combat: one unit from each side swings, if there is anyone to swing.
      for (const side of ['player', 'enemy'] as const) {
        const mine = onBoard.filter((o) => o.side === side && !o.busy && !tlBusy(o.card));
        if (!auto || !mine.length || Math.random() < 0.3) continue;
        const who = anyOf(mine);
        who.busy = true;
        rest(who);
        await attackWith(who);
        who.busy = false;
        await tl.wait(0.35);
      }
      const roll = Math.random();
      if (onBoard.length >= 6 || roll < 0.35) {
        const pick = anyOf(onBoard);
        if (pick) {
          const styles: (ExitStyle | 'grave')[] = ['grave', 'burn', 'shatter', 'sand'];
          const prev = exitStyle;
          exitStyle = anyOf(styles);
          await destroyOnBoard(pick);
          exitStyle = prev;
        }
      } else if (roll < 0.5) {
        await discardFromHand();
      }
      await tl.wait(0.45);
    }
  }

  // Opening deal, both sides.
  void tl.wait(0.25).then(async () => {
    for (let i = 0; i < 4; i++) void draw(i * 0.26);
    for (let i = 0; i < 4; i++) void enemyDraw(0.15 + i * 0.16);
  });

  const layout = () => {
    stage.centerBesidePanel(camera);
    (backdrop.material as THREE.ShaderMaterial).uniforms.uAspect.value = camera.aspect;
    // Keep the whole table in view on narrower windows, then lean in.
    const dist = Math.max(16.5, stage.fitDistance(camera, 20, 11, true));
    camera.position.set(0, LOOK_AT.y - dist * 0.44, dist * 0.9);
    camera.up.set(0, 1, 0);
    camera.lookAt(LOOK_AT);
    camera.updateMatrixWorld();

    // Hang the hand off the camera at a fixed distance.
    const forward = tmpA.set(0, 0, -1).applyQuaternion(camera.quaternion);
    hand.root.position.copy(camera.position).addScaledVector(forward, HAND_DISTANCE);
    hand.root.quaternion.copy(camera.quaternion);
    const h = handHeight();
    const p = hand.params;
    p.baseY = -h + 0.72;
    p.hoverY = -h + (CARD_H * p.hoverScale) / 2 + 0.24;
    // The panel takes space off the picture, so the room either side of centre is less than
    // half the window. Anything placed relative to the screen edge has to respect that.
    // A hovered card lifts toward the camera and looks wider, hence the last factor.
    p.halfWidth = (h * camera.aspect - (stage.panelShift * 2 * h) / stage.height) * ((HAND_DISTANCE - 0.5) / HAND_DISTANCE);
    revealX = Math.max(0.6, p.halfWidth - (CARD_W * 0.72) / 2 - 0.45);
    // Narrow the fan's limit so a full hand's edge cards stay on screen.
    const fanRoom = Math.max(0.5, p.halfWidth - (CARD_W * p.cardScale) / 2);
    p.maxSpreadDeg = Math.min(36, THREE.MathUtils.radToDeg(Math.asin(Math.min(1, fanRoom / p.radius))) * 2);
    const PREVIEW_Z = 0.6;
    const atPreview = (HAND_DISTANCE - PREVIEW_Z) / HAND_DISTANCE;
    preview.position.set(-p.halfWidth * atPreview + (CARD_W * 0.62) / 2 + 0.12, 0.42, PREVIEW_Z);
  };

  return {
    scene,
    camera,
    resize: layout,
    update(dt, t) {
      tl.update(dt);
      fx.update(t);
      hand.update(dt, t);
      enemyHand.update(dt, t);

      // The light roams with the pointer across the table.
      const onTable = stage.pointOnPlane(TABLE_PLANE, tmpA);
      if (onTable) sharedCardUniforms.uLightPos.value.set(onTable.x * 0.8, onTable.y * 0.8, 7);

      // Slot glow eases toward whichever one is being targeted.
      const draggingUnit = hand.dragging && hand.dragging.card.def.type !== 'Spell';
      playerSlots.forEach((s, i) => {
        const taken = onBoard.some((b) => b.side === 'player' && b.slot === i);
        const target = hoverSlot === i ? 1 : draggingUnit && !taken ? 0.22 : 0;
        s.glow += (target - s.glow) * Math.min(1, dt * 12);
        s.mat.uniforms.uGlow.value = s.glow;
      });

      // Everything dims together during a big moment, except the card causing it.
      tableMat.uniforms.uDim.value = dim.v;
      const live = allCardsLive();
      for (const c of live) {
        c.update(dt);
        c.u.uDim.value = c.parent === scene ? 1 : dim.v;
      }
      for (const b of onBoard) {
        if (b.card.parent === scene && !tlBusy(b.card)) b.card.u.uDim.value = dim.v;
        b.card.setShimmer(Math.sin(t * 0.55 + b.slot) * 0.05, Math.cos(t * 0.5 + b.slot * 2) * 0.05);
      }

      // Hover preview for cards on the table.
      const over = hand.dragging || hand.hovered ? null : boardUnderPointer();
      const target = over?.card ?? null;
      if (target !== previewFor) {
        previewFor = target;
        if (target) {
          preview.setDef(target.def);
          preview.setFinish(finishOf(target.def));
          sfx.hover();
        }
      }
      stage.canvas.style.cursor = hand.dragging ? 'grabbing' : hand.hovered || over ? 'pointer' : '';
      previewK += ((target ? 1 : 0) - previewK) * Math.min(1, dt * 14);
      preview.visible = previewK > 0.01;
      preview.scale.setScalar(0.5 + 0.12 * previewK);
      preview.rotation.y = (stage.pointer.x + 0.68) * 0.25;
      preview.rotation.x = -stage.pointer.y * 0.2;
    },
    dispose() {
      auto = false;
      tl.clear();
      listeners.clear();
      fx.dispose();
      for (const c of allCardsLive()) c.dispose();
      preview.dispose();
      deck.dispose();
      grave.dispose();
      enemyDeck.dispose();
      enemyGrave.dispose();
      tableMat.dispose();
      table.geometry.dispose();
      slotGeo.dispose();
      for (const s of [...playerSlots, ...enemySlots]) s.mat.dispose();
      stage.canvas.style.cursor = '';
    },
  };
};

const tlBusy = (c: CardView) => c.flex !== 0;
const TABLE_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
