import { cityPath, parkPath } from '../urls.js';
import { palFaces } from '../pals-here.js';
import { html } from '../html.js';
import { categoryLabel } from '../../domain/categories.js';
import { formatMiles, travelTime } from '../../domain/geo.js';
import { motifForPark, areaForPark } from '../../domain/city.js';
import { motifIcon } from '../motif.js';
import { ICONS } from '../icons.js';

// Explore page: a property-search style list + map. Cards are "postcards": a member's public
// photo in duotone when there is one, otherwise a risograph-style print of the park's motif.
// Everything works without JS (search, filters, near-me via the query string); the map, the
// list-map sync and the phone map/list toggle are enhancements (public/js/explore.js).

const INKS = ['aqua', 'pink', 'sun', 'violet'];
const inkFor = (slug) => INKS[[...slug].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % INKS.length];



const shortDate = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).toUpperCase();
};

// A postmark for stamped parks: ring, date and wavy cancellation lines. Decorative.
const postmark = (date) => html`<span class="postmark" aria-hidden="true"><svg viewBox="0 0 120 60">
  <circle cx="30" cy="30" r="25" fill="none" stroke="currentColor" stroke-width="2.5"/>
  <circle cx="30" cy="30" r="20" fill="none" stroke="currentColor" stroke-width="1"/>
  <path d="M60 18c8-6 16 6 24 0s16 6 24 0M60 30c8-6 16 6 24 0s16 6 24 0M60 42c8-6 16 6 24 0s16 6 24 0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
</svg><span class="postmark-text">STAMPED<br>${date}</span></span>`;

// Amenity tags: the ones you filtered by first (so a card shows why it matched), up to 3
// visible; the rest stay in the list for screen readers and the "+N" count.
function tags(categories, selected) {
  if (!categories.length) return '';
  const sorted = [...categories].sort((a, b) => selected.includes(b) - selected.includes(a));
  const extra = sorted.length - 3;
  return html`<ul class="chips tags" aria-label="Amenities">${sorted.map((c, i) => html`<li${i >= 3 ? html` class="visually-hidden"` : ''}>${categoryLabel(c)}</li>`)}${extra > 0 ? html`<li class="more" aria-hidden="true">+${extra}</li>` : ''}</ul>`;
}

export function postcard(p, i, { theme, stamped, stampDates, near, selected, extras, palsHere = null }) {
  const isStamped = stamped?.has(p.id);
  const area = areaForPark(theme, p);
  const motif = motifForPark(theme, p.slug);
  const ex = extras.get(p.id) || {};
  return html`<li class="park-card postcard ink-${inkFor(p.slug)}${isStamped ? ' is-stamped' : ''}" data-slug="${p.slug}" style="--i:${i}">
  <div class="pc-art${ex.photoId ? ' has-photo' : ''}" aria-hidden="true">
    ${ex.photoId
      ? html`<img src="/photos/${ex.photoId}/thumb" alt="" width="400" height="400" loading="${i < 4 ? 'eager' : 'lazy'}" decoding="async">`
      : html`<span class="pc-motif">${motifIcon(motif)}</span><span class="pc-motif pc-motif-ghost">${motifIcon(motif)}</span>`}
    ${near && p.distance_m != null ? html`<span class="pc-distance">${travelTime(p.distance_m)}</span>` : ''}
    ${isStamped && stampDates?.get(p.id) ? postmark(shortDate(stampDates.get(p.id))) : ''}
  </div>
  <div class="pc-body">
    ${area ? html`<p class="pc-area">${area.name}</p>` : ''}
    <h2><a href="${parkPath(p)}">${p.name}</a></h2>
    ${stamped ? (isStamped
      ? html`<p class="stamp-badge"><span aria-hidden="true">✓ </span>Stamped</p>`
      : html`<p class="stamp-badge unstamped">Not visited yet</p>`) : ''}
    ${near && p.distance_m != null ? html`<p class="distance">${formatMiles(p.distance_m)} away</p>` : ''}
    ${p.address ? html`<p class="address">${p.address}</p>` : ''}
    ${palFaces(palsHere?.get(p.id))}
    ${tags(p.categories, selected)}
    <p class="pc-foot">${ex.rating ? html`<span class="pc-rating"><span aria-hidden="true">★</span> ${ex.rating.average.toFixed(1)}<span class="visually-hidden"> out of 5,</span> <span class="muted">(${ex.rating.count})</span></span>` : html`<span class="muted">No ratings yet</span>`}
      ${stamped && !isStamped ? html`<span class="pc-points">+10 pts</span>` : ''}</p>
  </div>
</li>`;
}

