import { html } from '../html.js';
import { csrfField, errorSummary } from '../forms.js';
import { CATEGORIES, categoryLabel } from '../../domain/categories.js';
import { RULES } from '../../domain/badges/rules.js';
import { formatDate, localDate } from '../../domain/time.js';
import { badgeArt } from '../badge-art.js';
import { raw } from '../html.js';
import { sanitizeSvg } from '../../lib/svg-sanitize.js';

const page = (title, body, extra = {}) => ({ title: `Admin · ${title}`, current: 'admin', ...extra, body });
const crumb = html`<p class="breadcrumb"><a href="/admin">Admin</a></p>`;
const dateOf = (iso) => formatDate(localDate(new Date(iso)));
const input = (name, label, value, { type = 'text', hint, error, required = false, attrs = '' } = {}) => html`<div class="field${error ? ' field-error' : ''}">
  <label for="${name}">${label}</label>
  ${hint ? html`<p class="hint" id="${name}-hint">${hint}</p>` : ''}
  ${error ? html`<p class="error-text" id="${name}-error">${error}</p>` : ''}
  <input id="${name}" name="${name}" type="${type}" value="${value ?? ''}"${required ? html` required` : ''}${hint || error ? html` aria-describedby="${[hint ? `${name}-hint` : '', error ? `${name}-error` : ''].filter(Boolean).join(' ')}"` : ''}${error ? html` aria-invalid="true"` : ''} ${attrs}>
</div>`;

export function adminHome({ counts }) {
  return page('Dashboard', html`<h1>Admin</h1>
<ul class="admin-cards">
  <li><a href="/admin/parks"><strong>Parks</strong><span>${counts.active} active · ${counts.inactive} inactive</span></a></li>
  <li><a href="/admin/parks?filter=needs_pin"><strong>Pins to check</strong><span>${counts.needsPin} parks</span></a></li>
  <li><a href="/admin/import"><strong>Import parks</strong><span>CSV upload or seed file</span></a></li>
  <li><a href="/admin/badges"><strong>Badges</strong><span>${counts.badges} badges</span></a></li>
  <li><a href="/admin/moderation"><strong>Moderation</strong><span>${counts.shared} shared photos and reviews</span></a></li>
  <li><a href="/admin/users"><strong>Members</strong><span>${counts.users} members · ${counts.admins} admins</span></a></li>
  <li><a href="/admin/email"><strong>Email</strong><span>Sender, subject lines, SendGrid key</span></a></li>
  <li><a href="/admin/city"><strong>City theme</strong><span>Landmark icons, history and colors</span></a></li>
</ul>`);
}

