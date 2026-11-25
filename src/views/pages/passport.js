import { weekCard } from '../activities.js';
import { avatar } from '../avatar.js';
import { WEEKLY_GOALS } from '../../domain/activities.js';
import { html } from '../html.js';
import { badgeArt } from '../badge-art.js';
import { csrfField } from '../forms.js';
import { METHOD_LABELS } from '../../domain/visits.js';
import { formatDate, localDate } from '../../domain/time.js';
import { VISIBILITY_LABELS } from '../../domain/visibility.js';
import { collections, motifForPark } from '../../domain/city.js';
import { motifIcon } from '../motif.js';
import { ICONS } from '../icons.js';
import { nextUpCards, streakText } from '../nextup.js';
import { cityPath, parkPath } from '../urls.js';
import { saveButton } from '../save-button.js';

function stampTile(p, theme, i) {
  return html`<li class="stamp${p.first_visit ? ' is-stamped' : ''}" style="--i:${i}">
      <a href="${parkPath(p)}">
        ${p.first_visit ? html`<span class="seal" aria-hidden="true">${motifIcon(motifForPark(theme, p.slug))}</span>` : ''}
        <span class="stamp-name">${p.name}</span>
        <span class="stamp-date">${p.first_visit ? html`<span aria-hidden="true">✓ </span>Stamped ${shortDate(p.first_visit)}` : 'Not yet'}</span>
      </a>
    </li>`;
}

function collectionSection(g, theme) {
  const pct = Math.round((g.stamped / g.total) * 100);
  const done = g.stamped === g.total;
  return html`<section class="collection${done ? ' is-complete' : ''}" aria-labelledby="col-${g.slug}">
  <div class="collection-head">
    <span class="ring ring-sm" style="--p:${pct}" aria-hidden="true"><strong>${g.stamped}</strong></span>
    <div><h3 id="col-${g.slug}">${g.name}</h3>
    <p>${done ? 'Collection complete!' : `${g.stamped} of ${g.total} stamped · ${g.total - g.stamped} to discover`}</p></div>
  </div>
  <ul class="stamp-grid">${g.parks.map((p, i) => stampTile(p, theme, i))}</ul>
</section>`;
}

const shortDate = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
};

