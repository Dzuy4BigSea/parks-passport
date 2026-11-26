import { html } from './html.js';
import { motifIcon } from './motif.js';
import { motifForPark } from '../domain/city.js';
import { parkPath } from './urls.js';

/** "NOV 25" for a YYYY-MM-DD date. */
export const monthDay = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).toUpperCase();
};

// A postmark for the passport spread (home and passport): ring with the park's motif, its name and the date.
// s = { city_key, slug, name, visited_on }
export const spreadStamp = (s, theme, i) => html`<li class="spread-stamp" style="--i:${i}">
  <a href="${parkPath(s)}"><span class="spread-seal" aria-hidden="true">${motifIcon(motifForPark(theme, s.slug))}<span class="spread-date">${monthDay(s.visited_on)}</span></span>
  <span class="spread-name">${s.name}</span></a></li>`;
