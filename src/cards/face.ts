import * as THREE from 'three';
import type { CardDef, Faction, Rarity } from './data';
import { RARITY_COLOR } from './data';

// Everything visual about a card's print is painted here with Canvas 2D:
//   - a colour texture per card (art, text, frame paint)
//   - a mask texture per layout, shared by every card with that layout:
//       R = art window, G = metal-capable frame, B = emboss height
// The foil shader reads the mask to know which finish applies where, so a game can
// swap this file for pre-rendered textures without touching the shader.

export const BASE_W = 640;
export const BASE_H = 896;

const ART = { x: 40, y: 104, w: 560, h: 436 };
const TITLE = { x: 26, y: 26, w: 588, h: 72 };
const TYPE = { x: 26, y: 540, w: 588, h: 48 };
const RULES = { x: 44, y: 594, w: 552, h: 262 };

/** The art window in UV space (v up), which the shader needs for parallax. */
export const ART_RECT: Record<CardDef['layout'], THREE.Vector4> = {
  classic: new THREE.Vector4(ART.x / BASE_W, 1 - (ART.y + ART.h) / BASE_H, (ART.x + ART.w) / BASE_W, 1 - ART.y / BASE_H),
  fullart: new THREE.Vector4(0.02, 0.015, 0.98, 0.985),
};

interface Palette {
  frame: string;
  hi: string;
  lo: string;
  accent: string;
  box: string;
}
const PALETTE: Record<Faction, Palette> = {
  ember: { frame: '#7a4022', hi: '#e8a266', lo: '#2b1208', accent: '#ff8a50', box: '#1d120d' },
  cairn: { frame: '#566a38', hi: '#c0d890', lo: '#161d0c', accent: '#a8d478', box: '#141a0e' },
  veil: { frame: '#48407c', hi: '#b9aef0', lo: '#120e26', accent: '#a894e8', box: '#14101f' },
};

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

const art = new Map<string, HTMLImageElement>();
export function loadArt(names: string[]) {
  return Promise.all(
    names.map(
      (n) =>
        new Promise<void>((res) => {
          if (art.has(n)) return res();
          const img = new Image();
          img.onload = () => {
            art.set(n, img);
            res();
          };
          img.onerror = () => res();
          img.src = `${import.meta.env.BASE_URL}art/${n}.webp`;
        }),
    ),
  );
}
export const artImage = (n: string) => art.get(n);

function makeCanvas(scale: number) {
  const c = document.createElement('canvas');
  c.width = BASE_W * scale;
  c.height = BASE_H * scale;
  const ctx = c.getContext('2d', { willReadFrequently: false })!;
  ctx.scale(scale, scale);
  return { c, ctx };
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Cover-fits the art into a rect. focusY picks which part survives the crop. */
function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number, focusY = 0.4) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) * focusY;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    const next = cur ? cur + ' ' + word : word;
    if (ctx.measureText(next).width > maxW && cur) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Shrinks a font until the text fits on one line. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, family: string, weight: number, size: number, maxW: number) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${family}`;
    if (ctx.measureText(text).width <= maxW) break;
    s -= 1;
  } while (s > 12);
  return s;
}

/** Curved bracket used on each corner of the art window; `at` flips it into place. */
function bracketPath(ctx: CanvasRenderingContext2D, x: number, y: number, sx: number, sy: number, size = 46) {
  const s = size;
  ctx.moveTo(x + sx * s, y);
  ctx.quadraticCurveTo(x + sx * s * 0.42, y + sy * 2, x + sx * s * 0.34, y + sy * s * 0.34);
  ctx.quadraticCurveTo(x + sx * 2, y + sy * s * 0.42, x, y + sy * s);
  ctx.moveTo(x + sx * s * 0.22, y + sy * s * 0.22);
  ctx.arc(x + sx * s * 0.22, y + sy * s * 0.22, 3.2, 0, Math.PI * 2);
}

function gem(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, hi: string, base: string, lo: string) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.08, x, y, r);
  g.addColorStop(0, hi);
  g.addColorStop(0.45, base);
  g.addColorStop(1, lo);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#d9c28a';
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,.65)';
  ctx.beginPath();
  ctx.arc(x, y, r - 3.5, 0, Math.PI * 2);
  ctx.stroke();
}

function gemNumber(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  ctx.font = `700 ${size}px Cinzel, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(0,0,0,.85)';
  ctx.strokeText(text, x, y + 2);
  ctx.fillStyle = '#fff8e6';
  ctx.fillText(text, x, y + 2);
}

