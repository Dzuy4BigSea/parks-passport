import { html } from '../html.js';
import { csrfField, errorSummary } from '../forms.js';
import { RULES } from '../../domain/badges/rules.js';
import { STATUSES, NEW_RULE } from '../../domain/ideas.js';
import { formatDate, localDate } from '../../domain/time.js';

// Badge ideas (SPEC Flow 13): /ideas for contributors, Admin › Badge ideas for sharing and triage.

const dateOf = (iso) => formatDate(localDate(new Date(iso)));
const notice = (text) => (text ? html`<p class="notice" role="status" tabindex="-1" data-announce>${text}</p>` : '');
const ruleLabel = (t) => (t === NEW_RULE ? 'Needs a new rule' : RULES[t]?.label || '');

// Sparks for the blank: each one is a different kind of rule, to get people going.
const SPARKS = [
  'stamp 3 parks before 9 a.m. on one Saturday',
  'visit the same park in every season',
  'stamp a park on a rainy day',
  'walk 10 miles across parks in a month',
  'stamp every park with a fishing pier',
  'bring a pal to a park neither of you had stamped',
];

export function ideasPage({ csrf, ideas, errors = {}, values = {}, notice: note }) {
  return {
    title: 'Badge ideas',
    current: 'ideas',
    body: html`<div class="narrow">
<h1>Badge ideas</h1>
<p>Dream up a badge in one line. Any idea helps: small, silly or ambitious. The best ones become real badges in Parks Passport.</p>
${notice(note)}
${errorSummary(errors, { name: 'Badge name', pitch: 'Earn it when you', art: 'Emoji' })}
<form method="post" action="/ideas" class="card-form idea-form" novalidate>
  ${csrfField(csrf)}
  <fieldset class="idea-formula">
    <legend>Earn <em>[badge name]</em> when you <em>[do what]</em></legend>
    <div class="field${errors.name ? ' field-error' : ''}">
      <label for="name">Badge name <span class="muted">(optional)</span></label>
      ${errors.name ? html`<p class="error-text" id="name-error">${errors.name}</p>` : ''}
      <input id="name" name="name" type="text" maxlength="60" value="${values.name ?? ''}" placeholder="Early Bird"${errors.name ? html` aria-invalid="true" aria-describedby="name-error"` : ''}>
    </div>
    <div class="field${errors.pitch ? ' field-error' : ''}">
      <label for="pitch">Earn it when you…</label>
      <p class="hint" id="pitch-hint">One line, up to 160 characters.</p>
      ${errors.pitch ? html`<p class="error-text" id="pitch-error">${errors.pitch}</p>` : ''}
      <input id="pitch" name="pitch" type="text" maxlength="160" required value="${values.pitch ?? ''}" placeholder="${SPARKS[0]}" aria-describedby="pitch-hint${errors.pitch ? ' pitch-error' : ''}"${errors.pitch ? html` aria-invalid="true"` : ''}>
    </div>
    <div class="field${errors.art ? ' field-error' : ''}">
      <label for="art">Emoji <span class="muted">(optional)</span></label>
      ${errors.art ? html`<p class="error-text" id="art-error">${errors.art}</p>` : ''}
      <input id="art" name="art" type="text" maxlength="16" class="input-short" value="${values.art ?? ''}" placeholder="🌅"${errors.art ? html` aria-invalid="true" aria-describedby="art-error"` : ''}>
    </div>
  </fieldset>
  <button type="submit" class="btn btn-primary">Submit idea</button>
</form>
<details class="sparks">
  <summary>Need a spark?</summary>
  <p>Badges can be about how many parks, when you go, how often, what you do there, or who you go with. For example, earn it when you…</p>
  <ul>${SPARKS.map((s) => html`<li>${s}</li>`)}</ul>
</details>
<h2>My ideas</h2>
${ideas.length ? html`<ul class="idea-list">${ideas.map((i) => html`<li class="idea-card">
  <p class="idea-line">${i.art ? html`<span aria-hidden="true">${i.art}</span> ` : ''}<strong>${i.name || 'Untitled'}</strong>: earn it when you ${i.pitch}</p>
  <p class="muted">${dateOf(i.created_at)} · ${STATUSES[i.status]}</p>
</li>`)}</ul>` : html`<p>No ideas yet. Your first one goes here.</p>`}
</div>`,
  };
}

