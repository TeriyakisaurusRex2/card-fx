import * as THREE from 'three';
import { clamp, damp } from '../core/anim';
import type { CardDef } from './data';
import { RARITY_COLOR } from './data';
import { ART_RECT, BASE_H, BASE_W, backMaskTexture, backTexture, faceTexture, maskTexture } from './face';
import { type Finish, applyFinish, finishUniforms } from './finishes';
import { CARD_H, CARD_W, cardGeometry } from './geometry';
import { CARD_FRAG, CARD_VERT } from './shaders';

// Uniforms every card reads from the same object, so updating one updates them all.
export const sharedCardUniforms = {
  uTime: { value: 0 },
  uLightPos: { value: new THREE.Vector3(2.5, 3.5, 9) },
};

/** Soft rounded rectangle, used for both drop shadows and glowing halos. */
function softRectTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = Math.round(size * 1.3);
  const ctx = c.getContext('2d')!;
  // Opaque black first: the shape must land in the colour channels, not just alpha.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.filter = 'blur(16px)';
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(38, 38, c.width - 76, c.height - 76, 20);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
let softRect: THREE.CanvasTexture | null = null;
const softTex = () => (softRect ??= softRectTexture());
const softGeo = new THREE.PlaneGeometry(1, 1);

const HALO_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const HALO_FRAG = /* glsl */ `
uniform sampler2D tSoft; uniform vec3 uColor; uniform float uAmount,uTime,uSeed;
varying vec2 vUv;
void main(){
  float a=texture2D(tSoft,vUv).r;
  // Slow energy crawling around the outline, so the glow doesn't read as a flat sticker.
  vec2 p=vUv-.5;
  float ang=atan(p.y,p.x);
  float flow=.72+.28*sin(ang*5.+uTime*2.2+uSeed*6.)*sin(ang*3.-uTime*1.3);
  gl_FragColor=vec4(uColor*a*a*uAmount*flow,1.);
}`;

export interface CardViewOptions {
  /** Canvas scale for the face texture. 1 is fine for a hand, 2 for close inspection. */
  res?: number;
  /** Skip shadow and halo for very busy scenes. */
  bare?: boolean;
  faceDown?: boolean;
}

let seedCounter = 0;

/**
 * Draw layers, lowest first. Cards are painted over each other like sprites rather than
 * sorted by the depth buffer, so a moving card can never slice through another one. Within
 * a layer, the card nearer the camera is painted last. All values are below zero, which
 * keeps every effect (rendered at zero and up) on top of cards.
 */
export const CardLayer = { table: -3, hand: -2, air: -1, top: -0.5 } as const;
export type CardLayerValue = (typeof CardLayer)[keyof typeof CardLayer];

/**
 * A card you can place in a scene.
 *
 * The group itself is the card's logical transform, which game code and tweens drive.
 * `visual` is a child that adds secondary motion only: lean and bend derived from how
 * fast the group is moving. Gameplay animation never has to think about flex; it just
 * moves the card and the air drag happens.
 */
export class CardView extends THREE.Group {
  readonly visual = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  shadow?: THREE.Mesh;
  halo?: THREE.Mesh;

  /** 0 disables velocity-driven lean and bend; 1 is the default feel. */
  flex = 1;
  /** Extra bend on top of velocity flex: x curl, y curl, z twist. */
  readonly bendExtra = new THREE.Vector3();
  /** Height above whatever the shadow lands on. Drives its spread and softness. */
  liftForShadow = 0.05;

  private prevPos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private lean = new THREE.Vector2();
  private hasPrev = false;

