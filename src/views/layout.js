import { html, raw } from './html.js';
import { inlineJson } from '../lib/analytics.js';
import { badgeArt } from './badge-art.js';
import { ICONS, BRAND_MARK } from './icons.js';
import { motifIcon } from './motif.js';

/**
 * Page shell. `head` adds per-page tags (e.g. Leaflet CSS); `scripts` are module URLs loaded with defer.
 * `current` marks the active nav item.
 */
function announcementsBlock(a) {
  if (!a) return '';
  return html`<div class="announcements" role="status" tabindex="-1" data-announce>
  ${a.levelUp ? html`<div class="announce announce-level"><span class="announce-art" aria-hidden="true">🚀</span>
    <p><strong>Level up! You're now ${/^[AEIOU]/.test(a.levelUp.name) ? 'an' : 'a'} ${a.levelUp.name}.</strong></p></div>` : ''}
  ${a.badges.map((b) => html`<div class="announce">${badgeArt(b.art, 'announce-art')}
    <p><strong>New badge: ${b.name}</strong>${b.description ? html`<br>${b.description}` : ''}</p></div>`)}
  <p class="announce-more"><a href="/passport#badges">See your badges</a></p>
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

const HEX = /^#[0-9a-fA-F]{6}$/;
const aria = (on) => (on ? html` aria-current="page"` : '');

// Phones: members navigate with a bottom tab bar whose center button stamps the nearest park.
function tabBar(current) {
  const tab = (href, label, key, icon) => html`<li><a href="${href}"${aria(key === current)}>${icon}<span>${label}</span></a></li>`;
  return html`<nav class="tabbar" aria-label="Quick">
  <ul>
    ${tab('/parks', 'Parks', 'parks', ICONS.parks)}
    ${tab('/passport', 'Passport', 'passport', ICONS.passport)}
    <li><a href="/stamp" class="tab-stamp"${aria(current === 'stamp')}><span class="fab">${ICONS.stamp}</span><span>Stamp</span></a></li>
    ${tab('/pals', 'Pals', 'pals', ICONS.pals)}
    ${tab('/account', 'Account', 'account', ICONS.account)}
  </ul>
</nav>`;
}

// Small "you're on a roll" pills in the phone header (streak, points).
export function statusPills(status) {
  if (!status) return '';
  const { streak, points } = status;
  return html`${streak.weeks ? html`<span class="pill pill-streak${streak.activeThisWeek ? '' : ' is-cold'}">${ICONS.flame}<span>${streak.weeks}<span class="visually-hidden">-week streak</span></span></span>` : ''}
<span class="pill pill-points"><span>${points}<span class="visually-hidden"> points</span></span><span aria-hidden="true"> pts</span></span>`;
}

export function layout({ title, body, head = null, scripts = [], current = '', user = null, csrf = '', announcements = null, nudge = null,
  analytics = null, consent = { chosen: true, analytics: false, ads: false }, events = [], showConsentBanner = false, path = '/',
  theme = null, status = null }) {
  const nav = user
    ? [['/parks', 'Parks', 'parks'], ['/passport', 'Passport', 'passport'], ['/pals', 'Pals', 'pals'], ['/account', 'Account', 'account'],
      ...(user.is_admin ? [['/admin', 'Admin', 'admin']] : [])]
    : [['/parks', 'Parks', 'parks'], ['/login', 'Log in', 'login']];
  const city = theme?.name && theme.key !== 'default' ? theme.name : null;
  const accents = theme && HEX.test(theme.accent) && HEX.test(theme.accent_2)
    ? html`<style>:root{--city-accent:${theme.accent};--city-accent-2:${theme.accent_2}}</style>` : '';
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title ? `${title} · Parks Passport` : 'Parks Passport · St. Pete parks'}</title>
<meta name="description" content="Stamp every St. Petersburg park you visit, earn badges, and explore with your Park Pals.">
<meta name="theme-color" content="#f6f1e7">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<link rel="preload" href="/fonts/bricolage-grotesque.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/app.css">
${accents}
${analyticsHead(analytics, consent, events)}
${head}
${scripts.map((src) => html`<script type="module" src="${src}"></script>`)}
<script type="module" src="/js/announce.js"></script>
</head>
<body${user ? html` class="has-tabbar"` : ''}>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="/">${BRAND_MARK}<span class="brand-text">Parks Passport${city ? html` <span class="brand-city">${city}</span>` : ''}</span></a>
    ${user ? html`<div class="header-chips">${statusPills(status)}${user.is_admin ? html`<a class="pill" href="/admin">Admin</a>` : ''}</div>` : ''}
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
<main id="main" class="wrap" tabindex="-1">${announcementsBlock(announcements)}${nudge}${body}</main>
<footer class="site-footer">
  <div class="wrap">
    ${theme?.motifs?.length ? html`<div class="motif-strip" aria-hidden="true">${theme.motifs.map((m) => motifIcon(m))}</div>` : ''}
    ${city ? html`<p class="footer-city">Made for ${theme.tagline ? `the ${theme.tagline}` : city}.</p>` : ''}
    <p>An independent project. Not affiliated with the City of St. Petersburg.</p>
    <p><a href="/privacy">Privacy</a>${analytics?.gtmId ? html` · <a href="/consent?back=${encodeURIComponent(path)}" id="cookie-settings">Cookie settings</a>` : ''}</p>
  </div>
</footer>
${user ? tabBar(current) : ''}
</body>
</html>`;
}
