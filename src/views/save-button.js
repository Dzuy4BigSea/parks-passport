import { html } from './html.js';
import { csrfField } from './forms.js';
import { ICONS } from './icons.js';

/**
 * The "Want to go" heart: a POST form that works without JS (public/js/want-to-go.js toggles it
 * in place). `saved` sends the state to set, not "toggle", so a repeated submit is harmless.
 * The accessible name stays fixed and aria-pressed carries the state.
 */
export function saveButton({ park, saved, csrf, back, label = false }) {
  return html`<form method="post" action="/parks/${park.slug}/save" class="save-form${label ? ' save-form-label' : ''}">
  ${csrfField(csrf)}<input type="hidden" name="saved" value="${saved ? '0' : '1'}"><input type="hidden" name="back" value="${back}">
  <button type="submit" class="save-btn" aria-pressed="${saved ? 'true' : 'false'}"${label ? '' : html` aria-label="Want to go: ${park.name}"`}>${ICONS.heart}${label ? html`<span>Want to go</span>` : ''}</button>
</form>`;
}
