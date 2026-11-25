import { html } from '../html.js';
import { csrfField } from '../forms.js';
import { ICONS } from '../icons.js';
import { feedbackFields } from '../layout.js';
import { KINDS } from '../../domain/feedback.js';
import { formatDate, localDate } from '../../domain/time.js';

const dateOf = (iso) => formatDate(localDate(new Date(iso)));
const crumb = html`<p class="breadcrumb"><a href="/admin">Admin</a></p>`;

// ---------- Feedback (SPEC Flow 16) ----------

export function feedbackPage({ csrf, page = '', sent = false, error = null, values = {} }) {
  return {
    title: 'Feedback',
    current: 'feedback',
    body: html`<div class="narrow feedback-page">
<p class="feedback-eyebrow">${ICONS.sparkle} Founding explorer</p>
${sent
    ? html`<p class="feedback-heart" aria-hidden="true">💛</p><h1>Thank you. We read every one.</h1>
  <p><a href="/">Back to Parks Passport</a></p>`
    : html`<h1>You're one of our first explorers. Tell us anything.</h1>
  <p>Ideas, bugs, things you love: it all shapes what we build next.</p>
  <form method="post" action="/feedback" class="card-form feedback-form" novalidate>
    ${csrfField(csrf)}<input type="hidden" name="page" value="${page}">
    ${error ? html`<p class="error-text" role="alert" tabindex="-1" data-announce>${error}</p>` : ''}
    ${feedbackFields({ kind: values.kind, text: values.text, idPrefix: 'fbp' })}
    <button type="submit" class="btn btn-primary">Send</button>
  </form>`}
</div>`,
  };
}

export function adminFeedbackPage({ csrf, items, done }) {
  return {
    title: 'Admin · Feedback',
    current: 'admin',
    body: html`${crumb}<h1>Feedback</h1>
<p>From Founding Members and Early Bird Edition holders.</p>
<nav class="tabs" aria-label="Filter feedback"><a href="/admin/feedback"${done ? '' : html` aria-current="page"`}>Open</a><a href="/admin/feedback?show=done"${done ? html` aria-current="page"` : ''}>Done</a></nav>
${items.length ? html`<ul class="idea-list">${items.map((f) => html`<li class="idea-card">
  <p class="idea-line"><strong>${KINDS[f.kind]}</strong>: ${f.text}</p>
  <p class="muted">${f.display_name} (@${f.handle}) · ${dateOf(f.created_at)}${f.page ? html` · on <a href="${f.page}">${f.page}</a>` : ''}</p>
  <form method="post" action="/admin/feedback/${f.id}">${csrfField(csrf)}<input type="hidden" name="done" value="${done ? '0' : '1'}">
    <button type="submit" class="btn btn-small">${done ? 'Reopen' : 'Mark done'}<span class="visually-hidden"> feedback ${f.id}</span></button></form>
</li>`)}</ul>` : html`<p>${done ? 'Nothing marked done yet.' : 'No open feedback. 🎉'}</p>`}`,
  };
}
