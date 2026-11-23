import { html } from '../html.js';
import { categoryLabel } from '../../domain/categories.js';
import { formatMiles } from '../../domain/geo.js';

const chips = (cats) => cats.length
  ? html`<ul class="chips" aria-label="Amenities">${cats.map((c) => html`<li>${categoryLabel(c)}</li>`)}</ul>`
  : '';

export function parksPage({ parks, total, q, selected, categories, near, unvisited = false, stamped = null, signedIn = false }) {
  const filtered = q || selected.length || unvisited;
  const countText = filtered
    ? `${parks.length} of ${total} parks match`
    : `${total} parks`;
  return {
    title: 'Parks',
    current: 'parks',
    scripts: ['/js/near-me.js'],
    body: html`
<h1>St. Pete parks</h1>
<form class="park-search" method="get" action="/parks" role="search">
  <div class="field">
    <label for="q">Search by park name</label>
    <input id="q" name="q" type="search" value="${q}" maxlength="100" autocomplete="off">
  </div>
  <details class="filters"${selected.length ? html` open` : ''}>
    <summary>Amenities${selected.length ? ` (${selected.length})` : ''}</summary>
    <fieldset>
      <legend class="visually-hidden">Show parks with all of these amenities</legend>
      <div class="filter-grid">
        ${categories.map((c) => html`<label class="check"><input type="checkbox" name="cat" value="${c}"${selected.includes(c) ? html` checked` : ''}> ${categoryLabel(c)}</label>`)}
      </div>
    </fieldset>
  </details>
  ${signedIn ? html`<label class="check"><input type="checkbox" name="unvisited" value="1"${unvisited ? html` checked` : ''}> Not visited yet</label>` : ''}
  ${near ? html`<input type="hidden" name="lat" value="${near.lat}"><input type="hidden" name="lng" value="${near.lng}">` : ''}
  <div class="actions">
    <button type="submit" class="btn btn-primary">Search</button>
    <button type="button" class="btn" id="near-me" hidden>Sort by nearest</button>
    ${filtered || near ? html`<a class="btn btn-quiet" href="/parks">Clear</a>` : ''}
  </div>
  <p id="near-me-status" class="notice" role="status" aria-live="polite"></p>
</form>

<p class="result-count" role="status">${countText}${near ? ', nearest first' : ''}</p>
${parks.length ? html`<ul class="park-list">
  ${parks.map((p) => html`<li class="park-card${stamped?.has(p.id) ? ' is-stamped' : ''}">
    <h2><a href="/parks/${p.slug}">${p.name}</a></h2>
    ${stamped ? (stamped.has(p.id)
      ? html`<p class="stamp-badge"><span aria-hidden="true">✓ </span>Stamped</p>`
      : html`<p class="stamp-badge unstamped">Not visited yet</p>`) : ''}
    ${near && p.distance_m != null ? html`<p class="distance">${formatMiles(p.distance_m)} away</p>` : ''}
    ${p.address ? html`<p class="address">${p.address}</p>` : ''}
    ${chips(p.categories)}
  </li>`)}
</ul>` : html`<p class="empty">No parks match. Try fewer amenities or a shorter name.</p>`}`,
  };
}
