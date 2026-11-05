import * as THREE from 'three';
import { GLSL_COMMON } from './shaders';
import { sharedCardUniforms } from './CardView';
import { artImage } from './face';
import type { Faction } from './data';

// The foil wrapper. It is two sheets sealed at the edges, so anything placed at z = 0 is
// physically inside it. A tear splits it along a jagged line into a body and a top strip;
// both are the same mesh drawn with different discard rules, so the pieces fit perfectly.

export const PACK_W = 3.2;
export const PACK_H = 4.9;
/** y of the tear, near the top seal. */
export const TEAR_Y = 1.98;
const BULGE = 0.2;

const VERT = /* glsl */ `
attribute float aSide;
uniform float uBulge,uTearFront,uTearY,uPeel,uPiece,uTime;
uniform vec2 uHalf;
varying vec2 vP;
varying float vSide;
varying vec3 vWorld;
varying vec3 vN,vT,vB;
${GLSL_COMMON}
float tearLine(float x){ return uTearY+(vnoise(vec2(x*2.6,3.))-.5)*.14+(vnoise(vec2(x*11.,8.))-.5)*.035; }
void main(){
  vec3 p=position;
  vec2 n=p.xy/uHalf;
  // A pillow: full bulge in the middle, pinching to nothing at the sides and the seals.
  float ex=1.-pow(abs(n.x),3.2);
  float seal=.84;
  float ey=1.-pow(clamp(abs(n.y)/seal,0.,1.),5.);
  p.z=aSide*(uBulge*ex*ey+.004);
  vec3 nor=vec3(0.,0.,aSide);

  // Peel the strip forward, hinged on the tear line, more the further the tear has passed.
  if(uPiece>.5){
    float line=tearLine(p.x);
    float dy=max(p.y-line,0.);
    float a=smoothstep(0.,1.5,uTearFront-p.x);
    float th=a*uPeel*(1.+dy*1.6);
    float c=cos(th),s=sin(th);
    p.y=line+dy*c;
    p.z=p.z*c+dy*s+a*.12;
    nor=vec3(0.,-s,c)*aSide;
  }

  vP=position.xy;
  vSide=aSide;
  vec4 w=modelMatrix*vec4(p,1.);
  vWorld=w.xyz;
  mat3 m=mat3(modelMatrix);
  vN=normalize(m*nor);
  vT=normalize(m*vec3(aSide,0.,0.));
  vB=normalize(m*vec3(0.,1.,0.));
  gl_Position=projectionMatrix*viewMatrix*w;
}`;

const FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}
uniform sampler2D tPrint;
uniform vec2 uHalf;
uniform float uTearFront,uTearY,uPiece,uTime,uSeed,uGuide,uLeak,uShimmerX;
uniform vec3 uLeakColor,uLightPos,uTint;
varying vec2 vP;
varying float vSide;
varying vec3 vWorld,vN,vT,vB;

float tearLine(float x){ return uTearY+(vnoise(vec2(x*2.6,3.))-.5)*.14+(vnoise(vec2(x*11.,8.))-.5)*.035; }

// Surface relief, sampled three times per pixel to get a normal.
float height(vec2 p){
  float ny=abs(p.y)/uHalf.y;
  float seal=smoothstep(.86,.89,ny);
  // Soft dents and sharp creases over the bulge, as on real pack foil.
  float crinkle=fbm(p*1.05+uSeed*5.+vSide*3.)*.34;
  crinkle+=abs(fbm(p*2.2+vec2(9.,uSeed))-.5)*.14;
  crinkle+=abs(vnoise(p*vec2(1.2,6.)+uSeed)-.5)*.05;
  // Heat-seal ribs on the crimped strips.
  float ribs=sin(p.x*92.)*.018+sin(p.y*30.)*.008;
  return mix(crinkle*(1.-seal),ribs,seal);
}

