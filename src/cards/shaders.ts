// GLSL for the card. The fragment shader is an "uber shader": every foil layer lives
// here, gated by uniforms, and a finish just sets how much of each layer to use.

export const GLSL_COMMON = /* glsl */ `
float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec2 hash22(vec2 p){ float n=hash21(p); return vec2(n,hash21(p+n+17.1)); }
float vnoise(vec2 p){
  vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){
  float a=.5,s=0.;
  for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.3,9.1); a*=.5; }
  return s;
}
// Rainbow from a phase: three cosines a third of a cycle apart.
vec3 spectral(float t){ return .5+.5*cos(6.28318*(t+vec3(0.,.33,.67))); }
float luma(vec3 c){ return dot(c,vec3(.2126,.7152,.0722)); }
// Rotates a colour around the grey axis (Rodrigues' formula).
vec3 hueShift(vec3 c,float a){
  const vec3 k=vec3(.57735);
  float ca=cos(a);
  return c*ca+cross(k,c)*sin(a)+k*dot(k,c)*(1.-ca);
}
// x = distance from the cell's border, yz = cell id.
vec3 voronoi(vec2 p){
  vec2 n=floor(p),f=fract(p),mg=vec2(0.),mr=vec2(0.);
  float md=8.;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    vec2 g=vec2(float(i),float(j)),o=hash22(n+g),r=g+o-f;
    float d=dot(r,r);
    if(d<md){md=d;mr=r;mg=g;}
  }
  md=8.;
  for(int j=-2;j<=2;j++)for(int i=-2;i<=2;i++){
    vec2 g=mg+vec2(float(i),float(j)),o=hash22(n+g),r=g+o-f;
    if(dot(mr-r,mr-r)>1e-5) md=min(md,dot(.5*(mr+r),normalize(r-mr)));
  }
  return vec3(md,n+mg);
}
// A fake photo studio to reflect: a dim gradient room with tall strip lights.
// A flat card only ever reflects a narrow slice of the world, so the strips are packed
// tightly; a small tilt sweeps them across the surface.
vec3 studioEnv(vec3 r){
  r=normalize(r);
  float y=r.y*.5+.5;
  vec3 c=mix(vec3(.05,.045,.06),vec3(.5,.47,.46),smoothstep(.15,1.,y));
  c+=vec3(1.9,1.75,1.5)*pow(max(0.,sin(r.x*8.+r.y*2.5+.7)),10.);
  c+=vec3(.9,1.,1.35)*pow(max(0.,sin(r.x*3.7-r.y*6.3+2.2)),18.);
  c+=vec3(.6,.55,.5)*pow(max(0.,sin(r.x*19.+r.y*11.)),30.);
  return c;
}
`;

export const CARD_VERT = /* glsl */ `
attribute float aFace;
uniform vec3 uBend;   // x = curl across width, y = curl along height, z = twist
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vT;
varying vec3 vB;
varying float vFace;

void main(){
  vec3 p=position;
  // The bend is a height field z = f(x,y), so its slope gives the normal directly.
  float dzdx=uBend.x*p.x+uBend.z*p.y;
  float dzdy=uBend.y*p.y+uBend.z*p.x;
  p.z+=.5*uBend.x*p.x*p.x+.5*uBend.y*p.y*p.y+uBend.z*p.x*p.y;
  vec3 gn=normalize(vec3(-dzdx,-dzdy,1.));
  vec3 n=normal;
  if(aFace<.5) n=gn;
  else if(aFace<1.5) n=-gn;

  mat3 m=mat3(modelMatrix);
  vec4 world=modelMatrix*vec4(p,1.);
  vWorld=world.xyz;
  vN=normalize(m*n);
  // From behind the card, +x points left, so flip it to keep tangent space right-handed.
  vT=normalize(m*vec3(1.,0.,dzdx))*(aFace>.5&&aFace<1.5?-1.:1.);
  vB=normalize(m*vec3(0.,1.,dzdy));
  vUv=uv;
  vFace=aFace;
  gl_Position=projectionMatrix*viewMatrix*world;
}
`;