export function adminParks({ parks, filter }) {
  const tabs = [['', 'All'], ['needs_pin', 'Pins to check'], ['inactive', 'Inactive']];
  return page('Parks', html`${crumb}<h1>Parks</h1>
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

export function adminParkForm({ park, csrf, isNew, error, notice }) {
  const p = park || { checkin_radius_m: 150, active: 1, categories: [] };
  const action = isNew ? '/admin/parks/new' : `/admin/parks/${p.id}`;
  return page(isNew ? 'Add a park' : p.name, html`<p class="breadcrumb"><a href="/admin">Admin</a> › <a href="/admin/parks">Parks</a></p>
<h1>${isNew ? 'Add a park' : `Edit ${p.name}`}</h1>
${notice ? html`<p class="notice" role="status" tabindex="-1" data-announce>${notice}</p>` : ''}
${error ? html`<p class="notice" role="alert" tabindex="-1" data-announce>${error}</p>` : ''}
${!isNew && p.active ? html`<p><a href="/parks/${p.slug}">View the public page</a></p>` : ''}
<form method="post" action="${action}" class="card-form admin-form">
  ${csrfField(csrf)}
  ${input('name', 'Name', p.name, { required: true })}
  ${input('slug', 'Slug', p.slug, { required: true, hint: 'Used in the address, e.g. crescent-lake-park. Changing it breaks old links.' })}
  ${input('address', 'Address', p.address)}
  ${input('phone', 'Phone', p.phone)}
  <fieldset class="pin-fieldset">
    <legend>Location</legend>
    <p class="hint">Click the map or drag the pin to set it, or type the coordinates.</p>
    <div id="pin-map" class="park-map" data-lat="${p.lat ?? ''}" data-lng="${p.lng ?? ''}"></div>
    <div class="two-col">
      ${input('lat', 'Latitude', p.lat, { attrs: html`inputmode="decimal"` })}
      ${input('lng', 'Longitude', p.lng, { attrs: html`inputmode="decimal"` })}
    </div>
    <label class="check"><input type="checkbox" name="needs_pin" value="1"${p.needs_pin && !isNew ? html` checked` : ''}> Pin still needs checking</label>
  </fieldset>
  ${input('checkin_radius_m', 'Check-in radius (meters)', p.checkin_radius_m, { type: 'number', hint: '25 to 2000. Larger parks need a larger radius.', attrs: html`min="25" max="2000" step="1"` })}
  <fieldset class="radio-group">
    <legend>Amenities</legend>
    <div class="filter-grid">${Object.keys(CATEGORIES).map((c) => html`<label class="check"><input type="checkbox" name="categories" value="${c}"${p.categories.includes(c) ? html` checked` : ''}> ${categoryLabel(c)}</label>`)}</div>
  </fieldset>
  ${input('city_url', "City's page (https://…)", p.city_url, { type: 'url' })}
  <label class="check"><input type="checkbox" name="active" value="1"${p.active ? html` checked` : ''}> Active (shown in the app). Unticking keeps existing stamps.</label>
  <button type="submit" class="btn btn-primary">${isNew ? 'Add park' : 'Save park'}</button>
</form>`, { head: html`<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">`, scripts: ['/js/pin-picker.js'] });
}

export function adminImport({ csrf, result, error }) {
  return page('Import parks', html`${crumb}<h1>Import parks</h1>
<p>Rows match existing parks by slug: matching parks are updated, new slugs are added. Importing the same file twice changes nothing.
<strong>Importing overwrites edits made here</strong> (for example pins you fixed) for every park in the file.</p>
${error ? html`<p class="notice" role="alert" tabindex="-1" data-announce>${error}</p>` : ''}
${result ? html`<div class="notice import-result" role="status" tabindex="-1" data-announce>
  <p><strong>${result.added} added, ${result.updated} updated, ${result.unchanged} unchanged, ${result.invalid.length} invalid.</strong></p>
  ${result.invalid.length ? html`<ul>${result.invalid.map((r) => html`<li>Line ${r.line}${r.slug ? html` (${r.slug})` : ''}: ${r.reason}</li>`)}</ul>` : ''}
</div>` : ''}
<form method="post" action="/admin/import" class="card-form" enctype="multipart/form-data">
  ${csrfField(csrf)}
  <div class="field">
    <label for="csv">CSV file</label>
    <p class="hint" id="csv-hint">Columns: slug, name, address, phone, lat, lng, checkin_radius_m, categories (separated by |), city_url, needs_pin. Up to 1 MB.</p>
    <input type="file" id="csv" name="csv" accept=".csv,text/csv" required aria-describedby="csv-hint">
  </div>
  <button type="submit" class="btn btn-primary">Import CSV</button>
</form>
<form method="post" action="/admin/import/seed" class="card-form">
  ${csrfField(csrf)}
  <p>Or re-import the seed file that ships with the app (<code>seed/parks.csv</code>).</p>
  <button type="submit" class="btn">Import seed/parks.csv</button>
</form>`);
}

export function adminBadges({ badges }) {
  return page('Badges', html`${crumb}<h1>Badges</h1>
<p><a class="btn btn-primary" href="/admin/badges/new">Add a badge</a></p>
<div class="table-wrap"><table class="admin-table">
  <caption class="visually-hidden">Badges</caption>
  <thead><tr><th scope="col">Badge</th><th scope="col">Rule</th><th scope="col">Shows as</th><th scope="col">Earned</th></tr></thead>
  <tbody>${badges.map((b) => html`<tr${b.enabled ? '' : html` class="disabled"`}>
    <td data-label="Badge">${badgeArt(b.art, 'table-art')} <a href="/admin/badges/${b.id}">${b.name}</a>${b.enabled ? '' : html` <span class="flag">Disabled</span>`}</td>
    <td data-label="Rule">${RULES[b.rule_type]?.label || b.rule_type}<br><span class="muted">${b.rule_params}</span></td>
    <td data-label="Shows as">${b.kind}</td>
    <td data-label="Earned">${b.earned_count}</td>
  </tr>`)}</tbody>
</table></div>`);
}

const PARAM_LABELS = { n: 'N (how many)', category: 'Amenity', start: 'From (local time)', end: 'Until (local time)', probability: 'Chance per stamp (0–1)' };

export function adminBadgeForm({ badge, csrf, isNew, errors = {}, values = null, notice }) {
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
    ${allParams.map((k) => (k === 'category'
      ? html`<div class="field param" data-param="${k}">
          <label for="param_${k}">${PARAM_LABELS[k]}</label>
          ${errors[`param_${k}`] ? html`<p class="error-text">${errors[`param_${k}`]}</p>` : ''}
          <select id="param_${k}" name="param_${k}"><option value="">Choose…</option>${Object.keys(CATEGORIES).map((c) => html`<option value="${c}"${params[k] === c ? html` selected` : ''}>${categoryLabel(c)}</option>`)}</select>
        </div>`
      : html`<div class="param" data-param="${k}">${input(`param_${k}`, PARAM_LABELS[k], params[k], {
        type: k === 'start' || k === 'end' ? 'time' : 'number', error: errors[`param_${k}`],
        attrs: k === 'probability' ? html`step="0.01" min="0.01" max="1"` : k === 'n' ? html`step="1" min="1" max="1000"` : '',
      })}</div>`))}
  </fieldset>
  <fieldset class="radio-group${errors.kind ? ' field-error' : ''}">
    <legend>Shows as</legend>
    ${errors.kind ? html`<p class="error-text">${errors.kind}</p>` : ''}
    ${[['known', 'Known: name and progress shown'], ['hidden', 'Hidden: "?" with the hint until earned'], ['lucky', 'Lucky: awarded at random (lucky rule)']].map(([k, label]) => html`<label class="check"><input type="radio" name="kind" value="${k}"${b.kind === k ? html` checked` : ''}> ${label}</label>`)}
  </fieldset>
  <label class="check"><input type="checkbox" name="enabled" value="1"${enabled ? html` checked` : ''}> Enabled. Disabling stops new awards; members keep badges they earned.</label>
  <button type="submit" class="btn btn-primary">${isNew ? 'Add badge' : 'Save badge'}</button>
</form>`, { scripts: ['/js/badge-form.js'] });
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
    <p class="muted">${p.display_name} (${p.email}) · <a href="/parks/${p.park_slug}">${p.park_name}</a> · ${p.visibility} · ${dateOf(p.created_at)}${p.hidden ? html` · <strong>Hidden</strong>` : ''}</p>
    ${toggle(`/admin/photos/${p.id}/hidden`, p.hidden, 'photo')}</div>
</li>`)}</ul>` : html`<p>No shared photos.</p>`}
<h2>Reviews</h2>
${queue.reviews.length ? html`<ul class="mod-list">${queue.reviews.map((r) => html`<li${r.comment_hidden ? html` class="is-hidden"` : ''}>
  <div><p class="review-text">${r.comment}</p>
    <p class="muted">${r.stars}★ · ${r.display_name} (${r.email}) · <a href="/parks/${r.park_slug}">${r.park_name}</a> · ${r.visibility} · ${dateOf(r.updated_at)}${r.comment_hidden ? html` · <strong>Hidden</strong>` : ''}</p>
    ${toggle(`/admin/reviews/${r.id}/hidden`, r.comment_hidden, 'comment')}</div>
</li>`)}</ul>` : html`<p>No shared reviews with comments.</p>`}`);
}

