// Admin › Ads (SPEC Flow 25), and the no-JS page for an activity tip.
import { html } from '../html.js';
import { csrfField, errorSummary } from '../forms.js';
import { PLACEMENTS, SCOPES, AD_LIMITS } from '../../domain/ads.js';
import { CATEGORIES } from '../../domain/categories.js';
import { formatDate } from '../../domain/time.js';
import { tipContent } from '../ads.js';

const crumb = html`<p class="breadcrumb"><a href="/admin">Admin</a> › <a href="/admin/ads">Ads</a></p>`;
const STATE_CLASS = { Running: 'is-running', Scheduled: 'is-scheduled', Ended: 'is-ended', Off: 'is-off', Paused: 'is-off' };
const day = (d) => formatDate(d);

export function adminAdsPage({ ads }) {
  return {
    title: 'Admin · Ads',
    current: 'admin',
    body: html`<p class="breadcrumb"><a href="/admin">Admin</a></p><h1>Nonprofit ads</h1>
<p>Ads for nonprofits: 300×250 images at the bottom of park pages or the passport, or tips on an activity. New ads are off;
an ad shows only while it's on and between its dates. One per page, at random among those that match.</p>
<p><a class="btn btn-primary" href="/admin/ads/new">Make an ad</a> <a class="btn btn-quiet" href="/admin/nonprofits">Nonprofits</a></p>
${ads.length ? html`<div class="table-wrap"><table class="admin-table">
  <caption class="visually-hidden">Ads</caption>
  <thead><tr><th scope="col">Ad</th><th scope="col">Shows</th><th scope="col">Dates</th><th scope="col">Views · clicks (30 days)</th></tr></thead>
  <tbody>${ads.map((a) => html`<tr>
    <td data-label="Ad"><div class="ad-row">${a.first_key ? html`<img src="/ad-art/${a.first_key}.webp" alt="" width="60" height="50" loading="lazy">` : ''}
      <span><a href="/admin/ads/${a.id}">${a.name}</a> <span class="flag ${STATE_CLASS[a.state]}">${a.state}</span><br>
      <span class="muted">${a.nonprofit_name} · ${a.slide_count} image${a.slide_count === 1 ? '' : 's'}</span></span></div></td>
    <td data-label="Shows">${a.placement === 'activity' ? `Tip on "${a.activity_name}"` : PLACEMENTS[a.placement]}<br>
      <span class="muted">${a.all_cities ? 'All cities' : a.city_names}${a.placement !== 'passport' && a.park_scope !== 'all' ? ` · ${SCOPES[a.park_scope].toLowerCase()}` : ''}</span></td>
    <td data-label="Dates">${day(a.starts_on)} to ${day(a.ends_on)}</td>
    <td data-label="Views · clicks">${a.views_30} · ${a.clicks_30}<br><span class="muted">All time: ${a.views} · ${a.clicks}</span></td>
  </tr>`)}</tbody>
</table></div>` : html`<p>No ads yet.</p>`}`,
  };
}

const inputField = (name, label, value, { error, hint, type = 'text', max, attrs = '' } = {}) => html`<div class="field${error ? ' field-error' : ''}">
  <label for="${name}">${label}</label>
  ${hint ? html`<p class="hint" id="${name}-hint">${hint}</p>` : ''}
  ${error ? html`<p class="error-text" id="${name}-error">${error}</p>` : ''}
  <input id="${name}" name="${name}" type="${type}" value="${value ?? ''}"${max ? html` maxlength="${max}"` : ''}${attrs}${hint || error ? html` aria-describedby="${[hint ? `${name}-hint` : '', error ? `${name}-error` : ''].filter(Boolean).join(' ')}"` : ''}${error ? html` aria-invalid="true"` : ''}>
</div>`;
const checked = (on) => (on ? html` checked` : '');
const selected = (on) => (on ? html` selected` : '');
const box = (name, value, label, on) => html`<label class="check"><input type="checkbox" name="${name}" value="${value}"${checked(on)}> ${label}</label>`;

