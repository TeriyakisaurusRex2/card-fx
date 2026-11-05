import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { sharedCardUniforms } from '../cards/CardView';

const MAX_RIPPLES = 4;
const PANEL_MIN_SCREEN = 900;
const PANEL_SPACE = 284;

// Last full-screen pass: bends the image around impact ripples and splits colour
// slightly when a ripple or a hit asks for it.
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4()) },
    uAspect: { value: 1 },
    uAberration: { value: 0 },
    uVignette: { value: 0.35 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec4 uRipples[${MAX_RIPPLES}];
    uniform float uAspect,uAberration,uVignette;
    varying vec2 vUv;
    void main(){
      vec2 uv=vUv,off=vec2(0.);
      float ab=uAberration;
      for(int i=0;i<${MAX_RIPPLES};i++){
        vec4 r=uRipples[i];
        if(r.w<=0.) continue;
        vec2 d=(uv-r.xy)*vec2(uAspect,1.);
        float len=length(d)+1e-4;
        float x=(len-r.z)/.075;
        float w=exp(-x*x)*r.w;
        off+=(d/len)*w*x*-1.;
        ab+=w*.5;
      }
      off/=vec2(uAspect,1.);
      vec2 s=uv+off*.06;
      vec2 dir=(uv-.5)*ab*.012;
      vec3 c=vec3(texture2D(tDiffuse,s+dir).r,texture2D(tDiffuse,s).g,texture2D(tDiffuse,s-dir).b);
      float v=smoothstep(.95,.32,length((vUv-.5)*vec2(1.05,1.)));
      c*=mix(1.-uVignette,1.,v);
      gl_FragColor=vec4(c,1.);
    }`,
};

interface Ripple {
  world: THREE.Vector3;
  t: number;
  dur: number;
  strength: number;
  maxRadius: number;
}

/**
 * Owns the renderer and the post stack, and the things every scene wants from it:
 * camera fitting, pointer rays, screen shake and impact ripples.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly final: ShaderPass;
  private renderPass: RenderPass;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);

  readonly pointer = new THREE.Vector2(0, 0); // NDC
  readonly pointerPx = new THREE.Vector2();
  pointerInside = false;
  private raycaster = new THREE.Raycaster();

  private trauma = 0;
  private ripples: Ripple[] = [];
  private shakeOffset = new THREE.Vector3();
  private resizeListeners = new Set<() => void>();
  aberrationPulse = 0;
  width = 1;
  height = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Neutral leaves everything under ~0.8 alone, so card art keeps its true colours,
    // and only rolls off the HDR highlights that foil and bursts produce.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;

    // HDR buffer: foil can go above 1.0 and the bloom pass turns the excess into glow.
    const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.5, 1.2);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointermove', (e) => this.trackPointer(e));
    window.addEventListener('pointerdown', (e) => this.trackPointer(e));
    document.addEventListener('pointerleave', () => (this.pointerInside = false));
    this.resize();
  }

  private trackPointer(e: PointerEvent) {
    this.pointerPx.set(e.clientX, e.clientY);
    this.pointer.set((e.clientX / this.width) * 2 - 1, -(e.clientY / this.height) * 2 + 1);
    this.pointerInside = true;
  }

  onResize(fn: () => void) {
    this.resizeListeners.add(fn);
    return () => this.resizeListeners.delete(fn);
  }

  resize() {
    // A hidden tab can report zero; a zero height would turn every camera fit into NaN.
    this.width = Math.max(window.innerWidth, 1);
    this.height = Math.max(window.innerHeight, 1);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.final.uniforms.uAspect.value = this.width / this.height;
    for (const fn of this.resizeListeners) fn();
  }

  setScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    camera.aspect = this.width / this.height;
    camera.updateProjectionMatrix();
    this.ripples = [];
    this.trauma = 0;
  }

  /** World ray through the pointer. */
  ray(ndc: THREE.Vector2 = this.pointer) {
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray;
  }

  /** Where the pointer ray crosses a plane, or null if it runs parallel. */
  pointOnPlane(plane: THREE.Plane, out = new THREE.Vector3()) {
    return this.ray().intersectPlane(plane, out);
  }

  /** Moves the camera back along z until a world-space rect fits on screen, optionally beside the panel. */
  fitDistance(camera: THREE.PerspectiveCamera, w: number, h: number, besidePanel = false) {
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const distH = h / 2 / Math.tan(vfov / 2);
    const freeW = besidePanel && this.width > PANEL_MIN_SCREEN ? this.width - PANEL_SPACE : this.width;
    const distW = w / 2 / (Math.tan(vfov / 2) * (freeW / this.height));
    return Math.max(distH, distW);
  }

  /** CSS pixels the picture is moved left by centerBesidePanel, which is half the panel's space. */
  get panelShift() {
    return this.width > PANEL_MIN_SCREEN ? PANEL_SPACE / 2 : 0;
  }

  /**
   * Shifts the picture so the world origin lands in the middle of the space beside the
   * side panel, on screens wide enough to have one. Rays and projections account for it.
   */
  centerBesidePanel(camera: THREE.PerspectiveCamera) {
    camera.aspect = this.width / this.height;
    const shift = this.panelShift;
    if (shift) camera.setViewOffset(this.width, this.height, shift, 0, this.width, this.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  /** World position to CSS pixels, for lining DOM labels up with 3D objects. */
  toScreen(world: THREE.Vector3, out = new THREE.Vector2()) {
    const v = tmp.copy(world).project(this.camera);
    return out.set(((v.x + 1) / 2) * this.width, ((1 - v.y) / 2) * this.height);
  }

  /** Adds camera trauma. Shake grows with trauma squared, so small hits stay gentle. */
  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  ripple(world: THREE.Vector3, strength = 0.8, dur = 0.7, maxRadius = 0.75) {
    if (this.ripples.length >= MAX_RIPPLES) this.ripples.shift();
    this.ripples.push({ world: world.clone(), t: 0, dur, strength, maxRadius });
  }

  render(dt: number, time: number) {
    sharedCardUniforms.uTime.value = time;

    // Shake is applied just for this render, then undone, so scenes never see it.
    const shake = this.trauma * this.trauma;
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    const n = (o: number) => Math.sin(time * 41 + o) * 0.5 + Math.sin(time * 67 + o * 2.1) * 0.5;
    this.shakeOffset.set(n(1) * 0.32 * shake, n(5) * 0.32 * shake, 0);
    const roll = n(9) * 0.012 * shake;
    this.camera.position.add(this.shakeOffset);
    this.camera.rotation.z += roll;

    const slots = this.final.uniforms.uRipples.value as THREE.Vector4[];
    this.ripples = this.ripples.filter((r) => (r.t += dt) < r.dur);
    slots.forEach((slot, i) => {
      const r = this.ripples[i];
      if (!r) return slot.set(0, 0, 0, 0);
      const k = r.t / r.dur;
      const p = tmp.copy(r.world).project(this.camera);
      slot.set((p.x + 1) / 2, (p.y + 1) / 2, k * r.maxRadius, r.strength * (1 - k) * (1 - k));
    });
    this.aberrationPulse = Math.max(0, this.aberrationPulse - dt * 2.5);
    this.final.uniforms.uAberration.value = this.aberrationPulse + 0.04;

    this.composer.render(dt);

    this.camera.position.sub(this.shakeOffset);
    this.camera.rotation.z -= roll;
  }
}

const tmp = new THREE.Vector3();
