import { html } from '../html.js';
import { csrfField } from '../forms.js';
import { categoryLabel } from '../../domain/categories.js';
import { METHOD_LABELS } from '../../domain/visits.js';
import { formatDate } from '../../domain/time.js';

const telHref = (phone) => `tel:${phone.replace(/[^\d+]/g, '')}`;

// Stamp result shown after a successful stamp (?stamped=<visit id>).
function stampResult(result) {
  if (!result) return '';
  return html`<div class="stamp-result" role="status" tabindex="-1" data-announce>
  <p class="stamp-mark" aria-hidden="true">${result.visit.method === 'gps' ? 'GPS ✓' : 'Stamped'}</p>
  <div>
    <h2>Stamped! +${result.visit.points} points</h2>
    <ul class="points-breakdown">${result.parts.map((p) => html`<li>${p.reason}: +${p.points}</li>`)}</ul>
  </div>
</div>`;
}

function stampPanel({ park, user, csrf, today, myVisits, problem }) {
  if (!user) {
    return html`<section class="stamp-panel" aria-labelledby="stamp-h">
  <h2 id="stamp-h">Stamp this park</h2>
  <p><a class="btn btn-primary" href="/login?next=${encodeURIComponent(`/parks/${park.slug}`)}">Log in to stamp this park</a></p>
</section>`;
  }
  const stampedToday = myVisits.some((v) => v.visited_on === today);
  const hasPin = park.lat != null;
  return html`<section class="stamp-panel" aria-labelledby="stamp-h">
  <h2 id="stamp-h">Stamp this park</h2>
  ${problem ? html`<p class="notice" role="alert">${problem.text}</p>` : ''}
  ${stampedToday
    ? html`<p class="stamped-today">✓ Stamped today.</p>`
    : html`${hasPin ? html`<form method="post" action="/parks/${park.slug}/checkin" id="checkin-form" hidden>
    ${csrfField(csrf)}
    <input type="hidden" name="lat"><input type="hidden" name="lng"><input type="hidden" name="accuracy">
    <button type="submit" class="btn btn-primary btn-big">Check in here</button>
    <p class="hint">Uses your location once to confirm you're at the park. Your exact location is never shown to anyone.</p>
  </form>
  <p id="checkin-status" class="notice" role="status" aria-live="polite"></p>` : ''}
  <details class="honor"${problem || !hasPin ? html` open` : ''} id="honor">
    <summary>${hasPin ? 'No GPS? Stamp on the honor system' : 'Stamp on the honor system'}</summary>
    <form method="post" action="/parks/${park.slug}/stamp" class="honor-form">
      ${csrfField(csrf)}
      <div class="field">
        <label for="visited_on">Date of your visit</label>
        <input type="date" id="visited_on" name="visited_on" value="${today}" max="${today}" min="2000-01-01" required>
      </div>
      <button type="submit" class="btn">${problem?.offerHonor ? 'Stamp anyway (honor system)' : 'Stamp it'}</button>
    </form>
  </details>`}

  ${myVisits.length ? html`<h3>Your visits here</h3>
  <ul class="my-visits">
    ${myVisits.map((v) => html`<li>
      <span>${formatDate(v.visited_on)} · ${METHOD_LABELS[v.method]} · ${v.points} pts</span>
      <form method="post" action="/visits/${v.id}/delete">
        ${csrfField(csrf)}<input type="hidden" name="back" value="/parks/${park.slug}">
        <button type="submit" class="btn btn-quiet btn-small" aria-label="Delete visit on ${formatDate(v.visited_on)}">Delete</button>
      </form>
    </li>`)}
  </ul>` : ''}
</section>`;
}

export function parkPage({ park, user = null, csrf = '', today = '', myVisits = [], problem = null, stamped = null }) {
  const hasPin = park.lat != null && park.lng != null;
  const scripts = [];
  if (hasPin) scripts.push('/js/park-map.js');
  if (user && hasPin) scripts.push('/js/checkin.js');
  return {
    title: park.name,
    current: 'parks',
    offerShare: Boolean(stamped),
    head: hasPin ? html`<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">` : null,
    scripts,
    body: html`
<p class="breadcrumb"><a href="/parks">All parks</a></p>
<article class="park">
  <header class="park-header">
    <h1>${park.name}</h1>
    ${park.address ? html`<p class="address">${park.address}</p>` : ''}
    ${park.phone ? html`<p><a href="${telHref(park.phone)}">${park.phone}</a></p>` : ''}
  </header>

  ${stampResult(stamped)}
  ${stampPanel({ park, user, csrf, today, myVisits, problem })}

  <section class="park-map-section" aria-labelledby="map-h">
    <h2 id="map-h">Location</h2>
    ${hasPin
      ? html`<div id="park-map" class="park-map" data-lat="${park.lat}" data-lng="${park.lng}" data-name="${park.name}"></div>
<p><a href="https://www.openstreetmap.org/?mlat=${park.lat}&amp;mlon=${park.lng}#map=17/${park.lat}/${park.lng}">Open in OpenStreetMap</a></p>`
      : html`<p>We don't have this park's location yet.</p>`}
  </section>

  <section aria-labelledby="amenities-h">
    <h2 id="amenities-h">Amenities</h2>
    ${park.categories.length
      ? html`<ul class="chips">${park.categories.map((c) => html`<li><a href="/parks?cat=${c}">${categoryLabel(c)}</a></li>`)}</ul>`
      : html`<p>The City doesn't list amenities for this park.</p>`}
  </section>

  <section aria-labelledby="ratings-h">
    <h2 id="ratings-h">Ratings</h2>
    <p class="rating-summary">No ratings yet.</p>
  </section>

  ${park.city_url ? html`<p><a href="${park.city_url}" rel="noopener">More about ${park.name} on the City's website</a></p>` : ''}
</article>`,
  };
}
