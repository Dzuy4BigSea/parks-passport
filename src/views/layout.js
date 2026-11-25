import { html, raw } from './html.js';
import { inlineJson } from '../lib/analytics.js';
import { badgeArt } from './badge-art.js';
import { ICONS, BRAND_MARK } from './icons.js';
import { motifIcon } from './motif.js';
import { photosFor } from '../domain/city-photos.js';
import { cityPath } from './urls.js';

/**
 * Page shell. `head` adds per-page tags (e.g. Leaflet CSS); `scripts` are module URLs loaded with defer.
 * `current` marks the active nav item.
 */
function announcementsBlock(a, base) {
  if (!a) return '';
  return html`<div class="announcements" role="status" tabindex="-1" data-announce>
  ${a.levelUp ? html`<div class="announce announce-level" data-kind="level"><span class="announce-art" aria-hidden="true">🚀</span>
    <p><strong>Level up! You're now ${/^[AEIOU]/.test(a.levelUp.name) ? 'an' : 'a'} ${a.levelUp.name}.</strong></p></div>` : ''}
  ${a.badges.map((b) => html`<div class="announce" data-kind="${b.given_by ? 'gift' : b.kind}">${badgeArt(b.art, 'announce-art')}
    <p><strong>New badge: ${b.name}</strong>${b.description ? html`<br>${b.description}` : ''}${b.given_by ? html`<br><span class="gift-note">From ${b.given_by}${b.award_note ? `: “${b.award_note}”` : ''}</span>` : ''}</p></div>`)}
  <p class="announce-more"><a href="${base}/passport#badges">See your badges</a></p>
</div>`;
}

// Consent Mode v2 defaults (all denied) are set before GTM loads, then the saved choice is
// applied; queued events go to dataLayer (and to Umami via /js/analytics.js).
function analyticsHead(a, consent, events) {
  const gtm = Boolean(a?.gtmId);
  const umami = Boolean(a?.umamiWebsiteId);
  return html`<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500});
