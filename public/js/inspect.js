// Inspect a badge (SPEC Flow 11, "Game feel"): tap any badge on a passport for a big card that tilts
// with your finger or mouse and flips over to its story (or its hint, or your progress). The grid
// itself already shows everything, so without JS nothing is missing.
import { celebrationsOn, reducedMotion, buzz, openDialog, el } from './fx.js';

const STATE = { earned: 'Earned', known: 'In progress', mystery: 'Still a mystery' };

for (const badge of document.querySelectorAll('.badge-grid .badge')) {
  const name = badge.querySelector('.badge-name')?.textContent.trim() || 'Badge';
  const open = el('button', { type: 'button', class: 'badge-open', 'aria-haspopup': 'dialog' },
    el('span', { class: 'visually-hidden' }, `Look closer: ${name}`));
  badge.append(open);
  open.addEventListener('click', () => inspect(badge, name));
}

function inspect(badge, name) {
  const state = badge.classList.contains('earned') ? 'earned' : badge.classList.contains('known') ? 'known' : 'mystery';
  const art = badge.querySelector('.badge-art')?.cloneNode(true);
  const meta = badge.querySelector('.badge-meta')?.textContent.trim() || '';
  const desc = badge.querySelector('.badge-desc')?.textContent.trim() || '';
  const bar = badge.querySelector('.bar')?.cloneNode(true);

  const front = el('div', { class: 'inspect-face inspect-front' },
    el('span', { class: 'inspect-art', 'aria-hidden': 'true' }, art || '?'),
    el('h2', { id: 'inspect-name', class: 'inspect-name' }, name),
    el('p', { class: 'inspect-state' }, meta || STATE[state]),
    bar || '');
  const back = el('div', { class: 'inspect-face inspect-back' },
    el('p', { class: 'inspect-label' }, state === 'earned' ? 'The story' : state === 'known' ? 'How to earn it' : 'A clue'),
    el('p', { class: 'inspect-desc' }, desc || 'Keep exploring. Some badges only show themselves once you find them.'));
  const flipper = el('div', { class: 'inspect-flip' }, front, back);
  const card = el('div', { class: `inspect-card is-${state}` }, flipper, el('span', { class: 'inspect-glare', 'aria-hidden': 'true' }));
  const flip = el('button', { type: 'button', class: 'btn' }, 'Flip it over');
  const done = el('button', { type: 'button', class: 'btn btn-primary' }, 'Close');
  const dialog = el('div', { class: 'fx-inspect', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'inspect-name' },
    el('div', { class: 'reveal-backdrop' }), el('div', { class: 'inspect-stage' }, card, el('div', { class: 'inspect-actions' }, flip, done)));
  const still = reducedMotion() || !celebrationsOn();
  if (still) dialog.classList.add('is-still');

  const close = openDialog(dialog, { initial: flip });
  done.addEventListener('click', close);
  dialog.querySelector('.reveal-backdrop').addEventListener('click', close);
  flip.addEventListener('click', () => {
    const flipped = card.classList.toggle('is-flipped');
    flip.textContent = flipped ? 'Flip it back' : 'Flip it over';
    if (!still) buzz([12]);
  });
  if (state === 'earned' && !still) buzz([15, 40, 15]);

  // Tilt toward the pointer, with a glare that follows it.
  if (!still) {
    const tilt = (x, y) => {
      const r = card.getBoundingClientRect();
      const px = Math.min(1, Math.max(0, (x - r.left) / r.width));
      const py = Math.min(1, Math.max(0, (y - r.top) / r.height));
      card.style.setProperty('--ry', `${(px - 0.5) * 26}deg`);
      card.style.setProperty('--rx', `${(0.5 - py) * 22}deg`);
      card.style.setProperty('--gx', `${px * 100}%`);
      card.style.setProperty('--gy', `${py * 100}%`);
    };
    card.addEventListener('pointermove', (e) => tilt(e.clientX, e.clientY));
    card.addEventListener('pointerleave', () => { card.style.setProperty('--ry', '0deg'); card.style.setProperty('--rx', '0deg'); });
    card.addEventListener('click', () => flip.click());
  }
}
