import { html } from '../html.js';
import { MILESTONES } from '../../domain/milestones.js';
import { csrfField, errorSummary } from '../forms.js';
import { CATEGORIES, categoryLabel } from '../../domain/categories.js';
import { RULES } from '../../domain/badges/rules.js';
import { formatDate, localDate } from '../../domain/time.js';
import { badgeArt } from '../badge-art.js';
import { raw } from '../html.js';
import { sanitizeSvg } from '../../lib/svg-sanitize.js';
import { parkPath } from '../urls.js';

// "Early Bird Edition (limited: 93 of 100 left)" in the badge pickers.
const badgeOption = (b) => `${b.name}${b.limited_count ? ` (limited: ${Math.max(0, b.limited_count - b.serials_given)} of ${b.limited_count} left)` : b.rule_type === 'manual' ? ' (given only)' : ''}${b.enabled ? '' : ' (disabled)'}`;
const serialText = (b) => (b.serial ? ` · #${b.serial}${b.limited_count ? ` of ${b.limited_count}` : ''}` : '');

const page = (title, body, extra = {}) => ({ title: `Admin · ${title}`, current: 'admin', ...extra, body });
const crumb = html`<p class="breadcrumb"><a href="/admin">Admin</a></p>`;
const dateOf = (iso) => formatDate(localDate(new Date(iso)));

// Forms post back the city they were shown for (?city=), so a city switch in another tab can't
// send a save to a different city.
const cityQ = (bar) => (bar ? `?city=${bar.city.key}` : '');

// Parks, import and the city theme work on one city at a time; this switches it.
function cityBarBlock(bar) {
  if (!bar) return '';
  const { city, cities, csrf, back } = bar;
  return html`<form method="post" action="/admin/city/use" class="city-bar inline-form">
  ${csrfField(csrf)}<input type="hidden" name="back" value="${back}">
  <label for="admin-city">City</label>
  <select id="admin-city" name="city">${cities.map((c) => html`<option value="${c.key}"${c.key === city.key ? html` selected` : ''}>${c.name}</option>`)}</select>
  <button type="submit" class="btn btn-small">Switch</button>
</form>`;
}
const input = (name, label, value, { type = 'text', hint, error, required = false, attrs = '' } = {}) => html`<div class="field${error ? ' field-error' : ''}">
  <label for="${name}">${label}</label>
  ${hint ? html`<p class="hint" id="${name}-hint">${hint}</p>` : ''}
  ${error ? html`<p class="error-text" id="${name}-error">${error}</p>` : ''}
  <input id="${name}" name="${name}" type="${type}" value="${value ?? ''}"${required ? html` required` : ''}${hint || error ? html` aria-describedby="${[hint ? `${name}-hint` : '', error ? `${name}-error` : ''].filter(Boolean).join(' ')}"` : ''}${error ? html` aria-invalid="true"` : ''} ${attrs}>
</div>`;

export function adminHome({ counts }) {
  return page('Dashboard', html`<h1>Admin</h1>
<ul class="admin-cards">
  <li><a href="/admin/stats"><strong>Stats</strong><span>${counts.checkins7 ?? 0} check-ins this week · ${counts.users} members</span></a></li>
  <li><a href="/admin/parks"><strong>Parks</strong><span>${counts.active} active · ${counts.inactive} inactive</span></a></li>
  <li><a href="/admin/parks?filter=needs_pin"><strong>Pins to check</strong><span>${counts.needsPin} parks</span></a></li>
  <li><a href="/admin/import"><strong>Import parks</strong><span>CSV upload or seed file</span></a></li>
  <li><a href="/admin/badges"><strong>Badges</strong><span>${counts.badges} badges</span></a></li>
  <li><a href="/admin/mission"><strong>Our mission</strong><span>Draft for review</span></a></li>
  <li><a href="/admin/nonprofits"><strong>Nonprofits</strong><span>${counts.nonprofitsActive ?? 0} active · ${counts.nonprofitsSuggested ?? 0} suggested</span></a></li>
  <li><a href="/admin/sunshine"><strong>Drops of Sunshine</strong><span>${counts.newSunshine ?? 0} new thank-you notes</span></a></li>
  <li><a href="/admin/gary"><strong>Gary’s outfits</strong><span>Review outfit drafts and unlocks</span></a></li>
  <li><a href="/admin/messages"><strong>Messages</strong><span>${counts.liveMessages ?? 0} live · notes, greetings and giveaways</span></a></li>
  <li><a href="/admin/feedback"><strong>Feedback</strong><span>${counts.openFeedback ?? 0} open · from founding explorers</span></a></li>
  <li><a href="/admin/ideas"><strong>Badge ideas</strong><span>${counts.newIdeas ?? 0} new · share with contributors</span></a></li>
  <li><a href="/admin/activities"><strong>Activities</strong><span>Healthy things to do at parks</span></a></li>
  <li><a href="/admin/moderation"><strong>Moderation</strong><span>${counts.shared} shared photos and reviews</span></a></li>
  <li><a href="/admin/users"><strong>Members</strong><span>${counts.users} members · ${counts.admins} admins</span></a></li>
  <li><a href="/admin/email"><strong>Email</strong><span>Sender, subject lines, SendGrid key</span></a></li>
  <li><a href="/admin/city"><strong>City theme</strong><span>Landmark icons, history and colors</span></a></li>
</ul>`);
}

export function adminParks({ parks, filter, cityBar = null }) {
  const tabs = [['', 'All'], ['needs_pin', 'Pins to check'], ['inactive', 'Inactive']];
  return page('Parks', html`${crumb}<h1>${cityBar ? `${cityBar.city.copy.short} parks` : 'Parks'}</h1>
${cityBarBlock(cityBar)}
<p><a class="btn btn-primary" href="/admin/parks/new">Add a park</a></p>
<nav class="tabs" aria-label="Filter parks">${tabs.map(([f, label]) => html`<a href="/admin/parks${f ? `?filter=${f}` : ''}"${f === filter ? html` aria-current="page"` : ''}>${label}</a>`)}</nav>
<div class="table-wrap"><table class="admin-table">
  <caption class="visually-hidden">Parks</caption>
  <thead><tr><th scope="col">Park</th><th scope="col">Status</th><th scope="col">Visits</th></tr></thead>
  <tbody>${parks.map((p) => html`<tr>
    <td data-label="Park"><a href="/admin/parks/${p.id}">${p.name}</a><br><span class="muted">${p.slug}</span></td>
    <td data-label="Status">${p.active ? 'Active' : html`<strong>Inactive</strong>`}${p.needs_pin ? html`<br><span class="flag">Pin to check</span>` : ''}${p.lat == null ? html`<br><span class="flag">No location</span>` : ''}</td>
    <td data-label="Visits">${p.visit_count}</td>
  </tr>`)}</tbody>
</table></div>
${parks.length ? '' : html`<p>No parks here.</p>`}`);
}

