import { html } from '../html.js';
import { avatar } from '../avatar.js';
import { palsSentence } from '../pals-here.js';
import { csrfField } from '../forms.js';
import { categoryLabel } from '../../domain/categories.js';
import { motifForPark } from '../../domain/city.js';
import { METHOD_LABELS } from '../../domain/visits.js';
import { formatDate, localDate } from '../../domain/time.js';
import { VISIBILITY, VISIBILITY_LABELS } from '../../domain/visibility.js';
import { ICONS } from '../icons.js';
import { motifIcon } from '../motif.js';
import { nextLine } from '../nextup.js';
import { activitiesPanel } from '../activities.js';
import { cityPath, parkPath } from '../urls.js';
import { saveButton } from '../save-button.js';

// Confetti particles for the celebration: angles and distances, decorative only.
const BURST = [[0, 95], [30, 70], [60, 105], [95, 80], [125, 100], [160, 75], [195, 95], [225, 70], [260, 105], [290, 85], [320, 100], [345, 72]];
const burst = () => html`<span class="burst" aria-hidden="true">${BURST.map(([a, r], i) => html`<i style="--a:${a};--r:${r};--d:${(i % 4) * 40}ms"></i>`)}</span>`;

const ACCEPT = 'image/jpeg,image/png,image/webp';

const visibilitySelect = (id, current) => html`<select id="${id}" name="visibility">
  ${VISIBILITY.map((v) => html`<option value="${v}"${v === current ? html` selected` : ''}>${VISIBILITY_LABELS[v]}</option>`)}
</select>`;

// Errors get focus on load (announce.js), so they're seen and read even far down the page.
const areaProblem = (problem, area) => (problem && problem.area === area
  ? html`<p class="notice" role="alert" tabindex="-1" data-announce>${problem.text}</p>` : '');

const telHref = (phone) => `tel:${phone.replace(/[^\d+]/g, '')}`;

// Stamp result shown after a successful stamp (?stamped=<visit id>).
function stampResult(result, celebrate) {
  if (!result) return '';
  return html`<div class="stamp-result" role="status" tabindex="-1" data-announce>
  ${burst()}
  <p class="points-pop" aria-hidden="true">+<span class="count-up" data-count-to="${result.visit.points}">${result.visit.points}</span></p>
  <p class="stamp-mark" aria-hidden="true">${celebrate?.motif ? motifIcon(celebrate.motif) : ''}${result.visit.method === 'gps' ? 'GPS ✓' : 'Stamped'}</p>
  <div>
    <h2>Stamped! +${result.visit.points} points</h2>
    <ul class="points-breakdown">${result.parts.map((p) => html`<li>${p.reason}: +${p.points}</li>`)}</ul>
  </div>
  ${celebrate?.next ? nextLine(celebrate.next) : ''}
</div>`;
}

function stampPanel({ park, user, csrf, today, myVisits, problem: allProblems }) {
  const problem = allProblems?.area === 'stamp' ? allProblems : null;
  if (!user) {
    return html`<section class="stamp-panel" aria-labelledby="stamp-h">
  <h2 id="stamp-h">Stamp this park</h2>
  <p><a class="btn btn-primary" href="/login?next=${encodeURIComponent(parkPath(park))}">Log in to stamp this park</a></p>
</section>`;
  }
  const stampedToday = myVisits.some((v) => v.visited_on === today);
  const hasPin = park.lat != null;
  return html`<section class="stamp-panel" aria-labelledby="stamp-h">
  <h2 id="stamp-h">Stamp this park</h2>
  ${stampedToday ? '' : html`<p class="reward">${myVisits.length
    ? html`Repeat visit: <strong>+2 points</strong>, +5 more with GPS.`
    : html`First stamp here: <strong>+10 points</strong>, +5 more with GPS.`}</p>`}
  ${problem ? html`<p class="notice" role="alert" tabindex="-1" data-announce>${problem.text}</p>` : ''}
  ${stampedToday
    ? html`<p class="stamped-today">✓ Stamped today.</p>`
    : html`${hasPin ? html`<form method="post" action="${parkPath(park, '/checkin')}" id="checkin-form" hidden>
    ${csrfField(csrf)}
    <input type="hidden" name="lat"><input type="hidden" name="lng"><input type="hidden" name="accuracy">
    <button type="submit" class="btn btn-pop btn-big">${ICONS.stamp}Check in here</button>
    <p class="hint">Uses your location once to confirm you're at the park. Your exact location is never shown to anyone.</p>
  </form>
  <p id="checkin-status" class="notice" role="status" aria-live="polite"></p>` : ''}
  <details class="honor"${problem || !hasPin ? html` open` : ''} id="honor">
    <summary>${hasPin ? 'No GPS? Stamp on the honor system' : 'Stamp on the honor system'}</summary>
    <form method="post" action="${parkPath(park, '/stamp')}" class="honor-form" enctype="multipart/form-data">
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
        ${csrfField(csrf)}<input type="hidden" name="back" value="${parkPath(park)}">
        <button type="submit" class="btn btn-quiet btn-small" aria-label="Delete visit on ${formatDate(v.visited_on)}">Delete</button>
      </form>
    </li>`)}
  </ul>` : ''}