  constructor(
    public def: CardDef,
    finish: Finish,
    opts: CardViewOptions = {},
  ) {
    super();
    const seed = (seedCounter++ * 0.137) % 1;
    const finishU = finishUniforms();
    applyFinish(finishU, finish);
    this.material = new THREE.ShaderMaterial({
      vertexShader: CARD_VERT,
      fragmentShader: CARD_FRAG,
      uniforms: {
        tFace: { value: faceTexture(def, opts.res ?? 1) },
        tMask: { value: maskTexture(def) },
        tBack: { value: backTexture() },
        tBackMask: { value: backMaskTexture() },
        uTexel: { value: new THREE.Vector2(1.5 / BASE_W, 1.5 / BASE_H) },
        uArtRect: { value: ART_RECT[def.layout] },
        uTime: sharedCardUniforms.uTime,
        uLightPos: sharedCardUniforms.uLightPos,
        uSeed: { value: seed },
        uShimmer: { value: new THREE.Vector2() },
        uBend: { value: new THREE.Vector3() },
        uEdgeColor: { value: new THREE.Color(RARITY_COLOR[def.rarity]).multiplyScalar(0.55) },
        uDissolve: { value: 0 },
        uDissolveMode: { value: 0 },
        uBurnColor: { value: new THREE.Color(1, 0.45, 0.12) },
        uFlash: { value: 0 },
        uDim: { value: 1 },
        ...finishU,
      },
      // In the sorted pass with blending off: opaque pixels, painted in layer order. It still
      // writes depth, so anything placed behind a card (like god rays) stays hidden by it.
      transparent: true,
      blending: THREE.NoBlending,
      depthFunc: THREE.AlwaysDepth,
    });
    this.mesh = new THREE.Mesh(cardGeometry(), this.material);
    this.visual.add(this.mesh);
    this.add(this.visual);

    if (!opts.bare) {
      const shadowMat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.55,
        alphaMap: softTex(),
        depthWrite: false,
        depthTest: false,
      });
      this.shadow = new THREE.Mesh(softGeo, shadowMat);
      this.shadow.scale.set(CARD_W * 1.32, CARD_H * 1.3, 1);
      this.shadow.position.z = -0.006;
      this.visual.add(this.shadow);

      const haloMat = new THREE.ShaderMaterial({
        vertexShader: HALO_VERT,
        fragmentShader: HALO_FRAG,
        uniforms: {
          tSoft: { value: softTex() },
          uColor: { value: new THREE.Color(RARITY_COLOR[def.rarity]) },
          uAmount: { value: 0 },
          uTime: sharedCardUniforms.uTime,
          uSeed: { value: seed },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });
      this.halo = new THREE.Mesh(softGeo, haloMat);
      this.halo.scale.set(CARD_W * 1.42, CARD_H * 1.38, 1);
      this.halo.position.z = -0.012;
      this.halo.visible = false;
      this.visual.add(this.halo);
    }