export const CARD_FRAG = /* glsl */ `
precision highp float;
${GLSL_COMMON}
uniform sampler2D tFace,tMask,tBack,tBackMask;
uniform vec2 uTexel;
uniform vec4 uArtRect;
uniform float uTime,uSeed;
uniform vec3 uLightPos;
uniform vec2 uShimmer;
uniform vec3 uEdgeColor;

uniform vec3 uMetal,uPrism,uPillars,uCosmos,uGlitter,uShards,uEtch,uPoly,uMetalTint;
uniform float uBrush,uGild,uDepth,uSweep,uFire,uRelief,uGloss,uHue;

uniform float uDissolve,uDissolveMode,uFlash,uDim;
uniform vec3 uBurnColor;

varying vec2 vUv;
varying vec3 vWorld,vN,vT,vB;
varying float vFace;

// Shared compositing for rainbow foil. Mostly it multiplies the print by the rainbow, so
// the image survives underneath; a small additive part lets highlights glow. This is why
// foil looks like it sits inside the image rather than on a sheet in front of it.
void foil(inout vec3 col,float l,vec3 rainbow,float power,float amt){
  vec3 tinted=col*(1.+(rainbow*1.55-.6)*power);
  col=mix(col,tinted,amt);
  col+=rainbow*power*amt*(.035+.17*l);
}

// Fades patterns finer than a pixel so distant cards don't turn to moiré.
float fineFade(float coord){ return 1.-smoothstep(.25,.7,fwidth(coord)); }

void main(){
  vec2 uv=vUv;
  bool isFront=vFace<.5;
  bool isEdge=vFace>1.5;

  // ---- exit effects: burn, shatter, sand ----
  float burnEdge=0.;
  if(uDissolve>.0001){
    float n;
    if(uDissolveMode<.5){
      n=clamp((fbm(uv*vec2(4.5,6.3)+uSeed*7.)-.18)/.62,0.,1.)*.86+.14*vnoise(uv*42.);
    }else if(uDissolveMode<1.5){
      vec3 v=voronoi(uv*vec2(5.,7.)+uSeed*3.);
      n=hash21(v.yz+uSeed);
      if(v.x<.03) n*=.4;
    }else{
      n=uv.x*.72+vnoise(uv*7.+uSeed)*.14+hash21(floor(uv*220.))*.14;
    }
    float d=n-uDissolve*1.18;
    if(d<0.) discard;
    burnEdge=1.-smoothstep(0.,uDissolveMode>.5&&uDissolveMode<1.5?.05:.11,d);
  }

  vec3 N=normalize(vN),T=normalize(vT),B=normalize(vB);
  vec3 Vw=normalize(cameraPosition-vWorld);
  vec3 Lw=normalize(uLightPos-vWorld);

  if(isEdge){
    float rim=.35+.65*max(dot(N,Lw),0.);
    vec3 e=uEdgeColor*rim+studioEnv(reflect(-Vw,N))*.15;
    gl_FragColor=vec4(mix(e,vec3(2.),uFlash)*uDim+uBurnColor*burnEdge*6.,1.);
    return;
  }

  // Tangent space: x across the card, y up it, z out of it. uShimmer lets a scene nudge
  // the apparent view angle, so foil responds to the pointer on a card that isn't moving.
  vec3 Vt=vec3(dot(Vw,T),dot(Vw,B),dot(Vw,N));
  Vt.xy+=uShimmer;
  Vt=normalize(Vt);
  vec3 Lt=normalize(vec3(dot(Lw,T),dot(Lw,B),dot(Lw,N)));
  vec3 Ht=normalize(Lt+Vt);

  vec3 mask=isFront?texture2D(tMask,uv).rgb:texture2D(tBackMask,uv).rgb;
  vec3 alb=isFront?texture2D(tFace,uv).rgb:texture2D(tBack,uv).rgb;
  float rArt=mask.r,rFrame=mask.g,rPaper=clamp(1.-rArt-rFrame,0.,1.);
  vec3 reg=vec3(rArt,rFrame,rPaper);

  // ---- void window: re-sample the art as if it sat behind the card surface ----
  float windowShade=1.;
  // Only where the mask is firmly art: full-art cards fade it out under baked-in text,
  // and re-sampling there would drag a ghost copy of the words around.
  float rWindow=smoothstep(.5,.95,rArt);
  if(isFront&&uDepth>.0001&&rWindow>.01){
    vec2 c=.5*(uArtRect.xy+uArtRect.zw);
    vec2 half_=.5*(uArtRect.zw-uArtRect.xy);
    vec2 off=(Vt.xy/max(Vt.z,.4))*uDepth*vec2(1.,.714);
    vec2 auv=c+(uv-c)*(1.-uDepth*1.7)-off;
    auv=clamp(auv,uArtRect.xy+.003,uArtRect.zw-.003);
    alb=mix(alb,texture2D(tFace,auv).rgb,rWindow);
    // Inner shadow, thrown by the frame onto the recessed art, shifting with the view.
    vec2 q=abs(uv-c+off*.9)/half_;
    float rimD=1.-max(q.x,q.y);
    windowShade=mix(1.,smoothstep(-.02,.2,rimD)*.85+.15,rWindow);
    alb*=windowShade;
  }

  // ---- bump: frame bevels from the mask, relief from the art's own contrast ----
  vec2 dx=vec2(uTexel.x,0.),dy=vec2(0.,uTexel.y);
  float hx,hy;
  if(isFront){
    hx=texture2D(tMask,uv+dx).b-texture2D(tMask,uv-dx).b;
    hy=texture2D(tMask,uv+dy).b-texture2D(tMask,uv-dy).b;
  }else{
    hx=texture2D(tBackMask,uv+dx).b-texture2D(tBackMask,uv-dx).b;
    hy=texture2D(tBackMask,uv+dy).b-texture2D(tBackMask,uv-dy).b;
  }
  vec3 Nt=vec3(-hx*3.,-hy*3.,1.);
  float F=isFront?1.:0.;
  if(isFront&&uRelief>0.&&rArt>.01){
    float ax=luma(texture2D(tFace,uv+dx*1.5).rgb)-luma(texture2D(tFace,uv-dx*1.5).rgb);
    float ay=luma(texture2D(tFace,uv+dy*1.5).rgb)-luma(texture2D(tFace,uv-dy*1.5).rgb);
    Nt.xy-=vec2(ax,ay)*uRelief*rArt*.55;
  }

  // ---- etch bumps the surface too, so handle its lines before lighting ----
  float etchAmt=dot(uEtch,reg)*F;
  float etchLines=0.;
  vec2 ep=(uv-.5)*vec2(1.,1.4);
  float er=length(ep);
  if(etchAmt>.001){
    float ea=atan(ep.y,ep.x);
    float coord=er*170.+sin(ea*9.+er*14.)*3.5;
    float wave=sin(coord);
    etchLines=smoothstep(.2,.8,wave)*fineFade(coord/3.14);
    Nt.xy+=normalize(ep+1e-4)*cos(coord)*.22*etchAmt*fineFade(coord/3.14);
  }
  Nt=normalize(Nt);

  float ndl=max(dot(Nt,Lt),0.);
  vec3 col=alb*(.74+.4*ndl);
  float l=clamp(luma(alb)*1.6,0.,1.);
  float specTight=pow(max(dot(Nt,Ht),0.),420.);

  // ---- gild: art rendered as a gold duotone ----
  float gild=uGild*rArt*F;
  if(gild>.001){
    float g=pow(luma(alb)*1.25,.8);
    vec3 duo=mix(vec3(.10,.05,.018),vec3(.95,.66,.24),smoothstep(0.,.75,g));
    duo=mix(duo,vec3(1.55,1.3,.82),smoothstep(.72,1.1,g));
    col=mix(col,duo,gild);
  }

  // ---- metal: reflect the studio, tinted by ink and metal colour ----
  vec3 mWeights=isFront?uMetal:vec3(0.,1.,0.);
  float mAmt=dot(mWeights,reg);
  if(mAmt>.001){
    vec3 tint=isFront?uMetalTint:vec3(1.,.74,.36);
    float bru=isFront?uBrush:.1;
    vec3 Nm=Nt;
    float grain=fineFade(uv.y*260.);
    Nm.y+=(vnoise(uv*vec2(6.,520.))-.5)*bru*grain;
    Nm.x+=(vnoise(uv*vec2(520.,6.))-.5)*bru*.18*grain;
    Nm=normalize(Nm);
    vec3 Rt=reflect(-Vt,Nm);
    vec3 Rw=T*Rt.x+B*Rt.y+N*Rt.z;
    vec3 e=studioEnv(Rw);
    // Brushed metal smears highlights across the grain.
    if(bru>.3) e=mix(e,studioEnv(Rw+vec3(0.,.14,0.))*.5+studioEnv(Rw-vec3(0.,.14,0.))*.5,.7);
    vec3 F0=mix(tint,alb*1.7,.18)*(.45+.95*sqrt(clamp(luma(alb)*1.4,0.,1.)));
    if(rArt>.5&&gild>.001) F0=col*1.15;
    vec3 m=F0*e*.82+tint*pow(max(dot(Nm,Ht),0.),190.)*.55;
    col=mix(col,m,mAmt);
  }

  // ---- thin-film prism ----
  float a=dot(uPrism,reg)*F;
  if(a>.001){
    float ph=dot(Vt.xy,vec2(1.8,1.2))*1.55+dot(uv,vec2(.55,.85))+(fbm(uv*3.+uSeed)-.5)*.38+uHue;
    float band=.32+.68*pow(.5+.5*cos((dot(Vt.xy,vec2(1.,.65))*3.2+dot(uv,vec2(1.2,1.7))*2.1)*3.14159),2.);
    foil(col,l,spectral(ph),.8*band,a);
  }

  // ---- sun pillars: bright vertical bars, rainbow up the bar, fine diagonal foil lines ----
  a=dot(uPillars,reg)*F;
  if(a>.001){
    float bars=pow(.5+.5*sin((uv.x*5.+Vt.x*11.+Vt.y*3.)*3.14159),1.3);
    float ph=uv.y*1.5+Vt.y*2.4+Vt.x*.8+uHue;
    float coord=(uv.x+uv.y*1.4)*210.;
    float lines=mix(.55,.45+.55*(.5+.5*sin(coord*3.14159)),fineFade(coord));
    foil(col,l,spectral(ph),1.*(.08+.92*bars)*lines,a);
  }

  // ---- cosmos: a nebula wash, then stars that each act as a tiny tilted mirror ----
  a=dot(uCosmos,reg)*F;
  if(a>.001){
    float neb=fbm(uv*vec2(3.2,4.4)+uSeed*2.+Vt.xy*.6);
    foil(col,l,spectral(neb*1.6+Vt.x*1.2+Vt.y*.9+uHue),.38*smoothstep(.3,.72,neb),a);
    float stars=0.;
    vec3 starCol=vec3(0.);
    for(int i=0;i<3;i++){
      float sc=16.+float(i)*19.;
      vec2 g=uv*vec2(sc,sc*1.4)+float(i)*7.3;
      vec2 id=floor(g),fr=fract(g);
      vec2 rnd=hash22(id+float(i));
      float d=length(fr-.2-.6*rnd);
      vec3 sn=normalize(vec3((hash22(id+9.)-.5)*.8,1.));
      float tw=pow(max(dot(sn,Ht),0.),140.);
      float s=smoothstep(.15,.0,d)*(.05+tw*6.);
      stars+=s;
      starCol+=s*mix(vec3(1.),spectral(rnd.x+Vt.x*2.),.55);
    }
    col+=starCol*a;
  }

  // ---- glitter: thousands of micro-flakes, most dark, a few catching the light ----
  a=dot(uGlitter,reg)*F;
  if(a>.001){
    vec2 g=uv*vec2(170.,238.);
    vec2 id=floor(g);
    vec3 fn=normalize(vec3((hash22(id)-.5)*1.1,1.));
    float s=pow(max(dot(fn,Ht),0.),260.);
    vec3 c=mix(vec3(1.,.95,.85),spectral(hash21(id+3.)+Vt.x),.4);
    float flake=smoothstep(.55,.15,length(fract(g)-.5));
    col+=c*s*flake*5.5*a;
    col=mix(col,col*(.9+.2*hash21(id+7.)),a);
  }

  // ---- cracked ice: Voronoi facets with their own normals ----
  a=dot(uShards,reg)*F;
  if(a>.001){
    vec3 v=voronoi(uv*vec2(6.2,8.7)+uSeed);
    vec2 id=v.yz;
    vec3 sn=normalize(vec3((hash22(id)-.5)*.9,1.));
    float s=pow(max(dot(sn,Ht),0.),26.);
    float ph=hash21(id)*.9+dot(Vt.xy,vec2(1.6,1.1))+uHue;
    float edge=smoothstep(.045,.0,v.x);
    foil(col,l,spectral(ph),.05+1.05*s,a);
    col+=vec3(1.)*edge*(.05+s*.8)*a*.6;
    col=mix(col,col*.72,edge*a*.4);
  }

  // ---- etch: foil lives only in the engraved lines ----
  if(etchAmt>.001){
    vec3 rb=spectral(er*2.6+dot(Vt.xy,vec2(2.,1.3))+uHue);
    float glint=.45+1.1*pow(max(dot(Nt,Ht),0.),12.);
    foil(col,l,rb,.85*glint*etchLines,etchAmt);
  }

  // ---- polychrome: rotate the print's hue through a slow warp ----
  a=dot(uPoly,reg)*F;
  if(a>.001){
    vec2 wuv=uv*2.4+vec2(uTime*.03,-uTime*.02);
    float warp=fbm(wuv+fbm(wuv*1.4+uSeed)*1.3);
    float ang=(warp*1.9+Vt.x*1.3+Vt.y*.8+uHue)*6.28318;
    vec3 shifted=hueShift(col,ang);
    float g=luma(shifted);
    shifted=mix(vec3(g),shifted,1.25);
    col=mix(col,max(shifted,vec3(0.)),a*.78);
  }

  // ---- laminate gloss ----
  float gl=isFront?uGloss:.5;
  col+=vec3(1.,.98,.94)*specTight*.3*gl*(1.-mAmt*.7);
  col+=vec3(.9,.95,1.)*pow(1.-Vt.z,4.)*.28*gl;

  // ---- fire through the frame ----
  if(isFront&&uFire>.001){
    float rise=fbm(vec2(uv.x*7.+uSeed,uv.y*4.8-uTime*.55)+fbm(uv*5.-uTime*.2)*.9);
    float f=smoothstep(.42,.82,rise);
    vec3 fc=mix(vec3(1.,.18,.02),vec3(1.6,.95,.28),f)*f*2.6;
    col+=fc*rFrame*uFire;
    // Heat bleeding in from the frame over the art's outer rim.
    float inner=rArt*(1.-smoothstep(.0,.16,1.-max(abs(uv.x-.5)*2.,abs((uv.y-.63)*4.6))));
    col+=vec3(1.,.32,.08)*inner*f*.7*uFire;
  }

  // ---- motes drifting inside a void window ----
  if(isFront&&uDepth>.0001&&rWindow>.01){
    vec3 m=vec3(0.);
    for(int i=0;i<3;i++){
      float dp=uDepth*(.25+float(i)*.55);
      vec2 muv=uv-Vt.xy/max(Vt.z,.4)*dp*vec2(1.,.714);
      vec2 g=muv*vec2(13.,18.)*(1.+float(i)*.3)+vec2(sin(uTime*.2+float(i))*.4,-uTime*(.09+float(i)*.04));
      vec2 id=floor(g);
      vec2 rnd=hash22(id+float(i)*13.);
      float d=length(fract(g)-.2-.6*rnd);
      float pulse=.5+.5*sin(uTime*(1.+rnd.x*2.)+rnd.y*6.28);
      m+=smoothstep(.09,.0,d)*pulse*mix(vec3(.65,.55,1.),vec3(1.,.85,.6),rnd.x);
    }
    col+=m*1.4*rWindow*windowShade;
  }

  // ---- light sweep: a slow band crossing the card every few seconds ----
  if(isFront&&uSweep>.001){
    float s=fract(uTime*.14+uSeed);
    float d=dot(uv,vec2(.62,.38))-s*2.6+.5;
    float band=exp(-pow(d/.055,2.));
    col+=vec3(1.5,1.3,.9)*band*uSweep*(.16+l*.5);
  }

  col+=uBurnColor*burnEdge*5.;
  col=mix(col,vec3(2.2,2.1,1.9),uFlash);
  gl_FragColor=vec4(col*uDim,1.);
}
`;
