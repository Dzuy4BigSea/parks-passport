// Getting your passport (SPEC Flow 11, "Game feel"): right after sign-up the passport cover swings
// open, your name is stamped in, confetti and Gary. Shown once (the ?welcome=1 flag is dropped from
// the address). Without JS, or with celebrations off, the passport page is simply there.
import { celebrationsOn, reducedMotion, burst, buzz, openDialog, el } from './fx.js';

const data = document.getElementById('welcome-data');
const url = new URL(window.location.href);
if (url.searchParams.has('welcome')) {
  url.searchParams.delete('welcome');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

if (data && celebrationsOn()) {
  const name = data.dataset.name || 'Explorer';
  const city = data.dataset.city || '';
  const issued = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  const cover = el('div', { class: 'welcome-cover', 'aria-hidden': 'true' },
    el('span', { class: 'welcome-crest' }, '★'), el('span', { class: 'welcome-cover-title' }, 'PARKS PASSPORT'), el('span', { class: 'welcome-cover-city' }, city));
  const page = el('div', { class: 'welcome-page' },
    el('p', { class: 'welcome-label' }, 'This passport belongs to'),
    el('p', { class: 'welcome-name' }, name),
    el('span', { class: 'welcome-stamp', 'aria-hidden': 'true' }, el('span', {}, 'ISSUED'), el('strong', {}, city.toUpperCase() || 'PARKS'), el('span', {}, issued)));
  const book = el('div', { class: 'welcome-book' }, page, cover);
  const title = el('h2', { id: 'welcome-title', class: 'welcome-title' }, `Welcome, ${name.split(/\s+/)[0]}!`);
  const go = el('button', { type: 'button', class: 'btn btn-pop btn-big' }, 'Start exploring');
  // Tap Gary to dress him (Account › Gary's wardrobe).
  const gary = el('a', { class: 'welcome-gary', href: '/account/gary', title: 'Change Gary’s outfit' },
    el('img', { src: '/brand/gary.svg', alt: 'Change Gary’s outfit', width: '160', height: '160' }));
  const dialog = el('div', { class: 'fx-welcome', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'welcome-title' },
    el('div', { class: 'reveal-backdrop' }),
    el('div', { class: 'welcome-stage' }, book, title,
      el('p', { class: 'welcome-sub' }, 'Your passport is ready. Your first stamp is out there waiting.'), go, gary));
  if (reducedMotion()) dialog.classList.add('is-still');
  const close = openDialog(dialog, { initial: go });
  go.addEventListener('click', close);
  // Open the cover, then stamp the page.
  setTimeout(() => {
    dialog.classList.add('is-open');
    setTimeout(() => {
      dialog.classList.add('is-stamped');
      buzz([25, 50, 40]);
      const r = page.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, { count: 60, spread: 260 });
    }, reducedMotion() ? 0 : 750);
  }, reducedMotion() ? 0 : 450);
}