export function adminParkForm({ park, csrf, isNew, error, notice, cityBar = null, center = null }) {
  const p = park || { checkin_radius_m: 150, active: 1, categories: [] };
  const action = isNew ? `/admin/parks/new${cityQ(cityBar)}` : `/admin/parks/${p.id}`;
  const mapCenter = center || cityBar?.city.center;
  return page(isNew ? 'Add a park' : p.name, html`<p class="breadcrumb"><a href="/admin">Admin</a> › <a href="/admin/parks">Parks</a></p>
<h1>${isNew ? `Add a park${cityBar ? ` in ${cityBar.city.copy.short}` : ''}` : `Edit ${p.name}`}</h1>
${isNew ? cityBarBlock(cityBar) : ''}
${notice ? html`<p class="notice" role="status" tabindex="-1" data-announce>${notice}</p>` : ''}
${error ? html`<p class="notice" role="alert" tabindex="-1" data-announce>${error}</p>` : ''}
${!isNew && p.active ? html`<p><a href="${parkPath(p)}">View the public page</a></p>` : ''}
<form method="post" action="${action}" class="card-form admin-form">
  ${csrfField(csrf)}
  ${input('name', 'Name', p.name, { required: true })}
  ${input('slug', 'Slug', p.slug, { required: true, hint: 'Used in the address, e.g. crescent-lake-park. Changing it breaks old links.' })}
  ${input('address', 'Address', p.address)}
  ${input('phone', 'Phone', p.phone)}
  <fieldset class="pin-fieldset">
    <legend>Location</legend>
    <p class="hint">Click the map or drag the pin to set it, or type the coordinates.</p>
    <div id="pin-map" class="park-map" data-lat="${p.lat ?? ''}" data-lng="${p.lng ?? ''}"${mapCenter ? html` data-center="${mapCenter.lat},${mapCenter.lng}"` : ''}></div>
    <div class="two-col">
      ${input('lat', 'Latitude', p.lat, { attrs: html`inputmode="decimal"` })}
      ${input('lng', 'Longitude', p.lng, { attrs: html`inputmode="decimal"` })}
    </div>
    <label class="check"><input type="checkbox" name="needs_pin" value="1"${p.needs_pin && !isNew ? html` checked` : ''}> Pin still needs checking</label>
  </fieldset>
  ${input('checkin_radius_m', 'Check-in radius (meters)', p.checkin_radius_m, { type: 'number', hint: '25 to 2000. Larger parks need a larger radius.', attrs: html`min="25" max="2000" step="1"` })}
  ${input('loop_mi', 'Walking loop (miles)', p.loop_mi, { type: 'number', hint: 'Optional. One lap of the main path, e.g. 0.8. Shown next to "Walk a mile".', attrs: html`min="0.1" max="20" step="0.1" inputmode="decimal"` })}
  <fieldset class="radio-group">
    <legend>Amenities</legend>
    <div class="filter-grid">${Object.keys(CATEGORIES).map((c) => html`<label class="check"><input type="checkbox" name="categories" value="${c}"${p.categories.includes(c) ? html` checked` : ''}> ${categoryLabel(c)}</label>`)}</div>
  </fieldset>
  ${input('city_url', "City's page (https://…)", p.city_url, { type: 'url' })}
  <label class="check"><input type="checkbox" name="active" value="1"${p.active ? html` checked` : ''}> Active (shown in the app). Unticking keeps existing stamps.</label>
  <button type="submit" class="btn btn-primary">${isNew ? 'Add park' : 'Save park'}</button>
</form>`, { head: html`<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">`, scripts: ['/js/pin-picker.js'] });
}

export function adminImport({ csrf, result, error, cityBar = null, seedFile = true }) {
  return page('Import parks', html`${crumb}<h1>Import ${cityBar ? `${cityBar.city.copy.short} ` : ''}parks</h1>
${cityBarBlock(cityBar)}
<p>Rows match existing parks by slug: matching parks are updated, new slugs are added. Importing the same file twice changes nothing.
<strong>Importing overwrites edits made here</strong> (for example pins you fixed) for every park in the file.</p>
${error ? html`<p class="notice" role="alert" tabindex="-1" data-announce>${error}</p>` : ''}
${result ? html`<div class="notice import-result" role="status" tabindex="-1" data-announce>
  <p><strong>${result.added} added, ${result.updated} updated, ${result.unchanged} unchanged, ${result.invalid.length} invalid.</strong></p>
  ${result.invalid.length ? html`<ul>${result.invalid.map((r) => html`<li>Line ${r.line}${r.slug ? html` (${r.slug})` : ''}: ${r.reason}</li>`)}</ul>` : ''}
</div>` : ''}
<form method="post" action="/admin/import${cityQ(cityBar)}" class="card-form" enctype="multipart/form-data">
  ${csrfField(csrf)}
  <div class="field">
    <label for="csv">CSV file</label>
    <p class="hint" id="csv-hint">Columns: slug, name, address, phone, lat, lng, checkin_radius_m, categories (separated by |), city_url, needs_pin, and optionally managed_by (who runs the park when it isn’t the city, e.g. Pinellas County; blank clears it). Up to 1 MB.</p>
    <input type="file" id="csv" name="csv" accept=".csv,text/csv" required aria-describedby="csv-hint">
  </div>
  <button type="submit" class="btn btn-primary">Import CSV</button>
</form>
${seedFile ? html`<form method="post" action="/admin/import/seed${cityQ(cityBar)}" class="card-form">
  ${csrfField(csrf)}
  <p>Or re-import the seed file that ships with the app (<code>seed/cities/${cityBar?.city.key || 'st-pete'}/parks.csv</code>).</p>
  <button type="submit" class="btn">Import the seed parks.csv</button>
</form>` : ''}`);
}