function speckle(ctx: CanvasRenderingContext2D, alpha: number, count = 2400) {
  ctx.save();
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    const x = Math.random() * BASE_W;
    const y = Math.random() * BASE_H;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1);
  }
  ctx.restore();
}

function drawTitle(ctx: CanvasRenderingContext2D, def: CardDef, p: Palette, y: number) {
  const left = TITLE.x + 92;
  const maxW = TITLE.w - 112;
  fitFont(ctx, def.name, 'Cinzel, serif', 700, 37, maxW);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,.75)';
  ctx.fillText(def.name, left + 1.5, y + 2);
  ctx.fillStyle = '#f7ecd0';
  ctx.fillText(def.name, left, y);
  void p;
}

function drawRules(ctx: CanvasRenderingContext2D, def: CardDef, top: number, bottom: number, centered = false) {
  let size = 28;
  let lines: string[] = [];
  const maxW = RULES.w - 56;
  // Shrink until the rules fit between the type line and the stat gems.
  for (; size >= 18; size--) {
    ctx.font = `500 ${size}px Inter, sans-serif`;
    lines = wrapText(ctx, def.text, maxW);
    if (lines.length * size * 1.34 <= bottom - top) break;
  }
  const lh = size * 1.34;
  const y0 = centered ? top + (bottom - top - lines.length * lh) / 2 + lh / 2 : top + lh / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e9e0cc';
  lines.forEach((l, i) => ctx.fillText(l, RULES.x + 28, y0 + i * lh));
}

function drawStats(ctx: CanvasRenderingContext2D, def: CardDef, y = 838) {
  if (def.power === undefined) return;
  gem(ctx, 70, y, 40, '#ffbc8f', '#b34525', '#3b0f07');
  gemNumber(ctx, String(def.power), 70, y, 40);
  gem(ctx, 570, y, 40, '#b9e6a6', '#3f7f46', '#0c2a15');
  gemNumber(ctx, String(def.toughness), 570, y, 40);
}

function rarityGem(ctx: CanvasRenderingContext2D, r: Rarity, x: number, y: number) {
  const col = hex(RARITY_COLOR[r]);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = col;
  ctx.fillRect(-10, -10, 20, 20);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#f6e6be';
  ctx.strokeRect(-10, -10, 20, 20);
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.fillRect(-8, -8, 7, 7);
  ctx.restore();
}

