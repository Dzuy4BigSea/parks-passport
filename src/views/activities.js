import { html } from './html.js';
import { csrfField } from './forms.js';
import { PILLARS, LIMITS } from '../domain/activities.js';
import { categoryLabel } from '../domain/categories.js';

const AMOUNT = {
  minutes: { label: 'Minutes', step: '1', max: LIMITS.minutesPerLog, mode: 'numeric' },
  miles: { label: 'Miles', step: '0.1', max: LIMITS.milesPerLog, mode: 'decimal' },
  count: { label: 'How many', step: '1', max: LIMITS.countPerLog, mode: 'numeric' },
};

const done = (a, log) => ({
  check: 'Done', minutes: `${log.amount} min`, miles: `${log.amount} mi`, count: `${log.amount}`,
})[a.measure];

function item(a, { park, csrf, log, problem }) {
  const err = problem?.activity === a.slug ? problem.text : null;
  const amt = AMOUNT[a.measure];
  const hint = a.measure === 'miles' && park.loop_mi ? ` One loop here is about ${park.loop_mi} mi.` : '';
  return html`<li class="act${log ? ' is-done' : ''}">
  <div class="act-text">
    <p class="act-name"><strong>${a.name}</strong> <span class="act-pts">+${a.points}</span></p>
    <p class="act-desc">${a.description}${hint}</p>
  </div>
  ${err ? html`<p class="error-text" role="alert" tabindex="-1" data-announce>${err}</p>` : ''}
  ${log
    ? html`<form method="post" action="/activities/${log.id}/delete" class="act-form">${csrfField(csrf)}
      <span class="act-check">✓ ${done(a, log)}</span>
      <button type="submit" class="btn btn-quiet btn-small">Undo<span class="visually-hidden"> ${a.name}</span></button></form>`
    : html`<form method="post" action="/parks/${park.slug}/activities" class="act-form">${csrfField(csrf)}
      <input type="hidden" name="activity" value="${a.slug}">
      ${amt ? html`<label class="act-amount"><span>${amt.label}</span>
        <input type="number" name="amount" required min="${amt.step}" max="${amt.max}" step="${amt.step}" inputmode="${amt.mode}"${err ? html` aria-invalid="true"` : ''}></label>` : ''}
      <button type="submit" class="btn btn-small btn-primary">Log<span class="visually-hidden"> ${a.name}</span></button></form>`}
</li>`;
}

function group({ id, title, note = '', list, ctx, open }) {
  if (!list.length) return '';
  const doneCount = list.filter((a) => ctx.logs.has(a.id)).length;
  // Open: the first group, and the one holding an error or the activity just logged.
  const isOpen = open || list.some((a) => a.slug === ctx.problem?.activity || a.slug === ctx.justLogged);
  return html`<details class="act-group"${isOpen ? html` open` : ''} id="${id}">
  <summary><span>${title}</span><span class="act-count">${doneCount ? `${doneCount} / ` : ''}${list.length}</span></summary>
  ${note ? html`<p class="hint act-note">${note}</p>` : ''}
  <ul class="act-list">${list.map((a) => item(a, { ...ctx, log: ctx.logs.get(a.id) }))}</ul>
</details>`;
}

/**
 * "Things to do here": healthy activities for a park. Shown to members; unlocked by today's stamp.
 * activities = { list, logs, stampedToday, flash }.
 */
export function activitiesPanel({ park, csrf, activities, problem }) {
  if (!activities || !activities.list.length) return '';
  const { list, stampedToday } = activities;
  const here = list.filter((a) => a.category);
  // An error for an activity not in the list (switched off, or the stamp is from another day).
  const ownProblem = problem?.area === 'activities' ? problem : null;
  const loose = ownProblem && !(stampedToday && list.some((a) => a.slug === ownProblem.activity))
    ? html`<p class="notice" role="alert" tabindex="-1" data-announce>${ownProblem.text}</p>` : '';
  if (!stampedToday) {
    const names = here.slice(0, 3).map((a) => a.name);
    return html`<section class="activities is-locked" id="activities" aria-labelledby="act-h">
  <h2 id="act-h">Things to do here</h2>
  ${loose}
  <p>Stamp this park today to unlock <strong>${list.length} healthy things to do</strong>, each worth bonus points${names.length ? html`, like ${names.join(', ')}` : ''}.</p>
</section>`;
  }
  const ctx = {
    park, csrf, problem: problem?.area === 'activities' ? problem : null, justLogged: activities.flash?.slug,
    logs: new Map(activities.logs.map((l) => [l.activity_id, l])),
  };
  const core = list.filter((a) => !a.category && a.edition === 'core');
  const facilities = [...new Set(here.map((a) => a.category))].map(categoryLabel).join(', ');
  return html`<section class="activities" id="activities" aria-labelledby="act-h">
  <h2 id="act-h">Things to do here</h2>
  ${loose}
  ${activities.flash?.text ? html`<p class="notice" role="status" tabindex="-1" data-announce>${activities.flash.text}</p>` : ''}
  <p class="hint">Log what you do today for bonus points and health badges. Only you see your log.</p>
  ${group({ id: 'act-here', title: 'Special to this park', note: `Because it has: ${facilities}.`, list: here, ctx, open: true })}
  ${Object.entries(PILLARS).map(([key, p]) => group({
    id: `act-${key}`, title: `${p.icon} ${p.label}`, list: core.filter((a) => a.pillar === key), ctx,
  }))}
  ${group({ id: 'act-paws', title: '🐾 Paws', list: list.filter((a) => !a.category && a.edition === 'paws'), ctx })}
  ${group({ id: 'act-kids', title: '🧒 Kids', list: list.filter((a) => !a.category && a.edition === 'kids'), ctx })}
  <p class="hint">Florida tip: bring water, find shade, and head in if you hear thunder.</p>
</section>`;
}

/** This week's healthy-habit totals for the passport. week = weekSummary(); goals = WEEKLY_GOALS. */
export function weekCard({ week, goals }) {
  const bar = (label, value, goal, unit) => html`<div class="week-goal">
    <p><strong>${label}</strong> <span>${value} / ${goal} ${unit}</span></p>
    <progress max="${goal}" value="${Math.min(value, goal)}" aria-label="${label}: ${value} of ${goal} ${unit}"></progress>
  </div>`;
  return html`<section class="week-card" aria-labelledby="week-h">
  <h2 id="week-h">This week's healthy habits</h2>
  ${week.count ? '' : html`<p class="hint">Stamp a park, then log what you do there under "Things to do here".</p>`}
  ${bar('Movement', week.moveMinutes, goals.moveMinutes, 'min')}
  ${bar('Time in parks', week.parkMinutes, goals.parkMinutes, 'min')}
  <p class="week-extra">${week.miles} mi walked · ${week.pillars} of 6 pillars</p>
  <p class="hint">150 minutes of movement and 2 hours outdoors a week are the levels linked to better health.</p>
</section>`;
}