export function adminBadges({ badges }) {
  const table = (list, caption) => html`<div class="table-wrap"><table class="admin-table">
  <caption class="visually-hidden">${caption}</caption>
  <thead><tr><th scope="col">Badge</th><th scope="col">Rule</th><th scope="col">Shows as</th><th scope="col">Earned</th></tr></thead>
  <tbody>${list.map((b) => html`<tr${b.enabled ? '' : html` class="disabled"`}>
    <td data-label="Badge">${badgeArt(b.art, 'table-art')} <a href="/admin/badges/${b.id}">${b.name}</a>${b.enabled ? '' : html` <span class="flag">Disabled</span>`}${b.limited_count ? html` <span class="flag flag-holo">Limited: ${b.serials_given} of ${b.limited_count} given</span>` : ''}</td>
    <td data-label="Rule">${RULES[b.rule_type]?.label || b.rule_type}<br><span class="muted">${b.rule_params}</span></td>
    <td data-label="Shows as">${b.kind}</td>
    <td data-label="Earned">${b.earned_count}</td>
  </tr>`)}</tbody>
</table></div>`;
  const team = badges.filter((b) => b.is_group);
  return page('Badges', html`${crumb}<h1>Badges</h1>
<p><a class="btn btn-primary" href="/admin/badges/new">Add a badge</a></p>
${table(badges.filter((b) => !b.is_group), 'Badges')}
<section aria-labelledby="team-h">
<h2 id="team-h">Group badges (${team.length})</h2>
<p>Team badges: every member of a group gets one when the group reaches a goal, and keeps it. The ready-made goals are in <code>seed/group-goals.json</code>; owners can pick any enabled team badge for a goal of their own.</p>
<p><a class="btn" href="/admin/badges/new?team=1">Add a team badge</a></p>
${team.length ? table(team, 'Group badges') : html`<p>None yet.</p>`}
</section>`);
}

const PARAM_LABELS = {
  n: 'N (how many)', category: 'Amenity', start: 'From (local time)', end: 'Until (local time)', probability: 'Chance per stamp (0–1)',
  target: 'Which activities count', metric: 'Measure', total: 'Total (minutes or miles)', window_days: 'Within how many days (0 = all time)',
  per_week: 'Days per week', action: 'First-time action', order: 'Order among lucky drops (1 = first)',
  chance: 'Chance on a first stamp (0–1)', floor: 'Lowest chance (0–1)', half_life: 'Stamps until the chance halves',
};
const METRICS = [['minutes', 'Minutes'], ['miles', 'Miles']];
const paramSelect = (k, options, value, error) => html`<div class="field param" data-param="${k}">
  <label for="param_${k}">${PARAM_LABELS[k]}</label>
  ${error ? html`<p class="error-text">${error}</p>` : ''}
  <select id="param_${k}" name="param_${k}"><option value="">Choose…</option>${options.map(([v, label]) => html`<option value="${v}"${String(value) === v ? html` selected` : ''}>${label}</option>`)}</select>
</div>`;

