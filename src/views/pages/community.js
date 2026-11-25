import { html } from '../html.js';
import { csrfField } from '../forms.js';
import { ICONS } from '../icons.js';
import { feedbackFields } from '../layout.js';
import { KINDS } from '../../domain/feedback.js';
import { formatDate, localDate } from '../../domain/time.js';
import { STATUSES as SUNSHINE_STATUSES, DEPARTMENT, MAX_LENGTH as SUNSHINE_MAX } from '../../domain/sunshine.js';
import { REASONS, STATUSES as NP_STATUSES } from '../../domain/nonprofits.js';
import { errorSummary } from '../forms.js';

const dateOf = (iso) => formatDate(localDate(new Date(iso)));
const crumb = html`<p class="breadcrumb"><a href="/admin">Admin</a></p>`;

// ---------- Feedback (SPEC Flow 16) ----------

export function feedbackPage({ csrf, page = '', sent = false, reply = null, error = null, values = {} }) {
  return {
    title: 'Feedback',
    current: 'feedback',
    body: html`<div class="narrow feedback-page">
<p class="feedback-eyebrow">${ICONS.sparkle} Founding explorer</p>
${sent
    ? html`<p class="feedback-heart" aria-hidden="true">💛</p><h1>Thank you. We read every one.</h1>
  ${reply ? html`<div class="gary-chat is-page"><p class="gary-msg is-gary"><span class="gary-name">Gary</span> ${reply}</p></div>` : ''}
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

// ---------- Nonprofit spotlights (SPEC Flow 18) ----------

const field = (name, label, value, { error, hint, type = 'text', max, required = true } = {}) => html`<div class="field${error ? ' field-error' : ''}">
  <label for="${name}">${label}</label>
  ${hint ? html`<p class="hint" id="${name}-hint">${hint}</p>` : ''}
  ${error ? html`<p class="error-text" id="${name}-error">${error}</p>` : ''}
  <input id="${name}" name="${name}" type="${type}" value="${value ?? ''}"${max ? html` maxlength="${max}"` : ''}${required ? html` required` : ''}${hint || error ? html` aria-describedby="${[hint ? `${name}-hint` : '', error ? `${name}-error` : ''].filter(Boolean).join(' ')}"` : ''}${error ? html` aria-invalid="true"` : ''}>
</div>`;

const reasonField = (value, error) => html`<fieldset class="radio-group${error ? ' field-error' : ''}" id="reason">
  <legend>Why it belongs here</legend>
  ${error ? html`<p class="error-text">${error}</p>` : ''}
  ${Object.entries(REASONS).map(([k, label]) => html`<label class="check"><input type="radio" name="reason" value="${k}"${value === k ? html` checked` : ''}> ${k === 'steward' ? 'It cares for a park or waterway here' : label}</label>`)}
</fieldset>`;

export function suggestNonprofitPage({ csrf, city, sent = false, errors = {}, values = {} }) {
  const where = city.copy?.short || city.name;
  return {
    title: 'Suggest a nonprofit',
    body: html`<div class="narrow">
<h1>Suggest a local nonprofit</h1>
${sent ? html`<p class="notice" role="status" tabindex="-1" data-announce>Thank you! We'll take a look. If it's a fit, it will show on the parks it cares for.</p>
<p><a href="/">Back to Parks Passport</a></p>` : html`<p>Park pages in ${where} can spotlight a nonprofit that looks after the park or its waterways, or gives back to the planet. Tell us about one; our team reviews every suggestion.</p>
${errorSummary(errors, { name: 'Name', url: 'Website', mission: 'What it does', serves: 'Parks or waterways', reason: 'Why it belongs here' })}
<form method="post" action="/nonprofits/suggest" class="card-form" novalidate>
  ${csrfField(csrf)}
  ${field('name', 'Nonprofit name', values.name, { error: errors.name, max: 80 })}
  ${field('url', 'Website', values.url, { error: errors.url, type: 'url', hint: 'Starting with https://' })}
  ${field('mission', 'What it does, in one sentence', values.mission, { error: errors.mission, max: 160 })}
  ${field('serves', `Which parks or waterways in ${where} it looks after`, values.serves, { error: errors.serves, max: 300 })}
  ${reasonField(values.reason, errors.reason)}
  <button type="submit" class="btn btn-primary">Send suggestion</button>
</form>`}
</div>`,
  };
}

export function adminNonprofitsPage({ items, counts, status }) {
  return {
    title: 'Admin · Nonprofits',
    current: 'admin',
    body: html`${crumb}<h1>Nonprofit spotlights</h1>
<p>One small card per park page. Spotlights with parks chosen show on those parks; without, on every park in their city. Views and clicks are counted per park (counts only).</p>
<p><a class="btn btn-primary" href="/admin/nonprofits/new">Add a nonprofit</a></p>
<nav class="tabs" aria-label="Filter nonprofits"><a href="/admin/nonprofits"${status ? '' : html` aria-current="page"`}>All</a>${Object.entries(NP_STATUSES).map(([s, label]) => html`<a href="/admin/nonprofits?status=${s}"${s === status ? html` aria-current="page"` : ''}>${label} (${counts[s] || 0})</a>`)}</nav>
${items.length ? html`<div class="table-wrap"><table class="admin-table">
  <caption class="visually-hidden">Nonprofits</caption>
  <thead><tr><th scope="col">Nonprofit</th><th scope="col">Shows on</th><th scope="col">Views · clicks (30 days)</th><th scope="col">Top parks</th></tr></thead>
  <tbody>${items.map((n) => html`<tr>
    <td data-label="Nonprofit"><a href="/admin/nonprofits/${n.id}">${n.name}</a> <span class="flag">${NP_STATUSES[n.status]}</span><br><span class="muted">${REASONS[n.reason]}${n.suggester ? ` · suggested by ${n.suggester}` : ''}</span></td>
    <td data-label="Shows on">${n.park_count ? `${n.park_count} park${n.park_count === 1 ? '' : 's'}` : 'Every park'} in ${n.city_name}</td>
    <td data-label="Views · clicks">${n.views_30} · ${n.clicks_30}<br><span class="muted">All time: ${n.views} · ${n.clicks}</span></td>
    <td data-label="Top parks">${n.topParks.length ? html`<ul class="plain-list">${n.topParks.map((p) => html`<li>${p.name} <span class="muted">(${p.views} · ${p.clicks})</span></li>`)}</ul>` : html`<span class="muted">No views yet</span>`}</td>
  </tr>`)}</tbody>
</table></div>` : html`<p>None yet.</p>`}`,
  };
}

export function adminNonprofitForm({ csrf, cities, parksByCity, nonprofit = null, isNew = false, values = null, errors = {}, notice = null }) {
  const n = values ? { ...nonprofit, ...values, parks: [].concat(values.parks || []).map(Number) } : nonprofit || { status: 'active', reason: 'steward', city_id: cities[0]?.id, parks: [] };
  const logo = /^upload:([a-f0-9]{24})$/.exec(String(nonprofit?.logo || ''));
  return {
    title: `Admin · ${isNew ? 'Add a nonprofit' : n.name}`,
    current: 'admin',
    body: html`<p class="breadcrumb"><a href="/admin">Admin</a> › <a href="/admin/nonprofits">Nonprofits</a></p>
<h1>${isNew ? 'Add a nonprofit' : `Edit ${nonprofit.name}`}</h1>
${notice ? html`<p class="notice" role="status" tabindex="-1" data-announce>${notice}</p>` : ''}
${errorSummary(errors)}
${!isNew && nonprofit.serves ? html`<p class="notice">Suggested for: ${nonprofit.serves}</p>` : ''}
<form method="post" action="${isNew ? '/admin/nonprofits/new' : `/admin/nonprofits/${nonprofit.id}`}" class="card-form admin-form" enctype="multipart/form-data" novalidate>
  ${csrfField(csrf)}
  ${field('name', 'Name', n.name, { error: errors.name, max: 80 })}
  ${field('url', 'Website (https://)', n.url, { error: errors.url, type: 'url' })}
  ${field('mission', 'Mission line (one sentence)', n.mission, { error: errors.mission, max: 160 })}
  ${reasonField(n.reason, errors.reason)}
  <div class="field${errors.logo_file ? ' field-error' : ''}">
    ${logo ? html`<p>Current logo: <img src="/badge-art/${logo[1]}.png" alt="" width="40" height="40"> <label class="check"><input type="checkbox" name="remove_logo" value="1"> Remove</label></p>` : ''}
    <label for="logo_file">Logo (optional; SVG or PNG under 512 KB)</label>
    ${errors.logo_file ? html`<p class="error-text">${errors.logo_file}</p>` : ''}
    <input type="file" id="logo_file" name="logo_file" accept=".svg,.png,image/svg+xml,image/png">
  </div>
  <div class="field${errors.city_id ? ' field-error' : ''}">
    <label for="city_id">City</label>
    <select id="city_id" name="city_id">${cities.map((c) => html`<option value="${c.id}"${Number(n.city_id) === c.id ? html` selected` : ''}>${c.name}</option>`)}</select>
  </div>
  <fieldset class="radio-group${errors.parks ? ' field-error' : ''}" id="parks">
    <legend>Show on these parks</legend>
    <p class="hint">Tick none to show it on every park in its city. Only parks in the chosen city count.</p>
    ${errors.parks ? html`<p class="error-text">${errors.parks}</p>` : ''}
    ${cities.map((c) => html`<details${Number(n.city_id) === c.id ? html` open` : ''}><summary>${c.name}</summary><div class="filter-grid">
      ${(parksByCity[c.id] || []).map((p) => html`<label class="check"><input type="checkbox" name="parks" value="${p.id}"${(n.parks || []).includes(p.id) ? html` checked` : ''}> ${p.name}</label>`)}
    </div></details>`)}
  </fieldset>
  <fieldset class="radio-group"><legend>Status</legend>
    ${Object.entries(NP_STATUSES).map(([s, label]) => html`<label class="check"><input type="radio" name="status" value="${s}"${n.status === s ? html` checked` : ''}> ${label}${s === 'active' ? ' (shown on park pages)' : ''}</label>`)}
  </fieldset>
  <button type="submit" class="btn btn-primary">${isNew ? 'Add nonprofit' : 'Save'}</button>
</form>
${isNew ? '' : html`<form method="post" action="/admin/nonprofits/${nonprofit.id}/delete" class="inline-form">${csrfField(csrf)}
  <button type="submit" class="btn btn-quiet">Delete this nonprofit and its counts</button></form>`}`,
  };
}

// ---------- Our mission (SPEC Flow 19): a draft for review, in Admin for now ----------

const CYCLE = [
  ['Healthy people', 'Getting outside, moving and noticing the places around us. Stamps, activities and streaks make the habit easy and fun.'],
  ['Healthy communities', 'Exploring with Park Pals, families and groups, so parks become places where neighbors meet.'],
  ['Healthy public life', 'Gratitude flows back to the people who run our parks (Drops of Sunshine), and real use of real parks helps cities decide where care and money go.'],
  ['Meaningful giving', 'The most-visited park pages point people to the nonprofits that care for those parks and waterways, and Big Sea gives through 1% for the Planet.'],
];

export function adminMissionPage() {
  const r = 120; const cx = 160; const cy = 160;
  const nodes = CYCLE.map(([label], i) => {
    const a = (-90 + i * 90) * (Math.PI / 180);
    return { label, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
  return {
    title: 'Admin · Our mission',
    current: 'admin',
    body: html`${crumb}<article class="mission narrow">
<p class="notice">Draft for review. Only admins can see this page; it can become a public page later.</p>
<p class="mission-eyebrow">Our mission</p>
<h1>Healthy people, healthy places, and a cycle of care</h1>
<p class="mission-lead">Parks Passport helps people get outside, look after the places they love, and look after each other. Every stamp is a small act of care: for your own health, for your neighbors, and for the land we share.</p>

<h2>The cycle we're building</h2>
<div class="mission-cycle">
  <svg viewBox="0 0 320 320" aria-hidden="true" class="mission-ring">
    <circle cx="${cx}" cy="${cy}" r="${r}" />
    ${nodes.map((n, i) => html`<g class="mission-node mission-node-${i}"><circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="34"/>
      <text x="${n.x.toFixed(1)}" y="${(n.y + 5).toFixed(1)}" text-anchor="middle">${i + 1}</text></g>`)}
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="mission-center">Shared</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="mission-center">stewardship</text>
  </svg>
  <ol class="mission-steps">${CYCLE.map(([label, text]) => html`<li><strong>${label}.</strong> ${text}</li>`)}</ol>
</div>
<p>Each turn of the cycle feeds the next. Healthy people build healthy communities. Healthy communities ask more of, and give more to, their public institutions. Healthy public life makes room for meaningful giving. And giving, in time, money and attention, makes it easier for the next person to be healthy. We call that <strong>shared stewardship</strong>: of ourselves, our governments, our neighbors, our land, and the businesses, for-profit and nonprofit, that serve them.</p>

<h2>Inside the doughnut</h2>
<p>We borrow a frame from <strong>doughnut economics</strong>: the goal isn't endless growth, it's a safe and just space between a social foundation (what everyone needs to live well) and an ecological ceiling (what the planet can sustain). Parks sit right in that space. They're shared, they're close to home, and they cost the planet very little to enjoy.</p>
<p>So Parks Passport is built to be <em>enough</em>, not more:</p>
<ul>
  <li><strong>Health over screen time.</strong> The app's job is to get you out the door and then out of the way.</li>
  <li><strong>Private by default.</strong> Your location and photos are yours. We never sell data, and nothing about you is shared without your choice.</li>
  <li><strong>Gratitude over grievance.</strong> We make it easy to thank park crews, because appreciation keeps good people doing good work.</li>
  <li><strong>Local and accountable.</strong> Spotlights go only to nonprofits that care for our parks and waterways, or give back to the planet, and every one is reviewed by a person.</li>
  <li><strong>Light on the planet.</strong> A small app on a small server, made by a Certified B Corporation that's a member of 1% for the Planet.</li>
</ul>

<h2>How we'll know it's working</h2>
<p>More people visiting more parks, more often. More notes of thanks reaching the people who keep parks beautiful. More neighbors finding and supporting the nonprofits that care for those parks. And cities with a clearer picture of how their parks are loved.</p>
</article>`,
  };
}
