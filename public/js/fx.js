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

/** Opens a full-screen dialog element: locks scroll, traps Tab, Escape calls onClose. */
export function openDialog(dialog, { onClose, initial } = {}) {
  const before = document.activeElement;
  document.body.append(dialog);
  document.documentElement.classList.add('fx-locked');
  const focusables = () => [...dialog.querySelectorAll('button, a[href], [tabindex="0"]')].filter((el) => !el.hidden && el.offsetParent !== null);
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (!list.length) return;
    const [first, last] = [list[0], list[list.length - 1]];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  dialog.addEventListener('keydown', onKey);
  function close() {
    dialog.removeEventListener('keydown', onKey);
    dialog.remove();
    document.documentElement.classList.remove('fx-locked');
    onClose?.();
    (before && document.contains(before) ? before : document.querySelector('#main'))?.focus?.({ preventScroll: true });
  }
  requestAnimationFrame(() => (initial || focusables()[0])?.focus());
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
