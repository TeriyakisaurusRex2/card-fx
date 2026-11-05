import * as THREE from 'three';
import { Timeline, ease } from '../core/anim';
import { ParticleSystem } from './particles';

// One-shot visual effects. Each spawns a mesh, animates it on the scene's timeline and
// removes itself, so calling code stays a single line in a choreography.

const QUAD = new THREE.PlaneGeometry(1, 1);
const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;

const RING_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uK,uWidth,uAmount;
varying vec2 vUv;
void main(){
  float r=length(vUv-.5)*2.;
  float rad=uK*.92;
  float w=uWidth*(1.-uK*.55);
  float band=exp(-pow((r-rad)/w,2.));
  // A faint disc inside the ring, so it reads as a pressure wave and not a hoop.
  float inner=smoothstep(rad,0.,r)*.14*(1.-uK);
  float edge=smoothstep(1.,.92,r);
  gl_FragColor=vec4(uColor*(band+inner)*uAmount*(1.-uK)*edge,1.);
}`;

const RAYS_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uTime,uAmount,uSeed;
varying vec2 vUv;
float h(float x){ return fract(sin(x*127.1+uSeed)*43758.5453); }
void main(){
  vec2 p=vUv-.5;
  float r=length(p)*2.;
  float a=atan(p.y,p.x);
  float s=0.;
  // Layers of noisy spokes turning opposite ways; where they overlap, a beam appears.
  for(int i=0;i<3;i++){
    float n=9.+float(i)*7.;
    float sp=(i==1?-1.:1.)*(.1+.05*float(i));
    float x=(a+uTime*sp)/6.28318*n+float(i)*3.1;
    float id=floor(x);
    float f=fract(x);
    float wide=.25+.5*h(id+float(i)*9.);
    s+=smoothstep(wide,0.,abs(f-.5))*(.35+.65*h(id+40.));
  }
  float fall=pow(max(1.-r,0.),1.7);
  float core=exp(-r*6.5)*.9;
  gl_FragColor=vec4(uColor*(s*.45*fall+core)*uAmount,1.);
}`;

