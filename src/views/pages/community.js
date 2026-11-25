import { html } from '../html.js';
import { csrfField } from '../forms.js';
import { ICONS } from '../icons.js';
import { feedbackFields } from '../layout.js';
import { KINDS } from '../../domain/feedback.js';
import { formatDate, localDate } from '../../domain/time.js';
import { STATUSES as SUNSHINE_STATUSES, DEPARTMENT, MAX_LENGTH as SUNSHINE_MAX } from '../../domain/sunshine.js';

const dateOf = (iso) => formatDate(localDate(new Date(iso)));
const crumb = html`<p class="breadcrumb"><a href="/admin">Admin</a></p>`;

// ---------- Feedback (SPEC Flow 16) ----------

export function feedbackPage({ csrf, page = '', sent = false, error = null, values = {} }) {
  return {
    title: 'Feedback',
    current: 'feedback',
    body: html`<div class="narrow feedback-page">
<p class="feedback-eyebrow">${ICONS.sparkle} Founding explorer</p>
${sent
    ? html`<p class="feedback-heart" aria-hidden="true">💛</p><h1>Thank you. We read every one.</h1>
  <p><a href="/">Back to Parks Passport</a></p>`
    : html`<h1>You're one of our first explorers. Tell us anything.</h1>
  <p>Ideas, bugs, things you love: it all shapes what we build next.</p>
  <form method="post" action="/feedback" class="card-form feedback-form" novalidate>
    ${csrfField(csrf)}<input type="hidden" name="page" value="${page}">
    ${error ? html`<p class="error-text" role="alert" tabindex="-1" data-announce>${error}</p>` : ''}
    ${feedbackFields({ kind: values.kind, text: values.text, idPrefix: 'fbp' })}
    <button type="submit" class="btn btn-primary">Send</button>
  </form>`}
</div>`,
  };
}

export function adminFeedbackPage({ csrf, items, done }) {
  return {
    title: 'Admin · Feedback',
    current: 'admin',
    body: html`${crumb}<h1>Feedback</h1>
<p>From Founding Members and Early Bird Edition holders.</p>
<nav class="tabs" aria-label="Filter feedback"><a href="/admin/feedback"${done ? '' : html` aria-current="page"`}>Open</a><a href="/admin/feedback?show=done"${done ? html` aria-current="page"` : ''}>Done</a></nav>
${items.length ? html`<ul class="idea-list">${items.map((f) => html`<li class="idea-card">
  <p class="idea-line"><strong>${KINDS[f.kind]}</strong>: ${f.text}</p>
  <p class="muted">${f.display_name} (@${f.handle}) · ${dateOf(f.created_at)}${f.page ? html` · on <a href="${f.page}">${f.page}</a>` : ''}</p>
  <form method="post" action="/admin/feedback/${f.id}">${csrfField(csrf)}<input type="hidden" name="done" value="${done ? '0' : '1'}">
    <button type="submit" class="btn btn-small">${done ? 'Reopen' : 'Mark done'}<span class="visually-hidden"> feedback ${f.id}</span></button></form>
</li>`)}</ul>` : html`<p>${done ? 'Nothing marked done yet.' : 'No open feedback. 🎉'}</p>`}`,
  };
}

// ---------- Drops of Sunshine (SPEC Flow 17) ----------

// The sun: rays and drops of light around a smiling sun. Decorative (the heading says it all).
const SUN = html`<div class="sunshine-burst" aria-hidden="true"><svg viewBox="0 0 200 200">
  <g class="sun-rays">${Array.from({ length: 12 }, (_, i) => html`<line x1="100" y1="28" x2="100" y2="8" transform="rotate(${i * 30} 100 100)"/>`)}</g>
  <circle class="sun-core" cx="100" cy="100" r="46"/>
  <path class="sun-smile" d="M80 108c8 12 32 12 40 0"/><circle class="sun-eye" cx="85" cy="92" r="4"/><circle class="sun-eye" cx="115" cy="92" r="4"/>
</svg>${Array.from({ length: 10 }, (_, i) => html`<span class="sun-drop" style="--d:${i}"></span>`)}</div>`;

