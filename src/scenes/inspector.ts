import * as THREE from 'three';
import { CardView, sharedCardUniforms } from '../cards/CardView';
import { CARDS, RARITY_COLOR } from '../cards/data';
import { FINISHES, type Finish, type Regions, finishById } from '../cards/finishes';
import { Spring, Timeline, clamp, damp, ease } from '../core/anim';
import { sfx } from '../core/audio';
import { button, el, panel, section, slider, toggle } from '../core/ui';
import { Fx, makeBackdrop } from '../fx/fx';
import { Listeners, onCanvas, type SceneFactory } from './scene';

const REGION_LAYERS: { key: keyof Finish; label: string }[] = [
  { key: 'metal', label: 'Metal' },
  { key: 'prism', label: 'Prism' },
  { key: 'pillars', label: 'Pillars' },
  { key: 'cosmos', label: 'Cosmos' },
  { key: 'glitter', label: 'Glitter' },
  { key: 'shards', label: 'Shards' },
  { key: 'etch', label: 'Etch' },
  { key: 'poly', label: 'Polychrome' },
];
const SCALARS: { key: keyof Finish; label: string; max: number }[] = [
  { key: 'gild', label: 'Gild art', max: 1 },
  { key: 'relief', label: 'Art relief', max: 3 },
  { key: 'depth', label: 'Window depth', max: 0.15 },
  { key: 'sweep', label: 'Light sweep', max: 1 },
  { key: 'fire', label: 'Frame fire', max: 1 },
  { key: 'brush', label: 'Brushing', max: 1 },
  { key: 'gloss', label: 'Gloss', max: 1.5 },
  { key: 'hue', label: 'Hue offset', max: 1 },
];

/**
 * One card up close. Hover leans it; dragging turns it freely with momentum, and on
 * release it settles on whichever face is nearer, so a hard flick flips it over.
 */