function imagesSection({ ad, csrf, slideError, slideAlt }) {
  const full = ad.slides.length >= AD_LIMITS.slides;
  return html`<section id="images" aria-labelledby="images-h" class="card-form">
  <h2 id="images-h">Images (${ad.slides.length} of ${AD_LIMITS.slides})</h2>
  <p class="hint">300×250: JPEG, PNG, WebP or GIF, up to 10 MB, at least 300×250 (cropped to fit). Animated GIF and WebP stay animated. Two or more make a slider.</p>
  ${ad.slides.length ? html`<ol class="ad-slide-admin">${ad.slides.map((s, i) => html`<li>
    <img src="/ad-art/${s.image_key}.webp" alt="" width="150" height="125" loading="lazy">
    <div><p>${s.alt}${s.animated ? html` <span class="flag">Animated</span>` : ''}</p>
    <div class="inline-actions">
      ${i ? html`<form method="post" action="/admin/ads/${ad.id}/slides/${s.id}/up">${csrfField(csrf)}<button type="submit" class="btn btn-small btn-quiet">Move up<span class="visually-hidden">: image ${i + 1}</span></button></form>` : ''}
      ${i < ad.slides.length - 1 ? html`<form method="post" action="/admin/ads/${ad.id}/slides/${s.id}/down">${csrfField(csrf)}<button type="submit" class="btn btn-small btn-quiet">Move down<span class="visually-hidden">: image ${i + 1}</span></button></form>` : ''}
      <form method="post" action="/admin/ads/${ad.id}/slides/${s.id}/delete">${csrfField(csrf)}<button type="submit" class="btn btn-small btn-quiet">Remove<span class="visually-hidden">: image ${i + 1}</span></button></form>
    </div></div>
  </li>`)}</ol>` : html`<p>No images yet. The ad can't be switched on until it has one.</p>`}
  ${full ? '' : html`<form method="post" action="/admin/ads/${ad.id}/slides" enctype="multipart/form-data" class="add-slide">
    ${csrfField(csrf)}
    ${slideError ? html`<p class="error-text" role="alert" tabindex="-1" data-announce>${slideError}</p>` : ''}
    <div class="field"><label for="image">Add an image</label><input type="file" id="image" name="image" accept="image/jpeg,image/png,image/webp,image/gif" required></div>
    ${inputField('alt', 'What it shows (for people who can\'t see it)', slideAlt, { max: AD_LIMITS.alt, attrs: html` required` })}
    <button type="submit" class="btn">Add image</button>
  </form>`}
</section>`;
}

export function adminAdForm({ csrf, cities, nonprofits, activities, parksByCity, today, ad = null, isNew = false, values = null, errors = {}, notice = null, slideError = null, slideAlt = '' }) {
  const base = ad || {
    name: '', nonprofit_id: null, placement: 'park', activity_id: null, title: '', body: '', active: 0,
    starts_on: today, ends_on: today, all_cities: 1, cities: [], park_scope: 'all', categories: [], areas: [], parks: [],
  };
  const a = values ? { ...base, ...values } : base;
  const parkIds = (a.parks || []).map(Number);
  return {
    title: `Admin · ${isNew ? 'Make an ad' : ad.name}`,
    current: 'admin',
    body: html`${crumb}
<h1>${isNew ? 'Make an ad' : `Edit ${ad.name}`}</h1>
${notice ? html`<p class="notice" role="status" tabindex="-1" data-announce>${notice}</p>` : ''}
${errorSummary(errors)}
${nonprofits.length ? '' : html`<p class="notice">Ads belong to a nonprofit. <a href="/admin/nonprofits/new">Add a nonprofit</a> first.</p>`}
<form method="post" action="${isNew ? '/admin/ads/new' : `/admin/ads/${ad.id}`}" class="card-form admin-form ad-form" novalidate>
  ${csrfField(csrf)}
  ${inputField('name', 'Name (only admins see it)', a.name, { error: errors.name, max: AD_LIMITS.name })}
  <div class="field${errors.nonprofit_id ? ' field-error' : ''}">
    <label for="nonprofit_id">Nonprofit</label>
    ${errors.nonprofit_id ? html`<p class="error-text">${errors.nonprofit_id}</p>` : ''}
    <select id="nonprofit_id" name="nonprofit_id"><option value="">Choose…</option>${nonprofits.map((n) => html`<option value="${n.id}"${selected(Number(a.nonprofit_id) === n.id)}>${n.name}${n.status === 'paused' ? ' (paused: ads won\'t show)' : ''}</option>`)}</select>
    <p class="hint">Its name labels the ad, and a click goes to its website.</p>
  </div>

  <fieldset class="radio-group${errors.placement ? ' field-error' : ''}" id="placement"><legend>Where it shows</legend>
    ${Object.entries(PLACEMENTS).map(([k, label]) => html`<label class="check"><input type="radio" name="placement" value="${k}"${checked(a.placement === k)}> ${label}</label>`)}
  </fieldset>

  <fieldset class="for-activity" id="activity_id"><legend>Activity tip</legend>
    <p class="hint">Members see "Tips from …" on this activity once today's stamp unlocks it. It opens a pop-up with the image, heading and text.</p>
    <div class="field${errors.activity_id ? ' field-error' : ''}"><label for="activity">Activity</label>
      ${errors.activity_id ? html`<p class="error-text">${errors.activity_id}</p>` : ''}
      <select id="activity" name="activity_id"><option value="">Choose…</option>${activities.map((x) => html`<option value="${x.id}"${selected(Number(a.activity_id) === x.id)}>${x.name}${x.edition !== 'core' ? ` (${x.edition})` : ''}</option>`)}</select></div>
    ${inputField('title', 'Heading', a.title, { error: errors.title, max: AD_LIMITS.title })}
    <div class="field${errors.body ? ' field-error' : ''}" id="body-field"><label for="body">Tip text</label>
      <p class="hint" id="body-hint">Plain text, up to ${AD_LIMITS.body} characters. A blank line starts a new paragraph.</p>
      ${errors.body ? html`<p class="error-text" id="body-error">${errors.body}</p>` : ''}
      <textarea id="body" name="body" rows="7" maxlength="${AD_LIMITS.body}" aria-describedby="body-hint">${a.body}</textarea></div>
  </fieldset>

  <fieldset id="dates"><legend>Dates</legend>
    <p class="hint">Shown from the start date to the end date, inclusive, in each city's time zone, and only while switched on.</p>
    <div class="two-col">
      ${inputField('starts_on', 'Start date', a.starts_on, { type: 'date', error: errors.starts_on })}
      ${inputField('ends_on', 'End date', a.ends_on, { type: 'date', error: errors.ends_on })}
    </div>
  </fieldset>

  <fieldset class="radio-group${errors.cities ? ' field-error' : ''}" id="cities"><legend>Cities</legend>
    ${errors.cities ? html`<p class="error-text">${errors.cities}</p>` : ''}
    <label class="check"><input type="radio" name="all_cities" value="1"${checked(a.all_cities)}> All cities</label>
    <label class="check"><input type="radio" name="all_cities" value="0"${checked(!a.all_cities)}> These cities:</label>
    <div class="filter-grid ad-cities">${cities.map((c) => box('cities', c.id, c.name, (a.cities || []).map(Number).includes(c.id)))}</div>
  </fieldset>

  <fieldset class="radio-group for-parks${errors.park_scope ? ' field-error' : ''}" id="park_scope"><legend>Parks</legend>
    ${errors.park_scope ? html`<p class="error-text">${errors.park_scope}</p>` : ''}
    ${Object.entries(SCOPES).map(([k, label]) => html`<label class="check"><input type="radio" name="park_scope" value="${k}"${checked(a.park_scope === k)}> ${label}</label>`)}
    <div class="scope scope-categories"><p class="hint">Parks with any of these:</p><div class="filter-grid">
      ${Object.entries(CATEGORIES).map(([k, label]) => box('categories', k, label, (a.categories || []).includes(k)))}</div></div>
    <div class="scope scope-areas"><p class="hint">Parks in any of these neighborhoods:</p>
      ${cities.filter((c) => c.areas.length).map((c) => html`<details open><summary>${c.name}</summary><div class="filter-grid">
        ${c.areas.map((ar) => box('areas', `${c.id}:${ar.name}`, ar.name, (a.areas || []).includes(`${c.id}:${ar.name}`)))}</div></details>`)}</div>
    <div class="scope scope-parks"><p class="hint">Only these parks:</p>
      ${cities.map((c) => html`<details${(parksByCity[c.id] || []).some((p) => parkIds.includes(p.id)) ? html` open` : ''}><summary>${c.name}</summary><div class="filter-grid">
        ${(parksByCity[c.id] || []).map((p) => box('parks', p.id, p.name, parkIds.includes(p.id)))}</div></details>`)}</div>
  </fieldset>

  <fieldset id="active"><legend>Switched on</legend>
    ${errors.active ? html`<p class="error-text">${errors.active}</p>` : ''}
    <label class="check"><input type="checkbox" name="active" value="1"${checked(a.active)}> Show it between its dates</label>
  </fieldset>
  <button type="submit" class="btn btn-primary">${isNew ? 'Save and add images' : 'Save'}</button>
</form>
${isNew ? '' : html`${imagesSection({ ad, csrf, slideError, slideAlt })}
<form method="post" action="/admin/ads/${ad.id}/delete" class="inline-form">${csrfField(csrf)}
  <button type="submit" class="btn btn-quiet">Delete this ad and its counts</button></form>`}`,
  };
}

/** An activity tip as a page (no JS, or opened in a new tab). */
export function tipPage({ ad, park, back }) {
  return {
    title: `${ad.title} · Tips from ${ad.nonprofit_name}`,
    body: html`<div class="narrow tip-page">
<p class="breadcrumb"><a href="${back}">Back to ${park.name}</a></p>
${tipContent(ad, park, { page: true })}
</div>`,
    scripts: ['/js/ads.js'],
  };
}
