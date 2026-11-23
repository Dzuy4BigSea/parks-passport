import { html } from '../html.js';

export function homePage({ total }) {
  return {
    title: null,
    body: html`<section class="hero">
  <p class="eyebrow">St. Petersburg, Florida</p>
  <h1>Your passport to St. Pete parks</h1>
  <p class="lede">${total} parks to explore. Stamp each one you visit, collect badges, and explore with your Park Pals.</p>
  <p><a class="btn btn-primary" href="/parks">Find a park</a></p>
</section>`,
  };
}

// Stub; completed in M3 (accounts) and M9 (analytics and consent).
export function privacyPage() {
  return {
    title: 'Privacy',
    body: html`<h1>Privacy</h1>
<p>Parks Passport is a personal project. This page will list exactly what we collect,
who can see it, and how to delete it before accounts open.</p>
<p>Right now the site sets no cookies and stores nothing about visitors.</p>`,
  };
}