export function adminBadgeForm({ badge, csrf, isNew, errors = {}, values = null, notice, targets = [], fromIdea = null }) {
  const b = values || badge || { kind: 'known', enabled: 1, rule_type: 'parks_count', rule_params: '{}', art: '🏅' };
  let params = {};
  try { params = values ? Object.fromEntries(Object.keys(PARAM_LABELS).map((k) => [k, values[`param_${k}`]])) : JSON.parse(b.rule_params || '{}'); } catch { params = {}; }
  const allParams = Object.keys(PARAM_LABELS);
  const action = isNew ? '/admin/badges/new' : `/admin/badges/${badge.id}`;
  const enabled = values ? values.enabled === '1' : Boolean(b.enabled);
  return page(isNew ? 'Add a badge' : b.name, html`<p class="breadcrumb"><a href="/admin">Admin</a> › <a href="/admin/badges">Badges</a></p>
<h1>${isNew ? 'Add a badge' : `Edit ${b.name}`}</h1>
${notice ? html`<p class="notice" role="status" tabindex="-1" data-announce>${notice}</p>` : ''}
${errorSummary(errors)}
<form method="post" action="${action}" class="card-form admin-form" enctype="multipart/form-data" id="badge-form">
  ${csrfField(csrf)}
  ${fromIdea ? html`<input type="hidden" name="from_idea" value="${fromIdea}"><p class="notice">From <a href="/admin/ideas#idea-${fromIdea}">badge idea #${fromIdea}</a>. Check the rule settings; it stays disabled until you tick Enabled.</p>` : ''}
  ${input('name', 'Name', b.name, { required: true, error: errors.name })}
  ${isNew ? input('slug', 'Slug', b.slug, { required: true, error: errors.slug, hint: 'Permanent id, e.g. sunrise-club.' }) : html`<p><strong>Slug:</strong> ${badge.slug}</p>`}
  ${input('description', 'Description (shown once earned, and for known badges)', b.description, { error: errors.description })}
  ${input('hint', 'Hint (shown for hidden and lucky badges)', b.hint, { error: errors.hint })}
  <div class="art-row">
    ${!isNew && badge ? html`<p>Current art: ${badgeArt(badge.art, 'table-art')}</p>` : ''}
    ${input('art', 'Art: one emoji', String(b.art || '').startsWith('upload:') ? '' : b.art, { error: errors.art, hint: 'Leave empty to keep an uploaded image.' })}
    <div class="field${errors.art_file ? ' field-error' : ''}">
      <label for="art_file">…or upload art (SVG or PNG, under 512 KB)</label>
      ${errors.art_file ? html`<p class="error-text" id="art_file-error">${errors.art_file}</p>` : ''}
      <input type="file" id="art_file" name="art_file" accept=".svg,.png,image/svg+xml,image/png">
    </div>
  </div>
  <div class="field${errors.rule_type ? ' field-error' : ''}">
    <label for="rule_type">Rule</label>
    ${errors.rule_type ? html`<p class="error-text">${errors.rule_type}</p>` : ''}
    <select id="rule_type" name="rule_type">${Object.entries(RULES).map(([k, r]) => html`<option value="${k}" data-params="${Object.keys(r.params).join(' ')}"${k === b.rule_type ? html` selected` : ''}>${r.label}</option>`)}</select>
  </div>
  <fieldset class="radio-group rule-params">
    <legend>Rule settings</legend>
    <p class="hint">Only the settings the chosen rule uses are saved.</p>
    ${allParams.map((k) => (k === 'target' ? paramSelect(k, targets.map((t) => [t.value, t.label]), params[k], errors[`param_${k}`])
      : k === 'metric' ? paramSelect(k, METRICS, params[k], errors[`param_${k}`])
      : k === 'action' ? paramSelect(k, Object.entries(MILESTONES), params[k], errors[`param_${k}`])
      : k === 'category'
      ? html`<div class="field param" data-param="${k}">
          <label for="param_${k}">${PARAM_LABELS[k]}</label>
          ${errors[`param_${k}`] ? html`<p class="error-text">${errors[`param_${k}`]}</p>` : ''}
          <select id="param_${k}" name="param_${k}"><option value="">Choose…</option>${Object.keys(CATEGORIES).map((c) => html`<option value="${c}"${params[k] === c ? html` selected` : ''}>${categoryLabel(c)}</option>`)}</select>
        </div>`
      : html`<div class="param" data-param="${k}">${input(`param_${k}`, PARAM_LABELS[k], params[k], {
        type: k === 'start' || k === 'end' ? 'time' : 'number', error: errors[`param_${k}`],
        hint: k === 'n' ? 'For the weekly rules, the number of weeks.' : undefined,
        attrs: k === 'probability' || k === 'chance' ? html`step="any" min="0.001" max="1"` : k === 'floor' ? html`step="any" min="0" max="1"`
          : k === 'order' || k === 'half_life' ? html`step="1" min="1" max="1000"` : k === 'n' ? html`step="1" min="1" max="1000"`
          : k === 'total' ? html`step="0.1" min="0.1" max="10000"` : k === 'window_days' ? html`step="1" min="0" max="365"`
            : k === 'per_week' ? html`step="1" min="1" max="7"` : '',
      })}</div>`))}
  </fieldset>
  <fieldset class="radio-group${errors.kind ? ' field-error' : ''}">
    <legend>Shows as</legend>
    ${errors.kind ? html`<p class="error-text">${errors.kind}</p>` : ''}
    ${[['known', 'Known: name and progress shown'], ['hidden', 'Hidden: "?" with the hint until earned'], ['lucky', 'Lucky: awarded at random (random or lucky drop rule)']].map(([k, label]) => html`<label class="check"><input type="radio" name="kind" value="${k}"${b.kind === k ? html` checked` : ''}> ${label}</label>`)}
  </fieldset>
  ${input('limited_count', 'Limited edition: number of copies (optional)', b.limited_count ?? '', { type: 'number', error: errors.limited_count,
    hint: 'Leave empty for an ordinary badge. A limited edition is numbered (#1 of 100, #2 of 100…) as you give it out, and shines like a holographic card. Use the "Given by an admin only" rule.',
    attrs: html`step="1" min="1" max="1000"` })}
  <label class="check"><input type="checkbox" name="is_group" value="1"${(values ? values.is_group === '1' : Boolean(b.is_group)) ? html` checked` : ''}> Team badge: earned by every member when their group reaches a goal (use the "Given by an admin only" rule). Shown in its own section.</label>
  ${errors.is_group ? html`<p class="error-text">${errors.is_group}</p>` : ''}
  <label class="check"><input type="checkbox" name="enabled" value="1"${enabled ? html` checked` : ''}> Enabled. Disabling stops new awards; members keep badges they earned.</label>
  <button type="submit" class="btn btn-primary">${isNew ? 'Add badge' : 'Save badge'}</button>
</form>`, { scripts: ['/js/badge-form.js'] });
}

export function adminActivities({ activities, csrf }) {
  return page('Activities', html`${crumb}<h1>Activities</h1>
<p>Things members can log at a park after stamping it. The wording lives in <code>seed/activities.json</code> and updates on deploy; switch an activity off here to hide it. Logs already made keep their points.</p>
<div class="table-wrap"><table class="admin-table">
  <caption class="visually-hidden">Activities</caption>
  <thead><tr><th scope="col">Activity</th><th scope="col">Edition · pillar</th><th scope="col">Where</th><th scope="col">Points</th><th scope="col">Shown</th></tr></thead>
  <tbody>${activities.map((a) => html`<tr id="act-${a.slug}"${a.active ? '' : html` class="disabled"`}>
    <td data-label="Activity"><strong>${a.name}</strong><br><span class="muted">${a.description}</span></td>
    <td data-label="Edition · pillar">${a.edition} · ${a.pillar}</td>
    <td data-label="Where">${a.category ? categoryLabel(a.category) : 'Any park'}</td>
    <td data-label="Points">${a.points}</td>
    <td data-label="Shown"><form method="post" action="/admin/activities/${a.id}">${csrfField(csrf)}
      <input type="hidden" name="active" value="${a.active ? '0' : '1'}">
      <button type="submit" class="btn btn-small">${a.active ? 'Switch off' : 'Switch on'}<span class="visually-hidden"> ${a.name}</span></button>
    </form>${a.active ? '' : html` <span class="flag">Off</span>`}</td>
  </tr>`)}</tbody>
</table></div>`);
}

export function adminModeration({ queue, csrf }) {
  const back = '/admin/moderation';
  const toggle = (url, hidden, what) => html`<form method="post" action="${url}">${csrfField(csrf)}
    <input type="hidden" name="hidden" value="${hidden ? '0' : '1'}"><input type="hidden" name="back" value="${back}">
    <button type="submit" class="btn btn-small${hidden ? '' : ' btn-danger'}">${hidden ? `Unhide ${what}` : `Hide ${what}`}</button></form>`;
  return page('Moderation', html`${crumb}<h1>Moderation</h1>
<p>The newest photos and reviews shared with pals or the public. Hidden items stay visible to their owner, labeled "Hidden by moderator".</p>
<h2>Photos</h2>
${queue.photos.length ? html`<ul class="mod-list">${queue.photos.map((p) => html`<li${p.hidden ? html` class="is-hidden"` : ''}>
  <a href="/photos/${p.id}/full"><img src="/photos/${p.id}/thumb" alt="${p.caption || 'Photo'}" width="96" height="96" loading="lazy"></a>
  <div><p>${p.caption || html`<span class="muted">No caption</span>`}</p>
    <p class="muted">${p.display_name} (${p.email}) · <a href="${parkPath({ city_key: p.city_key, slug: p.park_slug })}">${p.park_name}</a> · ${p.visibility} · ${dateOf(p.created_at)}${p.hidden ? html` · <strong>Hidden</strong>` : ''}</p>
    ${toggle(`/admin/photos/${p.id}/hidden`, p.hidden, 'photo')}</div>
</li>`)}</ul>` : html`<p>No shared photos.</p>`}
<h2>Reviews</h2>
${queue.reviews.length ? html`<ul class="mod-list">${queue.reviews.map((r) => html`<li${r.comment_hidden ? html` class="is-hidden"` : ''}>
  <div><p class="review-text">${r.comment}</p>
    <p class="muted">${r.stars}★ · ${r.display_name} (${r.email}) · <a href="${parkPath({ city_key: r.city_key, slug: r.park_slug })}">${r.park_name}</a> · ${r.visibility} · ${dateOf(r.updated_at)}${r.comment_hidden ? html` · <strong>Hidden</strong>` : ''}</p>
    ${toggle(`/admin/reviews/${r.id}/hidden`, r.comment_hidden, 'comment')}</div>
</li>`)}</ul>` : html`<p>No shared reviews with comments.</p>`}`);
}

export function adminUsers({ users, csrf, me, error, notice, invites = [], inviteError = null, inviteValues = {}, badges = [], giveError = null, giveValues = {} }) {
  const picked = new Set([].concat(giveValues.user_id || []).map(String));
  return page('Members', html`${crumb}<h1>Members</h1>
${error ? html`<p class="notice" role="alert" tabindex="-1" data-announce>${error}</p>` : ''}
${notice ? html`<p class="notice" role="status" tabindex="-1" data-announce>${notice}</p>` : ''}

<section aria-labelledby="invite-h">
<h2 id="invite-h">Invite someone</h2>
<form method="post" action="/admin/invites" class="card-form admin-form">
  ${csrfField(csrf)}
  ${inviteError ? html`<p class="error-text" role="alert" tabindex="-1" data-announce>${inviteError}</p>` : ''}
  <div class="two-col">
    ${input('invite_email', 'Email', inviteValues.email, { type: 'email', required: true })}
    ${input('invite_name', 'Their name (optional)', inviteValues.name, { hint: 'Used in the greeting and to fill in their sign-up.' })}
  </div>
  <p class="hint">They get the branded invitation email (<a href="/admin/email/messages/invite">edit its wording</a>) with a link to create their passport. It works for 30 days.</p>
  <button type="submit" class="btn btn-pop">Send invite</button>
</form>
${invites.length ? html`<div class="table-wrap"><table class="admin-table">
  <caption class="visually-hidden">Recent invites</caption>
  <thead><tr><th scope="col">Invited</th><th scope="col">By</th><th scope="col">Sent</th><th scope="col">Status</th></tr></thead>
  <tbody>${invites.map((i) => html`<tr>
    <td data-label="Invited">${i.name ? html`${i.name}<br>` : ''}<span class="muted">${i.email}</span></td>
    <td data-label="By">${i.inviter_name || 'A former admin'}</td>
    <td data-label="Sent">${dateOf(i.created_at)}</td>
    <td data-label="Status">${i.accepted_at ? html`<span class="status-pill ok">Joined ${dateOf(i.accepted_at)}</span>` : html`<span class="status-pill">Pending</span>`}</td>
  </tr>`)}</tbody>
</table></div>` : ''}
</section>

<h2 id="members">All members</h2>
<form method="post" action="/admin/users/give" id="bulk-give" class="card-form admin-form give-bar">
  ${csrfField(csrf)}
  <h3>Give a badge to the members you tick</h3>
  ${giveError ? html`<p class="error-text" role="alert">${giveError}</p>` : ''}
  <div class="field"><label for="give_badge">Badge</label>
    <select id="give_badge" name="badge_id" required><option value="">Choose…</option>${badges.map((b) => html`<option value="${b.id}"${String(giveValues.badge_id) === String(b.id) ? html` selected` : ''}>${badgeOption(b)}</option>`)}</select></div>
  ${input('from_name', 'From', giveValues.from_name ?? 'Parks Passport', { hint: 'Who the badge says it\u2019s from. Up to 40 characters.', attrs: html`maxlength="40"` })}
  ${input('note', 'Note (optional)', giveValues.note, { hint: 'Shown with the badge. Up to 140 characters.', attrs: html`maxlength="140"` })}
  <p class="hint">It pops up the next time each of them opens the app. Limited editions are numbered in the order the members joined. Anyone who already has the badge is skipped.</p>
  <button type="submit" class="btn btn-pop">Give to ticked members</button>
  <button type="submit" class="btn" formaction="/admin/messages/compose" formnovalidate>Message ticked members</button>
</form>
<div class="table-wrap"><table class="admin-table">
  <caption class="visually-hidden">Members</caption>
  <thead><tr><th scope="col"><span class="visually-hidden">Tick to give a badge</span></th><th scope="col">Member</th><th scope="col">Parks</th><th scope="col">Joined</th><th scope="col">Badges</th><th scope="col">Admin</th></tr></thead>
  <tbody>${users.map((u) => html`<tr>
    <td data-label="Give"><input type="checkbox" name="user_id" value="${u.id}" form="bulk-give" class="give-tick" aria-label="Give the badge to ${u.display_name}"${picked.has(String(u.id)) ? html` checked` : ''}></td>
    <td data-label="Member">${u.display_name} <span class="muted">@${u.handle}</span><br><span class="muted">${u.email}</span></td>
    <td data-label="Parks">${u.parks}</td>
    <td data-label="Joined">${dateOf(u.created_at)}</td>
    <td data-label="Badges"><a href="/admin/users/${u.id}/badges">Give a badge<span class="visually-hidden"> to ${u.display_name}</span></a><br><a href="/admin/users/${u.id}/groups">Groups<span class="visually-hidden"> for ${u.display_name}</span></a></td>
    <td data-label="Admin">${u.id === me.id ? html`Admin (you)` : html`<form method="post" action="/admin/users/${u.id}/admin">${csrfField(csrf)}
      <input type="hidden" name="admin" value="${u.is_admin ? '0' : '1'}">
      <button type="submit" class="btn btn-small" aria-label="${u.is_admin ? `Remove admin (${u.display_name})` : `Make admin (${u.display_name})`}">${u.is_admin ? 'Remove admin' : 'Make admin'}</button></form>`}</td>
  </tr>`)}</tbody>
</table></div>`);
}

export function adminEmail({ csrf, settings, values = null, errors = {}, key, transport, me, notice, keyError, testError, messages = [] }) {
  const v = values || settings;
  const keyStatus = {
    admin: html`A key ending in <strong>…${key.hint}</strong> is saved here (encrypted). It's used instead of any key in <code>.env</code>.`,
    env: html`Using <code>SENDGRID_API_KEY</code> from the server's <code>.env</code> (ends in …${key.hint}). A key saved here would replace it.`,
    unreadable: html`<strong>A saved key can't be decrypted</strong> (the encryption key changed). Save the key again.`,
  }[key.source] || html`<strong>No SendGrid key yet.</strong> Sign-in links and password resets can't be sent until one is saved.`;
  return page('Email', html`${crumb}<h1>Email</h1>
${notice ? html`<p class="notice" role="status" tabindex="-1" data-announce>${notice}</p>` : ''}
${transport !== 'sendgrid' ? html`<p class="notice">This server writes emails to its outbox folder (<code>MAIL_TRANSPORT=${transport}</code>), so nothing is actually sent.</p>` : ''}

<section aria-labelledby="sender-h">
<h2 id="sender-h">Sender</h2>
${errorSummary(errors)}
<form method="post" action="/admin/email" class="card-form admin-form">
  ${csrfField(csrf)}
  ${input('mail_from_name', 'From name', v.mail_from_name, { required: true, error: errors.mail_from_name })}
  ${input('mail_from_address', 'From address', v.mail_from_address, { type: 'email', required: true, error: errors.mail_from_address, hint: 'Must be a sender (or domain) verified in SendGrid.' })}
  ${input('mail_reply_to', 'Reply-to address (optional)', v.mail_reply_to, { type: 'email', error: errors.mail_reply_to })}
  <button type="submit" class="btn btn-primary">Save email settings</button>
</form>
</section>

<section aria-labelledby="messages-h">
<h2 id="messages-h">Messages</h2>
<p>Change the wording of each email members get. Every email uses the Parks Passport design.</p>
<ul class="admin-cards">${messages.map((m) => html`<li><a href="/admin/email/messages/${m.kind}"><strong>${m.label}</strong>
  <span>${m.subject}</span><span>${m.customized ? 'Custom wording' : 'Default wording'}</span></a></li>`)}</ul>
</section>

<section aria-labelledby="key-h">
<h2 id="key-h">SendGrid API key</h2>
<p>${keyStatus}</p>
${keyError ? html`<p class="notice" role="alert" tabindex="-1" data-announce>${keyError}</p>` : ''}
<form method="post" action="/admin/email/key" class="card-form admin-form">
  ${csrfField(csrf)}
  ${input('sendgrid_key', key.source === 'admin' ? 'Replace the key' : 'API key', '', {
    type: 'password', required: true, attrs: html`autocomplete="off" spellcheck="false"`,
    hint: 'In SendGrid: Settings › API Keys › Create API Key, with "Mail Send" access. It is stored encrypted and never shown again.',
  })}
  <button type="submit" class="btn btn-primary">Save key</button>
</form>
${key.source === 'admin' || key.source === 'unreadable' ? html`<form method="post" action="/admin/email/key/delete" class="inline-form">${csrfField(csrf)}
  <button type="submit" class="btn btn-quiet btn-small">Remove the saved key</button></form>` : ''}
</section>

<section aria-labelledby="test-h">
<h2 id="test-h">Send a test email</h2>
${testError ? html`<p class="notice" role="alert" tabindex="-1" data-announce>${testError}</p>` : ''}
<form method="post" action="/admin/email/test" class="card-form">
  ${csrfField(csrf)}
  <p>Sends a test message to your address, <strong>${me.email}</strong>, with the settings above.</p>
  <button type="submit" class="btn">Send test email</button>
</form>
</section>`);
}

