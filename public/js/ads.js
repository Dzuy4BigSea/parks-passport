// Nonprofit ads and activity tips (SPEC Flow 25).
// Slider: advances every 6 s with Previous, Pause and Next; never moves by itself with reduced
// motion; pauses while hovered or focused. Pause also stills animated images (their first frame).
// Without JS the slides scroll sideways.
// Tips: "Tips from …" opens a pop-up with the tip (fetched from /tips/:id?embed=1, which counts the
// view); Escape or Close shuts it. Without JS the link opens the tip's page.
import { openDialog, el, reducedMotion } from './fx.js';

const EVERY_MS = 6000;

export function startSlider(root) {
  const track = root.querySelector('.ad-slides');
  const slides = [...track.children];
  const controls = root.querySelector('.ad-controls');
  if (!controls) return;
  const many = slides.length > 1;
  controls.hidden = false;
  root.classList.add('is-js');
  const pauseBtn = controls.querySelector('.ad-pause');
  let index = 0;
  let paused = reducedMotion();
  let hold = false; // hover or focus
  const show = (i) => {
    index = (i + slides.length) % slides.length;
    slides.forEach((s, n) => {
      const on = n === index;
      s.classList.toggle('is-current', on);
      s.setAttribute('aria-hidden', on ? 'false' : 'true');
      for (const a of s.querySelectorAll('a')) a.tabIndex = on ? 0 : -1;
    });
  };
  // One fixed name ("Pause") with a pressed state; the icon shows what a press does next.
  const setPaused = (p) => {
    paused = p;
    pauseBtn.setAttribute('aria-pressed', String(p));
    pauseBtn.textContent = p ? '▶' : '❚❚';
    for (const img of root.querySelectorAll('img[data-still]')) {
      img.dataset.moving ||= img.getAttribute('src');
      img.src = p ? img.dataset.still : img.dataset.moving;
    }
  };
  controls.querySelector('.ad-prev')?.addEventListener('click', () => show(index - 1));
  controls.querySelector('.ad-next')?.addEventListener('click', () => show(index + 1));
  pauseBtn.addEventListener('click', () => setPaused(!paused));
  root.addEventListener('pointerenter', () => { hold = true; });
  root.addEventListener('pointerleave', () => { hold = false; });
  root.addEventListener('focusin', () => { hold = true; });
  root.addEventListener('focusout', () => { hold = false; });
  setPaused(paused);
  show(0);
  if (!many) return;
  const timer = setInterval(() => {
    if (!root.isConnected) { clearInterval(timer); return; }
    if (!paused && !hold && !document.hidden) show(index + 1);
  }, EVERY_MS);
}

for (const root of document.querySelectorAll('[data-slider]')) startSlider(root);

for (const link of document.querySelectorAll('a[data-tip]')) {
  link.addEventListener('click', async (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; // a new tab gets the page
    e.preventDefault();
    let res;
    try {
      const url = new URL(link.href);
      url.searchParams.set('embed', '1');
      res = await fetch(url, { credentials: 'same-origin' });
    } catch { res = null; }
    if (!res?.ok) { window.location.href = link.href; return; }
    const body = el('div', { class: 'tip-body' });
    body.innerHTML = await res.text(); // our own server-rendered, escaped markup
    const closeBtn = el('button', { type: 'button', class: 'btn btn-quiet tip-close' }, 'Close');
    const box = el('div', { class: 'tip-box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tip-h' }, closeBtn, body);
    const dialog = el('div', { class: 'fx-tip' }, el('div', { class: 'tip-backdrop' }), box);
    const close = openDialog(dialog, { initial: closeBtn });
    closeBtn.addEventListener('click', close);
    dialog.querySelector('.tip-backdrop').addEventListener('click', close);
    for (const s of dialog.querySelectorAll('[data-slider]')) startSlider(s);
  });
}
