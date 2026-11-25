import { parkPath } from '../urls.js';
import { html } from '../html.js';
import { badgeArt } from '../badge-art.js';
import { csrfField } from '../forms.js';
import { METHOD_LABELS } from '../../domain/visits.js';
import { formatDate, localDate } from '../../domain/time.js';
import { VISIBILITY_LABELS } from '../../domain/visibility.js';

function feedItem(item) {
  const who = html`<a href="/u/${item.user.handle}">${item.user.display_name}</a>`;
  const when = formatDate(localDate(new Date(item.at)));
  if (item.type === 'stamp') {
    return html`<li class="feed-item"><span class="feed-icon" aria-hidden="true">✓</span>
  <p>${who} stamped <a href="${parkPath({ city_key: item.city_key, slug: item.park_slug })}">${item.park_name}</a>
  <span class="muted">${formatDate(item.visited_on)} · ${METHOD_LABELS[item.method]}</span></p></li>`;
  }
  if (item.type === 'photo') {
    return html`<li class="feed-item feed-photo"><a href="/photos/${item.photo_id}/full"><img src="/photos/${item.photo_id}/thumb" alt="${item.caption || `Photo of ${item.park_name}`}" width="72" height="72" loading="lazy"></a>
  <p>${who} added a photo of <a href="${parkPath({ city_key: item.city_key, slug: item.park_slug })}">${item.park_name}</a> <span class="muted">${when}</span></p></li>`;
  }
  return html`<li class="feed-item">${badgeArt(item.badge_art, 'feed-icon')}
  <p>${who} earned the <strong>${item.badge_name}</strong> badge <span class="muted">${when}</span></p></li>`;
}

export function palsPage({ user, csrf, inviteUrl, pals, board, feed, page, notice }) {
  return {
    title: 'Park Pals',
    current: 'pals',
    scripts: ['/js/copy.js'],
    body: html`
<h1>Park Pals</h1>
${notice ? html`<p class="notice" role="status">${notice}</p>` : ''}
${user.default_visibility === 'private' ? html`<p class="notice">Your passport is private, so your pals can't see your stamps yet.
  <a href="/account#visibility">Change who can see it</a>.</p>` : ''}

<section aria-labelledby="invite-h" class="card-form">
  <h2 id="invite-h">Invite a pal</h2>
  <p>Send this link to a friend. When they open it and accept, you'll be Park Pals.</p>
  <div class="copy-row">
    <label for="invite-link" class="visually-hidden">Your invite link</label>
    <input id="invite-link" type="text" readonly value="${inviteUrl}">
    <button type="button" class="btn" data-copy="#invite-link" hidden>Copy link</button>
  </div>
  <form method="post" action="/pals/invite/regenerate" class="inline-form">
    ${csrfField(csrf)}
    <button type="submit" class="btn btn-quiet">Make a new link (the old one stops working)</button>
  </form>
</section>

<section aria-labelledby="board-h">
  <h2 id="board-h">Leaderboard</h2>
  <ol class="leaderboard">
    ${board.map((r, i) => html`<li${r.id === user.id ? html` class="me"` : ''}>
      <span class="rank">${i + 1}</span>
      <span class="who">${r.id === user.id ? 'You' : html`<a href="/u/${r.handle}">${r.display_name}</a>`}</span>
      <span class="score">${r.parks} ${r.parks === 1 ? 'park' : 'parks'} · ${r.points} pts</span>
    </li>`)}
  </ol>
  ${pals.length === 0 ? html`<p>Invite a friend to see how you compare.</p>` : ''}
</section>

<section aria-labelledby="feed-h">
  <h2 id="feed-h">What your pals are up to</h2>
  ${feed.items.length ? html`<ul class="feed">${feed.items.map(feedItem)}</ul>` : html`<p>Nothing yet. Pals' stamps and badges show up here when they share their passport with you.</p>`}
  <nav class="pager" aria-label="Feed pages">
    ${page > 1 ? html`<a href="/pals?page=${page - 1}">Newer</a>` : ''}
    ${feed.hasMore ? html`<a href="/pals?page=${page + 1}">Older</a>` : ''}
  </nav>
</section>

<section aria-labelledby="list-h">
  <h2 id="list-h">Your pals (${pals.length})</h2>
  ${pals.length ? html`<ul class="pal-list">
    ${pals.map((p) => html`<li>
      <span>${p.visible ? html`<a href="/u/${p.handle}">${p.display_name}</a>` : p.display_name} <span class="muted">@${p.handle}</span></span>
      <form method="post" action="/pals/${p.handle}/remove">
        ${csrfField(csrf)}
        <button type="submit" class="btn btn-quiet btn-small" aria-label="Remove ${p.display_name} as a pal">Remove</button>
      </form>
    </li>`)}
  </ul>` : html`<p>No pals yet.</p>`}
</section>`,
  };
}

export function invitePage({ inviter, user, csrf, token, state }) {
  const here = `/pals/invite/${token}`;
  let action;
  if (!user) {
    action = html`<p><a class="btn btn-primary" href="/signup?next=${encodeURIComponent(here)}">Create your passport</a>
      <a class="btn" href="/login?next=${encodeURIComponent(here)}">Log in</a></p>`;
  } else if (state === 'self') {
    action = html`<p>This is your own invite link. Send it to a friend.</p><p><a href="/pals">Back to Park Pals</a></p>`;
  } else if (state === 'already') {
    action = html`<p>You're already Park Pals.</p><p><a href="/pals">See your pals</a></p>`;
  } else {
    action = html`<form method="post" action="${here}/accept" class="card-form">
      ${csrfField(csrf)}
      <p>You'll see each other's stamps and badges whenever you each share your passport with Park Pals.</p>
      <button type="submit" class="btn btn-primary">Accept and become Park Pals</button>
    </form>`;
  }
  return {
    title: `${inviter.display_name} invited you`,
    body: html`<div class="narrow">
<h1>${inviter.display_name} invited you to be Park Pals</h1>
${action}
</div>`,
  };
}

