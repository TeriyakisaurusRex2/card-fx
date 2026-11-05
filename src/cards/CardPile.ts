import * as THREE from 'three';
import { CardLayer, CardView } from './CardView';
import type { CardDef } from './data';
import { finishById } from './finishes';
import { CARD_T, cardGeometry } from './geometry';

// A deck or graveyard. Rendering every card would be wasteful, so a pile is one stretched
// card mesh (the body, with printed "page edge" stripes) and a single real card on top.

const VERT = /* glsl */ `
attribute float aFace;
varying float vZ;
varying float vFace;
varying vec3 vN;
void main(){
  vZ=position.z;
  vFace=aFace;
  vN=normalize(mat3(modelMatrix)*normal);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
}`;
const FRAG = /* glsl */ `
uniform float uCount;
uniform vec3 uTint;
varying float vZ;
varying float vFace;
varying vec3 vN;
void main(){
  float shade=.35+.65*max(dot(normalize(vN),normalize(vec3(.3,-.6,.75))),0.);
  // One dark line per card along the side, fading out if the pile is very thick.
  float line=.5+.5*sin(vZ/${CARD_T.toFixed(4)}*3.14159*uCount);
  gl_FragColor=vec4(uTint*shade*(vFace>1.5?mix(.32,1.,line):.15),1.);
}`;

const bodyGeo = cardGeometry();

export const CARD_STACK_STEP = 0.016;

export class CardPile extends THREE.Group {
  size = 0;
  private body: THREE.Mesh;
  private bodyMat: THREE.ShaderMaterial;
  top: CardView | null = null;

  constructor(
    topScale: number,
    tint = 0xd8c9a8,
    /** Which def shows on top while the pile only displays card backs. */
    backDef?: CardDef,
  ) {
    super();
    this.bodyMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uCount: { value: 1 }, uTint: { value: new THREE.Color(tint) } },
    });
    this.body = new THREE.Mesh(bodyGeo, this.bodyMat);
    this.body.scale.set(topScale, topScale, 1);
    this.add(this.body);
    if (backDef) {
      this.top = new CardView(backDef, finishById('matte').finish, { faceDown: true, bare: true });
      this.top.scale.setScalar(topScale);
      this.top.flex = 0;
      this.top.setLayer(CardLayer.table);
      this.add(this.top);
    }
    this.setCount(0);
  }

  get height() {
    return this.size * CARD_STACK_STEP;
  }

  /** World position of the top surface, which is where a card should land or lift from. */
  topWorld(out = new THREE.Vector3()) {
    return out.set(this.position.x, this.position.y, this.position.z + this.height + 0.01);
  }

  setCount(n: number) {
    this.size = Math.max(0, n);
    const h = this.height;
    this.body.visible = this.size > 0;
    this.body.scale.z = Math.max(h / CARD_T, 0.001);
    this.body.position.z = h / 2;
    this.bodyMat.uniforms.uCount.value = Math.max(this.size, 1);
    if (this.top) {
      this.top.visible = this.size > 0;
      this.top.position.z = h + 0.008;
    }
  }

  /** Replaces the top card with a real one, as on a graveyard. The old top is discarded. */
  placeOnTop(card: CardView) {
    this.top?.dispose();
    this.top = card;
    this.attach(card);
    card.setLayer(CardLayer.table);
    card.flex = 0;
    card.position.z = this.height + 0.008;
  }

  override dispose() {
    this.bodyMat.dispose();
    this.top?.dispose();
    this.removeFromParent();
  }
}