</section>`;
}

// A local nonprofit spotlight (SPEC Flow 18): small and clearly labelled. The link goes through
// /go/nonprofit/:id so clicks are counted per park (counts only).
const SPOTLIGHT_REASONS = { steward: 'Cares for this park', one_percent: '1% for the Planet partner', local: 'Local nonprofit' };
function spotlightCard(n, park) {
  const logo = /^upload:([a-f0-9]{24})$/.exec(String(n.logo || ''));
  return html`<aside class="spotlight" aria-labelledby="spotlight-h">
  <p class="spotlight-label">Local nonprofit${n.reason === 'local' ? '' : ` · ${SPOTLIGHT_REASONS[n.reason]}`}</p>
  <div class="spotlight-body">
    ${logo ? html`<img class="spotlight-logo" src="/badge-art/${logo[1]}.png" alt="" width="56" height="56" loading="lazy">` : ''}
    <div><h2 id="spotlight-h">${n.name}</h2><p>${n.mission}</p>
    <p><a href="/go/nonprofit/${n.id}?park=${park.id}" rel="noopener sponsored">Learn more<span class="visually-hidden"> about ${n.name}</span></a></p></div>
  </div>
  <p class="spotlight-suggest"><a href="/nonprofits/suggest?city=${park.city_key}">Know a nonprofit that cares for this park?</a></p>
</aside>`;
}

export function parkPage({ park, user = null, csrf = '', today = '', myVisits = [], problem = null, stamped = null,
  photos = [], summary = { count: 0, average: null }, reviews = [], mine = null, flash = null, theme = { motifs: [], areas: [] }, area = null, palsHere = [],
  celebrate = null, activities = null, saved = false, spotlight = null }) {
  const hasPin = park.lat != null && park.lng != null;
  const scripts = [];
  if (hasPin) scripts.push('/js/park-map.js');
  if (user && hasPin) scripts.push('/js/checkin.js');
  if (user) scripts.push('/js/upload-check.js', '/js/want-to-go.js');
  if (stamped) scripts.push('/js/celebrate.js');
  return {
    title: park.name,
    description: `Visit ${park.name}${park.address ? ` (${park.address})` : ''} and stamp it in your Parks Passport. Map, photos, ratings and badges for ${theme.copy?.short || 'local'} parks.`,
    current: 'parks',
    offerShare: Boolean(stamped),
    head: hasPin ? html`<link rel="stylesheet" href="/vendor/leaflet/leaflet.css"><link rel="preconnect" href="https://tile.openstreetmap.org">` : null,
    scripts,
    body: html`
