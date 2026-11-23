import { html } from '../html.js';
import { categoryLabel } from '../../domain/categories.js';

const telHref = (phone) => `tel:${phone.replace(/[^\d+]/g, '')}`;

export function parkPage({ park }) {
  const hasPin = park.lat != null && park.lng != null;
  return {
    title: park.name,
    current: 'parks',
    head: hasPin ? html`<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">` : null,
    scripts: hasPin ? ['/js/park-map.js'] : [],
    body: html`
<p class="breadcrumb"><a href="/parks">All parks</a></p>
<article class="park">
  <header class="park-header">
    <h1>${park.name}</h1>
    ${park.address ? html`<p class="address">${park.address}</p>` : ''}
    ${park.phone ? html`<p><a href="${telHref(park.phone)}">${park.phone}</a></p>` : ''}
  </header>

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