const textarea = (name, label, value, { rows = 3, hint, error } = {}) => html`<div class="field${error ? ' field-error' : ''}">
  <label for="${name}">${label}</label>
  ${hint ? html`<p class="hint" id="${name}-hint">${hint}</p>` : ''}
  ${error ? html`<p class="error-text" id="${name}-error">${error}</p>` : ''}
  <textarea id="${name}" name="${name}" rows="${rows}"${hint || error ? html` aria-describedby="${[hint ? `${name}-hint` : '', error ? `${name}-error` : ''].filter(Boolean).join(' ')}"` : ''}${error ? html` aria-invalid="true"` : ''}>${value ?? ''}</textarea>
</div>`;

function jobPanel(job, aiAvailable, csrf, q = '') {
  const running = job?.status === 'running';
  return html`<section class="card" aria-labelledby="ai-h">
  <h2 id="ai-h">Generate with AI</h2>
  <p>Claude searches the web for this city's best-known landmarks, history and nature, then drafts a line icon and a short blurb for each.
  Drafts show below with a dashed border. Nothing appears on the site until you approve it.</p>
  ${!aiAvailable ? html`<p class="notice">Set <code>ANTHROPIC_API_KEY</code> in the server's <code>.env</code> to turn this on.</p>` : ''}
  ${running ? html`<p class="notice" role="status">Researching… this takes a few minutes. This page refreshes on its own.</p>` : ''}
  ${job?.status === 'error' ? html`<p class="notice" role="alert">${job.error}</p>` : ''}
  ${job?.status === 'done' ? html`<p class="notice" role="status">Added ${job.added} draft${job.added === 1 ? '' : 's'}${job.rejected ? ` (${job.rejected} skipped: duplicate or an icon that didn't pass the safety check)` : ''}.
    ${job.suggestion?.accent ? html`Suggested colors: <span class="swatch" style="background:${job.suggestion.accent}"></span> ${job.suggestion.accent}${job.suggestion.accent_2 ? html` and <span class="swatch" style="background:${job.suggestion.accent_2}"></span> ${job.suggestion.accent_2}` : ''}${job.suggestion.tagline ? `, tagline "${job.suggestion.tagline}"` : ''}. Use them in the settings below if you like.` : ''}</p>` : ''}
  <form method="post" action="/admin/city/generate${q}">${csrfField(csrf)}
    <button type="submit" class="btn btn-pop"${!aiAvailable || running ? html` disabled` : ''}>${running ? 'Generating…' : 'Generate landmark drafts'}</button>
  </form>
</section>`;
}

function motifCard(m, csrf, editing = null, q = '') {
  const draft = m.status === 'draft';
  const ed = editing?.id === m.id ? editing : null;
  const val = ed ? ed.values : m;
  const err = ed?.errors || {};
  const action = (path, label, cls = 'btn btn-small') => html`<form method="post" action="/admin/city/motifs/${m.id}/${path}${q}">${csrfField(csrf)}<button type="submit" class="${cls}">${label}</button></form>`;
  return html`<li class="${draft ? 'is-draft' : ''}">
  <div class="motif-row">
    <span class="tile"><span class="motif" aria-hidden="true">${raw(sanitizeSvg(m.svg) || '')}</span></span>
    <div><h3>${m.name}</h3>
      <span class="status-pill${draft ? '' : ' ok'}">${draft ? 'Draft' : 'Live'}</span> <span class="muted">${{ seed: 'Hand-drawn', ai: 'AI draft', admin: 'Added by an admin' }[m.source]}</span></div>
  </div>
  ${m.blurb ? html`<p>${m.blurb}</p>` : ''}
  <div class="actions">
    ${draft ? action('approve', `Approve ${m.name}`, 'btn btn-small btn-primary') : action('unpublish', `Unpublish ${m.name}`)}
    ${action('delete', `Delete ${m.name}`, 'btn btn-small btn-quiet')}
  </div>
  <details${ed ? html` open` : ''}><summary>Edit</summary>
    <form method="post" action="/admin/city/motifs/${m.id}${q}">${csrfField(csrf)}
      ${ed ? html`<p class="error-text" role="alert" tabindex="-1" data-announce>Not saved. Fix the problems below.</p>` : ''}
      ${input(`name-${m.id}`, 'Name', val.name, { error: err.name })}
      ${textarea(`blurb-${m.id}`, 'Blurb', val.blurb, { error: err.blurb })}
      ${textarea(`svg-${m.id}`, 'Icon SVG', val.svg, { rows: 5, error: err.svg, hint: '48×48 line drawing: path, circle, ellipse, line, polyline, polygon or rect only.' })}
      <button type="submit" class="btn btn-small">Save ${m.name}</button>
    </form>
  </details>
</li>`;
}

export function adminCity({ csrf, theme, motifs, job, aiAvailable, errors = {}, values = null, notice = null, motifErrors = {}, motifValues = null, editing = null, cityBar = null }) {
  const v = values || theme;
  const q = `?city=${theme.key}`; // forms post back the city they show
  const drafts = motifs.filter((m) => m.status === 'draft').length;
  return page('City theme', html`${crumb}<h1>City theme</h1>
${cityBarBlock(cityBar)}
<p class="lede">${theme.name}'s landmark icons, history and colors appear on stamps, the home page, passports and the footer.</p>
${notice ? html`<p class="notice" role="status">${notice}</p>` : ''}
${jobPanel(job, aiAvailable, csrf, q)}

<section aria-labelledby="motifs-h">
  <h2 id="motifs-h">Motifs <span class="count">(${motifs.length - drafts} live${drafts ? `, ${drafts} to review` : ''})</span></h2>
  <ul class="motif-admin">${motifs.map((m) => motifCard(m, csrf, editing, q))}</ul>
</section>

<section aria-labelledby="add-h">
  <h2 id="add-h">Add a motif by hand</h2>
  <form method="post" action="/admin/city/motifs/new${q}" class="card-form admin-form">${csrfField(csrf)}
    ${errorSummary(motifErrors)}
    ${input('name', 'Name', motifValues?.name, { error: motifErrors.name, required: true })}
    ${textarea('blurb', 'Blurb (optional)', motifValues?.blurb, { error: motifErrors.blurb })}
    ${textarea('svg', 'Icon SVG', motifValues?.svg, { rows: 5, error: motifErrors.svg, hint: '<svg viewBox="0 0 48 48"> with path, circle, ellipse, line, polyline, polygon or rect shapes. The app adds the stroke.' })}
    <button type="submit" class="btn btn-primary">Add motif</button>
  </form>
</section>

<section aria-labelledby="settings-h">
  <h2 id="settings-h">Settings</h2>
  <form method="post" action="/admin/city/settings${q}" class="card-form admin-form">${csrfField(csrf)}
    ${errorSummary(Object.fromEntries(Object.entries(errors).map(([k, msg]) => [k === 'name' ? 'city_name' : k, msg])))}
    ${input('city_name', 'City name', v.name, { error: errors.name, required: true })}
    ${input('tagline', 'Nickname', v.tagline, { error: errors.tagline, hint: 'Shown on the home page and in the footer, e.g. "Sunshine City".' })}
    <div class="two-col">
      ${input('accent', 'Accent color', v.accent, { error: errors.accent, hint: 'Decorative only, e.g. #FF7A59.' })}
      ${input('accent_2', 'Second accent color', v.accent_2, { error: errors.accent_2, hint: 'Decorative only.' })}
    </div>
    <button type="submit" class="btn btn-primary">Save settings</button>
  </form>
</section>`, job?.status === 'running' ? { head: html`<meta http-equiv="refresh" content="10">` } : {});
}

// Admin › Email › Messages › one email: edit its wording, preview it, send a preview, reset.
export function adminEmailMessage({ csrf, kind, def, fields, values, errors = {}, previewHtml, customized, notice, sendError, me }) {
  const field = (name) => {
    const spec = fields[name];
    const common = { error: errors[name], hint: spec.hint, required: spec.required };
    return spec.oneLine
      ? input(name, spec.label, values[name], { ...common, attrs: html`maxlength="${spec.max}"` })
      : textarea(name, spec.label, values[name], { ...common, rows: name === 'body' ? 6 : 3 });
  };
  return page(def.label, html`<p class="breadcrumb"><a href="/admin">Admin</a> › <a href="/admin/email">Email</a></p>
<h1>${def.label}</h1>
<p class="lede">${def.when}</p>
${notice ? html`<p class="notice" role="status" tabindex="-1" data-announce>${notice}</p>` : ''}
${sendError ? html`<p class="notice" role="alert" tabindex="-1" data-announce>${sendError}</p>` : ''}
<div class="email-editor">
  <form method="post" action="/admin/email/messages/${kind}" class="card-form admin-form">
    ${csrfField(csrf)}
    ${errorSummary(errors)}
    ${['subject', 'preheader', 'heading', 'body', 'button', 'note'].map(field)}
    <p class="hint">The link, the logo, the colors and the footer are added for you.</p>
    <button type="submit" class="btn btn-primary">Save wording</button>
  </form>
  <section aria-labelledby="preview-h" class="email-preview">
    <h2 id="preview-h">Preview</h2>
    <iframe title="Preview of the ${def.label.toLowerCase()} email" srcdoc="${previewHtml}" loading="lazy"></iframe>
    <div class="actions">
      <form method="post" action="/admin/email/messages/${kind}/send">${csrfField(csrf)}
        <button type="submit" class="btn">Send me a preview</button></form>
      ${customized ? html`<form method="post" action="/admin/email/messages/${kind}/reset">${csrfField(csrf)}
        <button type="submit" class="btn btn-quiet">Reset to default wording</button></form>` : ''}
    </div>
    <p class="hint">The preview goes to ${me.email}. Its button opens the home page, not a real sign-in link.</p>
  </section>
</div>`);
}

// Admin › Stats: counts only (domain/stats.js). Bars are decorative; every number is in the table.
const METHOD_NAMES = { gps: 'GPS', photo: 'Photo', honor: 'Honor system' };
function barTable({ caption, rows, label, value, extra = null }) {
  const max = Math.max(1, ...rows.map((r) => r[value]));
  return html`<div class="table-wrap"><table class="stats-table">
  <caption>${caption}</caption>
  <thead><tr><th scope="col">${label.title}</th><th scope="col">Check-ins</th>${extra ? html`<th scope="col">${extra.title}</th>` : ''}</tr></thead>
  <tbody>${rows.map((r) => html`<tr><th scope="row">${label.get(r)}</th>
    <td><span class="stat-bar" style="--w:${Math.round((r[value] / max) * 100)}%" aria-hidden="true"></span>${r[value]}</td>
    ${extra ? html`<td>${extra.get(r)}</td>` : ''}</tr>`)}</tbody>
</table></div>`;
}

export function adminStats({ stats }) {
  const t = stats.totals;
  const tile = (n, label) => html`<li><strong>${n}</strong><span>${label}</span></li>`;
  const short = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  return page('Stats', html`${crumb}<h1>Stats</h1>
<p class="muted">Counts only: no names, emails or locations. Check-ins count when they were made (UTC days).</p>
<ul class="stat-tiles">
  ${tile(t.checkins7, 'check-ins in the last 7 days')}${tile(t.checkins30, 'check-ins in 30 days')}${tile(t.checkins, 'check-ins in all')}
  ${tile(t.active7, 'members who stamped in 7 days')}${tile(t.active30, 'who stamped in 30 days')}${tile(t.members, `members (${t.newMembers7} new in 7 days, ${t.newMembers30} in 30 days)`)}
  ${tile(t.stampers, 'members who ever stamped')}${tile(t.palLinks, 'Park Pal links')}${tile(t.photos, 'photos')}
  ${tile(t.ratings, 'ratings')}${tile(t.activities, 'activities logged')}${tile(t.badgesEarned, 'badges earned')}
</ul>
${barTable({ caption: 'Check-ins per day, last 14 days', rows: stats.days, value: 'checkins', label: { title: 'Day', get: (r) => short(r.day) } })}
${barTable({ caption: 'Check-ins per week, last 12 weeks', rows: stats.weeks, value: 'checkins', label: { title: 'Week of', get: (r) => short(r.week) }, extra: { title: 'New members', get: (r) => r.members } })}
${barTable({ caption: 'By city (all time)', rows: stats.byCity, value: 'checkins', label: { title: 'City', get: (r) => r.city },
    extra: { title: 'Last 30 days · members · parks stamped', get: (r) => `${r.checkins30 || 0} · ${r.members} · ${r.parks} of ${r.total_parks}` } })}
${barTable({ caption: 'By method (all time)', rows: stats.byMethod, value: 'checkins', label: { title: 'Method', get: (r) => METHOD_NAMES[r.method] || r.method },
    extra: { title: 'Last 30 days', get: (r) => r.checkins30 || 0 } })}
${stats.topParks.length ? barTable({ caption: 'Top parks, last 30 days', rows: stats.topParks, value: 'checkins', label: { title: 'Park', get: (r) => `${r.name} (${r.city})` },
    extra: { title: 'Members', get: (r) => r.members } }) : html`<p>No check-ins in the last 30 days.</p>`}`);
}

// A member's group limits (SPEC Flow 23): empty means what they've earned.
export function adminGroupLimits({ member, allowance, csrf, errors = {}, values = null, notice = null }) {
  const v = values || { group_create_limit: member.group_create_limit ?? '', group_join_limit: member.group_join_limit ?? '' };
  return page(`Groups for ${member.display_name}`, html`<p class="breadcrumb"><a href="/admin">Admin</a> › <a href="/admin/users">Members</a></p>
<h1>Groups for ${member.display_name}</h1>
${notice ? html`<p class="notice" role="status" tabindex="-1" data-announce>${notice}</p>` : ''}
${errorSummary(errors)}
<p>Now: can start ${allowance.createLimit} (runs ${allowance.owned}), can be in ${allowance.joinLimit} (in ${allowance.joined}). ${allowance.gps} GPS check-ins.</p>
<form method="post" action="/admin/users/${member.id}/groups" class="card-form admin-form">
  ${csrfField(csrf)}
  ${input('group_create_limit', 'Groups they can start', v.group_create_limit, { type: 'number', error: errors.group_create_limit, attrs: html`min="0" max="50" step="1"`,
    hint: 'Leave empty for what they\u2019ve earned: 3 once they\u2019re a Troop Leader (10 GPS check-ins), otherwise none. 0 turns it off.' })}
  ${input('group_join_limit', 'Groups they can be in', v.group_join_limit, { type: 'number', error: errors.group_join_limit, attrs: html`min="0" max="50" step="1"`,
    hint: 'Leave empty for what they\u2019ve earned: 5, or 10 after 25 GPS check-ins.' })}
  <button type="submit" class="btn btn-primary">Save</button>
</form>`);
}

// Give a member a badge (SPEC Flow 9). It pops up on their next page, with the note.
export function adminGiveBadge({ member, earned, available, csrf, error = null, notice = null, values = {} }) {
  return page(`Give ${member.display_name} a badge`, html`<p class="breadcrumb"><a href="/admin">Admin</a> › <a href="/admin/users">Members</a></p>
<h1>Give ${member.display_name} a badge</h1>
${notice ? html`<p class="notice" role="status" tabindex="-1" data-announce>${notice}</p>` : ''}
${error ? html`<p class="notice" role="alert" tabindex="-1" data-announce>${error}</p>` : ''}
${available.length ? html`<form method="post" action="/admin/users/${member.id}/badges" class="card-form admin-form">
  ${csrfField(csrf)}
  <div class="field"><label for="badge_id">Badge</label>
    <select id="badge_id" name="badge_id" required><option value="">Choose…</option>${available.map((b) => html`<option value="${b.id}"${String(values.badge_id) === String(b.id) ? html` selected` : ''}>${badgeOption(b)}</option>`)}</select></div>
  ${input('from_name', 'From', values.from_name ?? 'Parks Passport', { hint: 'Who the badge says it\u2019s from. Up to 40 characters.', attrs: html`maxlength="40"` })}
  ${input('note', 'Note (optional)', values.note, { hint: 'Shown with the badge, e.g. "Thanks for helping at the park cleanup!" Up to 140 characters.', attrs: html`maxlength="140"` })}
  <p class="hint">${member.display_name} sees it pop up the next time they open Parks Passport, and in their notifications. Badges you give are never taken away by the rules.</p>
  <button type="submit" class="btn btn-pop">Give badge</button>
</form>` : html`<p>${member.display_name} already has every badge.</p>`}
<h2>Their badges (${earned.length})</h2>
${earned.length ? html`<ul class="given-list">${earned.map((b) => html`<li>${badgeArt(b.art, 'table-art')} ${b.name}${serialText(b)} <span class="muted">· ${dateOf(b.awarded_at)}${b.source_type === 'grant' ? ` · given by ${b.given_by || 'an admin'}` : ''}</span>
  ${b.source_type === 'grant' ? html`<form method="post" action="/admin/users/${member.id}/badges/${b.id}/delete" class="inline-form">${csrfField(csrf)}<button type="submit" class="btn btn-quiet btn-small">Take back<span class="visually-hidden"> ${b.name}</span></button></form>` : ''}</li>`)}</ul>` : html`<p>None yet.</p>`}`);
}
