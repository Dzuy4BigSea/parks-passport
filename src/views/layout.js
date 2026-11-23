import { html, raw } from './html.js';
import { inlineJson } from '../lib/analytics.js';
import { badgeArt } from './badge-art.js';

/**
 * Page shell. `head` adds per-page tags (e.g. Leaflet CSS); `scripts` are module URLs loaded with defer.
 * `current` marks the active nav item.
 */
function announcementsBlock(a) {
  if (!a) return '';
  return html`<div class="announcements" role="status" tabindex="-1" data-announce>
  ${a.levelUp ? html`<div class="announce announce-level"><span class="announce-art" aria-hidden="true">⬆️</span>
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

export function layout({ title, body, head = null, scripts = [], current = '', user = null, csrf = '', announcements = null, nudge = null,
  analytics = null, consent = { chosen: true, analytics: false, ads: false }, events = [], showConsentBanner = false, path = '/' }) {
  const nav = user
    ? [['/parks', 'Parks', 'parks'], ['/passport', 'Passport', 'passport'], ['/pals', 'Pals', 'pals'], ['/account', 'Account', 'account'],
      ...(user.is_admin ? [['/admin', 'Admin', 'admin']] : [])]
    : [['/parks', 'Parks', 'parks'], ['/login', 'Log in', 'login']];
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title ? `${title} · Parks Passport` : 'Parks Passport · St. Pete parks'}</title>
<meta name="description" content="Stamp every St. Petersburg park you visit, earn badges, and explore with your Park Pals.">
<meta name="theme-color" content="#1d4a35">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<link rel="stylesheet" href="/css/app.css">
${analyticsHead(analytics, consent, events)}
${head}
${scripts.map((src) => html`<script type="module" src="${src}"></script>`)}
<script type="module" src="/js/announce.js"></script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="/"><img src="/icons/icon.svg" alt="" width="32" height="32"><span>Parks Passport</span></a>
    <nav aria-label="Main">
      <ul class="nav-list">
        ${nav.map(([href, label, key]) => html`<li><a href="${href}"${key === current ? html` aria-current="page"` : ''}>${label}</a></li>`)}
        ${user ? html`<li class="nav-logout"><form method="post" action="/logout"><input type="hidden" name="_csrf" value="${csrf}"><button type="submit" class="nav-button">Log out</button></form></li>` : ''}
      </ul>
    </nav>
  </div>
</header>
${showConsentBanner ? consentBanner(csrf, path) : ''}
<main id="main" class="wrap" tabindex="-1">${announcementsBlock(announcements)}${nudge}${body}</main>
<footer class="site-footer">
  <div class="wrap">
    <p>An independent project. Not affiliated with the City of St. Petersburg.</p>
    <p><a href="/privacy">Privacy</a>${analytics?.gtmId ? html` · <a href="/consent?back=${encodeURIComponent(path)}" id="cookie-settings">Cookie settings</a>` : ''}</p>
  </div>
</footer>
</body>
</html>`;
}