export function sunshinePage({ csrf, city, parks, chosen, fromParkPage = false, sent = false, sentTo = '', error = null, values = {} }) {
  const selected = values.park ?? (chosen ? chosen.slug : DEPARTMENT);
  const selectedName = selected === DEPARTMENT ? `the ${city.copy?.short || city.name} parks department` : (parks.find((p) => p.slug === selected)?.name || 'the parks department');
  // Pins for the browser's nearest-park choice. Public park data only.
  const pins = fromParkPage ? [] : parks.filter((p) => p.lat != null).map((p) => ({ slug: p.slug, lat: p.lat, lng: p.lng }));
  return {
    title: 'Drops of Sunshine',
    current: 'sunshine',
    scripts: sent ? [] : ['/js/sunshine.js'],
    body: html`<div class="narrow sunshine">
${sent ? html`${SUN}
<h1 tabindex="-1" data-announce>Your drop of sunshine is on its way.</h1>
<p>Thank you for thanking ${sentTo || `the people who look after ${city.copy?.short || city.name}'s parks`}. Notes like yours remind park crews why the work matters.</p>
<p class="sunshine-again"><a class="btn" href="/sunshine">Send another</a> <a class="btn btn-quiet" href="/">Done</a></p>`
    : html`<p class="sunshine-eyebrow"><span aria-hidden="true">☀️</span> Drops of Sunshine</p>
<h1>Thank the people who look after your parks</h1>
<form method="post" action="/sunshine" class="card-form sunshine-form" novalidate data-pins="${JSON.stringify(pins)}">
  ${csrfField(csrf)}
  ${error ? html`<p class="error-text" role="alert" tabindex="-1" data-announce>${error}</p>` : ''}
  <p class="sunshine-to">To: <strong data-sunshine-to>${selectedName}</strong></p>
  <label for="sunshine-text" class="visually-hidden">Your note</label>
  <textarea id="sunshine-text" name="text" rows="4" maxlength="${SUNSHINE_MAX}" required placeholder="Thank you for keeping the trails so clean!">${values.text || ''}</textarea>
  <details class="sunshine-change"${error && /park/i.test(error) ? html` open` : ''}>
    <summary>Change who it's for</summary>
    <label for="sunshine-park">Send it to</label>
    <select id="sunshine-park" name="park">
      <option value="${DEPARTMENT}"${selected === DEPARTMENT ? html` selected` : ''}>The whole parks department</option>
      ${parks.map((p) => html`<option value="${p.slug}"${p.slug === selected ? html` selected` : ''}>${p.name}</option>`)}
    </select>
    ${pins.length ? html`<button type="button" class="btn btn-quiet btn-small js-only" data-sunshine-locate hidden>Use the park I'm at</button>
    <p class="hint" data-sunshine-status role="status"></p>` : ''}
  </details>
  <button type="submit" class="btn btn-primary sunshine-send"><span aria-hidden="true">☀️</span> Send a drop of sunshine</button>
</form>
<p class="hint">Notes are read by our team before they're shared with the parks department. Your location never leaves your phone.</p>`}
</div>`,
  };
}

export function adminSunshinePage({ csrf, notes, counts, status, cities, city }) {
  const q = (s, c = city?.key) => `/admin/sunshine?status=${s}${c ? `&city=${c}` : ''}`;
  return {
    title: 'Admin · Drops of Sunshine',
    current: 'admin',
    body: html`${crumb}<h1>Drops of Sunshine</h1>
<p>Thank-you notes for park crews. Approve the ones to share with the parks department; hide anything that doesn't belong. Nothing is sent to a city yet.</p>
<nav class="tabs" aria-label="Filter by status">${Object.entries(SUNSHINE_STATUSES).map(([s, label]) => html`<a href="${q(s)}"${s === status ? html` aria-current="page"` : ''}>${label} (${counts[s] || 0})</a>`)}</nav>
<nav class="tabs" aria-label="Filter by city"><a href="${q(status, '')}"${city ? '' : html` aria-current="page"`}>All cities</a>${cities.map((c) => html`<a href="${q(status, c.key)}"${c.key === city?.key ? html` aria-current="page"` : ''}>${c.copy?.short || c.name}</a>`)}</nav>
${notes.length ? html`<ul class="idea-list">${notes.map((n) => html`<li class="idea-card">
  <p class="idea-line"><span aria-hidden="true">☀️</span> ${n.text}</p>
  <p class="muted">To ${n.park_name || 'the parks department'} · ${n.city_name} · ${n.display_name} (@${n.handle}) · ${dateOf(n.created_at)}</p>
  <div class="idea-actions">${Object.keys(SUNSHINE_STATUSES).filter((s) => s !== n.status && s !== 'new').map((s) => html`<form method="post" action="/admin/sunshine/${n.id}">
    ${csrfField(csrf)}<input type="hidden" name="status" value="${s}"><input type="hidden" name="back" value="${status}">
    <button type="submit" class="btn btn-small${s === 'approved' ? ' btn-primary' : ''}">${s === 'approved' ? 'Approve' : 'Hide'}<span class="visually-hidden"> note ${n.id}</span></button></form>`)}</div>
</li>`)}</ul>` : html`<p>No notes here.</p>`}`,
  };
}
