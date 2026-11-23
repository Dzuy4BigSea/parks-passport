import { html, raw } from './html.js';

// A city motif's icon. `m.svg` is already sanitized (domain/city.js getTheme). Decorative.
export function motifIcon(m, className = 'motif') {
  if (!m?.svg) return '';
  return html`<span class="${className}" aria-hidden="true">${raw(m.svg)}</span>`;
}