function paintClassic(ctx: CanvasRenderingContext2D, def: CardDef, p: Palette) {
  // Frame paint, the only thing visible on a card with no metal finish.
  const fg = ctx.createLinearGradient(0, 0, BASE_W, BASE_H);
  fg.addColorStop(0, p.hi);
  fg.addColorStop(0.18, p.frame);
  fg.addColorStop(0.55, p.lo);
  fg.addColorStop(0.82, p.frame);
  fg.addColorStop(1, p.hi);
  ctx.fillStyle = fg;
  ctx.fillRect(0, 0, BASE_W, BASE_H);
  speckle(ctx, 0.06);

  ctx.strokeStyle = 'rgba(255,240,200,.55)';
  ctx.lineWidth = 2;
  rr(ctx, 13, 13, BASE_W - 26, BASE_H - 26, 26);
  ctx.stroke();

  // Art window.
  const img = art.get(def.art);
  ctx.fillStyle = '#000';
  ctx.fillRect(ART.x, ART.y, ART.w, ART.h);
  if (img) drawCover(ctx, img, ART.x, ART.y, ART.w, ART.h, def.focusY);
  const vig = ctx.createLinearGradient(0, ART.y, 0, ART.y + 26);
  vig.addColorStop(0, 'rgba(0,0,0,.6)');
  vig.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vig;
  ctx.fillRect(ART.x, ART.y, ART.w, 26);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#120b06';
  ctx.strokeRect(ART.x, ART.y, ART.w, ART.h);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,235,190,.7)';
  ctx.strokeRect(ART.x - 3, ART.y - 3, ART.w + 6, ART.h + 6);

  // Corner brackets over the art.
  ctx.lineWidth = 3;
  ctx.strokeStyle = p.hi;
  ctx.beginPath();
  bracketPath(ctx, ART.x, ART.y, 1, 1);
  bracketPath(ctx, ART.x + ART.w, ART.y, -1, 1);
  bracketPath(ctx, ART.x, ART.y + ART.h, 1, -1);
  bracketPath(ctx, ART.x + ART.w, ART.y + ART.h, -1, -1);
  ctx.stroke();

  // Title and type plates.
  for (const plate of [TITLE, TYPE]) {
    const g = ctx.createLinearGradient(0, plate.y, 0, plate.y + plate.h);
    g.addColorStop(0, p.lo);
    g.addColorStop(1, '#050403');
    ctx.fillStyle = g;
    rr(ctx, plate.x, plate.y, plate.w, plate.h, 12);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = p.hi;
    ctx.stroke();
  }

  // Rules box.
  ctx.fillStyle = p.box;
  rr(ctx, RULES.x, RULES.y, RULES.w, RULES.h, 10);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,235,190,.35)';
  ctx.stroke();

  drawTitle(ctx, def, p, TITLE.y + TITLE.h / 2 + 1);
  const typeLine = def.subtype ? `${def.type} — ${def.subtype}` : def.type;
  ctx.font = '600 25px Cinzel, serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e6d6ad';
  ctx.fillText(typeLine, TYPE.x + 24, TYPE.y + TYPE.h / 2 + 1);
  rarityGem(ctx, def.rarity, TYPE.x + TYPE.w - 32, TYPE.y + TYPE.h / 2);

  drawRules(ctx, def, RULES.y + 20, def.power !== undefined ? RULES.y + RULES.h - 66 : RULES.y + RULES.h - 16, def.type === 'Spell');

  drawStats(ctx, def);
  gem(ctx, 66, 62, 44, '#a6d0ff', '#2f6fb8', '#0a2245');
  gemNumber(ctx, String(def.cost), 66, 62, 46);
}

function paintFullArt(ctx: CanvasRenderingContext2D, def: CardDef, p: Palette) {
  const img = art.get(def.art);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, BASE_W, BASE_H);
  if (img) drawCover(ctx, img, 0, 0, BASE_W, BASE_H, 0.4);

  // Scrims keep the text legible where art bleeds under it.
  const top = ctx.createLinearGradient(0, 0, 0, 150);
  top.addColorStop(0, 'rgba(0,0,0,.72)');
  top.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, BASE_W, 150);
  const bot = ctx.createLinearGradient(0, 560, 0, 720);
  bot.addColorStop(0, 'rgba(6,4,3,0)');
  bot.addColorStop(1, 'rgba(6,4,3,.95)');
  ctx.fillStyle = bot;
  ctx.fillRect(0, 560, BASE_W, BASE_H - 560);

  // Thin metal frame.
  ctx.lineWidth = 15;
  ctx.strokeStyle = p.frame;
  rr(ctx, 7.5, 7.5, BASE_W - 15, BASE_H - 15, 30);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = p.hi;
  rr(ctx, 16, 16, BASE_W - 32, BASE_H - 32, 24);
  ctx.stroke();

  ctx.lineWidth = 3;
  ctx.strokeStyle = '#f0d894';
  ctx.beginPath();
  bracketPath(ctx, 22, 22, 1, 1, 60);
  bracketPath(ctx, BASE_W - 22, 22, -1, 1, 60);
  bracketPath(ctx, 22, BASE_H - 22, 1, -1, 60);
  bracketPath(ctx, BASE_W - 22, BASE_H - 22, -1, -1, 60);
  ctx.stroke();

  drawTitle(ctx, def, p, 64);

  ctx.font = '600 24px Cinzel, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f0d894';
  ctx.fillText(`${def.type} — ${def.subtype ?? ''}`, BASE_W / 2, 650);
  ctx.strokeStyle = 'rgba(240,216,148,.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(150, 676);
  ctx.lineTo(BASE_W - 150, 676);
  ctx.stroke();
  rarityGem(ctx, def.rarity, BASE_W / 2, 676);

  drawRules(ctx, def, 692, 800);
  drawStats(ctx, def, 836);
  gem(ctx, 66, 66, 46, '#ffe9a8', '#c79524', '#3d2605');
  gemNumber(ctx, String(def.cost), 66, 66, 48);
}

