// Messages from the team (SPEC Flow 20): Admin › Messages (list, compose, review and publish) and
// the member's delivered messages (rendered by the layout, played by public/js/message.js).
import { html } from '../html.js';
import { csrfField, errorSummary } from '../forms.js';
import { badgeArt } from '../badge-art.js';
import { EFFECTS, AUDIENCES, TITLE_MAX, BODY_MAX, stateOf } from '../../domain/messages.js';

const page = (title, body, extra = {}) => ({ title: `Admin · ${title}`, current: 'admin', scripts: ['/js/message-admin.js'], ...extra, body });
const crumb = html`<p class="breadcrumb"><a href="/admin">Admin</a> › <a href="/admin/messages">Messages</a></p>`;
const STATE_LABELS = { draft: 'Draft', scheduled: 'Scheduled', live: 'Live', ended: 'Ended' };
const when = (iso, timeZone) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone, dateStyle: 'medium', timeStyle: 'short' }) : '');

/** The text with its line breaks, as paragraphs. */
const paragraphs = (text) => String(text || '').split(/\n{2,}/).filter(Boolean)
  .map((p) => html`<p>${p.split('\n').map((line, i) => html`${i ? html`<br>` : ''}${line}`)}</p>`);

/** Data the preview button reads: the effects' names and a sample text each. */
const effectPicker = (effect) => html`<fieldset class="effect-picker" id="effect">
  <legend>Effect</legend>
  ${Object.entries(EFFECTS).map(([key, e]) => html`<div class="effect-option">
    <label class="chip-check"><input type="radio" name="effect" value="${key}"${key === effect ? html` checked` : ''}> ${e.emoji} ${e.label}</label>
    <span class="hint">${e.hint}</span>
    <button type="button" class="btn btn-small btn-quiet" data-play-effect="${key}">Play<span class="visually-hidden"> ${e.label}</span></button>
  </div>`)}
</fieldset>`;

/** One delivered message, as the server renders it (the card without JS, the data for the dialog). */
export function teamMessageCard(m) {
  const e = EFFECTS[m.effect] || EFFECTS.celebrate;
  return html`<article class="team-message" data-effect="${m.effect}" aria-labelledby="tm-${m.id}">
  <p class="team-message-from"><img src="/brand/gary.svg" alt="" width="44" height="44" class="team-message-gary"> From the Parks Passport team</p>
  <h2 id="tm-${m.id}"><span class="team-message-emoji" aria-hidden="true">${e.emoji}</span> ${m.title}</h2>
  <div class="team-message-body">${paragraphs(m.body)}</div>
  ${m.badges?.length ? html`<ul class="team-message-badges" aria-label="Badges with this message">${m.badges.map((b) => html`<li>${badgeArt(b.art, 'team-message-badge-art')}<span>${b.name}</span></li>`)}</ul>` : ''}
</article>`;
}

export function teamMessagesBlock(messages) {
  if (!messages?.length) return '';
  return html`<section class="team-messages" data-messages aria-label="Messages from the team">${messages.map(teamMessageCard)}</section>`;
}

export function adminMessagesPage({ csrf, items, now, timeZone, notice = null }) {
  return page('Messages', html`<p class="breadcrumb"><a href="/admin">Admin</a></p>
<h1>Messages</h1>
<p>Short notes from the team that open with an animation on each member's next page: thank-yous, holiday greetings, giveaways, maintenance heads-ups. They can bring badges.</p>
${notice ? html`<p class="notice" role="status">${notice}</p>` : ''}
<p><a class="btn btn-primary" href="/admin/messages/new">Write a message</a></p>
${items.length ? html`<div class="table-wrap"><table class="admin-table">
  <caption class="visually-hidden">Messages</caption>
  <thead><tr><th scope="col">Message</th><th scope="col">Status</th><th scope="col">Seen by</th></tr></thead>
  <tbody>${items.map((m) => {
    const state = stateOf(m, now);
    return html`<tr>
    <td data-label="Message"><a href="/admin/messages/${m.id}">${(EFFECTS[m.effect] || EFFECTS.celebrate).emoji} ${m.title}</a><br>
      <span class="muted">${AUDIENCES[m.audience]}${m.audience_ref ? `: ${m.audience_ref}` : ''}${m.author ? ` · by ${m.author}` : ''}</span></td>
    <td data-label="Status"><span class="status-pill${state === 'live' ? ' ok' : ''}">${STATE_LABELS[state]}</span>
      ${m.starts_at || m.ends_at ? html`<br><span class="muted">${m.starts_at ? `From ${when(m.starts_at, timeZone)}` : ''}${m.starts_at && m.ends_at ? ' ' : ''}${m.ends_at ? `until ${when(m.ends_at, timeZone)}` : ''}</span>` : ''}</td>
    <td data-label="Seen by">${m.seen}</td>
  </tr>`;
  })}</tbody>
</table></div>` : html`<p>No messages yet.</p>`}`, { csrf });
}

