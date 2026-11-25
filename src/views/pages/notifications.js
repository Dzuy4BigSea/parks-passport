import { html } from '../html.js';
import { formatDate, localDate } from '../../domain/time.js';

const ICON = { badge: '🏅', gift: '🎁', level: '🚀', pal_request: '👋', pal_new: '🤝' };

// Notification center (SPEC Flow 8). Items that were unread when the page opened are marked "New".
export function notificationsPage({ items, page, hasMore, unreadIds, timeZone }) {
  return {
    title: 'Notifications',
    current: 'notifications',
    body: html`<div class="narrow">
<h1>Notifications</h1>
${items.length ? html`<ul class="notifications">${items.map((n) => html`<li class="notification${unreadIds.has(n.id) ? ' is-new' : ''}">
  <span class="feed-icon" aria-hidden="true">${ICON[n.kind] || '🔔'}</span>
  <p>${unreadIds.has(n.id) ? html`<span class="new-pill">New</span> ` : ''}${n.link ? html`<a href="${n.link}">${n.text}</a>` : n.text}
  <br><span class="muted">${formatDate(localDate(new Date(n.created_at), timeZone))}</span></p></li>`)}</ul>`
  : html`<p>Nothing yet. Badges you earn, level-ups and Park Pal news show up here.</p>`}
${page > 1 || hasMore ? html`<nav class="pager" aria-label="Notification pages">
  ${page > 1 ? html`<a href="/notifications?page=${page - 1}">Newer</a>` : ''}
  ${hasMore ? html`<a href="/notifications?page=${page + 1}">Older</a>` : ''}
</nav>` : ''}
</div>`,
  };
}
