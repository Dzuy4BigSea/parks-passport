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

<h2>Deleting your data</h2>
<p>You can delete your account from the <a href="/account">Account</a> page. That removes your account and everything in it right away.</p>
</div>`,
  };
}
