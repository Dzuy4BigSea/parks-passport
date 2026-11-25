import { html } from './html.js';
import { avatar } from './avatar.js';

// "Your pals were here" (SPEC Flow 8): a few faces and who stamped the park. pals come from
// domain/pals.js palsWhoStamped (only pals who share their passport), most recent first.
export function palsSentence(pals) {
  const [a, b] = pals;
  if (pals.length === 1) return `${a.display_name} stamped this`;
  if (pals.length === 2) return `${a.display_name} and ${b.display_name} stamped this`;
  return `${a.display_name} and ${pals.length - 1} other pals stamped this`;
}

/** The compact version for park cards: up to three faces and one line. */
export function palFaces(pals) {
  if (!pals?.length) return '';
  return html`<p class="pal-faces"><span class="faces" aria-hidden="true">${pals.slice(0, 3).map((p) => avatar(p, { size: 24 }))}</span>
  <span>${palsSentence(pals)}</span></p>`;
}