<p class="breadcrumb"><a href="${cityPath(theme, '/parks')}">All parks</a></p>
<article class="park">
  <header class="park-header">
    ${motifForPark(theme, park.slug) ? html`<span class="park-motif">${motifIcon(motifForPark(theme, park.slug))}</span>` : ''}
    ${area ? html`<p class="eyebrow">${area.name}</p>` : ''}
    <h1>${park.name}</h1>
    ${park.address ? html`<p class="address">${park.address}</p>` : ''}
    ${park.phone ? html`<p><a href="${telHref(park.phone)}">${park.phone}</a></p>` : ''}
    <div class="park-pills">
      ${user ? (myVisits.length
        ? html`<span class="pill pill-stamped">✓ Stamped ${myVisits.length === 1 ? 'once' : `${myVisits.length} times`}</span>`
        : html`<span class="pill pill-points">New for you · +10 pts</span>`) : ''}
      ${user ? saveButton({ park, saved, csrf, back: parkPath(park), label: true }) : ''}
      ${user ? html`<a class="pill pill-sunshine" href="/sunshine?city=${park.city_key}&amp;park=${encodeURIComponent(park.slug)}"><span aria-hidden="true">☀️</span> Say thanks</a>` : ''}
      ${summary.count ? html`<span class="pill"><span class="stars" aria-hidden="true">★</span> ${summary.average.toFixed(1)}<span class="visually-hidden"> out of 5 average rating</span></span>` : ''}
    </div>
  </header>
  ${palsHere.length ? html`<section class="card pals-here" aria-labelledby="palshere-h">
    <h2 id="palshere-h" class="visually-hidden">Your pals were here</h2>
    <p><strong>${palsSentence(palsHere)}.</strong></p>
    <ul>${palsHere.slice(0, 8).map((p) => html`<li>${avatar(p, { size: 32 })} <a href="/u/${p.handle}">${p.display_name}</a> <span class="muted">${formatDate(p.last_on)}</span></li>`)}</ul>
  </section>` : ''}

  ${flash ? html`<p class="notice" role="status">${flash}</p>` : ''}
  <div class="park-layout">
  <div class="park-aside">
  ${stampResult(stamped, celebrate)}
  ${stampPanel({ park, user, csrf, today, myVisits, problem })}
  ${activitiesPanel({ park, csrf, activities, problem })}
  </div>
  <div class="park-main">

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
      ? html`<ul class="chips">${park.categories.map((c) => html`<li><a href="${cityPath(theme, '/parks')}?cat=${c}">${categoryLabel(c)}</a></li>`)}</ul>`
      : html`<p>The City doesn't list amenities for this park.</p>`}
  </section>

  ${ratingsSection({ park, user, csrf, summary, reviews, mine, problem })}
  ${photosSection({ park, user, csrf, photos, problem })}

  ${spotlight ? spotlightCard(spotlight, park)
    : html`<p class="spotlight-suggest"><a href="/nonprofits/suggest?city=${park.city_key}">Know a nonprofit that cares for this park?</a></p>`}

  ${park.city_url ? html`<p><a href="${park.city_url}" rel="noopener">More about ${park.name} on the City's website</a></p>` : ''}
  </div>
  </div>
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
  ${user ? html`<form method="post" action="${parkPath(park, '/rating')}" class="card-form rating-form">
    ${csrfField(csrf)}
    ${areaProblem(problem, 'rating')}
    <fieldset class="star-picker">
      <legend>${mine ? 'Your rating' : 'Rate this park'}</legend>
      ${[1, 2, 3, 4, 5].map((n) => html`<label class="star"><input type="radio" name="stars" value="${n}"${mine?.stars === n ? html` checked` : ''} required><span class="star-glyph" aria-hidden="true"></span><span class="visually-hidden">${n} ${n === 1 ? 'star' : 'stars'}</span></label>`)}
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
  ${mine ? html`<form method="post" action="${parkPath(park, '/rating/delete')}" class="inline-form">${csrfField(csrf)}
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
  const back = parkPath(park, '#photos');
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
  ${user ? html`<form method="post" action="${parkPath(park, '/photos')}" class="card-form" enctype="multipart/form-data">
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
      ${visibilitySelect('photo_visibility', user.kids ? 'private' : user.default_visibility)}
      ${user.kids ? html`<p class="hint">Kids edition is on, so new photos start as "Only me". Share each one only if you're happy to.</p>` : ''}
    </div>
    <button type="submit" class="btn btn-primary">Upload photo</button>
  </form>` : ''}
</section>`;
}
