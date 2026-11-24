import { html } from '../html.js';
import { ICONS } from '../icons.js';
import { motifIcon } from '../motif.js';
import { streakText } from '../nextup.js';
import { badgeArt } from '../badge-art.js';
import { postcard } from './parks.js';
import { motifForPark } from '../../domain/city.js';

const tiles = (motifs) => motifs.map((m, i) => html`<span class="tile" style="--i:${i}">${motifIcon(m)}</span>`);

function lore(theme, { limit = 6, heading = `${theme.tagline || theme.name} lore` } = {}) {
  if (!theme.motifs.length) return '';
  return html`<section aria-labelledby="lore-h">
  <h2 id="lore-h">${heading}</h2>
  <ul class="lore">${theme.motifs.slice(0, limit).map((m, i) => html`<li class="reveal" style="--i:${i}">
    <span class="tile">${motifIcon(m)}</span><div><h3>${m.name}</h3><p>${m.blurb}</p></div></li>`)}</ul>
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

<section class="meet-gary" aria-labelledby="gary-h">
  <img class="gary-art" src="/brand/gary.svg" alt="Gary, waving hello in his rope hat" width="240" height="280">
  <div class="gary-bubble">
    <p class="eyebrow">Meet your guide</p>
    <h2 id="gary-h">Hey, I'm Gary. Glad you're here.</h2>
    <p>I've been wandering St. Pete parks for years and I still find something new on most visits, like a heron fishing off a seawall or a shady bench I'd walked past a hundred times.</p>
    <p>Start with the park closest to you. Your first stamp counts as much as your fiftieth, and I'll be cheering for every one.</p>
  </div>
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

// ---- Signed-in home: Gary's briefing, the passport spread, what's close, and progress ----

const monthDay = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).toUpperCase();
};

// A postmark for the passport spread: ring with the park's motif, its name and the date.
const spreadStamp = (s, theme, i) => html`<li class="spread-stamp" style="--i:${i}">
  <a href="/parks/${s.slug}"><span class="spread-seal" aria-hidden="true">${motifIcon(motifForPark(theme, s.slug))}<span class="spread-date">${monthDay(s.visited_on)}</span></span>
  <span class="spread-name">${s.name}</span></a></li>`;

// "Your St. Pete": every park as a dot on a hand-drawn plane (no map tiles), stamped ones as seals.
function constellation(dots, areas) {
  const pins = dots.filter((p) => p.lat != null);
  if (!pins.length) return '';
  const lats = pins.map((p) => p.lat);
  const lngs = pins.map((p) => p.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const kx = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180); // keep the city's real proportions
  const W = 300;
  const H = Math.round((W * (maxLat - minLat)) / ((maxLng - minLng) * kx)) || 300;
  const P = 14;
  const x = (lng) => (P + ((lng - minLng) / (maxLng - minLng)) * (W - 2 * P)).toFixed(1);
  const y = (lat) => (P + ((maxLat - lat) / (maxLat - minLat)) * (H - 2 * P)).toFixed(1);
  const stampedCount = pins.filter((p) => p.stamped).length;
  return html`<a class="constellation" href="/parks">
  <span class="visually-hidden">Map of St. Pete parks: ${stampedCount} of ${pins.length} stamped. Open the parks map.</span>
  <svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
    ${areas.map((a) => html`<text class="c-area" x="${x(a.lng)}" y="${y(a.lat)}" text-anchor="middle">${a.name.split(' & ')[0]}</text>`)}
    ${pins.filter((p) => !p.stamped).map((p) => html`<circle class="c-dot${p.next ? ' is-next' : ''}" cx="${x(p.lng)}" cy="${y(p.lat)}" r="${p.next ? 4.5 : 2.6}"/>`)}
    ${pins.filter((p) => p.stamped).map((p) => html`<g class="c-stamp" transform="translate(${x(p.lng)} ${y(p.lat)})"><circle r="6.5"/><path d="M-2.6 0.2l1.8 1.9 3.6-4"/></g>`)}
  </svg>
</a>`;
}

function punchCard(punches, streak) {
  const s = streakText(streak);
  return html`<section class="home-card punch" aria-labelledby="punch-h">
  <h2 id="punch-h">Weekly streak</h2>
  <p class="punch-title">${s.title}</p>
  <ol class="punches" aria-label="Last ${punches.length} weeks">${punches.map((w) => html`<li class="${w.on ? 'on' : ''}${w.current ? ' current' : ''}"><span class="visually-hidden">Week of ${w.label}: ${w.on ? 'stamped' : 'no stamp'}</span><span aria-hidden="true">${w.on ? '✓' : ''}</span></li>`)}</ol>
  <p class="muted">${s.meta}</p>
</section>`;
}

function weekCard(week) {
  const bar = (label, value, goal, unit) => {
    const pct = Math.min(100, Math.round((value / goal) * 100));
    return html`<div class="goal"><p><strong>${value}</strong> / ${goal} ${unit} <span class="muted">${label}</span></p>
    <span class="bar" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${Math.min(value, goal)}"><span style="width:${pct}%"></span></span></div>`;
  };
  return html`<section class="home-card week" aria-labelledby="week-h">
  <h2 id="week-h">This week outside</h2>
  ${bar('moving', week.moveMinutes, 150, 'min')}
  ${bar('in parks', week.parkMinutes, 120, 'min')}
  <p class="muted">${week.count ? `${week.count} activities logged · ${week.miles} mi` : 'Stamp a park, then log a walk, a sit or a game there.'}</p>
</section>`;
}

