import { html } from '../html.js';
import { formatDate, localDate } from '../../domain/time.js';
import { csrfField } from '../forms.js';

// A pal request can be answered right here while it's open (SPEC Flow 8).
function palRequestActions(n, csrf) {
  if (n.kind !== 'pal_request') return '';
  if (n.request_id) {
    const button = (action, label, cls) => html`<form method="post" action="/pals/requests/${n.request_id}/${action}">
      ${csrfField(csrf)}<input type="hidden" name="from" value="notifications">
      <button type="submit" class="btn btn-small ${cls}">${label}</button></form>`;
    return html`<span class="request-actions">${button('accept', 'Accept', 'btn-primary')}${button('decline', 'Decline', 'btn-quiet')}</span>`;
  }
  return html`<span class="muted request-answered">${n.now_pals ? "You're Park Pals now." : 'Answered.'}</span>`;
}

// Group invites (Join / Decline) and requests to my group (Approve / Decline), while open (SPEC Flow 23).
function groupActions(n, csrf) {
  const g = n.group;
  if (!g) return '';
  if (g.state !== 'open') {
    const text = g.state === 'gone' ? 'No longer open.' : g.state === 'answered' ? 'Answered.'
      : g.kind === 'invite' ? 'You joined.' : 'They\u2019re in.';
    return html`<span class="muted request-answered">${text}</span>`;
  }
  const button = (url, label, cls) => html`<form method="post" action="${url}">
      ${csrfField(csrf)}<input type="hidden" name="from" value="notifications">
      <button type="submit" class="btn btn-small ${cls}">${label}</button></form>`;
  return g.kind === 'invite'
    ? html`<span class="request-actions">${button(`/groups/invites/${g.id}/accept`, 'Join', 'btn-primary')}${button(`/groups/invites/${g.id}/decline`, 'Decline', 'btn-quiet')}</span>`
    : html`<span class="request-actions">${button(`/groups/${g.id}/requests/${g.userId}/approve`, 'Approve', 'btn-primary')}${button(`/groups/${g.id}/requests/${g.userId}/decline`, 'Decline', 'btn-quiet')}</span>`;
}

const ICON = { badge: '🏅', gift: '🎁', level: '🚀', pal_request: '👋', pal_new: '🤝', group_invite: '👥', group_request: '🙋', group_joined: '🎉', group_ended: '🏁', message: '💌' };

// Notification center (SPEC Flow 8). Items that were unread when the page opened are marked "New".
export function notificationsPage({ items, page, hasMore, unreadIds, timeZone, csrf = '', notice = null }) {
  return {
    title: 'Notifications',
    current: 'notifications',
    body: html`<div class="narrow">
<h1>Notifications</h1>
${notice ? html`<p class="notice" role="status" tabindex="-1" data-announce>${notice}</p>` : ''}
${items.length ? html`<ul class="notifications">${items.map((n) => html`<li class="notification${unreadIds.has(n.id) ? ' is-new' : ''}">
  <span class="feed-icon" aria-hidden="true">${ICON[n.kind] || '🔔'}</span>
  <p>${unreadIds.has(n.id) ? html`<span class="new-pill">New</span> ` : ''}${n.link ? html`<a href="${n.link}">${n.text}</a>` : n.text}
  <br><span class="muted">${formatDate(localDate(new Date(n.created_at), timeZone))}</span></p>${palRequestActions(n, csrf)}${groupActions(n, csrf)}</li>`)}</ul>`
  : html`<p>Nothing yet. Badges you earn, level-ups and Park Pal news show up here.</p>`}
${page > 1 || hasMore ? html`<nav class="pager" aria-label="Notification pages">
  ${page > 1 ? html`<a href="/notifications?page=${page - 1}">Newer</a>` : ''}
  ${hasMore ? html`<a href="/notifications?page=${page + 1}">Older</a>` : ''}
</nav>` : ''}
</div>`,
  };
}
