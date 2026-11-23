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

<h2>Cookies</h2>
<ul>
  <li><strong>pp_session</strong>: keeps you signed in (30 days).</li>
  <li><strong>pp_csrf</strong>: protects forms from being submitted by other sites.</li>
</ul>
<p>Both are essential. We don't set advertising or tracking cookies.</p>

<h2>Email</h2>
<p>Emails are sent through SendGrid, which processes your address only to deliver them.</p>

<h2>Deleting your data</h2>
<p>You can delete your account from the <a href="/account">Account</a> page. That removes your account and everything in it right away.</p>
</div>`,
  };
}
