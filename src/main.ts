import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/marcellus/400.css';
import '@fontsource/cormorant-sc/700.css';
import '@fontsource/spectral-sc/600.css';
import '@fontsource/spectral-sc/700.css';
import '@fontsource/forum/400.css';
import '@fontsource/im-fell-english-sc/400.css';
import '@fontsource/almendra/700.css';
import '@fontsource/grenze-gotisch/700.css';
import '@fontsource/alegreya-sans-sc/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './style.css';
import { CARDS } from './cards/data';
import { TITLE_FONTS, loadArt } from './cards/face';
import { isMuted, setMuted, unlockAudio } from './core/audio';
import { Stage } from './core/stage';
import { el } from './core/ui';
import { sharedCardUniforms } from './cards/CardView';
import type { SceneFactory, ShowScene } from './scenes/scene';
import { boardScene } from './scenes/board';
import { boosterScene } from './scenes/booster';
import { galleryScene } from './scenes/gallery';
import { handScene } from './scenes/hand';
import { inspectorScene } from './scenes/inspector';
import { layoutScene } from './scenes/layouts';

const ROUTES: { id: string; label: string; make: SceneFactory }[] = [
  { id: 'finishes', label: 'Finishes', make: galleryScene },
  { id: 'inspect', label: 'Inspector', make: inspectorScene },
  { id: 'booster', label: 'Booster', make: boosterScene },
  { id: 'hand', label: 'Hand', make: handScene },
  { id: 'board', label: 'Board', make: boardScene },
  { id: 'layout', label: 'Layout', make: layoutScene },
];

async function boot() {
  const loader = el('div', { id: 'loader', text: 'FORGING' });
  document.body.append(loader);

  // Canvas text bakes whatever font is ready at draw time, so fonts must load first.
  await Promise.all([
    document.fonts.load('700 40px Cinzel'),
    document.fonts.load('600 22px Inter'),
    ...TITLE_FONTS.map((f) => document.fonts.load(`${f.weight} 40px "${f.family}"`)),
    document.fonts.load('600 25px "Spectral SC"'),
    document.fonts.load('500 28px Inter'),
    loadArt(CARDS.map((c) => c.art).concat('_menu_hero')),
  ]);

  const stage = new Stage(document.getElementById('stage') as HTMLCanvasElement);
  const uiRoot = document.getElementById('ui')!;
  const sceneUi = el('div', {});
  sceneUi.style.pointerEvents = 'none';
  sceneUi.style.position = 'absolute';
  sceneUi.style.inset = '0';

  const tabs = ROUTES.map((r, i) =>
    el('button', { class: 'tab', type: 'button', onClick: () => (location.hash = `#/${r.id}`) }, el('kbd', { text: String(i + 1) }), r.label),
  );
  const mute = el('button', { class: 'icon-btn', type: 'button', text: isMuted() ? 'Sound off' : 'Sound on' });
  mute.addEventListener('click', () => {
    setMuted(!isMuted());
    mute.textContent = isMuted() ? 'Sound off' : 'Sound on';
  });
  // Global dials. Each drives one uniform shared by every card, and is remembered.
  const dial = (label: string, key: string, u: { value: number }) => {
    const saved = parseFloat(localStorage.getItem(key) ?? '');
    if (Number.isFinite(saved)) u.value = saved;
    const out = el('output', { text: `${Math.round(u.value * 100)}%` });
    const input = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: u.value, 'aria-label': label });
    input.addEventListener('input', () => {
      u.value = parseFloat(input.value);
      out.textContent = `${Math.round(u.value * 100)}%`;
      localStorage.setItem(key, String(u.value));
    });
    return el('label', { class: 'fx-dial' }, el('span', { text: label }), input, out);
  };
  const fxDial = dial('Effect strength', 'cardfx.fx', sharedCardUniforms.uFxMaster);
  const guardDial = dial('Text protection', 'cardfx.guard', sharedCardUniforms.uTextGuard);
  uiRoot.append(
    sceneUi,
    el('header', { class: 'topbar' }, el('div', { class: 'brand', text: 'CARD FX' }), el('nav', { class: 'tabs' }, ...tabs), el('div', { class: 'spacer' }), fxDial, guardDial, mute),
  );

  let current: ShowScene | null = null;

  const route = () => {
    const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
    const idx = Math.max(0, ROUTES.findIndex((r) => r.id === path));
    tabs.forEach((t, i) => t.classList.toggle('on', i === idx));
    current?.dispose();
    sceneUi.replaceChildren();
    current = ROUTES[idx].make({ stage, ui: sceneUi, params: new URLSearchParams(query ?? '') });
    stage.setScene(current.scene, current.camera);
    current.resize?.();
  };
  window.addEventListener('hashchange', route);
  stage.onResize(() => current?.resize?.());

  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= ROUTES.length) location.hash = `#/${ROUTES[n - 1].id}`;
  });

  route();
  loader.style.opacity = '0';
  setTimeout(() => loader.remove(), 450);

  let last = performance.now();
  let time = 0;
  const frame = (now: number) => {
    // Clamp: returning from a background tab must not look like one enormous frame.
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    time += dt;
    current?.update(dt, time);
    stage.render(dt, time);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Lets automated checks read which scene is live and drive it.
  (window as unknown as { cardfx: unknown }).cardfx = { stage, get scene() { return current; } };
}

void boot();
