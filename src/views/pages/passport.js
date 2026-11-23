import { html } from '../html.js';
import { csrfField } from '../forms.js';
import { METHOD_LABELS } from '../../domain/visits.js';
import { formatDate, localDate } from '../../domain/time.js';

const shortDate = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
};

function badgeCard(b) {
  if (b.state === 'earned') {
    return html`<li class="badge earned">
  <span class="badge-art" aria-hidden="true">${b.art}</span>
  <span class="badge-name">${b.name}</span>
  <span class="badge-meta">Earned ${formatDate(localDate(new Date(b.awarded_at)))}</span>
  ${b.description ? html`<span class="badge-desc">${b.description}</span>` : ''}
</li>`;
  }
  if (b.state === 'known') {
    const pct = b.target ? Math.round((b.progress / b.target) * 100) : 0;
    return html`<li class="badge known">
  <span class="badge-art" aria-hidden="true">${b.art}</span>
  <span class="badge-name">${b.name}</span>
  <span class="badge-desc">${b.description}</span>
  ${b.target ? html`<span class="badge-meta">${b.progress} / ${b.target} ${b.unit}</span>
  <span class="bar" role="progressbar" aria-label="${b.name} progress" aria-valuemin="0" aria-valuemax="${b.target}" aria-valuenow="${b.progress}"><span style="width:${pct}%"></span></span>` : html`<span class="badge-meta">Not earned yet</span>`}
</li>`;
  }
  return html`<li class="badge mystery">
  <span class="badge-art" aria-hidden="true">?</span>
  <span class="badge-name">${b.state === 'lucky' ? 'Lucky find' : 'Hidden badge'}</span>
  ${b.hint ? html`<span class="badge-desc">Hint: ${b.hint}</span>` : ''}
</li>`;
}

export function passportPage({ user, csrf, parks, history, points, level, badges }) {
  const stamped = parks.filter((p) => p.first_visit);
  const total = parks.length;
  const mapData = parks.filter((p) => p.lat != null).map((p) => ({
    slug: p.slug, name: p.name, lat: p.lat, lng: p.lng, stamped: Boolean(p.first_visit),
  }));
  const earned = badges.filter((b) => b.state === 'earned');
  const levelPct = Math.round(level.progress * 100);

  return {
    title: 'My passport',
    current: 'passport',
    head: html`<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">`,
    scripts: ['/js/passport-map.js'],
    body: html`
<header class="passport-cover">
  <p class="eyebrow">Parks Passport</p>
  <h1>${user.display_name}'s passport</h1>
  <p class="passport-count"><strong>${stamped.length} of ${total} parks stamped</strong></p>
  <div class="level">
    <p><span class="level-name">${level.name}</span> · <span class="points">${points} points</span></p>
    <span class="bar bar-level" role="progressbar" aria-label="Progress to ${level.next ? level.next.name : 'the top level'}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${levelPct}"><span style="width:${levelPct}%"></span></span>
    <p class="level-next">${level.next ? `${level.toNext} points to ${level.next.name}` : 'Top level reached!'}</p>
  </div>
</header>

<section aria-labelledby="stamps-h">
  <h2 id="stamps-h">Stamps</h2>
  <ul class="stamp-grid">
    ${parks.map((p) => html`<li class="stamp${p.first_visit ? ' is-stamped' : ''}">
      <a href="/parks/${p.slug}">
        <span class="stamp-name">${p.name}</span>
        <span class="stamp-date">${p.first_visit ? html`<span aria-hidden="true">✓ </span>Stamped ${shortDate(p.first_visit)}` : 'Not yet'}</span>
      </a>
    </li>`)}
  </ul>
</section>

<section aria-labelledby="map-h">
  <h2 id="map-h">Map</h2>
  <p class="map-legend"><span class="legend-stamped" aria-hidden="true">✓</span> Stamped
    <span class="legend-unstamped" aria-hidden="true">○</span> Not yet</p>
  <div id="passport-map" class="park-map passport-map" data-parks="${JSON.stringify(mapData)}"></div>
</section>

<section aria-labelledby="badges-h" id="badges">
  <h2 id="badges-h">Badges <span class="count">(${earned.length} earned)</span></h2>
  <ul class="badge-grid">${badges.map(badgeCard)}</ul>
</section>

<section aria-labelledby="history-h">
  <h2 id="history-h">Visit history</h2>
  ${history.length ? html`<ul class="history">
    ${history.map((v) => html`<li>
      <span><a href="/parks/${v.park_slug}">${v.park_name}</a><br>
        <span class="muted">${formatDate(v.visited_on)} · ${METHOD_LABELS[v.method]} · ${v.points} pts</span></span>
      <form method="post" action="/visits/${v.id}/delete">
        ${csrfField(csrf)}<input type="hidden" name="back" value="/passport">
        <button type="submit" class="btn btn-quiet btn-small" aria-label="Delete visit to ${v.park_name} on ${formatDate(v.visited_on)}">Delete</button>
      </form>
    </li>`)}
  </ul>` : html`<p>No visits yet. <a href="/parks">Find a park</a> and stamp it.</p>`}
</section>`,
  };
}
