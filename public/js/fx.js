// Shared bits for the celebrations (SPEC Flow 11, "Game feel"): the per-device on/off switch,
// reduced motion, a confetti burst, a short buzz and a focus trap for the full-screen cards.
// Silent by design: no sound.

const KEY = 'pp-celebrations';

/** Celebrations show unless this device turned them off (Account › On this device). */
export function celebrationsOn() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setCelebrations(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode: nothing to remember */ }
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A short haptic pattern on phones that support it (ignored elsewhere). */
export function buzz(pattern = [20, 50, 35]) {
  try { navigator.vibrate?.(pattern); } catch { /* not allowed: fine */ }
}

const COLORS = ['#ff4d88', '#ffc83d', '#00b3a4', '#7c6cf2', '#ff7a59'];

/** Confetti from a point (viewport coordinates). Decorative: aria-hidden, removed after. */
export function burst(x, y, { count = 36, spread = 220 } = {}) {
  if (reducedMotion()) return;
  const layer = document.createElement('div');
  layer.className = 'fx-burst';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.left = `${x}px`;
  layer.style.top = `${y}px`;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const dist = spread * (0.45 + Math.random() * 0.55);
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist - 40}px`);
    p.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
    p.style.background = COLORS[i % COLORS.length];
    if (i % 3 === 0) p.style.borderRadius = '50%';
    layer.append(p);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 1400);
}

let openCount = 0; // the scroll lock lifts only when the last dialog closes

/**
 * Opens a full-screen dialog element: locks scroll, keeps focus inside (Tab wraps, focus that
 * lands outside comes back), Escape closes. Keys are handled at the document, so they still work
 * after a click on something inside that can't take focus. Focus goes back where it was, or to
 * the main content. Fires "fx:closed" on the document when it closes.
 */
export function openDialog(dialog, { onClose, initial } = {}) {
  const active = document.activeElement;
  const before = active && active !== document.body ? active : null;
  dialog.setAttribute('tabindex', '-1'); // a click on plain content focuses the dialog, not <body>
  document.body.append(dialog);
  openCount += 1;
  document.documentElement.classList.add('fx-locked');
  const focusables = () => [...dialog.querySelectorAll('button, a[href], [tabindex="0"]')].filter((el) => !el.hidden && el.offsetParent !== null);
  const onKey = (e) => {
    if (!dialog.isConnected || document.querySelectorAll('[aria-modal="true"]').length > 1 && dialog !== [...document.querySelectorAll('[aria-modal="true"]')].at(-1)) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (!list.length) { e.preventDefault(); dialog.focus(); return; }
    const [first, last] = [list[0], list[list.length - 1]];
    const inside = dialog.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
  };
  const onFocus = (e) => { if (!dialog.contains(e.target)) (focusables()[0] || dialog).focus(); };
  document.addEventListener('keydown', onKey);
  document.addEventListener('focusin', onFocus);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('focusin', onFocus);
    dialog.remove();
    openCount = Math.max(0, openCount - 1);
    if (!openCount) document.documentElement.classList.remove('fx-locked');
    onClose?.();
    (before && document.contains(before) ? before : document.querySelector('#main'))?.focus?.({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('fx:closed'));
  }
  requestAnimationFrame(() => (initial || focusables()[0] || dialog).focus());
  return close;
}

/** A small element helper: el('p', { class: 'x' }, 'text', child). Text is set as text, never HTML. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

/**
 * Holographic foil (limited editions): the rainbow shine and the card's tilt follow the pointer, or
 * the phone's tilt where the browser reports it without asking. Only while `scope` has .is-holo,
 * and never with reduced motion (the CSS keeps a still foil).
 */
export function holoTilt(card, scope = card) {
  if (reducedMotion()) return;
  const set = (px, py) => {
    if (!scope.classList.contains('is-holo')) return;
    card.style.setProperty('--hx', `${Math.round(px * 100)}%`);
    card.style.setProperty('--hy', `${Math.round(py * 100)}%`);
    card.style.setProperty('--tilt-y', `${((px - 0.5) * 16).toFixed(1)}deg`);
    card.style.setProperty('--tilt-x', `${((0.5 - py) * 12).toFixed(1)}deg`);
  };
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    set(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  });
  card.addEventListener('pointerleave', () => { card.style.removeProperty('--tilt-x'); card.style.removeProperty('--tilt-y'); });
  const orient = (e) => {
    if (!card.isConnected) { window.removeEventListener('deviceorientation', orient); return; }
    if (e.gamma == null || e.beta == null) return;
    set(Math.min(1, Math.max(0, (e.gamma + 30) / 60)), Math.min(1, Math.max(0, (e.beta - 20) / 60)));
  };
  window.addEventListener('deviceorientation', orient);
}
