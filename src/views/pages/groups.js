// Groups (SPEC Flow 23): your groups, starting and joining one, and a group's page.
import { html } from '../html.js';
import { csrfField, errorSummary, field } from '../forms.js';
import { avatar } from '../avatar.js';
import { formatCode } from '../../domain/pals.js';
import { TROOP_LEADER_GPS, JOIN_UNLOCK_GPS, NAME_MAX, DESCRIPTION_MAX } from '../../domain/groups.js';
import { METRICS } from '../../domain/group-goals.js';
import { badgeArt } from '../badge-art.js';

const shortDate = (isoStr) => new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** A goal's progress bar (shared by the group page and the home card). */
export function goalBar(goal, total) {
  const pct = Math.min(100, Math.round((total / goal.target) * 100));
  return html`<span class="bar" role="progressbar" aria-label="${goal.title}" aria-valuemin="0" aria-valuemax="${goal.target}" aria-valuenow="${Math.min(total, goal.target)}"><span style="width:${pct}%"></span></span>`;
}

/** The group goal: under way (with each member's share), reached, or over; owners set the next one. */
function goalSection({ csrf, group, goal, progress, templates, teamBadges, errors = {} }) {
  const owner = group.is_owner;
  const unit = goal ? METRICS[goal.metric] : '';
  const card = goal ? html`<div class="goal-card${goal.reached_at ? ' is-reached' : ''}">
  <h3>${goal.badge_art ? html`${badgeArt(goal.badge_art, 'table-art')} ` : ''}${goal.title}</h3>
  <p><strong>${progress.total}</strong> of ${goal.target} ${unit}.
    ${goal.reached_at ? html`<strong>Reached ${shortDate(goal.reached_at)}!</strong> Everyone in the group got the ${goal.badge_name || 'team'} badge.`
      : goal.active ? `Until ${shortDate(goal.ends_at)}. Reach it and everyone gets the ${goal.badge_name || 'team'} badge.`
        : `Ended ${shortDate(goal.ends_at)}.`}</p>
  ${goalBar(goal, progress.total)}
  <ul class="goal-shares" aria-label="Each member's share">${progress.shares.map((s) => html`<li><span>${s.display_name}</span><span>${s.amount}</span></li>`)}</ul>
  ${owner && goal.active ? html`<form method="post" action="/groups/${group.id}/goal/stop" class="inline-form">${csrfField(csrf)}<button type="submit" class="btn btn-quiet btn-small">Stop this goal</button></form>` : ''}
</div>` : html`<p>${owner ? 'No goal yet. Pick one below.' : 'No goal yet. The owner picks one.'}</p>`;
  const form = owner && !goal?.active ? html`<form method="post" action="/groups/${group.id}/goal" class="card-form" novalidate>
  ${csrfField(csrf)}
  ${errorSummary(errors, { metric: 'Count', target: 'How many', days: 'Days' })}
  <fieldset class="radio-group"><legend>Next goal</legend>
    ${templates.map((t, i) => html`<label class="check"><input type="radio" name="template" value="${t.key}"${i === 0 ? html` checked` : ''}> ${t.title}</label>`)}
    <label class="check"><input type="radio" name="template" value="custom"> Our own goal:</label>
  </fieldset>
  <div class="inline-fields">
    <div class="field"><label for="metric">Count</label><select id="metric" name="metric">${Object.entries(METRICS).map(([k, label]) => html`<option value="${k}">${label}</option>`)}</select></div>
    ${field({ name: 'target', label: 'How many', type: 'number', value: '', error: errors.target, required: false })}
    ${field({ name: 'days', label: 'Days', type: 'number', value: '30', error: errors.days, required: false })}
    <div class="field"><label for="badge_id">Team badge</label><select id="badge_id" name="badge_id">${teamBadges.map((b) => html`<option value="${b.id}"${b.slug === 'team-effort' ? html` selected` : ''}>${b.name}</option>`)}</select></div>
  </div>
  <button type="submit" class="btn btn-pop">Start the goal</button>
</form>` : '';
  return html`<section aria-labelledby="goal-h" id="goal">
<h2 id="goal-h">Group goal</h2>
${card}
${form}
</section>`;
}

function suggestSection({ csrf, group }) {
  if (!group.is_owner) return '';
  return html`<section aria-labelledby="suggest-h">
<h2 id="suggest-h">Suggest a goal or team badge</h2>
<p>Ideas go to the Parks Passport team, who may add them for every group.</p>
<form method="post" action="/groups/${group.id}/suggest" class="card-form" novalidate>
  ${csrfField(csrf)}
  <fieldset class="radio-group"><legend>It's a</legend>
    <label class="check"><input type="radio" name="kind" value="group_goal" checked> Group goal</label>
    <label class="check"><input type="radio" name="kind" value="group_badge"> Team badge</label>
  </fieldset>
  ${field({ name: 'idea_name', label: 'Name (optional)', value: '', required: false, maxlength: 60 })}
  ${field({ name: 'pitch', label: 'What would the group do?', value: '', maxlength: 160, hint: 'e.g. visit every dog park in town together.' })}
  <button type="submit" class="btn">Send the idea</button>
</form>
</section>`;
}

