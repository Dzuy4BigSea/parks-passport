// Gary's outfits (SPEC Flow 22): Account › Gary's wardrobe and Admin › Gary.
import { html } from '../html.js';
import { csrfField } from '../forms.js';
import { garySvg } from '../gary-art.js';
import { STATUSES, CLASSIC } from '../../domain/outfits.js';
import { CONDITIONS } from '../../lib/weather.js';

const WEATHER_LABELS = { rain: '🌧️ Rain', snow: '❄️ Snow', cold: '🧣 Cold', hot: '☀️ Hot', mild: '🌤️ Mild' };
const weatherText = (list) => (list.length ? list.map((w) => WEATHER_LABELS[w]).join(', ') : 'Any day');

/** "Today in Bend: snowy, 28°F" (or nothing if the weather isn't known yet). */
const today = (city, weather) => (weather ? `Today in ${city.copy?.short || city.name}: ${CONDITIONS[weather.condition]}, ${weather.tempF}°F.` : '');

export function wardrobePage({ csrf, outfits, chosen, current, city, weather, badgeNames, notice = null }) {
  const owned = outfits.filter((o) => o.owned);
  const locked = outfits.filter((o) => !o.owned);
  if (!owned.some((o) => o.slug === chosen)) chosen = ''; // a pick that was hidden since: back to the weather
  const option = (value, checked, label, art, desc) => html`<label class="outfit-card${checked ? ' is-chosen' : ''}">
    <input type="radio" name="outfit" value="${value}"${checked ? html` checked` : ''}>
    ${art}<span class="outfit-name">${label}</span>${desc ? html`<span class="outfit-blurb">${desc}</span>` : ''}</label>`;
  return {
    title: 'Gary’s wardrobe',
    current: 'account',
    body: html`<div class="wardrobe">
<p class="breadcrumb"><a href="/account">Account</a></p>
<h1>Gary’s wardrobe</h1>
<p>Pick what Gary wears around the app, or let him dress for the weather where you’re exploring. Earn badges to unlock more.</p>
${notice ? html`<p class="notice" role="status">${notice}</p>` : ''}
<form method="post" action="/account/gary" class="wardrobe-form">
  ${csrfField(csrf)}
  <fieldset><legend class="visually-hidden">Gary’s outfit</legend>
  <div class="outfit-grid">
    ${option('', !chosen, 'Dress for the weather', garySvg(current.art, { id: 'w-auto', width: 140, height: 140, still: true }),
      today(city, weather) || 'He picks an outfit you have that suits today’s weather.')}
    ${owned.map((o) => option(o.slug, chosen === o.slug, o.name, garySvg(o.art, { id: `w-${o.slug}`, width: 140, height: 140, still: true }), o.blurb))}
  </div>
  </fieldset>
  <button type="submit" class="btn btn-primary">Save</button>
</form>
${locked.length ? html`<h2>Still to unlock</h2>
<ul class="outfit-grid is-locked">${locked.map((o) => html`<li class="outfit-card is-locked">
  ${garySvg(o.art, { id: `l-${o.slug}`, width: 140, height: 140, still: true, className: 'is-silhouette' })}
  <span class="outfit-name">${o.name}</span>
  <span class="outfit-blurb">Earn ${[...new Set(o.unlock_badges.map((b) => badgeNames[b] || b))].join(' or ')} to unlock.</span></li>`)}</ul>` : ''}
</div>`,
  };
}

export function adminGaryPage({ csrf, outfits, badges, notice = null, error = null }) {
  const badgeName = Object.fromEntries(badges.map((b) => [b.slug, b.name]));
  const counts = Object.fromEntries(Object.keys(STATUSES).map((s) => [s, outfits.filter((o) => o.status === s).length]));
  return {
    title: 'Admin · Gary',
    current: 'admin',
    body: html`<p class="breadcrumb"><a href="/admin">Admin</a></p>
<h1>Gary’s outfits</h1>
<p>Drafts to review: approve the ones members can wear, hide the rest. Starters are for everyone; the others unlock when a member holds any of their badges. “Dress for the weather” (the default) picks an outfit the member owns for today’s weather in the city they’re viewing.</p>
<p class="muted">${counts.approved} approved · ${counts.draft} drafts · ${counts.hidden} hidden</p>
${notice ? html`<p class="notice" role="status">${notice}</p>` : ''}
${error ? html`<p class="error-text" role="alert">${error}</p>` : ''}
<ul class="outfit-admin">${outfits.map((o) => html`<li class="outfit-admin-card card" id="outfit-${o.slug}">
  ${garySvg(o.art, { id: `a-${o.slug}`, width: 160, height: 160, label: `Gary in the ${o.name} outfit` })}
  <div>
    <p><span class="status-pill${o.status === 'approved' ? ' ok' : ''}">${STATUSES[o.status]}</span> ${o.starter ? html`<span class="status-pill">Starter</span>` : ''}</p>
    <form method="post" action="/admin/gary/${o.slug}" class="admin-form">
      ${csrfField(csrf)}
      <div class="field"><label for="name-${o.slug}">Name</label><input type="text" id="name-${o.slug}" name="name" value="${o.name}" maxlength="40" required></div>
      <div class="field"><label for="blurb-${o.slug}">Blurb</label><textarea id="blurb-${o.slug}" name="blurb" rows="2" maxlength="160">${o.blurb}</textarea></div>
      <p class="muted">Suits: ${weatherText(o.weather)}</p>
      ${o.slug === CLASSIC ? html`<p class="muted">Everyone always has Classic.</p>` : html`<label class="check"><input type="checkbox" name="starter" value="1"${o.starter ? html` checked` : ''}> Starter (everyone has it)</label>
      <div class="field"><label for="unlock-${o.slug}">Or unlocked by any of these badges</label>
        <select id="unlock-${o.slug}" name="unlock_badges" multiple size="4">${badges.map((b) => html`<option value="${b.slug}"${o.unlock_badges.includes(b.slug) ? html` selected` : ''}>${b.name}</option>`)}</select></div>`}
      <button type="submit" class="btn btn-small">Save<span class="visually-hidden"> ${o.name}</span></button>
    </form>
    ${o.slug === CLASSIC ? '' : html`<div class="actions">${['approved', 'hidden'].filter((s) => s !== o.status).map((s) => html`<form method="post" action="/admin/gary/${o.slug}/status">${csrfField(csrf)}<input type="hidden" name="status" value="${s}">
      <button type="submit" class="btn btn-small${s === 'approved' ? ' btn-primary' : ' btn-quiet'}">${s === 'approved' ? 'Approve' : 'Hide'}<span class="visually-hidden"> ${o.name}</span></button></form>`)}</div>`}
    ${o.unlock_badges.length && !o.starter ? html`<p class="muted">Unlocks with: ${o.unlock_badges.map((b) => badgeName[b] || b).join(', ')}</p>` : ''}
  </div>
</li>`)}</ul>`,
  };
}