const crumb = html`<p class="breadcrumb"><a href="/admin">Admin</a></p>`;

function shareSection({ csrf, contributors, shareError, shareValues = {} }) {
  return html`<section aria-labelledby="share-h">
<h2 id="share-h">Share with contributors</h2>
<form method="post" action="/admin/ideas/contributors" class="card-form admin-form">
  ${csrfField(csrf)}
  ${shareError ? html`<p class="error-text" role="alert" tabindex="-1" data-announce>${shareError}</p>` : ''}
  <div class="field">
    <label for="share_email">Email</label>
    <p class="hint" id="share_email-hint">Members get a link to the ideas page. Anyone else gets an invite to create a passport first.
      They can submit ideas and see their own, nothing more. <a href="/admin/email/messages/idea_share">Edit the email's wording</a>.</p>
    <input id="share_email" name="share_email" type="email" required value="${shareValues.email ?? ''}" aria-describedby="share_email-hint">
  </div>
  <button type="submit" class="btn btn-pop">Share badge ideas</button>
</form>
${contributors.length ? html`<div class="table-wrap"><table class="admin-table">
  <caption class="visually-hidden">Contributors</caption>
  <thead><tr><th scope="col">Contributor</th><th scope="col">Ideas</th><th scope="col">Access</th></tr></thead>
  <tbody>${contributors.map((c) => html`<tr>
    <td data-label="Contributor">${c.display_name || html`<span class="muted">Not signed up yet</span>`}<br><span class="muted">${c.email}</span></td>
    <td data-label="Ideas">${c.idea_count ?? 0}</td>
    <td data-label="Access"><form method="post" action="/admin/ideas/contributors/${c.id}/remove">${csrfField(csrf)}
      <button type="submit" class="btn btn-small">Remove<span class="visually-hidden"> ${c.email}</span></button></form></td>
  </tr>`)}</tbody>
</table></div>` : html`<p>No contributors yet. Admins can always submit ideas.</p>`}
</section>`;
}

function suggestionBox(i, csrf) {
  if (!i.ai || i.status !== 'new') return '';
  const s = i.ai;
  const verdict = { keep: 'Keep', kill: 'Kill', combine: `Combine into #${s.combine_with}` }[s.verdict];
  return html`<div class="idea-ai">
  <p><strong>Claude suggests: ${verdict}</strong>${s.name ? html` as “${s.name}”` : ''}. ${s.reason}</p>
  ${s.rule_type ? html`<p class="muted">${ruleLabel(s.rule_type)}${Object.keys(s.rule_params || {}).length ? ` ${JSON.stringify(s.rule_params)}` : ''}${s.new_rule ? `: ${s.new_rule}` : ''}</p>` : ''}
  <form method="post" action="/admin/ideas/${i.id}/apply">${csrfField(csrf)}
    <button type="submit" class="btn btn-small">Use suggestion<span class="visually-hidden"> for idea ${i.id}</span></button></form>
</div>`;
}

function triageForm(i, csrf, status) {
  if (i.status === 'built') return html`<p>Built as <a href="/admin/badges/${i.badge_id}">${i.badge_name || 'a badge'}</a>.</p>`;
  const v = (k) => `${k}-${i.id}`;
  return html`<form method="post" action="/admin/ideas/${i.id}/triage" class="idea-triage">
  ${csrfField(csrf)}${status ? html`<input type="hidden" name="status" value="${status}">` : ''}
  <fieldset class="radio-group">
    <legend>Verdict<span class="visually-hidden"> for idea ${i.id}</span></legend>
    ${[['keep', 'Keep'], ['kill', 'Kill'], ['combine', 'Combine'], ['new', 'Undecided']].map(([k, label]) => html`<label class="check"><input type="radio" name="verdict" value="${k}"${(i.status === 'combined' ? 'combine' : i.status) === k ? html` checked` : ''}> ${label}</label>`)}
  </fieldset>
  <div class="two-col">
    <div class="field">
      <label for="${v('merged_into')}">Combine into idea #</label>
      <input id="${v('merged_into')}" name="merged_into" type="text" inputmode="numeric" list="open-ideas" value="${i.merged_into ?? ''}">
    </div>
    <div class="field">
      <label for="${v('rule_type')}">Fits rule</label>
      <select id="${v('rule_type')}" name="rule_type"><option value="">Not decided</option>${Object.entries(RULES).map(([k, r]) => html`<option value="${k}"${i.rule_type === k ? html` selected` : ''}>${r.label}</option>`)}<option value="${NEW_RULE}"${i.rule_type === NEW_RULE ? html` selected` : ''}>Needs a new rule</option></select>
    </div>
  </div>
  <div class="field">
    <label for="${v('note')}">Note (optional)</label>
    <input id="${v('note')}" name="note" type="text" maxlength="500" value="${i.note}">
  </div>
  <button type="submit" class="btn btn-small btn-primary">Save<span class="visually-hidden"> idea ${i.id}</span></button>
  ${i.status === 'keep' && Object.hasOwn(RULES, i.rule_type || '') ? html` <a class="btn btn-small" href="/admin/badges/new?from_idea=${i.id}">Create badge<span class="visually-hidden"> from idea ${i.id}</span></a>` : ''}
</form>`;
}