function badgeCard(b) {
  if (b.state === 'earned') {
    return html`<li class="badge earned${b.serial ? ' is-holo' : ''}">
  ${b.serial ? html`<span class="holo-foil" aria-hidden="true"></span><span class="badge-serial">#${b.serial}${b.limited_count ? html`<span class="visually-hidden"> of ${b.limited_count}</span><span aria-hidden="true">/${b.limited_count}</span>` : ''}</span>` : ''}
  ${badgeArt(b.art)}
  <span class="badge-name">${b.name}</span>
  <span class="badge-meta">${b.serial ? `${b.limited_count ? `Limited edition #${b.serial} of ${b.limited_count}` : `No. ${b.serial}`} · ` : ''}Earned ${formatDate(localDate(new Date(b.awarded_at)))}</span>
  ${b.description ? html`<span class="badge-desc">${b.description}</span>` : ''}
</li>`;
  }
  if (b.state === 'known') {
    const pct = b.target ? Math.round((b.progress / b.target) * 100) : 0;
    return html`<li class="badge known">
  ${badgeArt(b.art)}
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

// One tab per city: its stamped count. Own passport: /<city>/passport; someone else's: ?city=.
function cityTabs(cities, theme, href) {
  if (!cities || cities.length < 2) return '';
  return html`<nav class="city-tabs" aria-label="Cities in this passport"><ul>
  ${cities.map(({ city, stamped, total }) => html`<li><a href="${href(city)}"${city.key === theme.key ? html` aria-current="page"` : ''}>
    <span class="city-tab-name">${city.copy.short}</span> <span class="city-tab-count">${stamped}<span class="visually-hidden"> of </span><span aria-hidden="true">/</span>${total}</span></a></li>`)}
</ul></nav>`;
}

export function passportPage({ teamBadges = [], user, csrf, parks, history, points, level, badges, readOnly = false, theme = { motifs: [], areas: [] }, next = null, week = null,
  cities = null, cityHref = (city) => cityPath(city, '/passport'), welcome = false, wantToGo = null }) {
  // Saved parks are private: only the owner's own passport passes wantToGo (never /u/:handle).
  const showWantToGo = !readOnly && Array.isArray(wantToGo);
  const stamped = parks.filter((p) => p.first_visit);
  const total = parks.length;
  const mapData = parks.filter((p) => p.lat != null).map((p) => ({
    url: parkPath(p), name: p.name, lat: p.lat, lng: p.lng, stamped: Boolean(p.first_visit),
  }));
  // Visits in more than one city: say which city each history row is in.
  const manyCities = new Set(history.map((v) => v.city_key)).size > 1;
  const here = theme.key ? cityPath(theme, '/passport') : '/passport';
  const earned = badges.filter((b) => b.state === 'earned');
  const levelPct = Math.round(level.progress * 100);

  return {
    title: readOnly ? `${user.display_name}'s passport` : 'My passport',
    current: readOnly ? '' : 'passport',
    head: html`<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">`,
    scripts: ['/js/passport-map.js', '/js/inspect.js', ...(welcome ? ['/js/welcome.js'] : []), ...(showWantToGo ? ['/js/want-to-go.js'] : [])],
    body: html`
${welcome ? html`<span id="welcome-data" hidden data-name="${user.display_name}" data-city="${theme.copy?.short || ''}"></span>` : ''}
<header class="passport-cover">
  ${theme.motifs.length ? html`<span class="cover-pattern" aria-hidden="true">${Array.from({ length: 24 }, (_, i) => motifIcon(theme.motifs[i % theme.motifs.length]))}</span>` : ''}
  <div>
    <p class="eyebrow">Parks Passport${theme.key !== 'default' && theme.name ? ` · ${theme.name}` : ''}</p>
    <div class="cover-name">${avatar(user, { size: 56 })}<h1>${user.display_name}'s passport</h1></div>
    <p class="passport-count"><strong>${stamped.length} of ${total} parks stamped</strong></p>
    ${readOnly ? '' : html`<p class="passport-visibility">Visible to: ${VISIBILITY_LABELS[user.default_visibility]} · <a href="/account#visibility">Change</a></p>`}
    ${next ? html`<p class="cover-pills"><span class="pill pill-streak">${ICONS.flame}${streakText(next.streak).title}</span></p>` : ''}
  </div>
  <div class="ring" style="--p:${total ? Math.round((stamped.length / total) * 100) : 0}" aria-hidden="true"><span><strong>${stamped.length}</strong><small>of ${total}</small></span></div>
  <div class="level">
    <p><span class="level-name">${level.name}</span> · <span class="points">${points} points</span></p>
    <span class="bar bar-level" role="progressbar" aria-label="Progress to ${level.next ? level.next.name : 'the top level'}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${levelPct}"><span style="width:${levelPct}%"></span></span>
    <p class="level-next">${level.next ? `${level.toNext} points to ${level.next.name}` : 'Top level reached!'}</p>
  </div>
</header>

${cityTabs(cities, theme, cityHref)}
${next ? nextUpCards(next, { city: theme }) : ''}
${week && !readOnly ? weekCard({ week, goals: WEEKLY_GOALS }) : ''}
${readOnly ? '' : html`<p class="sunshine-nudge"><a href="/sunshine?city=${theme.key}"><span aria-hidden="true">☀️</span> Send a drop of sunshine</a> to the crews who keep our parks beautiful.</p>`}

${showWantToGo ? html`<section aria-labelledby="want-h" id="want-to-go">
  <h2 id="want-h">Want to go</h2>
  <p class="muted">Parks you saved and haven't stamped yet. Only you can see this list.</p>
  ${wantToGo.length ? html`<ul class="want-list">${wantToGo.map((p) => html`<li>
    <span><a href="${parkPath(p)}">${p.name}</a>${p.address ? html`<br><span class="muted">${p.address}</span>` : ''}</span>
    ${saveButton({ park: p, saved: true, csrf, back: `${cityPath(theme, '/passport')}#want-to-go` })}
  </li>`)}</ul>` : html`<p>Nothing here yet. Tap the heart on a <a href="${cityPath(theme, '/parks')}">park</a> to save it for later.</p>`}
</section>` : ''}

<section aria-labelledby="stamps-h">
  <h2 id="stamps-h">Stamps</h2>
  <p class="muted">Parks are grouped by neighborhood. Complete a collection to fill its ring.</p>
  ${collections(theme, parks).map((g) => collectionSection(g, theme))}
</section>

<section aria-labelledby="map-h">
  <h2 id="map-h">Map</h2>
  <p class="map-legend"><span class="legend-stamped" aria-hidden="true">✓</span> Stamped
    <span class="legend-unstamped" aria-hidden="true">○</span> Not yet</p>
  <div id="passport-map" class="park-map passport-map" data-parks="${JSON.stringify(mapData)}"${theme.center ? html` data-center="${theme.center.lat},${theme.center.lng}"` : ''}></div>
</section>

<section aria-labelledby="badges-h" id="badges">
  <h2 id="badges-h">Badges <span class="count">(${earned.length} earned)</span></h2>
  <ul class="badge-grid">${badges.map(badgeCard)}</ul>
</section>
${teamBadges.length ? html`<section aria-labelledby="team-h" id="team-badges" class="team-badges">
  <h2 id="team-h">Team badges <span class="count">(${teamBadges.length})</span></h2>
  <p class="muted">Earned together by reaching a group goal. They're yours to keep.</p>
  <ul class="badge-grid">${teamBadges.map((b) => html`<li class="badge earned">
    ${badgeArt(b.art)}
    <span class="badge-name">${b.name}</span>
    <span class="badge-meta">With ${b.group_name || 'a group'} · ${formatDate(localDate(new Date(b.awarded_at)))}</span>
    ${b.description ? html`<span class="badge-desc">${b.description}</span>` : ''}
  </li>`)}</ul>
</section>` : ''}

<section aria-labelledby="history-h">
  <h2 id="history-h">Visit history</h2>
  ${history.length ? html`<ul class="history">
    ${history.map((v) => html`<li>
      <span><a href="${parkPath({ city_key: v.city_key, slug: v.park_slug })}">${v.park_name}</a><br>
        <span class="muted">${manyCities ? `${v.city_name} · ` : ''}${formatDate(v.visited_on)} · ${METHOD_LABELS[v.method]} · ${v.points} pts</span></span>
      ${readOnly ? '' : html`<form method="post" action="/visits/${v.id}/delete">
        ${csrfField(csrf)}<input type="hidden" name="back" value="${here}">
        <button type="submit" class="btn btn-quiet btn-small" aria-label="Delete visit to ${v.park_name} on ${formatDate(v.visited_on)}">Delete</button>
      </form>`}
    </li>`)}
  </ul>` : html`<p>${readOnly ? 'No visits yet.' : html`No visits yet. <a href="${theme.key ? cityPath(theme, '/parks') : '/parks'}">Find a park</a> and stamp it.`}</p>`}
</section>`,
  };
}
