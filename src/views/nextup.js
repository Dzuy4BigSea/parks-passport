import { html } from './html.js';
import { ICONS } from './icons.js';
import { badgeArt } from './badge-art.js';
import { formatMiles } from '../domain/geo.js';
import { parkPath } from './urls.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// "2 more parks" from a badge's unit ("parks", "visits", "weeks", "parks in a weekend").
const more = (b) => `${b.remaining} more ${b.remaining === 1 ? b.unit.replace(/^(\w+?)s\b/, '$1') : b.unit}`;

export function streakText(streak) {
  if (!streak.weeks) return { title: 'Start a streak', meta: 'Stamp a park this week to start a weekly streak.' };
  if (streak.activeThisWeek) return { title: `${plural(streak.weeks, 'week')} in a row`, meta: 'This week is stamped. Keep it going next week.' };
  return { title: `${plural(streak.weeks, 'week')} in a row`, meta: 'Stamp a park by Sunday to keep your streak.' };
}

/** The "what next" cards: closest unstamped park, closest badge, the streak. */
export function nextUpCards({ nextPark, nextBadge, streak }, { heading = 'Up next', id = 'nextup-h', city = null } = {}) {
  const s = streakText(streak);
  const base = city?.key ? `/${city.key}` : '';
  return html`<section aria-labelledby="${id}">
  <h2 id="${id}">${heading}</h2>
  <ul class="nextup">
    <li class="reveal" style="--i:0">${nextPark
      ? html`<a href="${parkPath(nextPark)}"><span class="icon">${ICONS.pin}</span><span>
        <span class="label">Closest new park</span><strong>${nextPark.name}</strong>
        <span class="meta">${formatMiles(nextPark.distance_m)} from your last stamp · +10 points</span></span></a>`
      : html`<a href="${base}/parks"><span class="icon">${ICONS.pin}</span><span>
        <span class="label">Closest new park</span><strong>Find a park near you</strong>
        <span class="meta">Sort the list by distance and pick one.</span></span></a>`}</li>
    ${nextBadge ? html`<li class="reveal" style="--i:1"><a href="${base}/passport#badges"><span class="icon">${badgeArt(nextBadge.art, 'nextup-art')}</span><span>
      <span class="label">Next badge</span><strong>${nextBadge.name}</strong>
      <span class="meta">${more(nextBadge)} to go (${nextBadge.progress} / ${nextBadge.target})</span></span></a></li>` : ''}
    <li class="reveal" style="--i:2"><div class="nextup-card"><span class="icon">${ICONS.flame}</span><span>
      <span class="label">Weekly streak</span><strong>${s.title}</strong><span class="meta">${s.meta}</span></span></div></li>
  </ul>
</section>`;
}

/** One line under the stamp celebration: the next park and the next badge. */
export function nextLine({ nextPark, nextBadge }) {
  if (!nextPark && !nextBadge) return '';
  return html`<p class="next-line">${nextBadge ? html`<strong>${more(nextBadge)}</strong> to earn ${nextBadge.name}. ` : ''}${nextPark
    ? html`Closest new park: <a href="${parkPath(nextPark)}">${nextPark.name}</a> (${formatMiles(nextPark.distance_m)}).` : ''}</p>`;
}
