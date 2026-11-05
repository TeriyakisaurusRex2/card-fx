// Small DOM helpers for the showcase chrome. Plain elements only: the card code never
// touches these, so a game's own UI framework can replace them outright.

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string)[]) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') n.className = String(v);
    else if (k === 'text') n.textContent = String(v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  n.append(...kids);
  return n;
}

export function panel(title: string, side: 'left' | 'right' = 'right') {
  const body = el('div', { class: 'panel-body' });
  const toggle = el('button', { class: 'panel-toggle', text: title });
  const root = el('section', { class: `panel panel-${side}` }, el('h2', {}, toggle), body);
  const setFolded = (folded: boolean) => {
    root.classList.toggle('folded', folded);
    toggle.setAttribute('aria-expanded', String(!folded));
  };
  toggle.addEventListener('click', () => setFolded(!root.classList.contains('folded')));
  // Without room beside it the panel sits over the scene, so it starts out of the way.
  setFolded(window.matchMedia('(max-width: 900px)').matches);
  return { root, body };
}

export function section(label: string, ...kids: Node[]) {
  return el('div', { class: 'group' }, el('h3', { text: label }), ...kids);
}

export function button(label: string, onClick: () => void, cls = '') {
  return el('button', { class: `btn ${cls}`, type: 'button', onClick }, label);
}

export function slider(
  label: string,
  o: { min: number; max: number; step?: number; value: number; format?: (v: number) => string },
  onInput: (v: number) => void,
) {
  const fmt = o.format ?? ((v: number) => String(+v.toFixed(2)));
  const out = el('output', { text: fmt(o.value) });
  const input = el('input', { type: 'range', min: o.min, max: o.max, step: o.step ?? 0.01, value: o.value, 'aria-label': label });
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    out.textContent = fmt(v);
    onInput(v);
  });
  const root = el('label', { class: 'slider' }, el('span', { class: 'slider-head' }, el('span', { text: label }), out), input);
  return {
    root,
    set(v: number) {
      input.value = String(v);
      out.textContent = fmt(v);
    },
  };
}

export function toggle(label: string, value: boolean, onChange: (v: boolean) => void) {
  const input = el('input', { type: 'checkbox' });
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'toggle' }, input, el('span', { text: label }));
}

/** A row of mutually exclusive choices. */
export function chips<T extends string>(options: { id: T; label: string; title?: string }[], value: T, onPick: (id: T) => void) {
  const root = el('div', { class: 'chips', role: 'group' });
  const buttons = new Map<T, HTMLButtonElement>();
  const select = (id: T) => {
    for (const [k, b] of buttons) {
      b.classList.toggle('on', k === id);
      b.setAttribute('aria-pressed', String(k === id));
    }
  };
  for (const o of options) {
    const b = el('button', { class: 'chip', type: 'button', title: o.title, onClick: () => { select(o.id); onPick(o.id); } }, o.label);
    buttons.set(o.id, b);
    root.append(b);
  }
  select(value);
  return { root, select };
}

export function hint(text: string) {
  return el('div', { class: 'hint', text });
}
