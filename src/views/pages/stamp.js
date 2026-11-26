import { parkPath } from '../urls.js';
import { html } from '../html.js';
import { csrfField } from '../forms.js';
import { ICONS } from '../icons.js';
import { formatMiles } from '../../domain/geo.js';

/**
 * One-tap stamping: finds the park the member is standing in by GPS and stamps it.
 * `problem` is { text, nearby: [{ slug, name, distance_m }] } after a failed attempt.
 */
export function stampFinderPage({ csrf, problem = null }) {
  return {
    title: 'Stamp a park',
    current: 'stamp',
    scripts: ['/js/stamp-finder.js'],
    body: html`<section class="finder" aria-labelledby="finder-h">
  <p class="eyebrow">One tap</p>
  <h1 id="finder-h">Stamp the park you're in</h1>
  <div class="radar" aria-hidden="true"><span class="fab-lg">${ICONS.stamp}</span></div>
  ${problem ? html`<p class="notice" role="alert" tabindex="-1" data-announce>${problem.text}</p>` : ''}
  <form method="post" action="/stamp" id="stamp-finder" hidden${problem ? '' : html` data-auto`}>
    ${csrfField(csrf)}
    <input type="hidden" name="lat"><input type="hidden" name="lng"><input type="hidden" name="accuracy">
    <button type="submit" class="btn btn-pop btn-big">${ICONS.pin}${problem ? 'Try again' : 'Find my park'}</button>
  </form>
  <p id="finder-status" class="muted" role="status" aria-live="polite"></p>
  <noscript><p>Finding your park needs location and JavaScript. You can still <a href="/parks">pick your park from the list</a> and stamp it there.</p></noscript>
  <p class="muted">We use your location once to find the park. Nobody else ever sees it.</p>
  ${problem?.nearby?.length ? html`<h2>Closest parks</h2>
  <ul class="finder-list">${problem.nearby.map((p) => html`<li><a href="${parkPath(p, '#stamp-h')}"><span class="park-name">${p.name}</span><span class="distance">${formatMiles(p.distance_m)}</span></a></li>`)}</ul>
  <p class="muted">Open a park to stamp it on the honor system.</p>` : ''}
  <p><a href="/parks">Browse all parks</a></p>
</section>`,
  };
}
