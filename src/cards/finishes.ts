import * as THREE from 'three';
import type { Rarity } from './data';

// A finish is plain data: how much of each foil layer applies to each region of the card.
// One shader runs every finish, so there is one program to compile no matter how many
// finishes a game ships, and a designer can add a new one without writing GLSL.

/** Coverage per region of the card: [art, frame, paper (title, rules)]. */
export type Regions = [number, number, number];

export interface Finish {
  metal: Regions;
  metalTint: number;
  /** 0 = mirror, higher = visibly brushed. */
  brush: number;
  prism: Regions;
  pillars: Regions;
  cosmos: Regions;
  glitter: Regions;
  shards: Regions;
  etch: Regions;
  poly: Regions;
  /** Turns the art into a gold duotone. */
  gild: number;
  /** How far the art window sits behind the card surface. */
  depth: number;
  /** Periodic light sweep, which keeps a card alive while it lies still. */
  sweep: number;
  /** Animated fire running through the frame. */
  fire: number;
  /** How strongly the art's own light and dark catch the light. */
  relief: number;
  gloss: number;
  /** Rotates every rainbow, for per-card variety. */
  hue: number;
}

const NONE: Regions = [0, 0, 0];

const BASE: Finish = {
  metal: NONE, metalTint: 0xffffff, brush: 0.12,
  prism: NONE, pillars: NONE, cosmos: NONE, glitter: NONE, shards: NONE, etch: NONE, poly: NONE,
  gild: 0, depth: 0, sweep: 0, fire: 0, relief: 0, gloss: 0.5, hue: 0,
};

const def = (f: Partial<Finish>): Finish => ({ ...BASE, ...f });

export interface FinishEntry {
  id: string;
  name: string;
  group: 'Print' | 'Partial' | 'Chromatic' | 'Metal' | 'Holographic' | 'Living';
  blurb: string;
  finish: Finish;
}

export const FINISHES: FinishEntry[] = [
  {
    id: 'matte', name: 'Matte', group: 'Print',
    blurb: 'The baseline: plain ink on card stock, with a faint laminate sheen.',
    finish: def({ gloss: 0.25 }),
  },
  {
    id: 'artfoil', name: 'Art Foil', group: 'Partial',
    blurb: 'Partial chromatic: rainbow film across the art window only. Frame and text stay plain.',
    finish: def({ prism: [1, 0, 0], relief: 0.7, gloss: 0.8 }),
  },
  {
    id: 'framefoil', name: 'Frame Foil', group: 'Partial',
    blurb: 'Partial chromatic, inverted: clean art inside a prismatic frame.',
    finish: def({ prism: [0, 1, 0.25], metal: [0, 0.75, 0], metalTint: 0xe8e8f0, brush: 0.05 }),
  },
  {
    id: 'prismatic', name: 'Full Chromatic', group: 'Chromatic',
    blurb: 'The whole card sits on a thin-film foil; colour drifts with viewing angle.',
    finish: def({ prism: [1, 1, 0.8], metal: [0, 0.35, 0], relief: 0.8, gloss: 1 }),
  },
  {
    id: 'polychrome', name: 'Polychrome', group: 'Chromatic',
    blurb: 'Rotates the hue of the print itself through a slow liquid warp.',
    finish: def({ poly: [1, 1, 0.5], prism: [0.25, 0.3, 0.15], gloss: 0.9 }),
  },
  {
    id: 'gilded', name: 'Gilded Frame', group: 'Metal',
    blurb: 'Metallic parts: a real reflective gold frame with embossed bevels around normal art.',
    finish: def({ metal: [0, 1, 0.15], metalTint: 0xffc964, brush: 0.1, sweep: 0.35, gloss: 0.7 }),
  },
  {
    id: 'steel', name: 'Brushed Steel', group: 'Metal',
    blurb: 'Cold, directional brushing. The highlight streaks across the grain.',
    finish: def({ metal: [0, 1, 0.2], metalTint: 0xcfd8e6, brush: 0.75, gloss: 0.5 }),
  },
  {
    id: 'solidgold', name: 'Solid Gold', group: 'Metal',
    blurb: 'The art itself is struck in gold, relief and all. Rarest-of-the-rare territory.',
    finish: def({ metal: [0.65, 1, 0.12], metalTint: 0xffc660, brush: 0.08, gild: 1, relief: 2.4, sweep: 0.8, glitter: [0.25, 0.1, 0], gloss: 1 }),
  },
  {
    id: 'sunpillar', name: 'Sun Pillar', group: 'Holographic',
    blurb: 'Classic holo: vertical rainbow pillars over fine diagonal foil lines.',
    finish: def({ pillars: [1, 0.55, 0.15], relief: 0.8, gloss: 0.8 }),
  },
  {
    id: 'cosmos', name: 'Cosmos', group: 'Holographic',
    blurb: 'Star-field foil: each star is its own tiny mirror, so they flash one at a time.',
    finish: def({ cosmos: [1, 0.45, 0.1], glitter: [0.4, 0.2, 0], relief: 0.5, gloss: 0.8 }),
  },
  {
    id: 'crackedice', name: 'Cracked Ice', group: 'Holographic',
    blurb: 'Faceted foil: every shard is tilted differently and lights up on its own angle.',
    finish: def({ shards: [1, 0.8, 0.3], gloss: 0.8 }),
  },
  {
    id: 'etched', name: 'Etched', group: 'Holographic',
    blurb: 'Foil only inside engraved guilloche lines, as on a banknote.',
    finish: def({ etch: [1, 1, 0.35], metal: [0, 0.5, 0], metalTint: 0xe6e0d0, relief: 0.6 }),
  },
  {
    id: 'stardust', name: 'Stardust', group: 'Holographic',
    blurb: 'Dense metallic glitter over the whole card, with no rainbow behind it.',
    finish: def({ glitter: [1, 1, 0.3], gloss: 0.5 }),
  },
  {
    id: 'void', name: 'Void Window', group: 'Living',
    blurb: 'Partial 3D: the art sits deep behind the frame like a window, with motes drifting inside.',
    finish: def({ depth: 0.075, metal: [0, 0.8, 0], metalTint: 0xb9aef0, brush: 0.04, prism: [0.12, 0, 0], gloss: 0.6 }),
  },
  {
    id: 'emberforged', name: 'Emberforged', group: 'Living',
    blurb: 'Fire runs through the frame on its own, so it needs no tilt to come alive.',
    finish: def({ fire: 1, metal: [0, 0.75, 0], metalTint: 0xb9683a, brush: 0.2, relief: 0.5, gloss: 0.6 }),
  },
];