export function parksPage({ parks, total, q, selected, categories, near, unvisited = false, stamped = null, stampDates = null,
  signedIn = false, theme = { motifs: [], areas: [] }, extras = new Map(), palsHere = null, palsOnly = false, hasPals = false }) {
  const filtered = q || selected.length || unvisited || palsOnly;
  const listPath = theme.key ? cityPath(theme, '/parks') : '/parks';
  const countText = filtered ? `${parks.length} of ${total} parks match` : `${total} parks`;
  // Map data: only what the map needs, no private fields.
  const mapData = parks.filter((p) => p.lat != null).map((p) => ({
    slug: p.slug, url: parkPath(p), name: p.name, lat: p.lat, lng: p.lng, stamped: Boolean(stamped?.has(p.id)),
    area: areaForPark(theme, p)?.name || '', travel: near && p.distance_m != null ? travelTime(p.distance_m) : '',
  }));
  return {
    title: theme.copy?.short ? `${theme.copy.short} parks` : 'Parks',
    current: 'parks',
    head: html`<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">`,
    scripts: ['/js/near-me.js', '/js/explore.js'],
    body: html`
<div class="explore">
<header class="explore-head">
  <div class="page-head">
    <div>
      <h1>${theme.copy?.short || 'All'} parks</h1>
      <p class="explore-sub">${total} green spaces, one passport<span class="squiggle" aria-hidden="true"><svg viewBox="0 0 120 10" preserveAspectRatio="none"><path d="M2 6c10-5 18 4 28 0s18-5 28 0 18 4 28 0 18-5 32 0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg></span></p>
    </div>
    ${stamped ? html`<p class="pill pill-stamped">${stamped.size} of ${total} stamped</p>` : ''}
  </div>
  <form class="park-search explore-bar" method="get" action="${listPath}" role="search">
    <div class="field search-field">
      <label for="q">Search by park name</label>
      <span class="search-input">${ICONS.search}<input id="q" name="q" type="search" value="${q}" maxlength="100" autocomplete="off" placeholder="${theme.copy?.search_examples || 'Park name…'}"></span>
    </div>
    <div class="toolbar">
      <button type="button" class="btn btn-near js-only" id="near-me">${ICONS.pin}Sort by nearest</button>
      <details class="filters"${selected.length ? html` open` : ''}>
        <summary class="btn">Amenities${selected.length ? ` (${selected.length})` : ''}</summary>
        <fieldset>
          <legend class="visually-hidden">Show parks with all of these amenities</legend>
          <div class="filter-grid">
            ${categories.map((c) => html`<label class="check chip-check"><input type="checkbox" name="cat" value="${c}"${selected.includes(c) ? html` checked` : ''}> ${categoryLabel(c)}</label>`)}
          </div>
        </fieldset>
      </details>
      ${signedIn ? html`<label class="check chip-check toggle-chip"><input type="checkbox" name="unvisited" value="1"${unvisited ? html` checked` : ''}> Not visited yet</label>` : ''}
      ${hasPals ? html`<label class="check chip-check toggle-chip"><input type="checkbox" name="pals" value="1"${palsOnly ? html` checked` : ''}> Stamped by a pal</label>` : ''}
      ${near ? html`<input type="hidden" name="lat" value="${near.lat}"><input type="hidden" name="lng" value="${near.lng}">` : ''}
      <button type="submit" class="btn btn-primary">Search</button>
      ${filtered || near ? html`<a class="btn btn-quiet" href="${listPath}">Clear</a>` : ''}
    </div>
    <p id="near-me-status" class="notice" role="status" aria-live="polite"></p>
  </form>
</header>

<div class="explore-split">
  <section class="explore-list" aria-labelledby="results-h">
    <p id="results-h" class="result-count" role="status">${countText}${near ? ', nearest first' : ''}</p>
    ${parks.length ? html`<ul class="park-list">
      ${parks.map((p, i) => postcard(p, i, { theme, stamped, stampDates, near, selected, extras, palsHere }))}
    </ul>` : html`<p class="empty">No parks match. Try fewer amenities or a shorter name.</p>`}
  </section>
  <aside class="explore-map" aria-label="Map of these parks">
    <div id="explore-map" class="park-map" data-parks="${JSON.stringify(mapData)}"${near ? html` data-near="${JSON.stringify(near)}"` : ''}></div>
  </aside>
</div>
<button type="button" class="map-toggle btn" id="map-toggle" hidden aria-pressed="false">${ICONS.pin}<span>Map</span></button>
</div>`,
  };
}
