// Admin › Messages (SPEC Flow 20): preview a message as written, and play each effect's sample.
import { showMessages } from './message.js';
import { el } from './fx.js';
import { EFFECT_SAMPLES } from './effect-samples.js';

function card({ title, body, effect }) {
  const paras = String(body || '').split(/\n{2,}/).filter(Boolean).map((p) => {
    const node = el('p');
    p.split('\n').forEach((line, i) => { if (i) node.append(el('br')); node.append(line); });
    return node;
  });
  return el('article', { class: 'team-message', 'data-effect': effect },
    el('p', { class: 'team-message-from' }, el('img', { src: '/brand/gary.svg', alt: '', width: 44, height: 44, class: 'team-message-gary' }), ' From the Parks Passport team'),
    el('h2', {}, title || '(No title yet)'),
    el('div', { class: 'team-message-body' }, ...paras));
}

const form = document.querySelector('[data-message-form]');
document.querySelector('[data-preview]')?.addEventListener('click', () => {
  const data = new FormData(form);
  showMessages([card({ title: data.get('title'), body: data.get('body'), effect: data.get('effect') || 'celebrate' })]);
});
for (const b of document.querySelectorAll('[data-play-effect]')) {
  b.addEventListener('click', () => showMessages([card({ ...EFFECT_SAMPLES[b.dataset.playEffect], effect: b.dataset.playEffect })]));
}
document.querySelector('[data-preview-saved]')?.addEventListener('click', () => {
  const saved = document.querySelector('.message-review .team-message');
  if (saved) showMessages([saved]);
});
