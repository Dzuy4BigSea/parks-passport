import { html } from './html.js';

/**
 * Page shell. `head` adds per-page tags (e.g. Leaflet CSS); `scripts` are module URLs loaded with defer.
 * `current` marks the active nav item.
 */
function announcementsBlock(a) {
  if (!a) return '';
  return html`<div class="announcements" role="status" tabindex="-1" data-announce>
  ${a.levelUp ? html`<div class="announce announce-level"><span class="announce-art" aria-hidden="true">⬆️</span>
    <p><strong>Level up! You're now ${/^[AEIOU]/.test(a.levelUp.name) ? 'an' : 'a'} ${a.levelUp.name}.</strong></p></div>` : ''}
  ${a.badges.map((b) => html`<div class="announce"><span class="announce-art" aria-hidden="true">${b.art}</span>
    <p><strong>New badge: ${b.name}</strong>${b.description ? html`<br>${b.description}` : ''}</p></div>`)}
  <p class="announce-more"><a href="/passport#badges">See your badges</a></p>
</div>`;
}

export function layout({ title, body, head = null, scripts = [], current = '', user = null, csrf = '', announcements = null, nudge = null }) {
  const nav = user
    ? [['/parks', 'Parks', 'parks'], ['/passport', 'Passport', 'passport'], ['/pals', 'Pals', 'pals'], ['/account', 'Account', 'account']]
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
<main id="main" class="wrap" tabindex="-1">${announcementsBlock(announcements)}${nudge}${body}</main>
<footer class="site-footer">
  <div class="wrap">
    <p>An independent project. Not affiliated with the City of St. Petersburg.</p>
    <p><a href="/privacy">Privacy</a></p>
  </div>
</footer>
</body>
</html>`;
}
