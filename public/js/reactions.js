// Reactions on pals' stamps, badges and photos (SPEC Flow 26): toggles in place instead of
// reloading the page. Without JS each button is a small form that posts and comes back.
import { reducedMotion } from './fx.js';

for (const form of document.querySelectorAll('form.react-form')) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const bar = form.closest('.reactions');
    const button = form.querySelector('button');
    if (button.dataset.busy) return;
    button.dataset.busy = '1';
    let res = null;
    try {
      res = await fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)), headers: { accept: 'application/json' }, credentials: 'same-origin' });
    } catch { /* offline: fall back below */ }
    delete button.dataset.busy;
    if (!res?.ok) { form.submit(); return; }
    const { on, counts, mine } = await res.json();
    for (const b of bar.querySelectorAll('button[data-reaction]')) {
      const key = b.dataset.reaction;
      const isMine = mine.includes(key);
      b.classList.toggle('is-on', isMine);
      b.setAttribute('aria-pressed', String(isMine));
      b.querySelector('.react-count').textContent = counts[key] || '';
    }
    if (on && !reducedMotion()) {
      button.classList.remove('is-pop');
      void button.offsetWidth; // restart the little pop
      button.classList.add('is-pop');
    }
  });
}
