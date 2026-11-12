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
  /** Scattered angular shards; a few light up in flat colour at each angle. */
  fracture: Regions;
  /** Diagonal rainbow streaks. */
  beams: Regions;
  /** Tiled pinwheel stars. */
  burst: Regions;
  /** Two-colour feather sheen. */
  iris: Regions;
  /** Cell mosaic in one structural colour. */
  mosaic: Regions;
  /** Bends the prism's bands into a marbled, liquid pattern. */
  flow: number;
  /** 0 = white and gold glitter, 1 = flakes coloured by a rainbow gradient. */
  glitterTint: number;
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
  /** Opacity of every foil layer together: 0 = plain print, 1 = full effect. */
  intensity: number;
  /** How unevenly the intensity is spread: 0 = uniform, 1 = bare patches between strong ones. */
  vary: number;
  /** Size of those patches: low = a few broad clouds, high = small mottling. */
  varyScale: number;
  /** Rotates every rainbow, for per-card variety. */
  hue: number;
}

const NONE: Regions = [0, 0, 0];

const BASE: Finish = {
  metal: NONE, metalTint: 0xffffff, brush: 0.12,
  prism: NONE, pillars: NONE, cosmos: NONE, glitter: NONE, shards: NONE, etch: NONE, poly: NONE,
  fracture: NONE, beams: NONE, burst: NONE, iris: NONE, mosaic: NONE,
  flow: 0, glitterTint: 0, gild: 0, depth: 0, sweep: 0, fire: 0, relief: 0, gloss: 0.5, intensity: 1, vary: 0.5, varyScale: 2.5, hue: 0,
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
    finish: def({ gloss: 0.25, vary: 0 }),
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
    id: 'shardframe', name: 'Shard Border', group: 'Partial',
    blurb: 'Shattered-glass foil on the frame only, around plain art, like a sparkle-bordered sports card.',
    finish: def({ fracture: [0, 1, 0.6], metal: [0, 0.3, 0], metalTint: 0xe8eef8, gloss: 0.6, vary: 0 }),
  },
  {
    id: 'prismatic', name: 'Full Chromatic', group: 'Chromatic',
    blurb: 'The whole card sits on a thin-film foil; colour drifts with viewing angle.',
    finish: def({ prism: [1, 1, 0.8], metal: [0, 0.35, 0], relief: 0.8, gloss: 1 }),
  },
  {
    id: 'liquid', name: 'Liquid Holo', group: 'Chromatic',
    blurb: 'An oil-slick foil: the rainbow pools and marbles, and slides like something wet when tilted.',
    finish: def({ prism: [1, 1, 0.8], flow: 1, metal: [0, 0.3, 0], metalTint: 0xe8eef8, relief: 0.5, gloss: 1, intensity: 0.7 }),
  },
  {
    id: 'polychrome', name: 'Polychrome', group: 'Chromatic',
    blurb: 'Rotates the hue of the print itself through a slow liquid warp.',
    finish: def({ poly: [1, 1, 0.5], prism: [0.25, 0.3, 0.15], gloss: 0.9 }),
  },
  {
    id: 'plumage', name: 'Plumage', group: 'Chromatic',
    blurb: "Structural colour as on a pigeon's neck: only green and violet, swapping places as it turns.",
    finish: def({ iris: [1, 0.85, 0.3], relief: 0.6, gloss: 0.7, intensity: 0.5 }),
  },
  {
    id: 'mosaic', name: 'Marble Berry', group: 'Chromatic',
    blurb: 'A mosaic of tiny cells, nearly all one metallic blue with stray specks of other colours.',
    finish: def({ mosaic: [1, 0.8, 0.25], relief: 0.5, gloss: 1, intensity: 0.55 }),
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
    id: 'shattered', name: 'Shattered Glass', group: 'Holographic',
    blurb: 'Scattered angular shards over a plain card. Nearly all are invisible; a few blaze one flat colour, and tilting swaps which.',
    finish: def({ fracture: [1, 1, 1], gloss: 0.9, vary: 0 }),
  },
  {
    id: 'rays', name: 'Laser Rays', group: 'Holographic',
    blurb: 'Diagonal streaks of uneven width, each catching the light at a different angle.',
    finish: def({ beams: [1, 0.8, 0.3], relief: 0.5, gloss: 0.9, intensity: 0.9 }),
  },
  {
    id: 'starburst', name: 'Starburst', group: 'Holographic',
    blurb: 'Tiled pinwheels: the wedges of every star light up in turn as the card tilts.',
    finish: def({ burst: [1, 0.9, 0.3], gloss: 0.8, intensity: 0.9 }),
  },
  {
    id: 'etched', name: 'Etched', group: 'Holographic',
    blurb: 'Foil only inside engraved guilloche lines, as on a banknote.',
    finish: def({ etch: [1, 1, 0.35], metal: [0, 0.5, 0], metalTint: 0xe6e0d0, relief: 0.6 }),
  },
  {
    id: 'stardust', name: 'Stardust', group: 'Holographic',
    blurb: 'Dense glitter like coloured sand: each flake takes its colour from a rainbow that slides across the card.',
    finish: def({ glitter: [1, 1, 0.3], glitterTint: 0.9, gloss: 0.5 }),
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

// Rarity ladder: the lower tiers are finishes a real printer could make, and the higher a
// card's rarity, the more its finish does things only a screen can (moving fire, a window
// with depth, drifting stars).
const BY_RARITY: Record<Rarity, string[]> = {
  common: ['matte', 'matte', 'matte', 'artfoil'],
  rare: ['artfoil', 'framefoil', 'shardframe', 'steel', 'stardust', 'etched', 'prismatic'],
  epic: ['gilded', 'shattered', 'rays', 'starburst', 'crackedice', 'sunpillar', 'liquid', 'plumage', 'mosaic'],
  legendary: ['void', 'emberforged', 'cosmos', 'polychrome', 'solidgold'],
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
  uFracture: { value: new THREE.Vector3() },
  uBeams: { value: new THREE.Vector3() },
  uBurst: { value: new THREE.Vector3() },
  uIris: { value: new THREE.Vector3() },
  uMosaic: { value: new THREE.Vector3() },
  uFlow: { value: 0 },
  uGlitterTint: { value: 0 },
  uGild: { value: 0 },
  uDepth: { value: 0 },
  uSweep: { value: 0 },
  uFire: { value: 0 },
  uRelief: { value: 0 },
  uGloss: { value: 0.5 },
  uIntensity: { value: 1 },
  uVary: { value: 0 },
  uVaryScale: { value: 2.5 },
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
  u.uFracture.value.fromArray(f.fracture);
  u.uBeams.value.fromArray(f.beams);
  u.uBurst.value.fromArray(f.burst);
  u.uIris.value.fromArray(f.iris);
  u.uMosaic.value.fromArray(f.mosaic);
  u.uFlow.value = f.flow;
  u.uGlitterTint.value = f.glitterTint;
  u.uGild.value = f.gild;
  u.uDepth.value = f.depth;
  u.uSweep.value = f.sweep;
  u.uFire.value = f.fire;
  u.uRelief.value = f.relief;
  u.uGloss.value = f.gloss;
  u.uIntensity.value = f.intensity ?? 1;
  u.uVary.value = f.vary ?? 0;
  u.uVaryScale.value = f.varyScale ?? 2.5;
  u.uHue.value = f.hue;
}
