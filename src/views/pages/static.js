import { html } from '../html.js';
import { ICONS } from '../icons.js';
import { motifIcon } from '../motif.js';
import { nextUpCards } from '../nextup.js';

const tiles = (motifs) => motifs.map((m, i) => html`<span class="tile" style="--i:${i}">${motifIcon(m)}</span>`);

function lore(theme, { limit = 6, heading = `${theme.tagline || theme.name} lore` } = {}) {
  if (!theme.motifs.length) return '';
  return html`<section aria-labelledby="lore-h">
  <h2 id="lore-h">${heading}</h2>
  <ul class="lore">${theme.motifs.slice(0, limit).map((m, i) => html`<li class="reveal" style="--i:${i}">
    <span class="tile">${motifIcon(m)}</span><div><h3>${m.name}</h3><p>${m.blurb}</p></div></li>`)}</ul>
</section>`;
}

// A different piece of city lore each day, for members coming back.
function loreOfTheDay(theme, today) {
  if (!theme.motifs.length) return '';
  const day = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86400000);
  const m = theme.motifs[day % theme.motifs.length];
  return html`<section aria-labelledby="lore-h">
  <h2 id="lore-h">Today's ${theme.tagline || theme.name} story</h2>
  <ul class="lore"><li><span class="tile">${motifIcon(m)}</span><div><h3>${m.name}</h3><p>${m.blurb}</p></div></li></ul>
</section>`;
}

function landing({ total, theme }) {
  return html`<section class="hero">
  <div>
    <p class="eyebrow">St. Petersburg, Florida</p>
    <h1>Your passport to St. Pete parks</h1>
    <p class="lede">${total} parks to explore. Stamp each one you visit, collect badges, and explore with your Park Pals.</p>
    <div class="hero-actions">
      <a class="btn btn-pop btn-big" href="/signup">Start your passport ${ICONS.arrow}</a>
      <a class="btn btn-big" href="/parks">Find a park</a>
    </div>
  </div>
  ${theme.motifs.length ? html`<div class="hero-motifs" aria-hidden="true">${tiles(theme.motifs.slice(0, 6))}</div>` : ''}
</section>

<section aria-labelledby="how-h">
  <h2 id="how-h">How it works</h2>
  <ol class="steps">
    <li class="reveal" style="--i:0"><strong>Find a park</strong><p>Search ${total} parks or sort by what's closest to you.</p></li>
    <li class="reveal" style="--i:1"><strong>Tap Stamp</strong><p>One tap checks you in by GPS. No signal? The honor system works too.</p></li>
    <li class="reveal" style="--i:2"><strong>Level up</strong><p>Earn points, unlock badges (some are secret) and race your Park Pals.</p></li>
  </ol>
</section>
${lore(theme)}`;
}

function dashboard({ user, total, theme, dash, today }) {
  const first = String(user.display_name).split(/\s+/)[0];
  const pct = total ? Math.round((dash.stamped / total) * 100) : 0;
  const levelPct = Math.round(dash.level.progress * 100);
  return html`<div class="dash-hello">
  <div><p class="eyebrow">${theme.tagline || 'Welcome back'}</p><h1>Hi, ${first}</h1></div>
</div>
<div class="dash-grid">
  <a class="stamp-cta" href="/stamp"><span class="fab-lg">${ICONS.stamp}</span>
    <span><strong>Stamp a park</strong><span class="sub">At a park? One tap and it's in your passport.</span></span></a>
  <div class="passport-cover dash-progress">
    <div>
      <p class="eyebrow">Your passport</p>
      <p class="passport-count"><strong>${dash.stamped} of ${total} parks stamped</strong></p>
      <p><span class="level-name">${dash.level.name}</span> · ${dash.points} points</p>
      <span class="bar bar-level" role="progressbar" aria-label="Progress to ${dash.level.next ? dash.level.next.name : 'the top level'}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${levelPct}"><span style="width:${levelPct}%"></span></span>
      <p class="level-next">${dash.level.next ? `${dash.level.toNext} points to ${dash.level.next.name}` : 'Top level reached!'}</p>
    </div>
    <div class="ring" style="--p:${pct}" aria-hidden="true"><span><strong>${pct}%</strong><small>explored</small></span></div>
  </div>
</div>
${nextUpCards(dash.next)}
${loreOfTheDay(theme, today)}`;
}

