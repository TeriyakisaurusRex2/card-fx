import * as THREE from 'three';
import { CardView, sharedCardUniforms } from '../cards/CardView';
import { byId } from '../cards/data';
import { FINISHES } from '../cards/finishes';
import { CARD_H, CARD_W } from '../cards/geometry';
import { Spring, Timeline } from '../core/anim';
import { sfx } from '../core/audio';
import { el } from '../core/ui';
import { makeBackdrop } from '../fx/fx';
import { Listeners, onCanvas, type SceneFactory } from './scene';

// Art chosen per finish so each one shows off on an image that suits it.
const ART_FOR: Record<string, string> = {
  matte: 'cairn_grove_keeper',
  artfoil: 'ember_molten_colossus',
  framefoil: 'veil_nightblade',
  prismatic: 'veil_sov_hollow_queen',
  polychrome: 'cairn_moss_titan',
  gilded: 'ember_forge_captain',
  steel: 'cairn_quarry_golem',
  solidgold: 'cairn_sov_greatwarden',
  sunpillar: 'ember_ash_wraith',
  cosmos: 'veil_umbral_colossus',
  crackedice: 'veil_dread_phantom',
  etched: 'cairn_deeproot_warden',
  stardust: 'veil_hexer',
  void: 'veil_sov_nightwarden',
  emberforged: 'ember_sov_pyrarch',
};

const COLS = 5;
const ROWS = 3;
const GAP_X = 0.5;
const GAP_Y = 0.85;

/** Every finish side by side. Each card leans to the pointer, so they all catch the light together. */
export const galleryScene: SceneFactory = ({ stage, ui }) => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 200);
  const backdrop = makeBackdrop({ inner: 0x1c1712, outer: 0x070605 });
  scene.add(backdrop);
  const tl = new Timeline();
  const listeners = new Listeners();

  const items = FINISHES.map((entry, i) => {
    const card = new CardView(byId(ART_FOR[entry.id]), entry.finish);
    card.flex = 0;
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    card.position.set((col - (COLS - 1) / 2) * (CARD_W + GAP_X), ((ROWS - 1) / 2 - row) * (CARD_H + GAP_Y) + 0.1, 0);
    scene.add(card);
    const label = el('div', { class: 'label3d' }, el('b', { text: entry.name }), el('span', { text: entry.group }));
    ui.append(label);
    return {
      card, entry, label,
      hover: new Spring(0, 200, 22),
      tiltX: new Spring(0, 90, 13),
      tiltY: new Spring(0, 90, 13),
      phase: i * 0.7,
    };
  });

  const layout = () => {
    const w = COLS * CARD_W + (COLS - 1) * GAP_X + 0.5;
    const h = ROWS * CARD_H + (ROWS - 1) * GAP_Y + 0.9;
    // Reserve the top bar's height so the first row clears it.
    const dist = stage.fitDistance(camera, w, h * (stage.height / Math.max(stage.height - 60, 1)));
    camera.position.set(0, 0.28, dist);
    camera.lookAt(0, 0.28, 0);
    camera.aspect = stage.width / stage.height;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    (backdrop.material as THREE.ShaderMaterial).uniforms.uAspect.value = stage.width / stage.height;
    for (const it of items) {
      const at = it.card.position.clone().add(new THREE.Vector3(0, -CARD_H / 2 - 0.1, 0));
      const s = stage.toScreen(at);
      it.label.style.left = `${s.x}px`;
      it.label.style.top = `${s.y}px`;
    }
  };

  let hovered: (typeof items)[number] | null = null;
  const pick = () => {
    const ray = stage.ray();
    let best: (typeof items)[number] | null = null;
    for (const it of items) if (it.card.hitTest(ray) !== null) best = it;
    return best;
  };

  listeners.on('pointerup', (e) => {
    if (!onCanvas(e)) return;
    const it = pick();
    if (it) location.hash = `#/inspect?finish=${it.entry.id}&card=${it.card.def.id}`;
  });

  return {
    scene,
    camera,
    resize: layout,
    update(dt, t) {
      tl.update(dt);
      const over = stage.pointerInside && !(document.elementFromPoint(stage.pointerPx.x, stage.pointerPx.y)?.closest('.panel,.topbar .tabs')) ? pick() : null;
      if (over !== hovered) {
        hovered = over;
        if (over) sfx.hover();
        stage.canvas.style.cursor = over ? 'pointer' : '';
      }
      // A light that drifts with the pointer, so foil keeps moving even at rest.
      sharedCardUniforms.uLightPos.value.set(stage.pointer.x * 9 + Math.sin(t * 0.4) * 1.5, stage.pointer.y * 7 + 3, 13);

      const pointerWorld = stage.pointOnPlane(PLANE, tmp) ?? tmp.set(0, 0, 0);
      for (const it of items) {
        const dx = pointerWorld.x - it.card.position.x;
        const dy = pointerWorld.y - it.card.position.y;
        // Lean toward the pointer, and always sway a little by itself.
        const sway = Math.sin(t * 0.6 + it.phase) * 0.05;
        const swayY = Math.cos(t * 0.47 + it.phase * 1.3) * 0.04;
        const isHover = it === hovered;
        it.tiltY.target = THREE.MathUtils.clamp(dx * 0.07, -0.3, 0.3) * (isHover ? 2 : 1) + sway;
        it.tiltX.target = THREE.MathUtils.clamp(-dy * 0.06, -0.26, 0.26) * (isHover ? 2 : 1) + swayY;
        it.hover.target = isHover ? 1 : 0;
        it.card.rotation.y = it.tiltY.update(dt);
        it.card.rotation.x = it.tiltX.update(dt);
        const h = it.hover.update(dt);
        it.card.scale.setScalar(1 + h * 0.06);
        it.card.position.z = h * 0.5;
        it.card.setShimmer(Math.sin(t * 0.6 + it.phase) * 0.05, Math.cos(t * 0.5 + it.phase) * 0.05);
        it.card.setShadow(0.5);
        it.card.update(dt);
      }
    },
    dispose() {
      tl.clear();
      listeners.clear();
      stage.canvas.style.cursor = '';
      for (const it of items) it.card.dispose();
    },
  };
};

const PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const tmp = new THREE.Vector3();
