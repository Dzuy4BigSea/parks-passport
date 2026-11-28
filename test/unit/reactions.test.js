// M41: Reactions between Park Pals (SPEC Flow 26).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, testClock } from './helpers.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { seedCities } from '../../src/db/seed.js';
import { toggleReaction, reactionsFor } from '../../src/domain/reactions.js';

const PW = 'correct horse battery';

async function world() {
  const now = testClock('2026-06-06T16:00:00Z');
  const made = makeApp({ now });
  const { db, app } = made;
  seedCities(db);
  importParksCsv(db, [PARK_CSV_COLUMNS.join(','), 'a-park,A Park,,,27.800,-82.700,,,,0'].join('\n'));
  const people = {};
  for (const name of ['ana', 'ben', 'cat', 'dee']) {
    const c = client(app);
    await c.post('/signup', { display_name: name, email: `${name}@example.com`, password: PW });
    people[name] = { c, id: db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(`${name}@example.com`) };
  }
  const link = (x, y) => { const [a, b] = x < y ? [x, y] : [y, x]; db.prepare('INSERT INTO pal_links (user_a, user_b, created_at) VALUES (?, ?, ?)').run(a, b, now().toISOString()); };
  // Ana shares with pals; Ben and Cat are her pals; Dee isn't.
  db.prepare("UPDATE users SET default_visibility = 'pals' WHERE id = ?").run(people.ana.id);
  link(people.ana.id, people.ben.id);
  link(people.ana.id, people.cat.id);
  await people.ana.c.post('/st-pete/parks/a-park/stamp', {});
  const visit = db.prepare('SELECT id FROM visits WHERE user_id = ?').pluck().get(people.ana.id);
  return { ...made, now, people, visit };
}

test('a pal reacts to a stamp in the feed and takes it back; counts and "mine" show', async () => {
  const { db, people, visit } = await world();
  const feed = (await people.ben.c.get('/pals')).body;
  assert.match(feed, new RegExp(`id="r-visit-${visit}-${people.ana.id}"`));
  assert.match(feed, /aria-label="React to ana's stamp"/);
  const react = (who, reaction) => people[who].c.post('/reactions', { type: 'visit', id: String(visit), owner: String(people.ana.id), reaction, page: '1' });
  const res = await react('ben', 'party');
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/pals#r-visit-${visit}-${people.ana.id}`);
  await react('cat', 'party');
  await react('cat', 'tree');
  const map = reactionsFor(db, people.ben.id, [{ type: 'visit', id: visit, ownerId: people.ana.id }]);
  const mine = map.get(`visit:${visit}:${people.ana.id}`);
  assert.deepEqual(mine.counts, { party: 2, tree: 1 });
  assert.deepEqual([...mine.mine], ['party']);
  const page = (await people.ben.c.get('/pals')).body;
  assert.match(page, /class="react is-on" aria-pressed="true" title="Nice one" data-reaction="party">\s*<span aria-hidden="true">🎉<\/span><span class="visually-hidden">Nice one<\/span><span class="react-count">2<\/span>/);
  // Tap again: taken back.
  await react('ben', 'party');
  assert.deepEqual(reactionsFor(db, people.ben.id, [{ type: 'visit', id: visit, ownerId: people.ana.id }]).get(`visit:${visit}:${people.ana.id}`).counts, { party: 1, tree: 1 });
});

test('only pals, only what the feed shows; not your own; 404 otherwise', async () => {
  const { db, people, visit, now } = await world();
  const t = { type: 'visit', id: visit, reaction: 'fire' };
  assert.equal(toggleReaction(db, people.dee.id, t, { now: now() }), null); // not a pal
  assert.equal(toggleReaction(db, people.ana.id, t, { now: now() }), null); // her own
  assert.equal(toggleReaction(db, people.ben.id, { ...t, reaction: 'heart' }, { now: now() }), null); // not one of the five
  assert.equal((await people.dee.c.post('/reactions', { type: 'visit', id: String(visit), reaction: 'fire' })).statusCode, 404);
  db.prepare("UPDATE users SET default_visibility = 'private' WHERE id = ?").run(people.ana.id);
  assert.equal(toggleReaction(db, people.ben.id, t, { now: now() }), null); // she stopped sharing
});

test('one grouped notification per item, refreshed as pals react; removing a pal removes their reactions', async () => {
  const { db, people, visit } = await world();
  const react = (who, reaction) => people[who].c.post('/reactions', { type: 'visit', id: String(visit), owner: String(people.ana.id), reaction });
  await react('ben', 'party');
  await react('cat', 'tree');
  await react('cat', 'party');
  const rows = db.prepare("SELECT * FROM notifications WHERE user_id = ? AND kind = 'reaction'").all(people.ana.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].read_at, null);
  const list = (await people.ana.c.get('/notifications')).body;
  assert.match(list, /cat and 1 other reacted 🎉🌳 to your stamp at A Park\./);
  assert.match(list, /href="\/st-pete\/parks\/a-park"/);
  // Taking one back doesn't notify.
  await react('cat', 'party');
  assert.equal(db.prepare("SELECT COUNT(*) FROM notifications WHERE kind = 'reaction'").pluck().get(), 1);
  // Unlinked: Ben's reactions on Ana's things go.
  db.prepare('DELETE FROM pal_links WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)').run(people.ana.id, people.ben.id, people.ben.id, people.ana.id);
  assert.equal(db.prepare('SELECT COUNT(*) FROM reactions WHERE user_id = ?').pluck().get(people.ben.id), 0);
  // Deleting the stamp removes its reactions.
  db.prepare('DELETE FROM visits WHERE id = ?').run(visit);
  assert.equal(db.prepare('SELECT COUNT(*) FROM reactions').pluck().get(), 0);
});

test('badges take reactions too (they need their owner); revoking one removes them', async () => {
  const { db, people, now } = await world();
  const badge = db.prepare('SELECT badge_id FROM user_badges WHERE user_id = ? LIMIT 1').pluck().get(people.ana.id);
  assert.ok(badge, 'the first stamp earned a badge');
  assert.equal(toggleReaction(db, people.ben.id, { type: 'badge', id: badge, reaction: 'clap' }, { now: now() }), null); // needs the owner
  assert.equal(toggleReaction(db, people.ben.id, { type: 'badge', id: badge, owner: people.ana.id, reaction: 'clap' }, { now: now() }).on, true);
  const n = db.prepare("SELECT text, link FROM notifications WHERE kind = 'reaction'").get();
  assert.match(n.text, /reacted 👏 to your .+ badge\./);
  assert.equal(n.link, '/passport#badges');
  // Revoking the badge removes its reactions.
  db.prepare('DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?').run(people.ana.id, badge);
  assert.equal(db.prepare("SELECT COUNT(*) FROM reactions WHERE target_type = 'badge'").pluck().get(), 0);
});
