import * as THREE from 'three';

// GPU particles. A particle is never updated once spawned: the vertex shader computes
// its position purely from (time - spawnTime), so thousands of them cost one draw call
// and no per-frame CPU. New particles overwrite the oldest slot in a ring buffer.

export const Kind = { glow: 0, spark: 1, star: 2, shard: 3, smoke: 4, ember: 5 } as const;
export type ParticleKind = keyof typeof Kind;

const VERT = /* glsl */ `
attribute vec3 iPos,iVel;
attribute vec4 iA;      // spawn time, life, size, seed
attribute vec4 iColor;  // rgb, kind
attribute vec4 iG;      // gravity xyz, drag
uniform float uTime;
varying vec2 vQ;
varying vec3 vColor;
varying float vKind,vAge,vSeed,vT;

void main(){
  float t=uTime-iA.x;
  float age=t/iA.y;
  if(age<0.||age>1.){ gl_Position=vec4(2.,2.,2.,1.); return; }
  float drag=max(iG.w,.0001);
  float dk=exp(-drag*t);
  // Closed form of velocity under drag plus gravity, so no integration state is needed.
  vec3 p=iPos+iVel*(1.-dk)/drag+.5*iG.xyz*t*t;
  vec3 v=iVel*dk+iG.xyz*t;
  float seed=iA.w;
  float kind=iColor.a;
  if(kind>4.5||kind>2.5&&kind<3.5){
    p.x+=sin(t*2.6+seed*40.)*.09*t;
    p.y+=cos(t*2.1+seed*23.)*.05*t;
  }

  vec4 mv=viewMatrix*vec4(p,1.);
  vec2 q=position.xy;
  float size=iA.z;
  vec2 off;
  if(kind>.5&&kind<1.5){
    // Spark: stretch along its on-screen velocity.
    vec2 sv=(mat3(viewMatrix)*v).xy;
    float sp=length(sv)+1e-4;
    vec2 dir=sv/sp;
    vec2 perp=vec2(-dir.y,dir.x);
    off=dir*q.x*size*(1.+sp*.5)+perp*q.y*size*.28;
    size*=1.-age*.5;
  }else if(kind>2.5&&kind<3.5){
    // Foil shard: spin in-plane and tumble by narrowing one axis.
    float a=seed*6.28+t*(2.+seed*5.);
    float tumble=cos(t*(4.+seed*9.)+seed*9.);
    vec2 r=q*vec2(size,size*.62*abs(tumble)+size*.05);
    off=vec2(r.x*cos(a)-r.y*sin(a),r.x*sin(a)+r.y*cos(a));
    vT=tumble;
  }else if(kind>3.5&&kind<4.5){
    // Smoke grows as it fades.
    float s=size*(.6+age*1.3);
    float a=seed*6.28+t*.25;
    vec2 r=q*s;
    off=vec2(r.x*cos(a)-r.y*sin(a),r.x*sin(a)+r.y*cos(a));
  }else{
    float s=size;
    if(kind>1.5&&kind<2.5){
      float a=seed*6.28+t*.8;
      vec2 r=q*s;
      off=vec2(r.x*cos(a)-r.y*sin(a),r.x*sin(a)+r.y*cos(a));
    }else off=q*s;
  }
  mv.xy+=off;
  gl_Position=projectionMatrix*mv;
  vQ=q;
  vColor=iColor.rgb;
  vKind=kind;
  vAge=age;
  vSeed=seed;
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
varying vec2 vQ;
varying vec3 vColor;
varying float vKind,vAge,vSeed,vT;
void main(){
  float r=length(vQ);
  float a;
  float k=vKind;
  vec3 c=vColor;
  if(k<.5){
    a=pow(max(1.-r,0.),2.2)*smoothstep(0.,.08,vAge)*pow(1.-vAge,1.5);
  }else if(k<1.5){
    a=pow(max(1.-r,0.),1.3)*pow(1.-vAge,1.2);
  }else if(k<2.5){
    // Four-point star: bright along the axes, pinched between them.
    float d=abs(vQ.x)*abs(vQ.y);
    float star=exp(-d*48.)*pow(max(1.-r,0.),1.5);
    float tw=.65+.35*sin(uTime*24.+vSeed*60.);
    a=star*tw*smoothstep(0.,.12,vAge)*pow(1.-vAge,1.1);
  }else if(k<3.5){
    // Foil shard: hard edged, colour flashing with its tumble.
    a=step(max(abs(vQ.x),abs(vQ.y)),.96)*smoothstep(1.,.75,vAge);
    float flash=pow(abs(vT),5.);
    vec3 rb=.5+.5*cos(6.283*(vSeed*2.+vT*.35+vec3(0.,.33,.67)));
    c=mix(c,rb,.55)*(.28+flash*2.4);
  }else if(k<4.5){
    a=pow(max(1.-r,0.),1.6)*smoothstep(0.,.15,vAge)*pow(1.-vAge,1.4);
  }else{
    float flick=.6+.4*sin(uTime*19.+vSeed*50.);
    a=pow(max(1.-r,0.),2.)*flick*pow(1.-vAge,1.2);
    c=mix(c,vec3(1.,.15,.02)*c.r,vAge);
  }
  if(a<.002) discard;
  gl_FragColor=vec4(c,a);
}`;