/**
 * The compose form (new, or a draft being changed). `picked` lists the members a "picked" message
 * goes to ({ id, display_name }); they ride along as hidden fields.
 */
export function adminMessageForm({ csrf, id = null, values = {}, errors = {}, cities, badges, picked = [], timeZone }) {
  const v = { effect: 'celebrate', audience: picked.length ? 'picked' : 'everyone', existing_only: 1, badge_ids: [], ...values };
  const chosen = new Set((v.badge_ids || []).map(String));
  const err = (k) => (errors[k] ? html`<p class="error-text" id="${k}-error">${errors[k]}</p>` : '');
  const radio = (key, label, extra = '') => html`<label class="radio-row"><input type="radio" name="audience" value="${key}"${v.audience === key ? html` checked` : ''}> ${label}</label>${extra}`;
  return page(id ? 'Edit message' : 'Write a message', html`${crumb}
<h1>${id ? 'Edit message' : 'Write a message'}</h1>
${errorSummary(errors, { title: 'Title', body: 'Message', city: 'City', badge: 'Badge', badge_ids: 'Badges', starts_at: 'Show from', ends_at: 'Show until', audience: 'Audience' })}
<form method="post" action="/admin/messages${id ? `/${id}` : ''}" class="card-form admin-form message-form" novalidate data-message-form>
  ${csrfField(csrf)}
  <div class="field${errors.title ? ' field-error' : ''}"><label for="title">Title</label>${err('title')}
    <input type="text" id="title" name="title" value="${v.title || ''}" maxlength="${TITLE_MAX}" required placeholder="Happy Thanksgiving!"${errors.title ? html` aria-invalid="true" aria-describedby="title-error"` : ''}></div>
  <div class="field${errors.body ? ' field-error' : ''}"><label for="body">Message</label>
    <p class="hint" id="body-hint">Plain text, up to ${BODY_MAX} characters. Line breaks are kept.</p>${err('body')}
    <textarea id="body" name="body" rows="5" maxlength="${BODY_MAX}" aria-describedby="body-hint">${v.body || ''}</textarea></div>
  ${effectPicker(v.effect)}
  <p><button type="button" class="btn" data-preview>Preview this message</button></p>

  <fieldset class="field" id="audience"><legend>Who gets it</legend>${err('audience')}
    ${radio('everyone', AUDIENCES.everyone)}
    ${radio('city', AUDIENCES.city, html`<div class="field indent${errors.city ? ' field-error' : ''}"><label for="city">City</label>${err('city')}
      <select id="city" name="city"><option value="">Choose…</option>${cities.map((c) => html`<option value="${c.key}"${v.city === c.key || v.audience_ref === c.key ? html` selected` : ''}>${c.name}</option>`)}</select></div>`)}
    ${radio('badge', AUDIENCES.badge, html`<div class="field indent${errors.badge ? ' field-error' : ''}"><label for="badge">Badge</label>${err('badge')}
      <select id="badge" name="badge"><option value="">Choose…</option>${badges.map((b) => html`<option value="${b.slug}"${v.badge === b.slug || v.audience_ref === b.slug ? html` selected` : ''}>${b.name}</option>`)}</select></div>`)}
    ${picked.length || v.audience === 'picked' ? radio('picked', html`${AUDIENCES.picked}: ${picked.map((u) => u.display_name).join(', ') || 'none'}`) : ''}
    ${picked.map((u) => html`<input type="hidden" name="user_ids" value="${u.id}">`)}
    <p class="hint">To message a few people, tick them in <a href="/admin/users#members">Members</a> and choose “Message ticked members”.</p>
    <label class="check"><input type="checkbox" name="existing_only" value="1"${v.existing_only ? html` checked` : ''}> Only members who joined before it goes live</label>
  </fieldset>

  <fieldset class="field" id="badge_ids"><legend>Badges to give with it (optional)</legend>${err('badge_ids')}
    <p class="hint">Given when each member first sees the message, with its title as the note. Anyone who already has one is skipped.</p>
    <div class="badge-ticks">${badges.map((b) => html`<label class="chip-check"><input type="checkbox" name="badge_ids" value="${b.id}"${chosen.has(String(b.id)) ? html` checked` : ''}> ${b.name}</label>`)}</div>
  </fieldset>

  <fieldset class="field"><legend>When (optional)</legend>
    <p class="hint">In ${timeZone.replace(/_/g, ' ')} time. Leave empty to show it from when you publish until you end it.</p>
    <div class="field${errors.starts_at ? ' field-error' : ''}"><label for="starts_at">Show from</label>${err('starts_at')}
      <input type="datetime-local" id="starts_at" name="starts_at" value="${v.starts_local || ''}"></div>
    <div class="field${errors.ends_at ? ' field-error' : ''}"><label for="ends_at">Show until</label>${err('ends_at')}
      <input type="datetime-local" id="ends_at" name="ends_at" value="${v.ends_local || ''}"></div>
  </fieldset>
  <button type="submit" class="btn btn-primary">Save and review</button>
</form>`, { csrf });
}

