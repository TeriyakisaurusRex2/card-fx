import * as THREE from 'three';
import { Spring, clamp } from '../core/anim';
import { sfx } from '../core/audio';
import type { Stage } from '../core/stage';
import { CardLayer, type CardView } from './CardView';
import { CARD_H, CARD_W } from './geometry';

export interface HandParams {
  /** Radius of the circle the fan sits on. Larger is flatter. */
  radius: number;
  /** Angle between neighbours, in degrees, until the hand gets too wide. */
  stepDeg: number;
  /** The whole fan never opens wider than this, however many cards. */
  maxSpreadDeg: number;
  /** Local y of the centre of a card at the top of the arc. */
  baseY: number;
  cardScale: number;
  hoverScale: number;
  /** Local y a hovered card's centre rises to. */
  hoverY: number;
  /** Angle added around a hovered card, in degrees, so neighbours make room. */
  pushDeg: number;
  /** How far the hand sinks while the pointer is elsewhere. 0 keeps it fully raised. */
  tuck: number;
  /** Slight cylindrical curl per card, like holding real cards. */
  curl: number;
  /** Used to clamp a hovered card so it can't hang off the screen. */
  halfWidth: number;
}

export const DEFAULT_HAND: HandParams = {
  radius: 13,
  stepDeg: 6.2,
  maxSpreadDeg: 42,
  baseY: -3,
  cardScale: 0.9,
  hoverScale: 1.5,
  hoverY: -1.5,
  pushDeg: 4.6,
  tuck: 1.2,
  curl: 0.008,
  halfWidth: 8,
};

/**
 * How the hand's springs feel. Stiffness says how hard a spring pulls toward its target and
 * damping how hard it brakes. Each pair here is "critically damped" (damping = 2 x the
 * square root of stiffness): the fastest a spring can arrive without overshooting, so
 * nothing wobbles. Higher stiffness = quicker.
 */
const SNAP = { k: 900, d: 60 }; // hover, making room, returning: settles in about 0.15s
const ARRIVE = { k: 240, d: 31 }; // a card drawn into the hand glides in over about 0.3s
const DRAG = { k: 2600, d: 102 }; // a held card is all but glued to the pointer

interface Slot {
  card: CardView;
  x: Spring;
  y: Spring;
  z: Spring;
  rot: Spring;
  rx: Spring;
  ry: Spring;
  s: Spring;
  // Rest pose from the most recent layout, used for stable pointer tests.
  restX: number;
  restY: number;
  restRot: number;
  /** Still on its way in, so it paints above the fan until it has nearly reached its place. */
  arriving: boolean;
}

export interface HandEvents {
  /** Dragged card released. Return true if it was taken (the hand forgets it). */
  onRelease?: (card: CardView, world: THREE.Vector3) => boolean;
  onDrag?: (card: CardView, world: THREE.Vector3) => void;
  onHover?: (card: CardView | null) => void;
}

/**
 * Lays out a fan of cards, handles hover and drag.
 *
 * `root` is an ordinary group, so the same code runs flat on screen or as a hand floating
 * in front of a tilted board camera. Everything is computed in its local space.
 *
 * Layout only ever sets spring targets. A card can therefore be interrupted at any moment
 * (a new card arrives, one gets dragged out) and everything flows to the new arrangement
 * from wherever it currently is, with no animation states to manage.
 */
export class HandController {
  readonly root = new THREE.Group();
  readonly slots: Slot[] = [];
  params: HandParams;
  events: HandEvents = {};
  interactive = true;
  faceDown = false;

  hovered: Slot | null = null;
  dragging: Slot | null = null;
  private tuckK = new Spring(1, 700, 53);
  private grab = new THREE.Vector2();
  private pointerLocal = new THREE.Vector2();
  private pointerOn = false;
  private plane = new THREE.Plane();

  constructor(
    private stage: Stage,
    params: Partial<HandParams> = {},
  ) {
    this.params = { ...DEFAULT_HAND, ...params };
  }

  get cards() {
    return this.slots.map((s) => s.card);
  }

  /** Pointer position in the hand's local space, updated each frame and on release. */
  get pointer(): Readonly<THREE.Vector2> {
    return this.pointerLocal;
  }