export function visibilityForm({ csrf, user }) {
  return html`<section id="visibility" aria-labelledby="vis-h">
<h2 id="vis-h">Who can see my passport</h2>
<p>This covers your stamps and badges, and is the starting setting for new photos and reviews.</p>
<form method="post" action="/account/visibility" class="card-form">
  ${csrfField(csrf)}
  <fieldset class="radio-group">
    <legend class="visually-hidden">Passport visibility</legend>
    ${['private', 'pals', 'public'].map((v) => html`<label class="check"><input type="radio" name="default_visibility" value="${v}"${user.default_visibility === v ? html` checked` : ''}> ${VISIBILITY_LABELS[v]}</label>`)}
  </fieldset>
  ${user.default_visibility === 'public' ? html`<p class="hint">Your public passport: <a href="/u/${user.handle}">/u/${user.handle}</a></p>` : ''}
  <button type="submit" class="btn btn-primary">Save</button>
</form>
</section>`;
}

// Nudge shown after a stamp or badge while the passport is private (until dismissed 3 times).
export function shareNudge({ csrf, back }) {
  return html`<div class="nudge">
  <p><strong>Share your passport with Park Pals?</strong> Right now only you can see your stamps.</p>
  <div class="actions">
    <form method="post" action="/account/visibility">${csrfField(csrf)}
      <input type="hidden" name="default_visibility" value="pals"><input type="hidden" name="back" value="${back}"><input type="hidden" name="source" value="nudge">
      <button type="submit" class="btn btn-primary btn-small">Share with Park Pals</button></form>
    <form method="post" action="/account/nudge/dismiss">${csrfField(csrf)}
      <input type="hidden" name="back" value="${back}">
      <button type="submit" class="btn btn-quiet btn-small">Not now</button></form>
  </div>
</div>`;
}
