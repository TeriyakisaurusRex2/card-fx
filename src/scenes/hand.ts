import * as THREE from 'three';
import { CardView, sharedCardUniforms } from '../cards/CardView';
import { HandController, type HandParams } from '../cards/HandController';
import { CARDS } from '../cards/data';
import { rollFinish } from '../cards/finishes';
import { dissolveOut, flyTo } from '../cards/moves';
import { Timeline, ease } from '../core/anim';
import { sfx } from '../core/audio';
import { button, el, panel, section, slider, toggle } from '../core/ui';
import { Fx, makeBackdrop } from '../fx/fx';
import { Listeners, onCanvas, type SceneFactory } from './scene';

const VIEW_H = 11;
const PLAY_LINE = -0.4;

/** The fan by itself, with every layout value on a slider. */
export const handScene: SceneFactory = ({ stage, ui }) => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const backdrop = makeBackdrop({ inner: 0x1d1813, outer: 0x060505, glow: 0x705020 });
  (backdrop.material as THREE.ShaderMaterial).uniforms.uCenter.value.set(0.5, 0.2);
  (backdrop.material as THREE.ShaderMaterial).uniforms.uGlowAmt.value = 0.12;
  scene.add(backdrop);

  const tl = new Timeline();
  const fx = new Fx(scene, tl, camera);
  const listeners = new Listeners();

  const hand = new HandController(stage);
  scene.add(hand.root);

  // Cards deal in from a point below the screen.
  const DEAL_FROM = new THREE.Vector3(9, -9, 1);
  const pool = [...CARDS].sort(() => Math.random() - 0.5);
  let poolIndex = 0;

  const dealOne = () => {
    const def = pool[poolIndex++ % pool.length];
    const card = new CardView(def, rollFinish(def.rarity));
    card.position.copy(DEAL_FROM);
    card.rotation.set(0, Math.PI, 0.6);
    card.scale.setScalar(hand.params.cardScale);
    scene.add(card);
    hand.add(card);
    sfx.draw();
    return card;
  };

  const dealTo = async (count: number) => {
    for (let i = hand.slots.length; i < count; i++) {
      dealOne();
      await tl.wait(0.09);
    }
    while (hand.slots.length > count) {
      const c = hand.cards[hand.slots.length - 1];
      hand.remove(c, scene);
      void flyTo(tl, c, { pos: DEAL_FROM }, { dur: 0.3, ease: ease.inCubic }).then(() => c.dispose());
    }
  };

  const reshuffle = async () => {
    const cards = hand.cards;
    cards.forEach((c) => {
      hand.remove(c, scene);
      void flyTo(tl, c, { pos: DEAL_FROM }, { dur: 0.3, ease: ease.inCubic }).then(() => c.dispose());
    });
    sfx.whoosh(0.15);
    await tl.wait(0.32);
    await dealTo(count);
  };

  let count = 7;
  void tl.wait(0.15).then(() => dealTo(count));

  hand.events.onRelease = (card) => {
    if (hand.pointer.y < PLAY_LINE) return false;
    // Above the line counts as played: consume it and top the hand back up.
    hand.remove(card, scene);
    void dissolveOut(tl, fx, card, 'burn').then(() => {
      card.dispose();
      void dealTo(count);
    });
    return true;
  };

  // ---- panel ----
  const { root, body } = panel('Hand Fan');
  ui.append(root);
  const p: HandParams = hand.params;
  const cardsSlider = slider('Cards', { min: 1, max: 12, step: 1, value: count }, (v) => {
    count = v;
    void dealTo(v);
  });
  body.append(
    section('Hand', cardsSlider.root, el('div', { class: 'btn-grid' }, button('Add card', () => { if (count < 12) { count++; cardsSlider.set(count); void dealTo(count); } }), button('Re-deal', () => void reshuffle()))),
    section(
      'Fan',
      slider('Arc radius', { min: 6, max: 40, step: 0.5, value: p.radius }, (v) => (p.radius = v)).root,
      slider('Card spacing', { min: 2, max: 14, step: 0.1, value: p.stepDeg, format: (v) => `${v.toFixed(1)}°` }, (v) => (p.stepDeg = v)).root,
      slider('Max width', { min: 10, max: 90, step: 1, value: p.maxSpreadDeg, format: (v) => `${v}°` }, (v) => (p.maxSpreadDeg = v)).root,
      slider('Card curl', { min: 0, max: 0.05, step: 0.001, value: p.curl }, (v) => (p.curl = v)).root,
    ),
    section(
      'Hover',
      slider('Zoom', { min: 1, max: 2, value: p.hoverScale }, (v) => (p.hoverScale = v)).root,
      slider('Neighbour push', { min: 0, max: 10, step: 0.1, value: p.pushDeg, format: (v) => `${v.toFixed(1)}°` }, (v) => (p.pushDeg = v)).root,
      toggle('Tuck hand while idle', true, (v) => (p.tuck = v ? 1.2 : 0)),
    ),
  );
  ui.append(el('div', { class: 'prompt prompt-top', text: 'Sweep across the fan · drag a card up past the middle to play it' }));

  listeners.on('pointerdown', (e) => {
    if (onCanvas(e)) hand.pointerDown();
  });
  listeners.on('pointerup', () => hand.pointerUp());

  const layout = () => {
    stage.centerBesidePanel(camera);
    const dist = VIEW_H / 2 / Math.tan((camera.fov * Math.PI) / 360);
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    // Half of what's beside the panel, so a hovered edge card can't end up underneath it.
    p.halfWidth = (VIEW_H / 2) * camera.aspect - (stage.panelShift * VIEW_H) / stage.height;
    p.baseY = -VIEW_H / 2 + 1.75;
    p.hoverY = -VIEW_H / 2 + (3.5 * p.hoverScale) / 2 + 0.25;
    (backdrop.material as THREE.ShaderMaterial).uniforms.uAspect.value = camera.aspect;
  };

  return {
    scene,
    camera,
    resize: layout,
    update(dt, t) {
      tl.update(dt);
      fx.update(t);
      hand.update(dt, t);
      for (const c of hand.cards) c.update(dt);
      // Scene-owned cards in flight also need their flex update.
      for (const o of scene.children) if (o instanceof CardView) o.update(dt);
      sharedCardUniforms.uLightPos.value.set(stage.pointer.x * 8, stage.pointer.y * 5 - 1, 12);
    },
    dispose() {
      tl.clear();
      listeners.clear();
      fx.dispose();
      for (const c of [...hand.cards]) c.dispose();
      for (const o of [...scene.children]) if (o instanceof CardView) o.dispose();
    },
  };
};

