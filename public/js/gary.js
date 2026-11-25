// Gary in the lower right of every page (SPEC Flow 21). The bubble is a <details> (works without
// JS); this adds Escape and a tap outside to close it, and, for founding explorers, a three-message
// chat: Gary's tip, what they send (as feedback for the team, Flow 16), and Gary's reply.
import { reducedMotion } from './fx.js';

const box = document.querySelector('[data-gary]');
if (box) {
  const summary = box.querySelector('summary');
  const closeBtn = box.querySelector('[data-gary-close]');
  const chat = box.querySelector('[data-gary-chat]');
  const form = box.querySelector('[data-gary-talk]');
  const talk = box.querySelector('[data-gary-talk-open]');
  closeBtn.hidden = false;
  chat.setAttribute('aria-live', 'polite');
  // With JS the form waits behind "Talk to Gary".
  if (form && talk) { form.hidden = true; talk.hidden = false; }

  const close = () => { if (box.open) { box.open = false; summary.focus(); } };
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box.open) { e.preventDefault(); close(); } });
  document.addEventListener('pointerdown', (e) => { if (box.open && !box.contains(e.target)) box.open = false; });

  talk?.addEventListener('click', () => {
    talk.hidden = true;
    form.hidden = false;
    form.querySelector('textarea').focus();
  });

  const bubble = (who, text, extra = '') => {
    const li = document.createElement('li');
    li.className = `gary-msg is-${who}${extra}`;
    const name = document.createElement('span');
    name.className = 'gary-name';
    name.textContent = who === 'gary' ? 'Gary' : 'You';
    const p = document.createElement('p');
    p.textContent = text;
    li.append(name, p);
    chat.append(li);
    li.scrollIntoView?.({ block: 'nearest' });
    return li;
  };

  let busy = false;
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const error = form.querySelector('.feedback-error');
    const text = form.querySelector('textarea').value.trim();
    if (!text) { error.textContent = 'Write a few words first.'; error.hidden = false; return; }
    busy = true;
    error.hidden = true;
    try {
      const res = await fetch(form.action, {
        method: 'POST', body: new URLSearchParams(new FormData(form)),
        headers: { Accept: 'application/json' }, credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'That didn’t send. Try again in a moment.');
      form.hidden = true;
      bubble('me', text);
      // A beat while Gary "types", then his reply. That's the end of the chat: he isn't a chatbot.
      const typing = bubble('gary', '…', ' is-typing');
      setTimeout(() => {
        typing.remove();
        bubble('gary', data.reply || 'Thank you! I’ve passed it to the crew. Let’s go!');
        closeBtn.focus();
      }, reducedMotion() ? 0 : 900);
    } catch (err) {
      error.textContent = err instanceof TypeError ? 'That didn’t send. Try again in a moment.' : err.message;
      error.hidden = false;
    } finally {
      busy = false;
    }
  });
}
