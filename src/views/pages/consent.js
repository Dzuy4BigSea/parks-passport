import { html } from '../html.js';
import { csrfField } from '../forms.js';

export function consentPage({ csrf, consent, back, saved }) {
  return {
    title: 'Cookie settings',
    body: html`<div class="narrow">
<h1>Cookie settings</h1>
${saved ? html`<p class="notice" role="status" tabindex="-1" data-announce>Saved.</p>` : ''}
<p>Essential cookies keep you signed in and protect forms; they're always on. Privacy-friendly visit counts (Umami) use no cookies.
These settings cover the optional ones. <a href="/privacy#analytics">More about what we collect</a>.</p>
<form method="post" action="/consent" class="card-form">
  ${csrfField(csrf)}
  <input type="hidden" name="choice" value="custom"><input type="hidden" name="back" value="${back}">
  <fieldset class="radio-group">
    <legend>Optional cookies</legend>
    <label class="check"><input type="checkbox" name="analytics" value="1"${consent.analytics ? html` checked` : ''}> Analytics: Google Analytics measures how the site is used</label>
    <label class="check"><input type="checkbox" name="ads" value="1"${consent.ads ? html` checked` : ''}> Advertising: lets Google use visits for ads measurement (we don't run ads)</label>
  </fieldset>
  <button type="submit" class="btn btn-primary">Save my choices</button>
</form>
<p><a href="${back}">Back</a></p>
</div>`,
  };
}