  /**
   * Takes a card from anywhere in the scene. Its current world pose is preserved and the
   * springs pick it up from there, so it flows into the fan from wherever it was.
   */
  add(card: CardView, index = this.slots.length) {
    this.root.attach(card);
    card.setLayer(CardLayer.air);
    const r = new THREE.Euler().setFromQuaternion(card.quaternion, 'XYZ');
    // Every rotation can be written two ways. Pick the one whose y is already close to where
    // this hand wants it, or the springs would swing the card over and show its other side.
    const wantY = this.faceDown ? Math.PI : 0;
    if (Math.abs(wrapAngle(r.y - wantY)) > Math.abs(wrapAngle(Math.PI - r.y - wantY))) {
      r.set(r.x + Math.PI, Math.PI - r.y, r.z + Math.PI);
    }
    const mk = (v: number, k: number, d: number) => new Spring(v, k, d);
    const slot: Slot = {
      card,
      x: mk(card.position.x, ARRIVE.k, ARRIVE.d),
      y: mk(card.position.y, ARRIVE.k, ARRIVE.d),
      z: mk(card.position.z, SNAP.k, SNAP.d),
      rot: mk(wrapAngle(r.z), ARRIVE.k, ARRIVE.d),
      rx: mk(wrapAngle(r.x), ARRIVE.k, ARRIVE.d),
      ry: mk(wantY + wrapAngle(r.y - wantY), ARRIVE.k, ARRIVE.d),
      s: mk(card.scale.x, SNAP.k, SNAP.d),
      restX: 0,
      restY: 0,
      restRot: 0,
      arriving: true,
    };
    this.slots.splice(clamp(index, 0, this.slots.length), 0, slot);
    return slot;
  }

  /** Hands the card back to `parent` (usually the scene) at its current world pose. */
  remove(card: CardView, parent: THREE.Object3D) {
    const i = this.slots.findIndex((s) => s.card === card);
    if (i < 0) return;
    const slot = this.slots[i];
    this.slots.splice(i, 1);
    if (this.hovered === slot) this.hovered = null;
    if (this.dragging === slot) this.dragging = null;
    parent.attach(card);
    card.setLayer(CardLayer.air);
    card.setHalo(0);
    card.bendExtra.set(0, 0, 0);
    card.setShimmer(0, 0);
  }

  pointerDown() {
    if (!this.interactive) return false;
    // Hover normally updates per frame; a press can arrive sooner, so check it now as well.
    this.updatePointer();
    this.hovered ??= this.pickSlot();
    if (!this.hovered) return false;
    this.dragging = this.hovered;
    this.grab.set(this.dragging.x.value - this.pointerLocal.x, this.dragging.y.value - this.pointerLocal.y);
    // Pull the grabbed point toward the pointer a bit, so the card doesn't hang off it.
    this.grab.multiplyScalar(0.35);
    this.dragging.x.stiffness = this.dragging.y.stiffness = DRAG.k;
    this.dragging.x.damping = this.dragging.y.damping = DRAG.d;
    this.dragging.rot.stiffness = SNAP.k;
    this.dragging.rot.damping = SNAP.d;
    sfx.draw();
    return true;
  }

  pointerUp() {
    const d = this.dragging;
    if (!d) return;
    // A quick flick can end before the next frame, so read the pointer fresh for the drop.
    this.updatePointer();
    this.events.onDrag?.(d.card, d.card.getWorldPosition(tmpW));
    this.dragging = null;
    d.x.stiffness = d.y.stiffness = SNAP.k;
    d.x.damping = d.y.damping = SNAP.d;
    const world = d.card.getWorldPosition(new THREE.Vector3());
    if (this.events.onRelease?.(d.card, world)) return;
    sfx.whoosh(0.1);
  }

  private anglesFor(n: number) {
    const p = this.params;
    const stepMax = n > 1 ? (p.maxSpreadDeg / (n - 1)) * DEG : 0;
    const step = Math.min(p.stepDeg * DEG, stepMax);
    return (i: number) => (i - (n - 1) / 2) * step;
  }

  private updatePointer() {
    const s = this.stage;
    this.root.updateWorldMatrix(true, false);
    this.plane.setFromNormalAndCoplanarPoint(
      tmpN.set(0, 0, 1).transformDirection(this.root.matrixWorld),
      tmpW.setFromMatrixPosition(this.root.matrixWorld),
    );
    const hit = s.pointOnPlane(this.plane, tmpW);
    this.pointerOn = false;
    if (!hit) return;
    invRoot.copy(this.root.matrixWorld).invert();
    tmpW.applyMatrix4(invRoot);
    this.pointerLocal.set(tmpW.x, tmpW.y);
    this.pointerOn = s.pointerInside;
  }