const FLASH_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uAmount;
varying vec2 vUv;
void main(){
  vec2 p=vUv-.5;
  float r=length(p)*2.;
  float glow=pow(max(1.-r,0.),2.6);
  // Anamorphic streak: a thin bright line through the flash.
  float streak=exp(-abs(p.y)*70.)*pow(max(1.-abs(p.x)*2.,0.),1.5)*.75;
  gl_FragColor=vec4(uColor*(glow+streak)*uAmount,1.);
}`;

function fxMaterial(frag: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: frag,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
}

export class Fx {
  /** Additive light: sparks, glows, stars, foil flakes. */
  readonly light: ParticleSystem;
  /** Normal-blended matter: dust and smoke, which can darken as well as lighten. */
  readonly dust: ParticleSystem;
  time = 0;
  private live = new Set<THREE.Mesh>();

  constructor(
    readonly scene: THREE.Scene,
    readonly tl: Timeline,
    readonly camera: THREE.Camera,
  ) {
    this.light = new ParticleSystem(9000, true);
    this.dust = new ParticleSystem(1600, false);
    scene.add(this.light, this.dust);
  }

  update(time: number) {
    this.time = time;
    this.light.update(time);
    this.dust.update(time);
  }

  private spawn(mat: THREE.ShaderMaterial, pos: THREE.Vector3, size: number, order: number, billboard: boolean) {
    const m = new THREE.Mesh(QUAD, mat);
    m.position.copy(pos);
    m.scale.setScalar(size);
    if (billboard) m.quaternion.copy(this.camera.quaternion);
    m.renderOrder = order;
    this.scene.add(m);
    this.live.add(m);
    return m;
  }

  private drop(m: THREE.Mesh) {
    (m.material as THREE.Material).dispose();
    m.removeFromParent();
    this.live.delete(m);
  }

  /** Expanding pressure wave lying in the XY plane (the table and the screen plane). */
  ring(pos: THREE.Vector3, o: { color?: number; size?: number; dur?: number; width?: number; amount?: number } = {}) {
    const mat = fxMaterial(RING_FRAG, {
      uColor: { value: new THREE.Color(o.color ?? 0xffffff) },
      uK: { value: 0 },
      uWidth: { value: o.width ?? 0.05 },
      uAmount: { value: o.amount ?? 2 },
    });
    const m = this.spawn(mat, pos, o.size ?? 8, 18, false);
    void this.tl.to(o.dur ?? 0.65, (k) => (mat.uniforms.uK.value = k), { ease: ease.outCubic }).then(() => this.drop(m));
  }

  flash(pos: THREE.Vector3, o: { color?: number; size?: number; dur?: number; amount?: number } = {}) {
    const amount = o.amount ?? 3;
    const size = o.size ?? 8;
    const mat = fxMaterial(FLASH_FRAG, {
      uColor: { value: new THREE.Color(o.color ?? 0xffffff) },
      uAmount: { value: amount },
    });
    const m = this.spawn(mat, pos, size, 22, true);
    void this.tl
      .to(o.dur ?? 0.35, (k) => {
        mat.uniforms.uAmount.value = amount * (1 - k);
        m.scale.setScalar(size * (0.65 + k * 0.5));
      }, { ease: ease.outQuad })
      .then(() => this.drop(m));
  }

  /** Long-lived god rays. Returns a handle: move them, change intensity, fade them out. */
  rays(pos: THREE.Vector3, o: { color?: number; size?: number; amount?: number; order?: number; billboard?: boolean; depthTest?: boolean } = {}) {
    const mat = fxMaterial(RAYS_FRAG, {
      uColor: { value: new THREE.Color(o.color ?? 0xffffff) },
      uTime: { value: 0 },
      uAmount: { value: o.amount ?? 1 },
      uSeed: { value: Math.random() * 100 },
    });
    // With depthTest on, rays placed behind an object stay behind it.
    mat.depthTest = o.depthTest ?? false;
    const m = this.spawn(mat, pos, o.size ?? 12, o.order ?? 2, o.billboard ?? true);
    const untick = this.tl.tick((dt) => (mat.uniforms.uTime.value += dt));
    return {
      mesh: m,
      amount: (v: number) => (mat.uniforms.uAmount.value = v),
      color: (c: number) => (mat.uniforms.uColor.value as THREE.Color).set(c),
      fadeTo: (v: number, dur: number) => {
        const from = mat.uniforms.uAmount.value as number;
        return this.tl.to(dur, (k) => (mat.uniforms.uAmount.value = from + (v - from) * k));
      },
      remove: (dur = 0.4) => {
        const from = mat.uniforms.uAmount.value as number;
        return this.tl
          .to(dur, (k) => (mat.uniforms.uAmount.value = from * (1 - k)))
          .then(() => {
            untick();
            this.drop(m);
          });
      },
    };
  }

  dispose() {
    for (const m of [...this.live]) this.drop(m);
    this.light.dispose();
    this.dust.dispose();
  }
}

/** Dim gradient behind everything, drawn in clip space so no camera can move it. */
export function makeBackdrop(colors: { inner: number; outer: number; glow?: number }) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,.9999,1.); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uInner,uOuter,uGlow; uniform float uGlowAmt,uAspect; uniform vec2 uCenter;
      varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
      void main(){
        vec2 p=(vUv-uCenter)*vec2(uAspect,1.);
        float r=length(p);
        vec3 c=mix(uInner,uOuter,smoothstep(.05,1.05,r));
        c+=uGlow*uGlowAmt*exp(-r*r*3.2);
        // Dither so a slow dark gradient doesn't band. Tiny, because this is linear light:
        // converting to sRGB later amplifies very dark values more than ten times.
        c+=(h(gl_FragCoord.xy)-.5)/2800.;
        gl_FragColor=vec4(c,1.);
      }`,
    uniforms: {
      uInner: { value: new THREE.Color(colors.inner) },
      uOuter: { value: new THREE.Color(colors.outer) },
      uGlow: { value: new THREE.Color(colors.glow ?? colors.inner) },
      uGlowAmt: { value: 0 },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uAspect: { value: 1 },
    },
    depthWrite: false,
    depthTest: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  m.frustumCulled = false;
  m.renderOrder = -100;
  return m;
}
