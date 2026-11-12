import * as THREE from 'three';
import { CardView, sharedCardUniforms } from '../cards/CardView';
import { CARDS, type CardDef } from '../cards/data';
import { TITLE_FONTS, getTitleFont, modernIsCut, setTitleFont } from '../cards/face';
import { finishById } from '../cards/finishes';
import { CARD_H, CARD_W } from '../cards/geometry';
import { KEYWORDS, splitRules } from '../cards/keywords';
import { Spring, clamp } from '../core/anim';
import { sfx } from '../core/audio';
import { button, chips, el, hint, panel, section } from '../core/ui';
import { makeBackdrop } from '../fx/fx';
import { Listeners, onCanvas, type SceneFactory } from './scene';

const FINISH_IDS = ['matte', 'artfoil', 'prismatic', 'shattered', 'void'] as const;
const START = ['ember_ash_wraith', 'cairn_deeproot_warden', 'veil_sov_hollow_queen', 'ember_battle_fury'];

/**
 * The same card in the old layout (left) and the modern one every tab now uses (right), with a picker for
 * the display font. Clicking the modern card expands it: the card steps forward and a panel
 * beside it spells out each keyword and the full rules text.
 */
export const layoutScene: SceneFactory = ({ stage, ui, params }) => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const backdrop = makeBackdrop({ inner: 0x221b15, outer: 0x060505 });
  scene.add(backdrop);
  const backU = (backdrop.material as THREE.ShaderMaterial).uniforms;
  const listeners = new Listeners();

  let index = Math.max(0, CARDS.findIndex((c) => c.id === (params.get('card') ?? START[0])));
  let finishId: string = 'matte';
  let expanded = false;
  const modernOf = (d: CardDef): CardDef => ({ ...d, layout: 'modern' });
  // The layouts every card used before the modern one became the default.
  const oldOf = (d: CardDef): CardDef => ({ ...d, layout: d.type === 'Sovereign' ? 'fullart' : 'classic' });

  const oldCard = new CardView(oldOf(CARDS[index]), finishById(finishId).finish, { res: 2 });
  const newCard = new CardView(modernOf(CARDS[index]), finishById(finishId).finish, { res: 2 });
  for (const c of [oldCard, newCard]) {
    c.flex = 0;
    scene.add(c);
  }

  // Where each card rests, and how it moves when the modern one is expanded.
  const SIDE = CARD_W / 2 + 0.3;
  const oldX = new Spring(-SIDE, 120, 18);
  const newX = new Spring(SIDE, 120, 18);
  const newS = new Spring(1, 140, 18);
  const oldDim = new Spring(1, 120, 20);
  const tilt = [oldCard, newCard].map(() => ({ x: new Spring(0, 90, 13), y: new Spring(0, 90, 13) }));

  // ---- labels and the expand panel ----
  const oldLabel = el('div', { class: 'label3d' }, el('b', { text: 'Old' }), el('span', { text: 'framed · text box' }));
  const newLabel = el('div', { class: 'label3d' }, el('b', { text: 'New · in use' }), el('span', { text: 'click the card to expand' }));
  const detail = el('div', { class: 'card-detail off' });
  ui.append(oldLabel, newLabel, detail);

  const fillDetail = () => {
    const def = CARDS[index];
    const { keywords, body } = splitRules(def);
    const title = el('h4', { text: def.name });
    title.style.fontFamily = `"${getTitleFont().family}", serif`;
    title.style.fontWeight = String(getTitleFont().weight);
    const sub = def.subtype ? `${def.type} · ${def.subtype}` : def.type;
    detail.replaceChildren(
      title,
      el('div', { class: 'card-detail-sub', text: sub }),
      ...keywords.map((k) =>
        el('div', { class: 'card-detail-kw' }, el('b', { text: k.note ? `${k.name} · ${k.note}` : k.name }), el('span', { text: KEYWORDS[k.name] })),
      ),
      ...(body ? [el('p', { text: body })] : []),
    );
  };

  const setExpanded = (v: boolean) => {
    if (v === expanded) return;
    expanded = v;
    sfx.whoosh(0.12);
    oldX.target = v ? -SIDE - 3.6 : -SIDE;
    oldDim.target = v ? 0.25 : 1;
    newX.target = v ? -SIDE * 0.55 : SIDE;
    newS.target = v ? 1.1 : 1;
    if (v) fillDetail();
    detail.classList.toggle('off', !v);
    newLabel.classList.toggle('off', v);
    oldLabel.classList.toggle('off', v);
  };

  // ---- panel ----
  const { root, body } = panel('Layout');
  ui.append(root);
  const nameEl = el('div', { class: 'hint' });
  const cutEl = el('div', { class: 'hint' });

  const refresh = () => {
    const def = CARDS[index];
    oldCard.setDef(oldOf(def), 2);
    newCard.setDef(modernOf(def), 2);
    nameEl.textContent = def.name;
    cutEl.textContent = modernIsCut(def) ? 'Text is cut on the new layout: expand to read it all.' : 'All of the text fits on the new layout.';
    for (const b of fontList.children) b.classList.toggle('on', (b as HTMLElement).dataset.id === getTitleFont().id);
    if (expanded) fillDetail();
  };
  const step = (d: number) => {
    index = (index + d + CARDS.length) % CARDS.length;
    sfx.flip();
    refresh();
  };

  // Each font button is set in its own face, so the list doubles as a specimen sheet.
  const fontList = el('div', { class: 'finish-list' });
  for (const f of TITLE_FONTS) {
    const sample = el('span', { text: f.family });
    sample.style.font = `${f.weight} 15px "${f.family}", serif`;
    const b = el('button', { class: 'finish-item font-item', type: 'button', title: f.note, onClick: () => { setTitleFont(f.id); sfx.hover(); refresh(); } }, sample, el('small', { text: f.note }));
    b.dataset.id = f.id;
    fontList.append(b);
  }

  body.append(
    section('Card', nameEl, cutEl, el('div', { class: 'btn-grid' }, button('← Previous', () => step(-1)), button('Next →', () => step(1)))),
    section(
      'Examples',
      chips(
        [
          { id: START[0], label: 'Keyword unit' },
          { id: START[1], label: 'Ward' },
          { id: START[2], label: 'Sovereign' },
          { id: START[3], label: 'Spell' },
        ],
        START[0],
        (id) => {
          index = CARDS.findIndex((c) => c.id === id);
          refresh();
        },
      ).root,
    ),
    section('Title font', fontList, hint('Applies to names and numbers on both layouts. Other tabs pick it up too.')),
    section(
      'Finish',
      chips(FINISH_IDS.map((id) => ({ id, label: finishById(id).name })), 'matte', (id) => {
        finishId = id;
        oldCard.setFinish(finishById(id).finish);
        newCard.setFinish(finishById(id).finish);
      }).root,
    ),
  );
  refresh();

  // ---- input ----
  listeners.on('pointerup', (e) => {
    if (!onCanvas(e)) return;
    if (newCard.hitTest(stage.ray()) !== null) setExpanded(!expanded);
    else if (expanded) setExpanded(false);
  });
  listeners.on('keydown', (e) => {
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'Escape') setExpanded(false);
  });

  const layout = () => {
    stage.centerBesidePanel(camera);
    backU.uAspect.value = camera.aspect;
  };

  const tmp = new THREE.Vector3();
  const place = (label: HTMLElement, card: CardView) => {
    const s = stage.toScreen(tmp.set(card.position.x, card.position.y - (CARD_H / 2) * card.scale.x - 0.12, 0));
    label.style.left = `${s.x}px`;
    label.style.top = `${s.y}px`;
  };

  return {
    scene,
    camera,
    resize: layout,
    update(dt, t) {
      const dist = stage.fitDistance(camera, CARD_W * 2 + 1.5, CARD_H + 1.5, true);
      camera.position.set(0, 0, dist);
      camera.lookAt(0, 0, 0);

      const p = stage.pointerInside ? stage.pointer : ZERO;
      sharedCardUniforms.uLightPos.value.set(p.x * 8, p.y * 6 + 2, 10);

      oldCard.position.x = oldX.update(dt);
      newCard.position.x = newX.update(dt);
      newCard.scale.setScalar(newS.update(dt));
      newCard.position.z = (newCard.scale.x - 1) * 4;
      oldCard.u.uDim.value = oldDim.update(dt);

      [oldCard, newCard].forEach((c, i) => {
        // Both lean gently toward the pointer and breathe a little, so foil stays alive.
        tilt[i].y.target = clamp(p.x * 0.3, -0.3, 0.3) + Math.sin(t * 0.6 + i) * 0.03;
        tilt[i].x.target = clamp(-p.y * 0.24, -0.24, 0.24) + Math.cos(t * 0.5 + i) * 0.025;
        c.rotation.set(tilt[i].x.update(dt), tilt[i].y.update(dt), 0);
        c.setShimmer(p.x * 0.08, p.y * 0.08);
        c.setShadow(0.5);
        c.update(dt);
      });

      place(oldLabel, oldCard);
      place(newLabel, newCard);
      // The expand panel sits just to the right of the modern card.
      const edge = stage.toScreen(tmp.set(newCard.position.x + (CARD_W / 2) * newCard.scale.x + 0.25, 0, newCard.position.z));
      detail.style.left = `${edge.x}px`;
      detail.style.top = `${edge.y}px`;

      stage.canvas.style.cursor = stage.pointerInside && newCard.hitTest(stage.ray()) !== null ? 'pointer' : '';
    },
    dispose() {
      listeners.clear();
      oldCard.dispose();
      newCard.dispose();
      stage.canvas.style.cursor = '';
    },
  };
};

const ZERO = new THREE.Vector2();