export function adminUsers({ users, csrf, me, error, notice, invites = [], inviteError = null, inviteValues = {} }) {
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

<h2>All members</h2>
<div class="table-wrap"><table class="admin-table">
  <caption class="visually-hidden">Members</caption>
  <thead><tr><th scope="col">Member</th><th scope="col">Parks</th><th scope="col">Joined</th><th scope="col">Admin</th></tr></thead>
  <tbody>${users.map((u) => html`<tr>
    <td data-label="Member">${u.display_name} <span class="muted">@${u.handle}</span><br><span class="muted">${u.email}</span></td>
    <td data-label="Parks">${u.parks}</td>
    <td data-label="Joined">${dateOf(u.created_at)}</td>
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

function jobPanel(job, aiAvailable, csrf) {
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
  <form method="post" action="/admin/city/generate">${csrfField(csrf)}
    <button type="submit" class="btn btn-pop"${!aiAvailable || running ? html` disabled` : ''}>${running ? 'Generating…' : 'Generate landmark drafts'}</button>
  </form>
</section>`;
}

function motifCard(m, csrf, editing = null) {
  const draft = m.status === 'draft';
  const ed = editing?.id === m.id ? editing : null;
  const val = ed ? ed.values : m;
  const err = ed?.errors || {};
  const action = (path, label, cls = 'btn btn-small') => html`<form method="post" action="/admin/city/motifs/${m.id}/${path}">${csrfField(csrf)}<button type="submit" class="${cls}">${label}</button></form>`;
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
    <form method="post" action="/admin/city/motifs/${m.id}">${csrfField(csrf)}
      ${ed ? html`<p class="error-text" role="alert" tabindex="-1" data-announce>Not saved. Fix the problems below.</p>` : ''}
      ${input(`name-${m.id}`, 'Name', val.name, { error: err.name })}
      ${textarea(`blurb-${m.id}`, 'Blurb', val.blurb, { error: err.blurb })}
      ${textarea(`svg-${m.id}`, 'Icon SVG', val.svg, { rows: 5, error: err.svg, hint: '48×48 line drawing: path, circle, ellipse, line, polyline, polygon or rect only.' })}
      <button type="submit" class="btn btn-small">Save ${m.name}</button>
    </form>
  </details>
</li>`;
}

export function adminCity({ csrf, theme, motifs, job, aiAvailable, errors = {}, values = null, notice = null, motifErrors = {}, motifValues = null, editing = null }) {
  const v = values || theme;
  const drafts = motifs.filter((m) => m.status === 'draft').length;
  return page('City theme', html`${crumb}<h1>City theme</h1>
<p class="lede">${theme.name}'s landmark icons, history and colors appear on stamps, the home page, passports and the footer.</p>
${notice ? html`<p class="notice" role="status">${notice}</p>` : ''}
${jobPanel(job, aiAvailable, csrf)}

<section aria-labelledby="motifs-h">
  <h2 id="motifs-h">Motifs <span class="count">(${motifs.length - drafts} live${drafts ? `, ${drafts} to review` : ''})</span></h2>
  <ul class="motif-admin">${motifs.map((m) => motifCard(m, csrf, editing))}</ul>
</section>

<section aria-labelledby="add-h">
  <h2 id="add-h">Add a motif by hand</h2>
  <form method="post" action="/admin/city/motifs/new" class="card-form admin-form">${csrfField(csrf)}
    ${errorSummary(motifErrors)}
    ${input('name', 'Name', motifValues?.name, { error: motifErrors.name, required: true })}
    ${textarea('blurb', 'Blurb (optional)', motifValues?.blurb, { error: motifErrors.blurb })}
    ${textarea('svg', 'Icon SVG', motifValues?.svg, { rows: 5, error: motifErrors.svg, hint: '<svg viewBox="0 0 48 48"> with path, circle, ellipse, line, polyline, polygon or rect shapes. The app adds the stroke.' })}
    <button type="submit" class="btn btn-primary">Add motif</button>
  </form>
</section>

<section aria-labelledby="settings-h">
  <h2 id="settings-h">Settings</h2>
  <form method="post" action="/admin/city/settings" class="card-form admin-form">${csrfField(csrf)}
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