export function homePage({ total, theme, user = null, dash = null, today = '' }) {
  return {
    title: null,
    body: user && dash ? dashboard({ user, total, theme, dash, today }) : landing({ total, theme }),
  };
}

// Completed further in M4–M7 (visits, photos, ratings) and M9 (analytics and consent).
export function privacyPage() {
  return {
    title: 'Privacy',
    body: html`<div class="narrow prose">
<h1>Privacy</h1>
<p>Parks Passport is an independent, personal project. It is not run by the City of St. Petersburg.</p>

<h2>What we store when you create an account</h2>
<ul>
  <li>Your email address, used to sign you in and to send sign-in, password reset and account deletion links.</li>
  <li>Your display name and a handle.</li>
  <li>Your password, stored only as a one-way scrypt hash. We can't read it.</li>
</ul>

<h2>What we store when you use it</h2>
<ul>
  <li>Your visits (park, date and how you stamped). For GPS check-ins we keep the position your phone reported, privately: it's never shown to anyone, including other Park Pals.</li>
  <li>Photos you upload. All metadata, including location, is removed from every photo.</li>
  <li>Ratings and comments you write.</li>
  <li>Who can see each of these follows your settings: only you, your Park Pals, or anyone.</li>
</ul>

<h2>Cookies</h2>
<ul>
  <li><strong>pp_session</strong> (essential): keeps you signed in (30 days).</li>
  <li><strong>pp_csrf</strong> (essential): protects forms from being submitted by other sites.</li>
  <li><strong>pp_consent</strong> (essential): remembers your cookie choice (6 months).</li>
  <li><strong>_ga, _ga_*</strong> (optional, only if you accept analytics): Google Analytics.</li>
</ul>
<p>Change your choice any time in <a href="/consent">Cookie settings</a>.</p>

<h2 id="analytics">Analytics</h2>
<ul>
  <li><strong>Umami</strong> (always on, no cookies): counts page views and the actions listed below, without identifying you. It runs on our own server.</li>
  <li><strong>Google Analytics 4</strong>, through Google Tag Manager (only with your consent): the same page views and actions, with cookies. Without consent, Google receives cookieless signals only, as Google Consent Mode describes.</li>
</ul>
<p>Actions we count: sign up, log in, viewing or searching parks, stamping a park (and how), uploading a photo, rating a park (stars only),
earning a badge or level, creating or accepting a Park Pals invite, answering the share prompt, and changing cookie choices.
These never include your email, name, handle, comments, captions or location.</p>

<h2>Email</h2>
<p>Emails are sent through SendGrid, which processes your address only to deliver them.</p>

<h2>Invitations</h2>
<p>If an admin invites you by email, we store your address, the name they typed (if any), who invited you and when, so we can send the invitation and show whether you joined. The link expires after 30 days.</p>

<h2>Deleting your data</h2>
<p>You can delete your account from the <a href="/account">Account</a> page. That removes your account and everything in it right away.</p>
</div>`,
  };
}

// Photo credits for the city's background photos (CC BY needs credit, a link and the license).
export function creditsPage({ theme, credits }) {
  return {
    title: 'Photo credits',
    body: html`<div class="narrow">
<h1>Photo credits</h1>
<p>The softened background photos of ${theme.name} are used under free licenses. Thank you to the photographers.</p>
<ul class="credits-list">${credits.map((c) => html`<li class="card">
  <img src="${c.file}" alt="" width="160" height="107" loading="lazy">
  <div><h2>${c.title}</h2>
  <p>By ${c.author} · <a href="${c.licenseUrl}" rel="noopener license">${c.license}</a> · <a href="${c.source}" rel="noopener">Source</a></p>
  <p class="muted">${c.changes}</p></div>
</li>`)}</ul>
<p>The app's own icons, illustrations and design are by Big Sea for Parks Passport.</p>
</div>`,
  };
}