export const finishById = (id: string) => FINISHES.find((f) => f.id === id) ?? FINISHES[0];

const BY_RARITY: Record<Rarity, string[]> = {
  common: ['matte', 'matte', 'matte', 'artfoil'],
  rare: ['artfoil', 'framefoil', 'steel', 'stardust', 'gilded'],
  epic: ['gilded', 'crackedice', 'sunpillar', 'etched', 'cosmos'],
  legendary: ['solidgold', 'prismatic', 'cosmos', 'void', 'emberforged', 'polychrome'],
};

/** Picks a finish suited to a rarity, with a random rainbow offset so no two foils match. */
export function rollFinish(rarity: Rarity, rng: () => number = Math.random): Finish {
  const ids = BY_RARITY[rarity];
  const f = structuredClone(finishById(ids[Math.floor(rng() * ids.length)]).finish);
  f.hue = rng();
  return f;
}

/** The set of uniforms a finish drives. The material owns one of these per card. */
export const finishUniforms = () => ({
  uMetal: { value: new THREE.Vector3() },
  uMetalTint: { value: new THREE.Color() },
  uBrush: { value: 0 },
  uPrism: { value: new THREE.Vector3() },
  uPillars: { value: new THREE.Vector3() },
  uCosmos: { value: new THREE.Vector3() },
  uGlitter: { value: new THREE.Vector3() },
  uShards: { value: new THREE.Vector3() },
  uEtch: { value: new THREE.Vector3() },
  uPoly: { value: new THREE.Vector3() },
  uGild: { value: 0 },
  uDepth: { value: 0 },
  uSweep: { value: 0 },
  uFire: { value: 0 },
  uRelief: { value: 0 },
  uGloss: { value: 0.5 },
  uHue: { value: 0 },
});

export type FinishUniforms = ReturnType<typeof finishUniforms>;

export function applyFinish(u: FinishUniforms, f: Finish) {
  u.uMetal.value.fromArray(f.metal);
  u.uMetalTint.value.set(f.metalTint);
  u.uBrush.value = f.brush;
  u.uPrism.value.fromArray(f.prism);
  u.uPillars.value.fromArray(f.pillars);
  u.uCosmos.value.fromArray(f.cosmos);
  u.uGlitter.value.fromArray(f.glitter);
  u.uShards.value.fromArray(f.shards);
  u.uEtch.value.fromArray(f.etch);
  u.uPoly.value.fromArray(f.poly);
  u.uGild.value = f.gild;
  u.uDepth.value = f.depth;
  u.uSweep.value = f.sweep;
  u.uFire.value = f.fire;
  u.uRelief.value = f.relief;
  u.uGloss.value = f.gloss;
  u.uHue.value = f.hue;
}