void main(){
  // Serrated seal edge at the top and bottom.
  vec2 h=uHalf;
  float tooth=abs(fract(vP.x*7.5)-.5)*.1;
  if(abs(vP.y)>h.y-.05+tooth-.05) discard;

  float line=tearLine(vP.x);
  bool torn=vP.x<uTearFront;
  if(uPiece<.5){ if(vP.y>line&&torn) discard; }
  else { if(vP.y<=line||!torn) discard; }

  vec2 uv=vP/(h*2.)+.5;
  if(vSide<0.) uv.x=1.-uv.x;
  vec3 print=texture2D(tPrint,uv).rgb;

  float e=.018;
  float h0=height(vP);
  float hx=(height(vP+vec2(e,0.))-h0)/e;
  float hy=(height(vP+vec2(0.,e))-h0)/e;

  vec3 N=normalize(vN),T=normalize(vT),B=normalize(vB);
  // Inside of the sheet, seen through the opening or on the back of the peeled strip.
  bool inside=!gl_FrontFacing;
  if(inside) N=-N;
  vec3 Nw=normalize(N-T*hx*.05-B*hy*.05);
  vec3 V=normalize(cameraPosition-vWorld);
  vec3 L=normalize(uLightPos-vWorld);
  vec3 R=reflect(-V,Nw);
  vec3 env=studioEnv(R);
  float spec=pow(max(dot(R,L),0.),60.);

  vec3 col;
  if(inside){
    // Bare silver lining, lit by whatever is glowing inside the pack.
    col=vec3(.5,.52,.55)*(.25+env*.55)+uLeakColor*uLeak*.6;
  }else{
    float lum=luma(print);
    vec3 film=spectral(dot(R.xy,vec2(1.2,.8))+uv.y*.4+h0*1.5+uShimmerX);
    col=print*(.7+env*.42);
    col+=film*(.03+pow(luma(env),1.2)*.09)*(.3+lum);
    col+=vec3(1.,.97,.9)*spec*.45;
    col=mix(col,col*uTint,.15);
  }

  // Bright fringe where the sheet is torn, plus light escaping through the opening.
  float d=abs(vP.y-line);
  if(torn){
    float rim=smoothstep(.035,.0,d);
    col+=vec3(1.,.95,.85)*rim*(.5+uLeak*2.);
    col+=uLeakColor*smoothstep(.55,.0,d)*uLeak*.8;
  }

  // Guide: a light running along the tear line until the player starts.
  if(uGuide>.001&&uPiece<.5&&!inside){
    float run=fract(uTime*.55);
    float px=vP.x/h.x*.5+.5;
    float head=exp(-pow((px-run)/.09,2.));
    float gd=smoothstep(.022,.0,d);
    float dash=step(.4,fract(vP.x*5.-uTime*1.6));
    col+=vec3(1.,.86,.5)*gd*(.18*dash+head*1.8)*uGuide;
  }
  gl_FragColor=vec4(col,1.);
}`;

function buildGeometry() {
  const nx = 70;
  const ny = 100;
  const pos: number[] = [];
  const side: number[] = [];
  const idx: number[] = [];
  for (const s of [1, -1]) {
    const base = pos.length / 3;
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        pos.push((i / nx - 0.5) * PACK_W, (j / ny - 0.5) * PACK_H, 0);
        side.push(s);
      }
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = base + j * (nx + 1) + i;
        const b = a + 1;
        const c = a + nx + 1;
        const d = c + 1;
        if (s > 0) idx.push(a, b, d, a, d, c);
        else idx.push(a, d, b, a, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), PACK_H * 1.4);
  return g;
}
let geo: THREE.BufferGeometry | null = null;

const THEME: Record<Faction, { a: string; b: string; c: string; hero: string; label: string; tint: number }> = {
  ember: { a: '#ff7e3d', b: '#8f2410', c: '#2c0806', hero: 'ember_sov_pyrarch', label: 'EMBER RISING', tint: 0xffb080 },
  cairn: { a: '#b6d97e', b: '#3f6a2c', c: '#0d1c0c', hero: 'cairn_sov_greatwarden', label: 'CAIRN ETERNAL', tint: 0xcdeaa0 },
  veil: { a: '#b6a2ff', b: '#47359a', c: '#0e0a26', hero: 'veil_sov_hollow_queen', label: 'VEIL UNBOUND', tint: 0xc8bbff },
};

function printTexture(f: Faction) {
  const W = 640;
  const H = 980;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const t = THEME[f];

  const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
  g.addColorStop(0, t.a);
  g.addColorStop(0.45, t.b);
  g.addColorStop(1, t.c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Hero art, feathered into the foil so it looks printed rather than stuck on.
  const art = artImage(t.hero);
  if (art) {
    const tmp = document.createElement('canvas');
    tmp.width = W;
    tmp.height = H;
    const tc = tmp.getContext('2d')!;
    const scale = Math.max((W * 1.05) / art.width, 720 / art.height);
    const w = art.width * scale;
    const h = art.height * scale;
    tc.drawImage(art, (W - w) / 2, 120, w, h);
    tc.globalCompositeOperation = 'destination-in';
    const m = tc.createRadialGradient(W / 2, 470, 150, W / 2, 470, 430);
    m.addColorStop(0, 'rgba(0,0,0,1)');
    m.addColorStop(0.72, 'rgba(0,0,0,.92)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    tc.fillStyle = m;
    tc.fillRect(0, 0, W, H);
    ctx.drawImage(tmp, 0, 0);
  }

  // Radiating lines that catch the foil.
  ctx.save();
  ctx.translate(W / 2, 470);
  ctx.globalAlpha = 0.11;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 380, Math.sin(a) * 380);
    ctx.lineTo(Math.cos(a) * 760, Math.sin(a) * 760);
    ctx.stroke();
  }
  ctx.restore();

  // Dark bands behind the title and footer.
  const bandTop = ctx.createLinearGradient(0, 96, 0, 262);
  bandTop.addColorStop(0, 'rgba(5,3,3,.92)');
  bandTop.addColorStop(1, 'rgba(5,3,3,0)');
  ctx.fillStyle = bandTop;
  ctx.fillRect(0, 96, W, 170);
  const bandBot = ctx.createLinearGradient(0, 720, 0, 900);
  bandBot.addColorStop(0, 'rgba(5,3,3,0)');
  bandBot.addColorStop(1, 'rgba(5,3,3,.95)');
  ctx.fillStyle = bandBot;
  ctx.fillRect(0, 720, W, 190);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 66px Cinzel, serif';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(0,0,0,.8)';
  ctx.strokeText('SOVEREIGN', W / 2, 172);
  const gold = ctx.createLinearGradient(0, 140, 0, 205);
  gold.addColorStop(0, '#fff3c4');
  gold.addColorStop(0.55, '#e4bb5e');
  gold.addColorStop(1, '#9d7327');
  ctx.fillStyle = gold;
  ctx.fillText('SOVEREIGN', W / 2, 172);

  ctx.font = '600 25px Cinzel, serif';
  ctx.fillStyle = '#f6ecd3';
  ctx.fillText(t.label, W / 2, 222);

  ctx.font = '600 30px Cinzel, serif';
  ctx.fillStyle = '#fff3c4';
  ctx.fillText('BOOSTER PACK', W / 2, 800);
  ctx.font = '500 21px Inter, sans-serif';
  ctx.fillStyle = '#d9cfb8';
  ctx.fillText('5 cards · 1 guaranteed rare', W / 2, 842);

  // Seal bands, darker and plain.
  ctx.fillStyle = 'rgba(0,0,0,.42)';
  ctx.fillRect(0, 0, W, H * 0.07);
  ctx.fillRect(0, H * 0.93, W, H * 0.07);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const prints = new Map<Faction, THREE.CanvasTexture>();

export class BoosterPack extends THREE.Group {
  readonly uniforms: Record<string, THREE.IUniform>;
  readonly body: THREE.Mesh;
  readonly strip: THREE.Mesh;
  private bodyMat: THREE.ShaderMaterial;
  private stripMat: THREE.ShaderMaterial;

  constructor(readonly faction: Faction) {
    super();
    if (!prints.has(faction)) prints.set(faction, printTexture(faction));
    geo ??= buildGeometry();
    this.uniforms = {
      tPrint: { value: prints.get(faction) },
      uHalf: { value: new THREE.Vector2(PACK_W / 2, PACK_H / 2) },
      uBulge: { value: BULGE },
      uTearFront: { value: -PACK_W },
      uTearY: { value: TEAR_Y },
      uPeel: { value: 2.3 },
      uTime: sharedCardUniforms.uTime,
      uLightPos: sharedCardUniforms.uLightPos,
      uSeed: { value: Math.random() * 10 },
      uGuide: { value: 0 },
      uLeak: { value: 0 },
      uLeakColor: { value: new THREE.Color(0xffd080) },
      uTint: { value: new THREE.Color(THEME[faction].tint) },
      uShimmerX: { value: 0 },
    };
    const mk = (piece: number) =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.DoubleSide,
        // Shared values by reference; only uPiece differs between the two meshes.
        uniforms: { ...this.uniforms, uPiece: { value: piece } },
      });
    this.bodyMat = mk(0);
    this.stripMat = mk(1);
    this.body = new THREE.Mesh(geo, this.bodyMat);
    this.strip = new THREE.Mesh(geo, this.stripMat);
    this.strip.visible = false;
    this.add(this.body, this.strip);
  }

  /** Moves the tear to local x, on the same tear-line function the shader uses. */
  setTear(x: number) {
    this.uniforms.uTearFront.value = x;
    this.strip.visible = x > -PACK_W / 2;
  }

  get tear() {
    return this.uniforms.uTearFront.value as number;
  }

  override dispose() {
    this.bodyMat.dispose();
    this.stripMat.dispose();
    this.removeFromParent();
  }
}