export type Range = number | [number, number];
const pick = (r: Range) => (typeof r === 'number' ? r : r[0] + Math.random() * (r[1] - r[0]));

export interface EmitOptions {
  kind?: ParticleKind;
  /** Spawn point, or a function giving a different point per particle. */
  at: THREE.Vector3 | ((out: THREE.Vector3, i: number) => void);
  /** Random jitter around the spawn point, per axis. */
  jitter?: [number, number, number];
  speed?: Range;
  /** Cone centre. Omit for all directions. */
  dir?: THREE.Vector3;
  /** Half-angle of the cone in radians. */
  cone?: number;
  /** Squashes velocity on z, so bursts spread over the table instead of at the camera. */
  flatten?: number;
  life?: Range;
  size?: Range;
  color?: number | number[];
  /** HDR multiplier. Above ~1 lights the bloom. */
  bright?: Range;
  gravity?: [number, number, number];
  drag?: Range;
}

export class ParticleSystem extends THREE.Mesh {
  private head = 0;
  private dirty = false;
  private attrs: Record<'iPos' | 'iVel' | 'iA' | 'iColor' | 'iG', THREE.InstancedBufferAttribute>;
  private mat: THREE.ShaderMaterial;
  time = 0;

  constructor(
    readonly capacity: number,
    additive: boolean,
  ) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n).setUsage(THREE.DynamicDrawUsage);
    const attrs = { iPos: mk(3), iVel: mk(3), iA: mk(4), iColor: mk(4), iG: mk(4) };
    for (const [k, v] of Object.entries(attrs)) g.setAttribute(k, v);
    // Start every slot in the past so nothing draws until it is really spawned.
    (attrs.iA.array as Float32Array).fill(-1000);
    g.instanceCount = capacity;

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    super(g, mat);
    this.mat = mat;
    this.attrs = attrs;
    this.frustumCulled = false;
    this.renderOrder = additive ? 20 : 15;
  }

  emit(count: number, o: EmitOptions) {
    const kind = Kind[o.kind ?? 'glow'];
    const colors = Array.isArray(o.color) ? o.color : [o.color ?? 0xffffff];
    const iPos = this.attrs.iPos.array as Float32Array;
    const iVel = this.attrs.iVel.array as Float32Array;
    const iA = this.attrs.iA.array as Float32Array;
    const iC = this.attrs.iColor.array as Float32Array;
    const iG = this.attrs.iG.array as Float32Array;
    const j = o.jitter ?? [0, 0, 0];
    const g = o.gravity ?? [0, 0, 0];
    for (let n = 0; n < count; n++) {
      const i = this.head;
      this.head = (this.head + 1) % this.capacity;
      if (typeof o.at === 'function') o.at(tmpP, n);
      else tmpP.copy(o.at);
      iPos[i * 3] = tmpP.x + (Math.random() * 2 - 1) * j[0];
      iPos[i * 3 + 1] = tmpP.y + (Math.random() * 2 - 1) * j[1];
      iPos[i * 3 + 2] = tmpP.z + (Math.random() * 2 - 1) * j[2];

      // Random direction, then pulled into the cone if one was given.
      tmpD.randomDirection();
      if (o.dir) {
        const cone = o.cone ?? 0.6;
        tmpD.lerp(o.dir, 1 - Math.min(cone / Math.PI, 1)).normalize();
      }
      if (o.flatten !== undefined) tmpD.z *= o.flatten;
      const sp = pick(o.speed ?? 1);
      iVel[i * 3] = tmpD.x * sp;
      iVel[i * 3 + 1] = tmpD.y * sp;
      iVel[i * 3 + 2] = tmpD.z * sp;

      iA[i * 4] = this.time;
      iA[i * 4 + 1] = Math.max(pick(o.life ?? 1), 0.02);
      iA[i * 4 + 2] = pick(o.size ?? 0.1);
      iA[i * 4 + 3] = Math.random();

      tmpC.set(colors[(Math.random() * colors.length) | 0]).multiplyScalar(pick(o.bright ?? 1));
      iC[i * 4] = tmpC.r;
      iC[i * 4 + 1] = tmpC.g;
      iC[i * 4 + 2] = tmpC.b;
      iC[i * 4 + 3] = kind;

      iG[i * 4] = g[0];
      iG[i * 4 + 1] = g[1];
      iG[i * 4 + 2] = g[2];
      iG[i * 4 + 3] = pick(o.drag ?? 0.8);
    }
    this.dirty = true;
  }

  update(time: number) {
    this.time = time;
    this.mat.uniforms.uTime.value = time;
    if (this.dirty) {
      for (const a of Object.values(this.attrs)) a.needsUpdate = true;
      this.dirty = false;
    }
  }

  override dispose() {
    this.geometry.dispose();
    this.mat.dispose();
    this.removeFromParent();
  }
}

const tmpP = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpC = new THREE.Color();
