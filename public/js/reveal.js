// Badge reveal (SPEC Flow 11, "Game feel"): new badges and level-ups from the server-rendered
// announcements (layout.js) become face-down cards to tap open, one after another: a flip, a shine,
// confetti and a short buzz. The announcement stays in the page for screen readers and without JS.
import { celebrationsOn, reducedMotion, burst, buzz, openDialog, el, holoTilt } from './fx.js';

const box = document.querySelector('.announcements');
const KICKERS = { known: 'Badge unlocked!', hidden: 'Surprise badge!', lucky: 'Lucky find!', level: 'Level up!', gift: 'A gift for you!', limited: 'Limited edition!', team: 'Team goal reached!' };

if (box && celebrationsOn()) {
  const items = [...box.querySelectorAll('.announce')].map((a) => {
    const strong = a.querySelector('strong');
    const title = (strong?.textContent || '').replace(/^New badge:\s*/, '').trim();
    const text = (sel) => (a.querySelector(sel)?.textContent || '').trim();
    const holo = a.classList.contains('is-holo');
    return {
      note: text('.gift-note'),
      serial: text('.limited-no').replace(/^Limited edition\s*/, ''),
      holo,
      kind: holo ? 'limited' : a.dataset.kind || 'known',
      art: a.querySelector('.announce-art')?.cloneNode(true) || null,
      title,
      desc: text('.announce-desc'),
    };
  }).filter((i) => i.title);
  if (!items.length) {
    // nothing to show
  } else if (document.querySelector('[data-messages]')) {
    // Messages from the team (message.js) go first; the badges they brought come right after.
    document.addEventListener('pp:messages-done', () => show(items), { once: true });
  } else if (document.querySelector('.fx-welcome')) {
    // The passport opening goes first; the badges come right after it.
    document.addEventListener('fx:closed', () => show(items), { once: true });
  } else {
    show(items);
  }
}

function show(items) {
  let index = 0;
  const kicker = el('p', { class: 'reveal-kicker', id: 'reveal-kicker' });
  const back = el('span', { class: 'reveal-face reveal-back', 'aria-hidden': 'true' }, el('span', { class: 'reveal-q' }, '?'));
  const frontArt = el('span', { class: 'reveal-art', 'aria-hidden': 'true' });
  const frontName = el('span', { class: 'reveal-name' });
  const frontDesc = el('span', { class: 'reveal-desc' });
  const frontNote = el('span', { class: 'reveal-note' });
  const frontSerial = el('span', { class: 'reveal-serial' });
  const foil = el('span', { class: 'holo-foil', 'aria-hidden': 'true' });
  const front = el('span', { class: 'reveal-face reveal-front' }, foil, frontSerial, frontArt, frontName, frontDesc, frontNote);
  const card = el('button', { type: 'button', class: 'reveal-card' }, el('span', { class: 'reveal-flip' }, back, front), el('span', { class: 'reveal-shine', 'aria-hidden': 'true' }));
  const hint = el('p', { class: 'reveal-hint' }, 'Tap the card to reveal it');
  const live = el('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const count = el('p', { class: 'reveal-count' });
  const next = el('button', { type: 'button', class: 'btn btn-pop btn-big reveal-next', hidden: true });
  const stage = el('div', { class: 'reveal-stage' }, kicker, card, hint, live, next, count);
  const dialog = el('div', { class: 'fx-reveal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'reveal-kicker' }, el('div', { class: 'reveal-backdrop' }), stage);
  if (reducedMotion()) dialog.classList.add('is-still');

  const close = openDialog(dialog, { initial: card });

  function load() {
    const item = items[index];
    dialog.dataset.kind = item.kind;
    dialog.classList.remove('is-revealed');
    kicker.textContent = KICKERS[item.kind] || KICKERS.known;
    frontArt.replaceChildren(...(item.art ? [item.art.cloneNode(true)] : []));
    frontName.textContent = item.title;
    frontDesc.textContent = item.desc;
    frontNote.textContent = item.note;
    frontNote.hidden = !item.note;
    frontSerial.textContent = item.serial;
    frontSerial.hidden = !item.serial;
    dialog.classList.toggle('is-holo', item.holo);
    card.setAttribute('aria-label', `${KICKERS[item.kind] || KICKERS.known} Tap to reveal`);
    card.disabled = false;
    hint.hidden = false;
    next.hidden = true;
    count.textContent = items.length > 1 ? `${index + 1} of ${items.length}` : '';
    card.focus();
  }

  function reveal() {
    if (dialog.classList.contains('is-revealed')) return;
    const item = items[index];
    dialog.classList.add('is-revealed');
    card.removeAttribute('aria-label'); // now named by what it shows
    hint.hidden = true;
    live.textContent = `${item.kind === 'level' ? '' : 'New badge: '}${item.title}${item.serial ? `, limited edition ${item.serial}` : ''}. ${item.desc} ${item.note}`.trim();
    buzz(item.kind === 'lucky' || item.kind === 'level' ? [30, 60, 30, 60, 60] : [20, 50, 35]);
    setTimeout(() => {
      const r = card.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, { count: item.kind === 'lucky' ? 56 : 40 });
    }, reducedMotion() ? 0 : 380);
    next.textContent = index < items.length - 1 ? 'Next' : 'Awesome!';
    next.hidden = false;
    setTimeout(() => next.focus(), reducedMotion() ? 0 : 650);
  }

  card.addEventListener('click', reveal);
  holoTilt(card, dialog);
  next.addEventListener('click', () => {
    if (index < items.length - 1) { index += 1; load(); } else close();
  });
  dialog.querySelector('.reveal-backdrop').addEventListener('click', () => {
    if (dialog.classList.contains('is-revealed') && index === items.length - 1) close();
  });
  load();
}