(function (c) {
  if (c.analytics) gtag('consent', 'update', {analytics_storage: 'granted'});
  if (c.ads) gtag('consent', 'update', {ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted'});
})(${raw(inlineJson({ analytics: consent.analytics, ads: consent.ads }))});
window.__ppEvents = ${raw(inlineJson(events))};
window.__ppEvents.forEach(function (e) { dataLayer.push(e); });
${gtm ? raw("dataLayer.push({'gtm.start': new Date().getTime(), event: 'gtm.js'});") : ''}
</script>
${gtm ? html`<script async src="${a.gtmScriptOrigin}/gtm.js?id=${a.gtmId}"></script>` : ''}
${umami ? html`<script defer src="${a.umamiScriptUrl}" data-website-id="${a.umamiWebsiteId}" data-host-url="${a.umamiHostUrl}"></script>` : ''}
<script type="module" src="/js/analytics.js"></script>
${gtm ? html`<script type="module" src="/js/consent.js"></script>` : ''}`;
}

// First-party consent banner, in the page flow (never covering content). Accept and Reject are
// equally prominent; Settings opens the full choices.
function consentBanner(csrf, back) {
  const form = (choice, label, cls) => html`<form method="post" action="/consent" class="consent-form">
    <input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="choice" value="${choice}"><input type="hidden" name="back" value="${back}">
    <button type="submit" class="btn ${cls}">${label}</button></form>`;
  return html`<div class="wrap"><section class="consent-banner" aria-labelledby="consent-h" id="consent-banner">
  <h2 id="consent-h">Cookies</h2>
  <p>We use Google Analytics cookies to see how the site is used, only if you agree. Privacy-friendly counts without cookies run either way.
  <a href="/privacy#analytics">Details</a></p>
  <div class="actions">${form('accept', 'Accept', 'btn-primary')}${form('reject', 'Reject', 'btn-primary')}
    <a class="btn btn-quiet" href="/consent?back=${encodeURIComponent(back)}">Settings</a></div>
</section></div>`;
}

const OG_ALT = 'Parks Passport: stamp every St. Pete park you visit. Gary the park guide waves in front of the St. Pete Pier at sunrise.';

export const DEFAULT_DESCRIPTION = 'Check in at every St. Petersburg park you visit, collect stamps and badges, rate your favorites and explore with your Park Pals.';

// Link previews (Open Graph / Twitter). Image and URLs must be absolute; canonicalPath is the
// pathname only (never the query string) and is null on pages whose URL carries a secret.
function shareMeta({ title, description, baseUrl, canonicalPath, theme, shareImages }) {
  const url = canonicalPath ? baseUrl + canonicalPath : null;
  // A city's own share image (public/og/<key>.jpg, scripts/make-og-image.js) when it has one.
  const own = theme?.key && shareImages?.has(`${theme.key}.jpg`);
  const image = baseUrl + (own ? `/og/${theme.key}.jpg` : '/og/parks-passport.jpg');
  const alt = (own || theme?.key === 'st-pete') && theme.copy?.og_alt ? theme.copy.og_alt : OG_ALT;
  return html`<meta property="og:type" content="website">
<meta property="og:site_name" content="Parks Passport">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
${url ? html`<meta property="og:url" content="${url}">
<link rel="canonical" href="${url}">` : ''}
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${alt}">
<meta name="twitter:card" content="summary_large_image">`;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const aria = (on) => (on ? html` aria-current="page"` : '');

// Phones: members navigate with a bottom tab bar whose center button stamps the nearest park.
function tabBar(current, base) {
  const tab = (href, label, key, icon) => html`<li><a href="${href}"${aria(key === current)}>${icon}<span>${label}</span></a></li>`;
  return html`<nav class="tabbar" aria-label="Quick">
  <ul>
    ${tab(`${base}/parks`, 'Parks', 'parks', ICONS.parks)}
    ${tab(`${base}/passport`, 'Passport', 'passport', ICONS.passport)}
    <li><a href="/stamp" class="tab-stamp"${aria(current === 'stamp')}><span class="fab">${ICONS.stamp}</span><span>Stamp</span></a></li>
    ${tab('/pals', 'Pals', 'pals', ICONS.pals)}
    ${tab('/account', 'Account', 'account', ICONS.account)}
  </ul>
</nav>`;
}

// Small "you're on a roll" pills in the phone header (streak, points).
// The notification center's bell, with how many are unread.
function bell(unread, here) {
  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  return html`<a class="pill pill-bell${unread ? ' has-unread' : ''}" href="/notifications" aria-label="${label}"${here ? html` aria-current="page"` : ''}>${ICONS.bell}${unread ? html`<span class="bell-count" aria-hidden="true">${unread > 99 ? '99+' : unread}</span>` : ''}</a>`;
}

export function statusPills(status) {
  if (!status) return '';
  const { streak, points } = status;
  return html`${streak.weeks ? html`<span class="pill pill-streak${streak.activeThisWeek ? '' : ' is-cold'}">${ICONS.flame}<span>${streak.weeks}<span class="visually-hidden">-week streak</span></span></span>` : ''}
<span class="pill pill-points"><span>${points}<span class="visually-hidden"> points</span></span><span aria-hidden="true"> pts</span></span>`;
}

export function layout({ title, body, head = null, scripts = [], current = '', user = null, csrf = '', announcements = null, nudge = null,
  analytics = null, consent = { chosen: true, analytics: false, ads: false }, events = [], showConsentBanner = false, path = '/',
  theme = null, cities = [], status = null, description = null, baseUrl = '', canonicalPath = null, shareImages = null }) {
  // Parks and Passport links stay in the city being viewed (SPEC Flow 14).
  const base = theme?.key && theme.key !== 'default' ? cityPath(theme) : '';
  const nav = user
    ? [[`${base}/parks`, 'Parks', 'parks'], [`${base}/passport`, 'Passport', 'passport'], ['/pals', 'Pals', 'pals'], ['/account', 'Account', 'account'],
      ...(user.is_admin ? [['/admin', 'Admin', 'admin']] : [])]
    : [[`${base}/parks`, 'Parks', 'parks'], ['/login', 'Log in', 'login']];
  const city = theme?.name && theme.key !== 'default' ? theme.name : null;
  const short = theme?.copy?.short || city;
  description = description || theme?.copy?.description || DEFAULT_DESCRIPTION;
  // City accent colors and background photos (paths come from our own registry, never input).
  const photos = theme ? photosFor(theme.key) : null;
  const photoVars = photos ? Object.entries(photos).map(([role, p]) => `--photo-${role}:url(${p.file});`).join('') : '';
  const accents = theme && HEX.test(theme.accent) && HEX.test(theme.accent_2)
    ? html`<style>:root{--city-accent:${theme.accent};--city-accent-2:${theme.accent_2};${raw(photoVars)}}</style>` : '';
  const fullTitle = title ? `${title} · Parks Passport` : `Parks Passport · ${short || 'St. Pete'} parks`;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${fullTitle}</title>
<meta name="description" content="${description}">
${shareMeta({ title: fullTitle, description, baseUrl, canonicalPath, theme, shareImages })}
<meta name="theme-color" content="#f6f1e7">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<link rel="preload" href="/fonts/bricolage-grotesque.woff2" as="font" type="font/woff2" crossorigin>
<script>document.documentElement.classList.add('js')</script>
<link rel="stylesheet" href="/css/app.css">
${accents}
${analyticsHead(analytics, consent, events)}
${head}
${scripts.map((src) => html`<script type="module" src="${src}"></script>`)}
<script type="module" src="/js/announce.js"></script>
${announcements ? html`<script type="module" src="/js/reveal.js"></script>` : ''}
</head>
<body${user ? html` class="has-tabbar"` : ''}>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="/">${BRAND_MARK}<span class="brand-text">Parks Passport${city ? html` <span class="brand-city">${city}</span>` : ''}</span></a>
    ${user ? html`<div class="header-chips">${statusPills(status)}${bell(status?.unread || 0, current === 'notifications')}${user.is_admin ? html`<a class="pill" href="/admin">Admin</a>` : ''}</div>` : ''}
    <nav aria-label="Main" class="site-nav">
      <ul class="nav-list">
        ${nav.map(([href, label, key]) => html`<li><a href="${href}"${aria(key === current)}>${label}</a></li>`)}
        ${user
          ? html`<li><a href="/stamp" class="nav-cta"${aria(current === 'stamp')}>${ICONS.stamp}Stamp</a></li>
        <li class="nav-logout"><form method="post" action="/logout"><input type="hidden" name="_csrf" value="${csrf}"><button type="submit" class="nav-button">Log out</button></form></li>`
          : html`<li class="nav-signup"><a href="/signup" class="nav-cta">Get started</a></li>`}
      </ul>
    </nav>
  </div>
</header>
${showConsentBanner ? consentBanner(csrf, path) : ''}
<main id="main" class="wrap" tabindex="-1">${announcementsBlock(announcements, base)}${nudge}${body}</main>
<footer class="site-footer">
  <div class="wrap">
    ${theme?.motifs?.length ? html`<div class="motif-strip" aria-hidden="true">${theme.motifs.map((m) => motifIcon(m))}</div>` : ''}
    ${city ? html`<p class="footer-city">Made for ${theme.copy?.made_for || (theme.tagline ? `the ${theme.tagline}` : city)}.</p>` : ''}
    <p>An independent project. Not affiliated with ${theme?.copy?.official || 'any city government'}.</p>
    ${cities.length > 1 ? html`<nav class="footer-cities" aria-label="Cities"><p>Cities: ${cities.map((c, i) => html`${i ? ' · ' : ''}<a href="${cityPath(c)}"${c.key === theme?.key ? html` aria-current="page"` : ''}>${c.copy.short}</a>`)}</p></nav>` : ''}
    <p><a href="/privacy">Privacy</a>${photos ? html` · <a href="/credits">Photo credits</a>` : ''}${analytics?.gtmId ? html` · <a href="/consent?back=${encodeURIComponent(path)}" id="cookie-settings">Cookie settings</a>` : ''}</p>
    <p class="credit"><span>© ${new Date().getFullYear()} Parks Passport</span>
      <a class="bigsea" href="https://bigsea.co" rel="noopener" title="Purpose built by Big Sea"><span>Purpose built by</span><img src="/brand/bigsea-logo.svg" alt="Big Sea" width="54" height="15"></a></p>
  </div>
</footer>
${user ? tabBar(current, base) : ''}
</body>
</html>`;
}
