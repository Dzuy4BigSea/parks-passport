import { html } from './html.js';

export function layout({ title, body }) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title ? `${title} · Parks Passport` : 'Parks Passport'}</title>
<link rel="stylesheet" href="/css/app.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header"><a class="brand" href="/">Parks Passport</a></header>
<main id="main">${body}</main>
<footer class="site-footer">
  <p>An independent project. Not affiliated with the City of St. Petersburg.</p>
</footer>
</body>
</html>`;
}
