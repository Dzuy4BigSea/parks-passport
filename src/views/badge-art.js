import { html } from './html.js';

// A badge's art: an emoji, or "upload:<key>" for an uploaded image (served as a PNG).
// Decorative: the badge name is always next to it.
export function badgeArt(art, className = 'badge-art') {
  const m = /^upload:([a-f0-9]{24})$/.exec(String(art || ''));
  if (m) return html`<img class="${className} badge-img" src="/badge-art/${m[1]}.png" alt="" width="40" height="40">`;
  return html`<span class="${className}" aria-hidden="true">${art}</span>`;
}