const faceCache = new Map<string, THREE.CanvasTexture>();
const finishTex = (c: HTMLCanvasElement, srgb: boolean) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
};

/** Colour texture for a card, cached so a deck of duplicates costs one texture. */
export function faceTexture(def: CardDef, scale = 1) {
  const key = `${def.id}@${scale}`;
  const hit = faceCache.get(key);
  if (hit) return hit;
  const { c, ctx } = makeCanvas(scale);
  if (def.layout === 'fullart') paintFullArt(ctx, def, PALETTE[def.faction]);
  else paintClassic(ctx, def, PALETTE[def.faction]);
  const t = finishTex(c, true);
  faceCache.set(key, t);
  return t;
}

/**
 * Masks are painted with 'lighter' (additive) blending so each channel is independent:
 * filling pure red only ever touches R, and so on.
 */
function emboss(ctx: CanvasRenderingContext2D, blur: number, width: number, shade: string, path: () => void) {
  ctx.save();
  ctx.filter = `blur(${blur}px)`;
  ctx.strokeStyle = shade;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  path();
  ctx.stroke();
  ctx.restore();
}

function maskClassic(ctx: CanvasRenderingContext2D, hasStats: boolean) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, BASE_W, BASE_H);
  ctx.globalCompositeOperation = 'lighter';

  ctx.fillStyle = '#f00';
  ctx.fillRect(ART.x, ART.y, ART.w, ART.h);

  // Frame: everything except the window, the plates and the rules box.
  ctx.fillStyle = '#0f0';
  ctx.beginPath();
  ctx.rect(0, 0, BASE_W, BASE_H);
  ctx.rect(ART.x, ART.y, ART.w, ART.h);
  ctx.roundRect(TITLE.x, TITLE.y, TITLE.w, TITLE.h, 12);
  ctx.roundRect(TYPE.x, TYPE.y, TYPE.w, TYPE.h, 12);
  ctx.roundRect(RULES.x, RULES.y, RULES.w, RULES.h, 10);
  ctx.fill('evenodd');

  // Corner brackets and gems are metal even where they sit over the art or a plate.
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#0f0';
  ctx.beginPath();
  bracketPath(ctx, ART.x, ART.y, 1, 1);
  bracketPath(ctx, ART.x + ART.w, ART.y, -1, 1);
  bracketPath(ctx, ART.x, ART.y + ART.h, 1, -1);
  bracketPath(ctx, ART.x + ART.w, ART.y + ART.h, -1, -1);
  ctx.stroke();

  const rim = (w: number) => {
    emboss(ctx, 2.5, w, '#00f', () => rr(ctx, 7, 7, BASE_W - 14, BASE_H - 14, 30));
    emboss(ctx, 2, w * 0.8, '#00a', () => rr(ctx, 13, 13, BASE_W - 26, BASE_H - 26, 26));
  };
  rim(9);
  emboss(ctx, 1.5, 7, '#00d', () => {
    ctx.beginPath();
    ctx.rect(ART.x - 3, ART.y - 3, ART.w + 6, ART.h + 6);
  });
  for (const plate of [TITLE, TYPE]) emboss(ctx, 1.5, 5, '#00c', () => rr(ctx, plate.x, plate.y, plate.w, plate.h, 12));
  emboss(ctx, 1.5, 4, '#008', () => rr(ctx, RULES.x, RULES.y, RULES.w, RULES.h, 10));
  emboss(ctx, 1, 5, '#00f', () => {
    ctx.beginPath();
    bracketPath(ctx, ART.x, ART.y, 1, 1);
    bracketPath(ctx, ART.x + ART.w, ART.y, -1, 1);
    bracketPath(ctx, ART.x, ART.y + ART.h, 1, -1);
    bracketPath(ctx, ART.x + ART.w, ART.y + ART.h, -1, -1);
  });
  domeGem(ctx, 66, 62, 44);
  if (hasStats) {
    domeGem(ctx, 70, 838, 40);
    domeGem(ctx, 570, 838, 40);
  }
}