const PRIVACY = 'Group members see your display name and your counts: parks stamped, check-ins, badges and level. Never your locations, photos, reviews or visits.';
const notice = (text) => (text ? html`<p class="notice" role="status" tabindex="-1" data-announce>${text}</p>` : '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function groupFields({ values = {}, errors = {}, withMode = false }) {
  return html`${field({ name: 'name', label: 'Group name', value: values.name, error: errors.name, maxlength: NAME_MAX, hint: 'e.g. Sunrise Run Club, Room 12, Bayfront Gym.' })}
  ${field({ name: 'emoji', label: 'Emoji', value: values.emoji ?? '🌳', error: errors.emoji, maxlength: 8 })}
  ${field({ name: 'description', label: 'What the group is about (optional)', value: values.description, error: errors.description, maxlength: DESCRIPTION_MAX, required: false })}
  ${withMode ? html`<fieldset class="radio-group"><legend>What the group code does</legend>
    <label class="check"><input type="radio" name="join_mode" value="ask"${values.join_mode !== 'open' ? html` checked` : ''}> Ask me first: I approve each request</label>
    <label class="check"><input type="radio" name="join_mode" value="open"${values.join_mode === 'open' ? html` checked` : ''}> Anyone with the code joins</label>
  </fieldset>` : ''}`;
}

/** Progress toward a number of GPS check-ins, as a small bar. */
function unlockBar(gps, goal, label) {
  return html`<span class="bar" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${Math.min(gps, goal)}"><span style="width:${Math.min(100, Math.round((gps / goal) * 100))}%"></span></span>`;
}

