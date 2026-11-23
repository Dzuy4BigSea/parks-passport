import { html } from '../html.js';
import { csrfField } from '../forms.js';
import { categoryLabel } from '../../domain/categories.js';
import { METHOD_LABELS } from '../../domain/visits.js';
import { formatDate, localDate } from '../../domain/time.js';
import { VISIBILITY, VISIBILITY_LABELS } from '../../domain/visibility.js';

const ACCEPT = 'image/jpeg,image/png,image/webp';

const visibilitySelect = (id, current) => html`<select id="${id}" name="visibility">
  ${VISIBILITY.map((v) => html`<option value="${v}"${v === current ? html` selected` : ''}>${VISIBILITY_LABELS[v]}</option>`)}
</select>`;

// Errors get focus on load (announce.js), so they're seen and read even far down the page.
const areaProblem = (problem, area) => (problem && problem.area === area
  ? html`<p class="notice" role="alert" tabindex="-1" data-announce>${problem.text}</p>` : '');

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

function stampPanel({ park, user, csrf, today, myVisits, problem: allProblems }) {
  const problem = allProblems?.area === 'stamp' ? allProblems : null;
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
  ${problem ? html`<p class="notice" role="alert" tabindex="-1" data-announce>${problem.text}</p>` : ''}
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
    <form method="post" action="/parks/${park.slug}/stamp" class="honor-form" enctype="multipart/form-data">
      ${csrfField(csrf)}
      <div class="field">
        <label for="visited_on">Date of your visit</label>
        <input type="date" id="visited_on" name="visited_on" value="${today}" max="${today}" min="2000-01-01" required>
      </div>
      <div class="field">
        <label for="stamp_photo">Add a photo (optional, +3 points)</label>
        <input type="file" id="stamp_photo" name="photo" accept="${ACCEPT}">
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

export function parkPage({ park, user = null, csrf = '', today = '', myVisits = [], problem = null, stamped = null,
  photos = [], summary = { count: 0, average: null }, reviews = [], mine = null, flash = null }) {
  const hasPin = park.lat != null && park.lng != null;
  const scripts = [];
  if (hasPin) scripts.push('/js/park-map.js');
  if (user && hasPin) scripts.push('/js/checkin.js');
  if (user) scripts.push('/js/upload-check.js');
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

  ${flash ? html`<p class="notice" role="status">${flash}</p>` : ''}
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

  ${ratingsSection({ park, user, csrf, summary, reviews, mine, problem })}
  ${photosSection({ park, user, csrf, photos, problem })}

  ${park.city_url ? html`<p><a href="${park.city_url}" rel="noopener">More about ${park.name} on the City's website</a></p>` : ''}
</article>`,
  };
}

const stars = (n) => `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`;

function ratingsSection({ park, user, csrf, summary, reviews, mine, problem }) {
  return html`<section aria-labelledby="ratings-h" id="ratings">
  <h2 id="ratings-h">Ratings</h2>
  <p class="rating-summary">${summary.count
    ? html`<span class="stars" aria-hidden="true">${stars(Math.round(summary.average))}</span>
      <strong>${summary.average.toFixed(1)}</strong> out of 5 · ${summary.count} ${summary.count === 1 ? 'rating' : 'ratings'}`
    : 'No ratings yet.'}</p>
  ${user ? html`<form method="post" action="/parks/${park.slug}/rating" class="card-form rating-form">
    ${csrfField(csrf)}
    ${areaProblem(problem, 'rating')}
    <fieldset class="star-picker">
      <legend>${mine ? 'Your rating' : 'Rate this park'}</legend>
      ${[1, 2, 3, 4, 5].map((n) => html`<label class="check"><input type="radio" name="stars" value="${n}"${mine?.stars === n ? html` checked` : ''} required> ${n} ${n === 1 ? 'star' : 'stars'}</label>`)}
    </fieldset>
    <div class="field">
      <label for="comment">Comment (optional)</label>
      <textarea id="comment" name="comment" maxlength="500" rows="3">${problem?.area === 'rating' ? problem.values?.comment : mine?.comment || ''}</textarea>
    </div>
    <div class="field">
      <label for="rating_visibility">Who can read your comment</label>
      ${visibilitySelect('rating_visibility', mine?.visibility || user.default_visibility)}
    </div>
    <button type="submit" class="btn btn-primary">${mine ? 'Update rating' : 'Save rating'}</button>
  </form>
  ${mine ? html`<form method="post" action="/parks/${park.slug}/rating/delete" class="inline-form">${csrfField(csrf)}
    <button type="submit" class="btn btn-quiet btn-small">Delete my rating</button></form>` : ''}` : ''}
  ${reviews.length ? html`<ul class="reviews">${reviews.map((r) => html`<li>
    <p><span class="stars" aria-label="${r.stars} out of 5">${stars(r.stars)}</span> <strong>${r.display_name}</strong>
      <span class="muted">${formatDate(localDate(new Date(r.updated_at)))}</span></p>
    ${r.comment_hidden ? html`<p class="moderated">Hidden by moderator</p>` : ''}
    <p class="review-text">${r.comment}</p>
  </li>`)}</ul>` : ''}
</section>`;
}

function photosSection({ park, user, csrf, photos, problem }) {
  const back = `/parks/${park.slug}#photos`;
  return html`<section aria-labelledby="photos-h" id="photos">
  <h2 id="photos-h">Photos</h2>
  ${photos.length ? html`<ul class="photo-grid">${photos.map((ph) => html`<li class="photo">
    <a href="/photos/${ph.id}/full"><img src="/photos/${ph.id}/thumb" alt="${ph.caption || `Photo of ${park.name} by ${ph.display_name}`}" width="400" height="400" loading="lazy"></a>
    <p class="photo-meta">${ph.caption ? html`${ph.caption}<br>` : ''}<span class="muted">by ${ph.display_name}</span></p>
    ${ph.hidden ? html`<p class="moderated">Hidden by moderator</p>` : ''}
    ${user && user.id === ph.user_id ? html`<details class="photo-edit"><summary>Edit</summary>
      <form method="post" action="/photos/${ph.id}">${csrfField(csrf)}<input type="hidden" name="back" value="${back}">
        <div class="field"><label for="cap-${ph.id}">Caption</label>
          <input type="text" id="cap-${ph.id}" name="caption" maxlength="200" value="${ph.caption}"></div>
        <div class="field"><label for="vis-${ph.id}">Who can see it</label>${visibilitySelect(`vis-${ph.id}`, ph.visibility)}</div>
        <button type="submit" class="btn btn-small">Save</button>
      </form>
      <form method="post" action="/photos/${ph.id}/delete">${csrfField(csrf)}<input type="hidden" name="back" value="${back}">
        <button type="submit" class="btn btn-quiet btn-small">Delete photo</button>
      </form></details>` : ''}
  </li>`)}</ul>` : html`<p>No photos yet.</p>`}
  ${user ? html`<form method="post" action="/parks/${park.slug}/photos" class="card-form" enctype="multipart/form-data">
    ${csrfField(csrf)}
    ${areaProblem(problem, 'photo')}
    <div class="field">
      <label for="photo">Add a photo</label>
      <p class="hint" id="photo-hint">JPEG, PNG or WebP, up to 10 MB. Location data in the file is removed.</p>
      <input type="file" id="photo" name="photo" accept="${ACCEPT}" required aria-describedby="photo-hint">
    </div>
    <div class="field">
      <label for="caption">Caption (optional)</label>
      <input type="text" id="caption" name="caption" maxlength="200" value="${problem?.area === 'photo' ? problem.values?.caption || '' : ''}">
    </div>
    <div class="field">
      <label for="photo_visibility">Who can see it</label>
      ${visibilitySelect('photo_visibility', user.default_visibility)}
    </div>
    <button type="submit" class="btn btn-primary">Upload photo</button>
  </form>` : ''}
</section>`;
}