function domeGem(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();
  // Clear any channels below the gem, then lay down a domed height.
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
  g.addColorStop(0, '#00f');
  g.addColorStop(0.75, '#008');
  g.addColorStop(1, '#001');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function maskFullArt(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, BASE_W, BASE_H);
  ctx.globalCompositeOperation = 'lighter';

  // Art channel fades out toward the text so foil never washes the rules away.
  const g = ctx.createLinearGradient(0, 0, 0, BASE_H);
  g.addColorStop(0, '#500');
  g.addColorStop(0.095, '#500');
  g.addColorStop(0.125, '#f00');
  g.addColorStop(0.62, '#f00');
  g.addColorStop(0.76, '#200');
  g.addColorStop(1, '#200');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, BASE_W, BASE_H);

  ctx.lineWidth = 15;
  ctx.strokeStyle = '#0f0';
  rr(ctx, 7.5, 7.5, BASE_W - 15, BASE_H - 15, 30);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.beginPath();
  bracketPath(ctx, 22, 22, 1, 1, 60);
  bracketPath(ctx, BASE_W - 22, 22, -1, 1, 60);
  bracketPath(ctx, 22, BASE_H - 22, 1, -1, 60);
  bracketPath(ctx, BASE_W - 22, BASE_H - 22, -1, -1, 60);
  ctx.stroke();

  emboss(ctx, 2.5, 10, '#00f', () => rr(ctx, 8, 8, BASE_W - 16, BASE_H - 16, 30));
  emboss(ctx, 1, 5, '#00f', () => {
    ctx.beginPath();
    bracketPath(ctx, 22, 22, 1, 1, 60);
    bracketPath(ctx, BASE_W - 22, 22, -1, 1, 60);
    bracketPath(ctx, 22, BASE_H - 22, 1, -1, 60);
    bracketPath(ctx, BASE_W - 22, BASE_H - 22, -1, -1, 60);
  });
  domeGem(ctx, 66, 66, 46);
  domeGem(ctx, 70, 836, 40);
  domeGem(ctx, 570, 836, 40);
}

const maskCache = new Map<string, THREE.CanvasTexture>();
export function maskTexture(def: CardDef) {
  // Spells have no stat gems, so they need their own mask or the gems' bumps would show.
  const hasStats = def.power !== undefined;
  const key = `${def.layout}:${hasStats}`;
  const hit = maskCache.get(key);
  if (hit) return hit;
  const { c, ctx } = makeCanvas(1);
  if (def.layout === 'fullart') maskFullArt(ctx);
  else maskClassic(ctx, hasStats);
  const t = finishTex(c, false);
  maskCache.set(key, t);
  return t;
}

