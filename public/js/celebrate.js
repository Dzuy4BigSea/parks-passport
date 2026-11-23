// Stamp celebration: count the points up and give a short buzz on phones that support it.
// The final number is already in the HTML, so without JS (or with reduced motion) nothing changes.
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const el = document.querySelector('[data-count-to]');
if (el && !reduced) {
  const to = Number(el.dataset.countTo) || 0;
  const start = performance.now() + 350; // after the stamp lands
  const dur = 650;
  el.textContent = '0';
  const tick = (t) => {
    const p = Math.min(1, Math.max(0, (t - start) / dur));
    el.textContent = String(Math.round(to * (1 - (1 - p) ** 3)));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try { navigator.vibrate?.([18, 40, 30]); } catch { /* not allowed: fine */ }
}
