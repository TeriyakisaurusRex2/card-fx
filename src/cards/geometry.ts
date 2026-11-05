import * as THREE from 'three';

// World size of a card. Everything else in the project is expressed relative to these.
export const CARD_W = 2.5;
export const CARD_H = 3.5;
export const CARD_R = 0.14; // corner radius
export const CARD_T = 0.014; // thickness

const CORNER_STEPS = 6;
const COLS = 12;
const ROWS = 18;

/** Grid line positions: dense through the corner radius, even across the middle. */
function gridLines(size: number, cells: number) {
  const half = size / 2;
  const out: number[] = [];
  for (let i = 0; i < CORNER_STEPS; i++) out.push(-half + (CARD_R * i) / CORNER_STEPS);
  for (let i = 0; i <= cells; i++) out.push(-half + CARD_R + ((size - 2 * CARD_R) * i) / cells);
  for (let i = 1; i <= CORNER_STEPS; i++) out.push(half - CARD_R + (CARD_R * i) / CORNER_STEPS);
  return out;
}

/** Pulls a square's corner block onto a quarter circle, keeping concentric rows evenly spaced. */
function roundCorner(x: number, y: number): [number, number] {
  const cx = CARD_W / 2 - CARD_R;
  const cy = CARD_H / 2 - CARD_R;
  const a = Math.abs(x) - cx;
  const b = Math.abs(y) - cy;
  if (a <= 1e-6 || b <= 1e-6) return [x, y];
  const u = a / CARD_R;
  const v = b / CARD_R;
  const k = (Math.max(u, v) / Math.hypot(u, v)) * CARD_R;
  return [Math.sign(x) * (cx + u * k), Math.sign(y) * (cy + v * k)];
}

/**
 * One geometry shared by every card: front grid, back grid and an edge ribbon.
 *
 * It is a real subdivided mesh, not a quad, so the vertex shader can bend it. `aFace`
 * tells the shader which part a vertex belongs to (0 front, 1 back, 2 edge), which
 * lets one material and one draw call cover the whole card.
 */
function build() {
  const xs = gridLines(CARD_W, COLS);
  const ys = gridLines(CARD_H, ROWS);
  const nx = xs.length;
  const ny = ys.length;

  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const face: number[] = [];
  const idx: number[] = [];

  const addFace = (z: number, nz: number, faceId: number) => {
    const base = pos.length / 3;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const [x, y] = roundCorner(xs[i], ys[j]);
        pos.push(x, y, z);
        nor.push(0, 0, nz);
        // The back's u is mirrored so its texture reads correctly from behind.
        const u = x / CARD_W + 0.5;
        uv.push(faceId === 1 ? 1 - u : u, y / CARD_H + 0.5);
        face.push(faceId);
      }
    }
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = base + j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        if (nz > 0) idx.push(a, b, d, a, d, c);
        else idx.push(a, d, b, a, c, d);
      }
    }
    return base;
  };

  const front = addFace(CARD_T / 2, 1, 0);
  const back = addFace(-CARD_T / 2, -1, 1);

  // Walk the outline counter-clockwise and stitch front to back with a ribbon.
  const outline: number[] = [];
  for (let i = 0; i < nx - 1; i++) outline.push(i);
  for (let j = 0; j < ny - 1; j++) outline.push(j * nx + nx - 1);
  for (let i = nx - 1; i > 0; i--) outline.push((ny - 1) * nx + i);
  for (let j = ny - 1; j > 0; j--) outline.push(j * nx);

  const ribbon = pos.length / 3;
  const cx = CARD_W / 2 - CARD_R;
  const cy = CARD_H / 2 - CARD_R;
  for (const o of outline) {
    const f = front + o;
    const b = back + o;
    const x = pos[f * 3];
    const y = pos[f * 3 + 1];
    const dx = Math.max(Math.abs(x) - cx, 0) * Math.sign(x);
    const dy = Math.max(Math.abs(y) - cy, 0) * Math.sign(y);
    const len = Math.hypot(dx, dy) || 1;
    for (const src of [f, b]) {
      pos.push(pos[src * 3], pos[src * 3 + 1], pos[src * 3 + 2]);
      nor.push(dx / len, dy / len, 0);
      uv.push(uv[src * 2], uv[src * 2 + 1]);
      face.push(2);
    }
  }
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const a = ribbon + i * 2;
    const b = ribbon + ((i + 1) % n) * 2;
    idx.push(a, a + 1, b + 1, a, b + 1, b);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFace', new THREE.Float32BufferAttribute(face, 1));
  g.setIndex(idx);
  // Bends push vertices past the flat bounds; pad the sphere so culling stays safe.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.hypot(CARD_W, CARD_H));
  return g;
}

let shared: THREE.BufferGeometry | null = null;
export const cardGeometry = () => (shared ??= build());