    if (opts.faceDown) this.rotation.y = Math.PI;
    this.setLayer(CardLayer.air);
  }

  get u() {
    return this.material.uniforms;
  }

  /** Which layer this card paints in. See CardLayer. */
  setLayer(layer: CardLayerValue) {
    this.mesh.renderOrder = layer;
    if (this.shadow) this.shadow.renderOrder = layer;
    if (this.halo) this.halo.renderOrder = layer;
  }

  /** False makes solid objects in front hide the card, like a sealed pack around it. */
  setPainted(painted: boolean) {
    this.material.depthFunc = painted ? THREE.AlwaysDepth : THREE.LessEqualDepth;
  }

  setFinish(f: Finish) {
    applyFinish(this.u as never, f);
  }

  setDef(def: CardDef, res = 1) {
    this.def = def;
    this.u.tFace.value = faceTexture(def, res);
    this.u.tMask.value = maskTexture(def);
    this.u.uArtRect.value = ART_RECT[def.layout];
    (this.u.uEdgeColor.value as THREE.Color).set(RARITY_COLOR[def.rarity]).multiplyScalar(0.55);
    if (this.halo) ((this.halo.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).set(RARITY_COLOR[def.rarity]);
  }

  /** Glow amount around the card. 0 hides the halo entirely. */
  setHalo(amount: number, color?: number) {
    if (!this.halo) return;
    const u = (this.halo.material as THREE.ShaderMaterial).uniforms;
    u.uAmount.value = amount;
    if (color !== undefined) (u.uColor.value as THREE.Color).set(color);
    this.halo.visible = amount > 0.002;
  }

  setShadow(opacity: number) {
    if (!this.shadow) return;
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = opacity;
    this.shadow.visible = opacity > 0.002;
  }

  setShimmer(x: number, y: number) {
    (this.u.uShimmer.value as THREE.Vector2).set(x, y);
  }

  /** Call once per frame. Works out velocity from actual movement, so it needs no input. */
  update(dt: number) {
    if (dt <= 0) return;
    const p = this.getWorldPosition(tmpV);
    if (this.hasPrev) {
      const rate = 1 / dt;
      this.vel.x = damp(this.vel.x, (p.x - this.prevPos.x) * rate, 16, dt);
      this.vel.y = damp(this.vel.y, (p.y - this.prevPos.y) * rate, 16, dt);
      this.vel.z = damp(this.vel.z, (p.z - this.prevPos.z) * rate, 16, dt);
    }
    this.prevPos.copy(p);
    this.hasPrev = true;

    // Lean into motion, as if the air were pushing on the top of the card.
    const k = this.flex;
    const leanX = clamp(this.vel.y * -0.055 * k, -0.5, 0.5);
    const leanY = clamp(this.vel.x * 0.055 * k, -0.5, 0.5);
    this.lean.x = damp(this.lean.x, leanX, 14, dt);
    this.lean.y = damp(this.lean.y, leanY, 14, dt);
    this.visual.rotation.x = this.lean.x;
    this.visual.rotation.y = this.lean.y;

    // Shadow and halo go on whichever side faces away from the viewer, so a face-down card
    // paints them beneath itself rather than over its back.
    const away = tmpV.set(0, 0, 1).transformDirection(this.matrixWorld).z >= 0 ? 1 : -1;
    if (this.shadow) this.shadow.position.z = -0.006 * away;
    if (this.halo) this.halo.position.z = -0.012 * away;

    const bend = this.u.uBend.value as THREE.Vector3;
    const speed = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
    const cap = 0.11;
    bend.x = clamp(this.vel.x * 0.006 * k, -cap, cap) + clamp(speed * 0.0035 * k, 0, cap) + this.bendExtra.x;
    bend.y = clamp(this.vel.y * 0.007 * k, -cap, cap) + this.bendExtra.y;
    bend.z = clamp(this.vel.x * this.vel.y * 0.0008 * k, -cap, cap) + this.bendExtra.z;
  }

  /**
   * Fast pointer test against the card's rectangle, ignoring bend and corner radius.
   * Returns the ray distance, or null on a miss. Cheaper than a triangle raycast, and
   * corners and bends are too small to matter for picking.
   */
  hitTest(ray: THREE.Ray): number | null {
    this.updateWorldMatrix(true, false);
    invM.copy(this.matrixWorld).invert();
    localRay.copy(ray).applyMatrix4(invM);
    const dz = localRay.direction.z;
    if (Math.abs(dz) < 1e-5) return null;
    const t = -localRay.origin.z / dz;
    if (t < 0) return null;
    localRay.at(t, tmpV);
    if (Math.abs(tmpV.x) > CARD_W / 2 || Math.abs(tmpV.y) > CARD_H / 2) return null;
    return tmpV.applyMatrix4(this.matrixWorld).distanceTo(ray.origin);
  }

  /** The card's materials are per-instance; textures and geometry are shared and survive. */
  override dispose() {
    this.material.dispose();
    (this.shadow?.material as THREE.Material | undefined)?.dispose();
    (this.halo?.material as THREE.Material | undefined)?.dispose();
    this.removeFromParent();
  }
}

const tmpV = new THREE.Vector3();
const invM = new THREE.Matrix4();
const localRay = new THREE.Ray();