export const inspectorScene: SceneFactory = ({ stage, ui, params }) => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const backdrop = makeBackdrop({ inner: 0x241c15, outer: 0x060505, glow: 0xffc65a });
  scene.add(backdrop);
  const tl = new Timeline();
  const fx = new Fx(scene, tl, camera);
  const listeners = new Listeners();
  const backU = (backdrop.material as THREE.ShaderMaterial).uniforms;

  let cardIndex = Math.max(0, CARDS.findIndex((c) => c.id === (params.get('card') ?? 'ember_sov_pyrarch')));
  let entry = finishById(params.get('finish') ?? 'prismatic');
  let finish: Finish = structuredClone(entry.finish);

  const card = new CardView(CARDS[cardIndex], finish, { res: 2 });
  card.flex = 0.5;
  scene.add(card);

  // Rotation is a spring on each axis: the pointer moves the target, the spring moves the card.
  const yaw = new Spring(0, 60, 9);
  const pitch = new Spring(0, 70, 11);
  const zoom = new Spring(0, 90, 15);
  const pan = new THREE.Vector2();

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let spin = 0; // flick speed carried past release
  let lightFollows = true;
  let autoTurn = false;

  // ---- panel ----
  const { root, body } = panel('Inspector');
  ui.append(root);
  const list = el('div', { class: 'finish-list' });
  const blurb = el('p', { class: 'blurb' });
  const labSliders: { refresh: () => void }[] = [];

  const refreshAll = () => {
    for (const b of list.children) b.classList.toggle('on', (b as HTMLElement).dataset.id === entry.id);
    blurb.textContent = entry.blurb;
    labSliders.forEach((s) => s.refresh());
    nameEl.textContent = card.def.name;
  };

  for (const f of FINISHES) {
    const b = el('button', { class: 'finish-item', type: 'button', onClick: () => setFinish(f.id) }, f.name, el('small', { text: f.group }));
    b.dataset.id = f.id;
    list.append(b);
  }
  const setFinish = (id: string) => {
    entry = finishById(id);
    finish = structuredClone(entry.finish);
    card.setFinish(finish);
    refreshAll();
    sfx.shimmer(-0.4);
    void kick();
  };

  const nameEl = el('div', { class: 'hint' });
  const stepCard = (d: number) => {
    cardIndex = (cardIndex + d + CARDS.length) % CARDS.length;
    card.setDef(CARDS[cardIndex], 2);
    refreshAll();
    void kick();
  };

  // Layer lab: every value in the finish, live. "Copy JSON" hands the result to a game.
  const lab = el('details', { class: 'group' }, el('summary', { text: 'Finish lab' }));
  const mkRegion = (key: keyof Finish, label: string) => {
    const wrap = el('div', {});
    wrap.append(el('div', { class: 'hint', text: label }));
    const names = ['Art', 'Frame', 'Paper'];
    const sliders = names.map((n, i) =>
      slider(n, { min: 0, max: 1, value: (finish[key] as Regions)[i] }, (v) => {
        (finish[key] as Regions)[i] = v;
        card.setFinish(finish);
      }),
    );
    sliders.forEach((s) => wrap.append(s.root));
    labSliders.push({ refresh: () => sliders.forEach((s, i) => s.set((finish[key] as Regions)[i])) });
    return wrap;
  };
  for (const r of REGION_LAYERS) lab.append(mkRegion(r.key, r.label));
  for (const s of SCALARS) {
    const sl = slider(s.label, { min: 0, max: s.max, step: s.max / 100, value: finish[s.key] as number }, (v) => {
      (finish[s.key] as number) = v;
      card.setFinish(finish);
    });
    lab.append(sl.root);
    labSliders.push({ refresh: () => sl.set(finish[s.key] as number) });
  }
  lab.append(
    button('Copy finish as JSON', () => {
      void navigator.clipboard?.writeText(JSON.stringify(finish, null, 2));
    }),
  );

  body.append(
    section('Finish', list, blurb),
    section('Card', nameEl, el('div', { class: 'btn-grid' }, button('← Previous', () => stepCard(-1)), button('Next →', () => stepCard(1)))),
    section(
      'View',
      toggle('Light follows pointer', true, (v) => (lightFollows = v)),
      toggle('Auto turntable', false, (v) => (autoTurn = v)),
      el('div', { class: 'btn-grid' }, button('Flip card', () => flip())),
    ),
    lab,
  );
  ui.append(el('div', { class: 'prompt', text: 'Drag to turn · flick to flip · scroll to zoom' }));
  refreshAll();

  // A small reaction when something changes, so a swap reads as an event and not a cut.
  async function kick() {
    tl.kill(card);
    const color = RARITY_COLOR[card.def.rarity];
    fx.light.emit(46, {
      kind: 'star', at: card.position, jitter: [1.4, 1.9, 0.1], speed: [0.2, 0.9], life: [0.5, 1.2],
      size: [0.08, 0.22], color: [color, 0xffffff], bright: [1.5, 3], flatten: 0.3,
    });
    await tl.to(0.1, (k) => (card.u.uFlash.value = 0.3 * k), { owner: card });
    await tl.to(0.3, (k) => (card.u.uFlash.value = 0.3 * (1 - k)), { owner: card });
  }

  function flip() {
    yaw.target = (Math.round(yaw.value / Math.PI) + 1) * Math.PI;
    sfx.flip();
  }

  listeners.on('pointerdown', (e) => {
    if (!onCanvas(e)) return;
    if (card.hitTest(stage.ray()) === null) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    spin = 0;
    stage.canvas.style.cursor = 'grabbing';
  });
  listeners.on('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    yaw.target += dx * 0.012;
    yaw.value += dx * 0.012;
    pitch.target = clamp(pitch.target + dy * 0.008, -1.1, 1.1);
    spin = dx * 0.012;
  });
  listeners.on('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    stage.canvas.style.cursor = '';
    // Project the flick forward, then snap to whichever face that lands nearest.
    const landing = yaw.value + spin * 18;
    const face = Math.round(landing / Math.PI);
    yaw.target = face * Math.PI;
    if (Math.abs(spin) > 0.03) sfx.flip();
    pitch.target = 0;
  });
  listeners.on('wheel', (e) => {
    if (!onCanvas(e)) return;
    zoom.target = clamp(zoom.target - e.deltaY * 0.0016, -0.5, 1);
  });
  listeners.on('keydown', (e) => {
    if (e.key === 'f') flip();
    if (e.key === 'ArrowLeft') stepCard(-1);
    if (e.key === 'ArrowRight') stepCard(1);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const i = FINISHES.findIndex((f) => f.id === entry.id);
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setFinish(FINISHES[(i + d + FINISHES.length) % FINISHES.length].id);
      e.preventDefault();
    }
  });

  // Intro: the card drops in with a little spin rather than just appearing.
  void tl.to(0.7, (k) => {
    card.scale.setScalar(0.8 + 0.2 * k);
    card.position.y = (1 - k) * -1.2;
  }, { ease: ease.outBack });

  const layout = () => {
    stage.centerBesidePanel(camera);
    backU.uAspect.value = camera.aspect;
  };

  return {
    scene,
    camera,
    resize: layout,
    update(dt, t) {
      tl.update(dt);
      fx.update(t);

      const dist = stage.fitDistance(camera, 4.4, 5.3) * (1 - zoom.update(dt) * 0.42);
      camera.position.set(0, 0, dist);
      camera.lookAt(0, 0, 0);

      const p = stage.pointerInside ? stage.pointer : ZERO;
      pan.x = damp(pan.x, p.x, 6, dt);
      pan.y = damp(pan.y, p.y, 6, dt);

      if (!dragging) {
        // Base rest plus pointer lean plus a very slow idle breath.
        const faceAngle = Math.round(yaw.target / Math.PI) * Math.PI;
        if (autoTurn) yaw.target += dt * 0.7;
        else yaw.target = faceAngle + pan.x * 0.42 + Math.sin(t * 0.5) * 0.035;
        pitch.target = -pan.y * 0.36 + Math.cos(t * 0.4) * 0.025;
      }
      card.rotation.y = yaw.update(dt);
      card.rotation.x = pitch.update(dt);
      card.position.y = damp(card.position.y, Math.sin(t * 0.8) * 0.035, 3, dt);
      // Foil gets a bit more view-angle swing than the geometry shows, for extra life.
      card.setShimmer(pan.x * 0.1, pan.y * 0.1);
      card.setShadow(0.55);
      card.update(dt);

      const l = sharedCardUniforms.uLightPos.value;
      if (lightFollows) l.set(p.x * 8, p.y * 7, 9);
      else l.set(3 + Math.sin(t * 0.5) * 3, 4, 9);

      backU.uGlowAmt.value = 0.012;
      if (Math.random() < dt * 5) {
        fx.light.emit(1, {
          kind: 'glow', at: tmp.set((Math.random() - 0.5) * 9, -4, -1.6 + Math.random() * 1.2),
          dir: UP, cone: 0.2, speed: [0.25, 0.6], life: [5, 9], size: [0.015, 0.05],
          color: 0xffd9a0, bright: [0.8, 1.6], drag: 0.02,
        });
      }
    },
    dispose() {
      tl.clear();
      listeners.clear();
      fx.dispose();
      card.dispose();
      stage.canvas.style.cursor = '';
    },
  };
};

const ZERO = new THREE.Vector2();
const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