function progressCard(almost, nextBadge) {
  return html`<section class="home-card almost" aria-labelledby="almost-h">
  <h2 id="almost-h">Almost there</h2>
  ${almost.length ? html`<ul class="almost-list">${almost.map((g) => html`<li>
    <span class="ring ring-sm" style="--p:${Math.round((g.stamped / g.total) * 100)}" aria-hidden="true"><strong>${g.stamped}</strong></span>
    <span><strong>${g.name}</strong><br><span class="muted">${g.total - g.stamped} to go of ${g.total}</span></span></li>`)}</ul>` : ''}
  ${nextBadge ? html`<a class="almost-badge" href="/passport#badges">${badgeArt(nextBadge.art, 'almost-art')}<span><strong>${nextBadge.name}</strong><br>
    <span class="muted">${nextBadge.progress} / ${nextBadge.target} ${nextBadge.unit}</span></span></a>` : ''}
</section>`;
}

function palsCard(items) {
  return html`<section class="home-card pals-mini" aria-labelledby="palsmini-h">
  <h2 id="palsmini-h">Park Pals</h2>
  ${items.length ? html`<ul class="feed">${items.map((i) => html`<li class="feed-item"><span class="feed-icon" aria-hidden="true">${i.type === 'badge' ? (i.badge_art || '🏅') : i.type === 'photo' ? '📷' : '📍'}</span>
    <p><strong>${i.user.display_name}</strong> ${i.type === 'stamp' ? html`stamped <a href="/parks/${i.park_slug}">${i.park_name}</a>` : i.type === 'photo' ? html`added a photo at <a href="/parks/${i.park_slug}">${i.park_name}</a>` : html`earned ${i.badge_name}`}</p></li>`)}</ul>
    <p><a href="/pals">See all</a></p>`
    : html`<p>Exploring is better with friends. Share your invite link and race each other to 102.</p><p><a class="btn btn-small" href="/pals">Invite a Park Pal</a></p>`}
</section>`;
}