/** The radiating sigil on the back, traced so it can paint both colour and mask. */
function sigilPath(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.beginPath();
  for (const r of [176, 158, 74]) {
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  const spikes = 12;
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2 - Math.PI / 2;
    const b = a + Math.PI / spikes;
    const long = i % 3 === 0 ? 150 : 118;
    ctx.moveTo(cx + Math.cos(a) * 80, cy + Math.sin(a) * 80);
    ctx.lineTo(cx + Math.cos(a) * long, cy + Math.sin(a) * long);
    ctx.lineTo(cx + Math.cos(b) * 80, cy + Math.sin(b) * 80);
  }
  // Crown in the centre.
  const w = 42;
  ctx.moveTo(cx - w, cy + 26);
  ctx.lineTo(cx - w, cy - 16);
  ctx.lineTo(cx - w * 0.45, cy + 6);
  ctx.lineTo(cx, cy - 32);
  ctx.lineTo(cx + w * 0.45, cy + 6);
  ctx.lineTo(cx + w, cy - 16);
  ctx.lineTo(cx + w, cy + 26);
  ctx.closePath();
}

function backOrnaments(ctx: CanvasRenderingContext2D) {
  const m = 30;
  rr(ctx, m, m, BASE_W - m * 2, BASE_H - m * 2, 20);
  ctx.moveTo(m + 16, m + 80);
  ctx.lineTo(m + 16, m + 16);
  ctx.lineTo(m + 80, m + 16);
  const x2 = BASE_W - m - 16;
  const y2 = BASE_H - m - 16;
  ctx.moveTo(x2 - 64, m + 16);
  ctx.lineTo(x2, m + 16);
  ctx.lineTo(x2, m + 80);
  ctx.moveTo(m + 16, y2 - 64);
  ctx.lineTo(m + 16, y2);
  ctx.lineTo(m + 80, y2);
  ctx.moveTo(x2 - 64, y2);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x2, y2 - 64);
}

let backTex: THREE.CanvasTexture | null = null;
let backMaskTex: THREE.CanvasTexture | null = null;

export function backTexture() {
  if (backTex) return backTex;
  const { c, ctx } = makeCanvas(1);
  const g = ctx.createRadialGradient(BASE_W / 2, BASE_H / 2, 40, BASE_W / 2, BASE_H / 2, 620);
  g.addColorStop(0, '#5b1f1a');
  g.addColorStop(0.5, '#2c0f12');
  g.addColorStop(1, '#100608');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, BASE_W, BASE_H);

  // A woven diagonal lattice, faint enough to read as printed texture.
  ctx.strokeStyle = 'rgba(240,200,140,.07)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = -BASE_H; i < BASE_W + BASE_H; i += 34) {
    ctx.moveTo(i, 0);
    ctx.lineTo(i + BASE_H, BASE_H);
    ctx.moveTo(i, 0);
    ctx.lineTo(i - BASE_H, BASE_H);
  }
  ctx.stroke();
  speckle(ctx, 0.05);

  ctx.strokeStyle = '#d9b566';
  ctx.lineWidth = 5;
  ctx.beginPath();
  backOrnaments(ctx);
  ctx.stroke();
  ctx.lineWidth = 4;
  sigilPath(ctx, BASE_W / 2, BASE_H / 2);
  ctx.fillStyle = 'rgba(217,181,102,.16)';
  ctx.fill();
  ctx.stroke();

  backTex = finishTex(c, true);
  return backTex;
}

export function backMaskTexture() {
  if (backMaskTex) return backMaskTex;
  const { c, ctx } = makeCanvas(1);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, BASE_W, BASE_H);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = '#0f0';
  ctx.lineWidth = 7;
  ctx.beginPath();
  backOrnaments(ctx);
  ctx.stroke();
  ctx.lineWidth = 6;
  sigilPath(ctx, BASE_W / 2, BASE_H / 2);
  ctx.stroke();
  emboss(ctx, 1.5, 7, '#00f', () => {
    ctx.beginPath();
    backOrnaments(ctx);
  });
  emboss(ctx, 1.5, 6, '#00f', () => sigilPath(ctx, BASE_W / 2, BASE_H / 2));
  backMaskTex = finishTex(c, false);
  return backMaskTex;
}
