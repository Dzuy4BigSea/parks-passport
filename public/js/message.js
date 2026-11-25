// Messages from the team (SPEC Flow 20): each delivered message (rendered by the server as a card,
// which is what shows without JS) opens full screen with Gary and its effect, one after another.
// When the last one closes, "pp:messages-done" lets the badge reveals (reveal.js) follow.
import { openDialog, el, reducedMotion } from './fx.js';
import { playEffect } from './effects.js';

const BUTTON = { notice: 'Got it', gift: 'Yay, thank you!', thanks: 'Aw, thanks!' };
let uid = 0;

/** Opens the messages in turn. Each item is a .team-message article (cloned into the dialog). */
export function showMessages(cards, { onDone } = {}) {
  let index = 0;
  const next = () => {
    if (index >= cards.length) { onDone?.(); return; }
    const card = cards[index].cloneNode(true);
    index += 1;
    const effect = card.dataset.effect || 'celebrate';
    // Unique ids: the copy in the dialog must not repeat the card's.
    const heading = card.querySelector('h2');
    const id = `fx-message-h-${++uid}`;
    heading?.setAttribute('id', id);
    card.removeAttribute('aria-labelledby');
    card.classList.add('is-in-dialog');
    const gift = effect === 'gift' ? el('div', { class: 'message-gift', 'aria-hidden': 'true' }, el('span', { class: 'message-gift-lid' }), el('span', { class: 'message-gift-box' })) : null;
    const ok = el('button', { type: 'button', class: 'btn btn-pop btn-big' }, BUTTON[effect] || 'Let’s go!');
    const count = cards.length > 1 ? el('p', { class: 'reveal-count' }, `${index} of ${cards.length}`) : null;
    const stage = el('div', { class: 'message-stage' }, gift, card, ok, count);
    const dialog = el('div', { class: `fx-message is-${effect}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id },
      el('div', { class: 'reveal-backdrop' }), stage);
    if (reducedMotion()) dialog.classList.add('is-still');
    const close = openDialog(dialog, { initial: ok, onClose: () => setTimeout(next, 0) });
    ok.addEventListener('click', close);
    requestAnimationFrame(() => playEffect(effect, stage));
  };
  next();
}

const box = document.querySelector('[data-messages]');
if (box) {
  const cards = [...box.querySelectorAll('.team-message')];
  const done = () => document.dispatchEvent(new CustomEvent('pp:messages-done'));
  const start = () => showMessages(cards, { onDone: done });
  // The passport opening (welcome.js) goes first.
  if (document.querySelector('.fx-welcome')) document.addEventListener('fx:closed', start, { once: true });
  else start();
}