export function adminIdeasPage({
  csrf, isSuper, contributors, ideas = [], counts = {}, status = '', openIdeas = [], job = null, aiAvailable = false,
  notice: note, error, shareError, shareValues,
}) {
  const tabs = [['', 'All'], ...Object.entries(STATUSES)];
  const running = job?.status === 'running';
  return {
    title: 'Admin · Badge ideas',
    current: 'admin',
    body: html`${crumb}<h1>Badge ideas</h1>
${notice(note)}
${error ? html`<p class="notice" role="alert" tabindex="-1" data-announce>${error}</p>` : ''}
<p><a class="btn" href="/ideas">Submit an idea</a></p>
${shareSection({ csrf, contributors, shareError, shareValues })}
${isSuper ? html`<section aria-labelledby="triage-h">
<h2 id="triage-h">Triage</h2>
<p>Keep, kill or combine each idea. Kept ideas that fit a rule become badges with “Create badge”. The rest go to Claude Code with the export.</p>
<div class="idea-actions">
  <form method="post" action="/admin/ideas/suggest">${csrfField(csrf)}
    <button type="submit" class="btn"${aiAvailable && !running && counts.new ? '' : html` disabled`}>${running ? 'Claude is reviewing…' : 'Suggest with Claude'}</button></form>
  <a class="btn" href="/admin/ideas/export.md" download>Export for Claude Code</a>
</div>
${aiAvailable ? '' : html`<p class="hint">Suggestions need <code>ANTHROPIC_API_KEY</code> on the server.</p>`}
${job?.status === 'done' ? html`<p class="hint">Last review ${dateOf(job.finished_at)}: ${job.suggested} suggestion${job.suggested === 1 ? '' : 's'}${job.rejected ? `, ${job.rejected} dropped as invalid` : ''}.</p>` : ''}
${job?.status === 'error' ? html`<p class="notice" role="alert">${job.error}</p>` : ''}
<nav class="tabs" aria-label="Filter ideas">${tabs.map(([s, label]) => html`<a href="/admin/ideas${s ? `?status=${s}` : ''}"${s === status ? html` aria-current="page"` : ''}>${label}${s ? ` (${counts[s] || 0})` : ''}</a>`)}</nav>
<datalist id="open-ideas">${openIdeas.map((o) => html`<option value="${o.id}">${o.name || o.pitch}</option>`)}</datalist>
${ideas.length ? html`<ul class="idea-list">${ideas.map((i) => html`<li class="idea-card" id="idea-${i.id}">
  <p class="idea-line"><span class="muted">#${i.id}</span> ${i.art ? html`<span aria-hidden="true">${i.art}</span> ` : ''}<strong>${i.name || 'Untitled'}</strong>: earn it when you ${i.pitch}</p>
  <p class="muted">${i.author} · ${dateOf(i.created_at)} · ${STATUSES[i.status]}${i.status === 'combined' && i.merged_into ? html` into #${i.merged_into}` : ''}${i.combined_count ? ` · ${i.combined_count} combined into this` : ''}${i.rule_type ? ` · ${ruleLabel(i.rule_type)}` : ''}</p>
  ${suggestionBox(i, csrf)}
  ${triageForm(i, csrf, status)}
</li>`)}</ul>` : html`<p>No ideas here.</p>`}
</section>` : ''}`,
  };
}