export function groupsPage({ csrf, groups, invites, allowance, errors = {}, values = {}, joinError = null, joinCode = '', notice: note = null }) {
  const a = allowance;
  return {
    title: 'Groups',
    current: 'groups',
    body: html`<div class="narrow">
<h1>Groups</h1>
<p class="lede">Explore as a team: your gym, your run club, your class. ${PRIVACY}</p>
${notice(note)}

${invites.length ? html`<section id="invites" aria-labelledby="invites-h">
<h2 id="invites-h">Invites</h2>
<ul class="group-list">${invites.map((i) => html`<li class="group-row">
  <span class="group-emoji" aria-hidden="true">${i.emoji}</span>
  <span><strong>${i.name}</strong><br><span class="muted">${i.from_name} invited you · ${plural(i.members, 'member')}</span></span>
  <form method="post" action="/groups/invites/${i.id}/accept" class="inline-form">${csrfField(csrf)}<button type="submit" class="btn btn-primary btn-small">Join<span class="visually-hidden"> ${i.name}</span></button></form>
  <form method="post" action="/groups/invites/${i.id}/decline" class="inline-form">${csrfField(csrf)}<button type="submit" class="btn btn-quiet btn-small">No thanks<span class="visually-hidden">: ${i.name}</span></button></form>
</li>`)}</ul>
<p class="hint">${PRIVACY}</p>
</section>` : ''}

<section aria-labelledby="mine-h">
<h2 id="mine-h">Your groups (${groups.length} of ${a.joinLimit})</h2>
${groups.length ? html`<ul class="group-list">${groups.map((g) => html`<li class="group-row">
  <span class="group-emoji" aria-hidden="true">${g.emoji}</span>
  <span><a href="/groups/${g.id}"><strong>${g.name}</strong></a><br><span class="muted">${plural(g.members, 'member')}${g.is_owner ? ' · you run it' : ''}${g.is_owner && g.requests ? ` · ${plural(g.requests, 'request')} to answer` : ''}</span></span>
</li>`)}</ul>` : html`<p>You're not in a group yet.</p>`}
${a.joinLimit < 10 ? html`<p class="hint">You can be in ${a.joinLimit} groups. ${a.gps < JOIN_UNLOCK_GPS ? `${JOIN_UNLOCK_GPS - a.gps} more GPS check-ins and you can be in 10.` : ''}</p>` : ''}
</section>

<section aria-labelledby="join-h">
<h2 id="join-h">Join with a code</h2>
<form method="post" action="/groups/join" class="card-form" novalidate>
  ${csrfField(csrf)}
  ${field({ name: 'code', label: 'Group code', value: joinCode, error: joinError, maxlength: 20, hint: 'Ask someone in the group for it, like ABCD-EFGH.', autocomplete: 'off' })}
  <button type="submit" class="btn">Join</button>
</form>
</section>

<section aria-labelledby="start-h">
<h2 id="start-h">Start a group</h2>
${a.canCreate ? html`${errorSummary(errors, { name: 'Group name', emoji: 'Emoji', description: 'What the group is about' })}
<form method="post" action="/groups" class="card-form" novalidate>
  ${csrfField(csrf)}
  ${groupFields({ values, errors })}
  <p class="hint">You can start ${a.createLimit - a.owned} more. New groups ask you before anyone joins with the code; you can change that.</p>
  <button type="submit" class="btn btn-pop">Start the group</button>
</form>`
  : a.createLimit === 0 ? html`<div class="unlock">
  <p><strong>Become a Troop Leader to start your own groups.</strong> Check in at parks by GPS ${TROOP_LEADER_GPS} times: ${a.gps} so far.</p>
  ${unlockBar(a.gps, TROOP_LEADER_GPS, 'GPS check-ins toward Troop Leader')}
</div>`
  : html`<p>You run ${plural(a.owned, 'group')}, as many as you can start for now${a.joined >= a.joinLimit ? ', and you’re in as many groups as you can be' : ''}.</p>`}
</section>
</div>`,
  };
}

export function groupPage({ csrf, group, board, me, requests = [], pals = [], notice: note = null, errors = {}, values = null, baseUrl = '',
  goal = null, progress = { total: 0, shares: [] }, templates = [], teamBadges = [], goalErrors = {} }) {
  const owner = group.is_owner;
  const v = values || group;
  return {
    title: group.name,
    current: 'groups',
    body: html`<div class="narrow">
<p class="breadcrumb"><a href="/groups">Groups</a></p>
<h1 class="group-title"><span aria-hidden="true">${group.emoji}</span> ${group.name}</h1>
${group.description ? html`<p class="lede group-lede">${group.description}</p>` : ''}
${notice(note)}

<section aria-labelledby="board-h">
<h2 id="board-h">Members (${board.length})</h2>
<p class="hint">${PRIVACY}</p>
<ol class="group-board" aria-label="Members, most parks stamped first">${board.map((m) => html`<li${m.id === me.id ? html` class="is-me"` : ''}>
  ${avatar(m, { size: 36, visible: false })}
  <span class="gb-who"><strong>${m.display_name}</strong>${m.id === group.owner_id ? html` <span class="flag">Owner</span>` : ''}${m.id === me.id ? html` <span class="muted">(you)</span>` : ''}
    <span class="gb-stats">${plural(m.parks, 'park')} · ${plural(m.checkins, 'check-in')} · ${plural(m.badges, 'badge')} · ${m.level}</span></span>
</li>`)}</ol>
</section>

${goalSection({ csrf, group, goal, progress, templates, teamBadges, errors: goalErrors })}

<section aria-labelledby="invite-h">
<h2 id="invite-h">Invite people</h2>
${pals.length ? html`<form method="post" action="/groups/${group.id}/invite" class="card-form inline-fields">
  ${csrfField(csrf)}
  <div class="field"><label for="pal">Invite a Park Pal</label>
    <select id="pal" name="user_id">${pals.map((p) => html`<option value="${p.id}">${p.display_name}</option>`)}</select></div>
  <button type="submit" class="btn">Send invite</button>
</form>` : ''}
<p>Group code: <strong class="friend-code">${formatCode(group.code)}</strong>. ${group.join_mode === 'open' ? 'Anyone with it joins.' : 'People who use it ask first; the owner approves.'}</p>
<p>Or share the link: <code class="share-link">${baseUrl}/groups/join/${group.code}</code></p>
</section>

${owner ? html`<section id="requests" aria-labelledby="req-h">
<h2 id="req-h">Requests to join (${requests.length})</h2>
${requests.length ? html`<ul class="group-list">${requests.map((r) => html`<li class="group-row">
  <span>${r.display_name}</span>
  <form method="post" action="/groups/${group.id}/requests/${r.id}/approve" class="inline-form">${csrfField(csrf)}<button type="submit" class="btn btn-primary btn-small">Approve<span class="visually-hidden"> ${r.display_name}</span></button></form>
  <form method="post" action="/groups/${group.id}/requests/${r.id}/decline" class="inline-form">${csrfField(csrf)}<button type="submit" class="btn btn-quiet btn-small">Decline<span class="visually-hidden"> ${r.display_name}</span></button></form>
</li>`)}</ul>` : html`<p class="muted">No one's waiting.</p>`}
</section>

<section aria-labelledby="settings-h">
<h2 id="settings-h">Group settings</h2>
${errorSummary(errors, { name: 'Group name', emoji: 'Emoji', description: 'What the group is about' })}
<form method="post" action="/groups/${group.id}/settings" class="card-form" novalidate>
  ${csrfField(csrf)}
  ${groupFields({ values: v, errors, withMode: true })}
  <button type="submit" class="btn btn-primary">Save settings</button>
</form>
<form method="post" action="/groups/${group.id}/code" class="inline-form">${csrfField(csrf)}<button type="submit" class="btn btn-small">Make a new code</button> <span class="hint">The old code and link stop working.</span></form>
${board.length > 1 ? html`<form method="post" action="/groups/${group.id}/members" class="card-form inline-fields">
  ${csrfField(csrf)}
  <div class="field"><label for="member">Member</label>
    <select id="member" name="user_id">${board.filter((m) => m.id !== me.id).map((m) => html`<option value="${m.id}">${m.display_name}</option>`)}</select></div>
  <button type="submit" name="action" value="owner" class="btn btn-small">Make them the owner</button>
  <button type="submit" name="action" value="remove" class="btn btn-quiet btn-small">Remove from the group</button>
</form>` : ''}
<form method="post" action="/groups/${group.id}/end" class="inline-form">${csrfField(csrf)}<button type="submit" class="btn btn-danger btn-small">End the group</button> <span class="hint">Everyone is told; badges earned together stay with each member.</span></form>
</section>` : ''}

${suggestSection({ csrf, group })}

<form method="post" action="/groups/${group.id}/leave" class="inline-form">${csrfField(csrf)}<button type="submit" class="btn btn-quiet">Leave the group</button>${owner ? html` <span class="hint">${board.length > 1 ? 'The member who has been in it longest becomes the owner.' : 'You are the only member, so this ends the group.'}</span>` : ''}</form>
</div>`,
  };
}

/** /groups/join/:code: what the group is, and join or ask (signed out: sign up or log in first). */
export function joinGroupPage({ csrf, group, user, state, here }) {
  const action = !user
    ? html`<p><a class="btn btn-primary" href="/signup?next=${encodeURIComponent(here)}">Create your passport</a> <a class="btn" href="/login?next=${encodeURIComponent(here)}">Log in</a></p>`
    : state === 'member' ? html`<p>You're in this group. <a href="/groups/${group.id}">Open it</a></p>`
      : state === 'asked' ? html`<p>You've asked to join. The owner will see your request.</p>`
        : html`<form method="post" action="${here}" class="card-form">${csrfField(csrf)}
  <p class="hint">${PRIVACY}</p>
  <button type="submit" class="btn btn-primary">${group.join_mode === 'open' ? 'Join the group' : 'Ask to join'}</button></form>`;
  return {
    title: `Join ${group.name}`,
    body: html`<div class="narrow">
<p class="eyebrow">A Parks Passport group</p>
<h1 class="group-title"><span aria-hidden="true">${group.emoji}</span> ${group.name}</h1>
${group.description ? html`<p class="lede group-lede">${group.description}</p>` : ''}
<p class="muted">${plural(group.members, 'member')}</p>
${action}
</div>`,
  };
}

/** The home page's "Your groups" card: your groups, or how to get into one. */
export function groupsCard({ groups, allowance }) {
  const a = allowance;
  return html`<section class="home-card groups-mini" aria-labelledby="groupsmini-h">
  <h2 id="groupsmini-h">Your groups</h2>
  ${groups.length ? html`<ul class="group-list">${groups.slice(0, 4).map((g) => html`<li class="group-row"><span class="group-emoji" aria-hidden="true">${g.emoji}</span>
    <span><a href="/groups/${g.id}">${g.name}</a><br><span class="muted">${g.goal ? html`${g.goal.title}: ${g.goal.total} of ${g.goal.target}` : plural(g.members, 'member')}</span>
    ${g.goal ? goalBar(g.goal, g.goal.total) : ''}</span></li>`)}</ul>
  <p><a href="/groups">All your groups</a></p>`
  : html`<p>Explore as a team: your gym, your run club, your class. Have a group code? <a href="/groups#join-h">Join a group</a>.</p>
  ${a.canCreate ? html`<p><a class="btn btn-small" href="/groups#start-h">Start a group</a></p>`
    : a.createLimit === 0 ? html`<p class="muted">${TROOP_LEADER_GPS - Math.min(a.gps, TROOP_LEADER_GPS)} more GPS check-ins and you're a Troop Leader: you can start your own group.</p>
  ${unlockBar(a.gps, TROOP_LEADER_GPS, 'GPS check-ins toward Troop Leader')}` : ''}`}
</section>`;
}