/** A saved message: what members will see, who it reaches, and Publish / End. */
export function adminMessagePage({ csrf, m, state, reach, badges, picked, timeZone, notice = null }) {
  const e = EFFECTS[m.effect] || EFFECTS.celebrate;
  return page(m.title, html`${crumb}
<h1>${m.title}</h1>
${notice ? html`<p class="notice" role="status">${notice}</p>` : ''}
<p><span class="status-pill${state === 'live' ? ' ok' : ''}">${STATE_LABELS[state]}</span></p>
<div class="message-review card">
  ${teamMessageCard({ ...m, badges })}
  <p><button type="button" class="btn" data-preview-saved data-effect="${m.effect}">Preview with the ${e.label.toLowerCase()} effect</button></p>
</div>
<dl class="message-facts">
  <dt>Who gets it</dt><dd>${AUDIENCES[m.audience]}${m.audience_ref ? `: ${m.audience_ref}` : ''}${m.audience === 'picked' ? `: ${picked.map((u) => u.display_name).join(', ')}` : ''}${m.existing_only ? ' (members who joined before it went live)' : ''}</dd>
  <dt>When</dt><dd>${m.starts_at ? `From ${when(m.starts_at, timeZone)}` : 'As soon as it’s published'}${m.ends_at ? `, until ${when(m.ends_at, timeZone)}` : ', until you end it'}</dd>
  <dt>Reaches</dt><dd><strong data-reach>${reach} ${reach === 1 ? 'member' : 'members'}</strong> right now${m.status !== 'draft' ? html` · seen by ${m.seen} so far` : ''}</dd>
</dl>
${m.status === 'draft' ? html`<div class="actions">
  <form method="post" action="/admin/messages/${m.id}/publish" class="publish-form">${csrfField(csrf)}
    <label class="check"><input type="checkbox" name="confirm" value="1" required> Yes, send it to ${reach} ${reach === 1 ? 'member' : 'members'}</label>
    <button type="submit" class="btn btn-pop">Publish</button></form>
  <a class="btn" href="/admin/messages/${m.id}/edit">Edit</a>
  <form method="post" action="/admin/messages/${m.id}/delete">${csrfField(csrf)}<button type="submit" class="btn btn-quiet">Delete draft</button></form>
</div>
<p class="hint">Once it’s published it can’t be edited, only ended.</p>` : ''}
${state === 'live' || state === 'scheduled' ? html`<form method="post" action="/admin/messages/${m.id}/end">${csrfField(csrf)}
  <button type="submit" class="btn">End this message</button> <span class="hint">Members who haven’t seen it yet won’t.</span></form>` : ''}`, { csrf });
}