function dashboard({ user, total, theme, dash }) {
  const first = String(user.display_name).split(/\s+/)[0];
  const pct = total ? Math.round((dash.stamped / total) * 100) : 0;
  const levelPct = Math.round(dash.level.progress * 100);
  const tip = dash.tip;
  const slots = Math.max(0, 4 - dash.recent.length);
  return html`<div class="home">
<section class="gary-brief" aria-labelledby="hello-h">
  <img class="gary-art" src="/brand/gary.svg" alt="" width="240" height="280">
  <div class="gary-bubble">
    <p class="eyebrow">${theme.tagline || 'Welcome back'}</p>
    <h1 id="hello-h">Hi, ${first}</h1>
    <p class="gary-says"><span class="visually-hidden">Gary says: </span>${tip.text}</p>
    <div class="actions">
      ${tip.action ? html`<a class="btn btn-pop" href="${tip.action.href}">${tip.action.label} ${ICONS.arrow}</a>` : ''}
      <a class="btn" href="/stamp">${ICONS.stamp}Stamp a park</a>
    </div>
  </div>
</section>

<section class="spread" aria-labelledby="spread-h">
  <h2 id="spread-h" class="visually-hidden">Your passport</h2>
  <div class="spread-page spread-left">
    <p class="eyebrow">Your passport</p>
    <p class="passport-count"><strong>${dash.stamped} of ${total} parks stamped</strong></p>
    <div class="spread-ring"><div class="ring" style="--p:${pct}" aria-hidden="true"><span><strong>${pct}%</strong><small>explored</small></span></div></div>
    <p><span class="level-name">${dash.level.name}</span> · ${dash.points} points</p>
    <span class="bar bar-level" role="progressbar" aria-label="Progress to ${dash.level.next ? dash.level.next.name : 'the top level'}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${levelPct}"><span style="width:${levelPct}%"></span></span>
    <p class="level-next">${dash.level.next ? `${dash.level.toNext} points to ${dash.level.next.name}` : 'Top level reached!'}</p>
  </div>
  <div class="spread-page spread-right">
    <p class="eyebrow">Latest stamps</p>
    <ul class="spread-stamps">
      ${dash.recent.map((s, i) => spreadStamp(s, theme, i))}
      ${Array.from({ length: slots }, (_, i) => html`<li class="spread-stamp is-empty" aria-hidden="true"><span class="spread-seal"></span><span class="spread-name">${i === 0 && !dash.recent.length ? 'Your first stamp goes here' : ''}</span></li>`)}
    </ul>
    <p><a href="/passport">Open your passport ${ICONS.arrow}</a></p>
  </div>
</section>

${dash.nearby.length ? html`<section class="home-near" aria-labelledby="near-h">
  <div class="section-head"><div><h2 id="near-h">Closest new parks</h2>
    <p class="muted">${dash.nearFromYou ? 'From where you are now' : dash.stamped ? 'Near your last stamp' : 'Around downtown'}</p></div>
    <div class="actions"><button type="button" class="btn btn-small js-only" id="home-locate">${ICONS.pin}Use my location</button>
    <a class="btn btn-small btn-quiet" href="/parks?unvisited=1">See all</a></div></div>
  <p id="home-locate-status" class="notice" role="status" aria-live="polite"></p>
  <ul class="park-list strip">${dash.nearby.map((p, i) => postcard(p, i, { theme, stamped: dash.stampedSet, stampDates: null, near: dash.nearFromYou ? dash.anchor : null, selected: [], extras: dash.extras }))}</ul>
</section>` : ''}

<div class="home-cards">
  ${punchCard(dash.punches, dash.streak)}
  ${weekCard(dash.week)}
  ${progressCard(dash.almost, dash.nextBadge)}
</div>

<div class="home-pair">
  <section class="home-card your-city" aria-labelledby="city-h">
    <h2 id="city-h">Your ${theme.key !== 'default' ? theme.name.replace('St. Petersburg', 'St. Pete') : 'city'}</h2>
    ${constellation(dash.dots, theme.areas)}
    <p class="muted"><span class="legend-dot stamped" aria-hidden="true"></span> stamped <span class="legend-dot next" aria-hidden="true"></span> closest new <span class="legend-dot" aria-hidden="true"></span> to find</p>
  </section>
  ${palsCard(dash.pals)}
</div>
</div>`;
}

export function homePage({ total, theme, user = null, dash = null, today = '' }) {
  return {
    title: null,
    scripts: user && dash ? ['/js/home.js'] : [],
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
