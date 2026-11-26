// The passport redesign (SPEC Flow 6, "Look"): paper cover with the latest stamps, folding
// neighborhood pages, and badges split into earned + closest, the rest behind "See all".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passportPage } from '../../src/views/pages/passport.js';
import { levelFor } from '../../src/domain/levels.js';

const theme = {
  key: 'st-pete', name: 'St. Petersburg', copy: { short: 'St. Pete' }, motifs: [],
  areas: [{ slug: 'north', name: 'North', lat: 27.85, lng: -82.65 }, { slug: 'south', name: 'South', lat: 27.7, lng: -82.65 }],
};
const park = (slug, lat, first) => ({ id: slug.length, slug, name: slug.replace(/-/g, ' '), city_key: 'st-pete', lat, lng: -82.65, first_visit: first || null });
const badge = (name, state, extra = {}) => ({ name, state, art: '🏅', description: `${name} desc`, ...extra });
const view = (parks, badges = []) => String(passportPage({
  user: { display_name: 'Ana', default_visibility: 'private' }, csrf: 'x', parks, history: [], points: 30, level: levelFor(30), badges, theme,
}).body);

test('cover: count, ring and the 3 latest stamps as postmarks (newest first)', () => {
  const body = view([park('n-one', 27.85, '2026-06-01'), park('n-two', 27.85, '2026-06-03'), park('s-one', 27.7, '2026-06-02'),
    park('s-two', 27.7, '2026-05-01'), park('s-three', 27.7)]);
  assert.match(body, /<header class="spread pp-cover">/);
  assert.match(body, /4 of 5 parks stamped/);
  assert.match(body, /<strong>80%<\/strong><small>explored<\/small>/);
  const latest = body.split('pp-latest')[1].split('</ul>')[0];
  assert.deepEqual([...latest.matchAll(/class="spread-name">([^<]+)</g)].map((m) => m[1]), ['n two', 's one', 'n one']);
  assert.match(latest, /JUN 3/);
  assert.match(body, /<nav class="pp-jump" aria-label="Passport sections">/);
});

test('pages: started neighborhoods open, untouched ones folded; outlines keep names and say "Not yet" to screen readers', () => {
  const body = view([park('n-one', 27.85, '2026-06-01'), park('s-one', 27.7)]);
  assert.match(body, /<details class="collection is-complete" open>\s*<summary class="collection-head">[\s\S]*?>North</);
  assert.match(body, /<details class="collection">\s*<summary class="collection-head">[\s\S]*?>South</);
  assert.match(body, /class="seal-slot" aria-hidden="true"><\/span>\s*<span class="stamp-name">s one<\/span>\s*<span class="stamp-date"><span class="visually-hidden">Not yet<\/span>/);
  assert.match(body, /<span class="seal-date">JUN 1<\/span>/);
  // No stamps at all: the first page is open so it isn't all folded.
  const empty = view([park('n-one', 27.85), park('s-one', 27.7)]);
  assert.equal((empty.match(/<details class="collection" open>/g) || []).length, 1);
  assert.match(empty, /Your first stamp goes here/);
});

test('badges: earned and the 3 closest up front; the rest behind See all', () => {
  const badges = [
    badge('Got', 'earned', { awarded_at: '2026-06-01T12:00:00Z' }),
    badge('Half', 'known', { progress: 5, target: 10, unit: 'parks' }),
    badge('Most', 'known', { progress: 9, target: 10, unit: 'parks' }),
    badge('Little', 'known', { progress: 1, target: 10, unit: 'parks' }),
    badge('None', 'known', { progress: 0, target: 50, unit: 'parks' }),
    badge('Secret', 'hidden', { hint: 'shh' }),
  ];
  const body = view([park('n-one', 27.85)], badges);
  const [front, rest] = body.split('class="more-badges"');
  assert.deepEqual([...front.matchAll(/class="badge-name">([^<]+)</g)].map((m) => m[1]), ['Got', 'Most', 'Half', 'Little']);
  assert.match(rest, /See all 6 badges/);
  assert.deepEqual([...rest.matchAll(/class="badge-name">([^<]+)</g)].map((m) => m[1]), ['None', 'Hidden badge']);
  assert.match(body, /Badges <span class="pp-jump-count"><span class="visually-hidden">, <\/span>1<span class="visually-hidden"> earned<\/span><\/span>/);
  // The heading sits straight in the summary (no wrapper a heading can't live in).
  assert.match(body, /<summary class="collection-head">\s*<span class="ring ring-sm"[^>]*>.*?<\/span>\s*<h3 id="col-/);
});