  /** Does the pointer land on a card's rest rectangle, in that card's rotated frame? */
  private pickSlot() {
    if (!this.pointerOn || !this.interactive) return null;
    const p = this.params;
    const px = this.pointerLocal.x;
    const py = this.pointerLocal.y;
    const halfW = (CARD_W * p.cardScale) / 2;
    const halfH = (CARD_H * p.cardScale) / 2;
    let inBand = false;
    for (const s of this.slots) {
      if (s === this.dragging) continue;
      const c = Math.cos(-s.restRot);
      const n = Math.sin(-s.restRot);
      const dx = px - s.restX;
      const dy = py - s.restY;
      const lx = dx * c - dy * n;
      const ly = dx * n + dy * c;
      if (Math.abs(lx) <= halfW && Math.abs(ly) <= halfH) {
        inBand = true;
        break;
      }
    }
    // Keep a card selected while the pointer is on its raised, enlarged self.
    const h = this.hovered;
    if (!inBand && h) {
      const dx = Math.abs(px - h.x.value);
      const dy = Math.abs(py - h.y.value);
      if (dx <= (CARD_W * h.s.value) / 2 && dy <= (CARD_H * h.s.value) / 2) return h;
    }
    if (!inBand) return null;
    // Nearest card by x, not topmost: that makes sweeping left and right feel symmetric,
    // even though each card's rectangle is mostly hidden under its neighbour.
    let best: Slot | null = null;
    let bestD = Infinity;
    for (const s of this.slots) {
      if (s === this.dragging) continue;
      const d = Math.abs(px - s.restX);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  update(dt: number, _t: number) {
    const p = this.params;
    this.updatePointer();

    if (!this.dragging) {
      const next = this.pickSlot();
      if (next !== this.hovered) {
        this.hovered = next;
        if (next) sfx.hover();
        this.events.onHover?.(next?.card ?? null);
      }
    } else {
      this.events.onDrag?.(this.dragging.card, this.dragging.card.getWorldPosition(tmpW));
    }

    // Tuck: 1 = sunk, 0 = raised.
    this.tuckK.target = this.hovered || this.dragging ? 0 : 1;
    const sink = this.tuckK.update(dt) * p.tuck;

    const layoutSlots = this.slots.filter((s) => s !== this.dragging);
    const n = layoutSlots.length;
    const angleOf = this.anglesFor(n);
    const hoverIdx = this.hovered ? layoutSlots.indexOf(this.hovered) : -1;

    layoutSlots.forEach((s, i) => {
      const a0 = angleOf(i);
      s.restX = Math.sin(a0) * p.radius;
      s.restY = p.baseY + (Math.cos(a0) - 1) * p.radius;
      s.restRot = -a0;

      let a = a0;
      if (hoverIdx >= 0 && i !== hoverIdx) {
        // Push neighbours along the arc; the effect falls off with distance.
        const d = i - hoverIdx;
        a += Math.sign(d) * (p.pushDeg * DEG) / Math.pow(Math.abs(d), 0.75);
      }
      const isHover = i === hoverIdx;
      const x = Math.sin(a) * p.radius;
      const y = p.baseY + (Math.cos(a) - 1) * p.radius - sink;

      if (isHover) {
        const hw = (CARD_W * p.hoverScale) / 2;
        s.x.target = clamp(x, -p.halfWidth + hw, p.halfWidth - hw);
        s.y.target = p.hoverY;
        s.rot.target = 0;
        s.s.target = p.hoverScale;
        s.z.target = 0.5;
      } else {
        s.x.target = x;
        s.y.target = y;
        s.rot.target = -a;
        s.s.target = p.cardScale;
        s.z.target = i * 0.022;
      }
      s.rx.target = 0;
      s.ry.target = this.faceDown ? Math.PI : 0;
      s.card.setHalo(isHover ? 1.1 : 0);
      s.card.bendExtra.x = isHover ? 0 : p.curl;
      // Foil answers the pointer's side of the hand, even on cards that don't move.
      if (this.pointerOn) s.card.setShimmer((this.pointerLocal.x - x) * 0.018, (this.pointerLocal.y - y) * 0.018);
    });

    const d = this.dragging;
    if (d) {
      d.x.target = this.pointerLocal.x + this.grab.x;
      d.y.target = this.pointerLocal.y + this.grab.y;
      d.z.target = 0.9;
      d.rot.target = 0;
      d.s.target = p.cardScale * 1.08;
      d.card.setHalo(1.5);
      d.card.setShimmer(0, 0);
    }

    for (const s of this.slots) {
      // A travelling card rides above the fan, so its lean can't swing through a neighbour.
      if (s !== d && s !== this.hovered) s.z.target += Math.min(Math.hypot(s.x.velocity, s.y.velocity) * 0.035, 0.7);
      s.card.position.set(s.x.update(dt), s.y.update(dt), s.z.update(dt));
      s.card.rotation.set(s.rx.update(dt), s.ry.update(dt), s.rot.update(dt));
      s.card.scale.setScalar(s.s.update(dt));
      s.card.setShadow(s === this.hovered || s === d ? 0.7 : 0.5);
      if (s.arriving && Math.hypot(s.x.value - s.x.target, s.y.value - s.y.target) < 0.3) {
        s.arriving = false;
        s.card.setLayer(CardLayer.hand);
        // Once it has landed, the card answers the pointer as crisply as the rest.
        for (const sp of [s.x, s.y, s.rot, s.rx, s.ry]) {
          sp.stiffness = SNAP.k;
          sp.damping = SNAP.d;
        }
      }
    }
  }
}

const DEG = Math.PI / 180;
/** The same angle, expressed between -PI and PI. */
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const tmpN = new THREE.Vector3();
const tmpW = new THREE.Vector3();
const invRoot = new THREE.Matrix4();
