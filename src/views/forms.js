import { html } from './html.js';

export const csrfField = (token) => html`<input type="hidden" name="_csrf" value="${token}">`;

// Error summary for the top of a form; links jump to the fields.
export function errorSummary(errors, labels) {
  const entries = Object.entries(errors || {}).filter(([k]) => k !== 'form');
  const formError = errors?.form;
  if (!entries.length && !formError) return '';
  return html`<div class="error-summary" role="alert" tabindex="-1">
  <h2>There's a problem</h2>
  <ul>
    ${formError ? html`<li>${formError}</li>` : ''}
    ${entries.map(([k, msg]) => html`<li><a href="#${k}">${labels?.[k] ? `${labels[k]}: ` : ''}${msg}</a></li>`)}
  </ul>
</div>`;
}

export function field({ name, label, type = 'text', value = '', error, autocomplete, hint, required = true, maxlength }) {
  const describedBy = [hint ? `${name}-hint` : '', error ? `${name}-error` : ''].filter(Boolean).join(' ');
  return html`<div class="field${error ? ' field-error' : ''}">
  <label for="${name}">${label}</label>
  ${hint ? html`<p class="hint" id="${name}-hint">${hint}</p>` : ''}
  ${error ? html`<p class="error-text" id="${name}-error">${error}</p>` : ''}
  <input id="${name}" name="${name}" type="${type}" value="${type === 'password' ? '' : value}"${autocomplete ? html` autocomplete="${autocomplete}"` : ''}${required ? html` required` : ''}${maxlength ? html` maxlength="${maxlength}"` : ''}${describedBy ? html` aria-describedby="${describedBy}"` : ''}${error ? html` aria-invalid="true"` : ''}>
</div>`;
}

// Photo pickers. HEIC too, so iPhones send the original photo instead of converting it first.
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
