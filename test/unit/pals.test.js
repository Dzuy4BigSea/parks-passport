import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, testClock } from './helpers.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { seedBadgesIfEmpty } from '../../src/domain/badges/index.js';
import { canSee } from '../../src/domain/visibility.js';
import { palsFeed, FEED_PAGE_SIZE } from '../../src/domain/pals.js';

const PW = 'correct horse battery';

async function world() {
  const now = testClock('2026-06-06T16:00:00Z'); // a Saturday
  const { app, db } = makeApp({ now });
  importParksCsv(db, [PARK_CSV_COLUMNS.join(','),
    'a-park,A Park,,,27.80,-82.70,,,,0', 'b-park,B Park,,,27.81,-82.71,,,,0'].join('\n'));
  seedBadgesIfEmpty(db, [
    { slug: 'first', name: 'First Stamp', kind: 'known', rule_type: 'parks_count', rule_params: { n: 1 } },
    { slug: 'together', name: 'Better Together', kind: 'known', rule_type: 'pal_same_day', rule_params: {} },
  ]);
  const people = {};
  for (const name of ['ana', 'ben', 'cat']) {
    const c = client(app);
    await c.post('/signup', { display_name: name, email: `${name}@example.com`, password: PW });
    people[name] = { c, id: db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(`${name}@example.com`) };
  }
  const inviteLink = async (who) => {
    const page = await people[who].c.get('/pals');
    return page.body.match(/\/pals\/invite\/[A-Za-z0-9_-]+/)[0];
  };
  const befriend = async (a, b) => {
    const link = await inviteLink(a);
    return people[b].c.post(`${link}/accept`);
  };
  const setVis = (who, v) => people[who].c.post('/account/visibility', { default_visibility: v });
  return { app, db, now, people, inviteLink, befriend, setVis };
}

test('canSee: owner always; private owner only; pals for pals; public for anyone', () => {
  const cases = [
    // visibility, viewer, isPal, expected
    ['private', 'owner', false, true], ['private', 'pal', true, false], ['private', 'stranger', false, false], ['private', 'anon', false, false],
    ['pals', 'owner', false, true], ['pals', 'pal', true, true], ['pals', 'stranger', false, false], ['pals', 'anon', false, false],
    ['public', 'owner', false, true], ['public', 'pal', true, true], ['public', 'stranger', false, true], ['public', 'anon', false, true],
  ];
  const ids = { owner: 1, pal: 2, stranger: 3, anon: null };
  for (const [visibility, who, isPal, expected] of cases) {
    assert.equal(canSee({ viewerId: ids[who], ownerId: 1, visibility, isPal }), expected, `${visibility}/${who}`);
  }
});

test('permissions matrix over HTTP: passport, visits and badges for owner / pal / stranger / signed-out', async () => {
  const { app, people, befriend, setVis } = await world();
  await befriend('ana', 'ben'); // ana and ben are pals; cat is a stranger
  await people.ana.c.post('/st-pete/parks/a-park/stamp', {}); // ana: a visit and the First Stamp badge
  const viewers = { owner: people.ana.c, pal: people.ben.c, stranger: people.cat.c, anon: client(app) };
  const expected = {
    private: { owner: true, pal: false, stranger: false, anon: false },
    pals: { owner: true, pal: true, stranger: false, anon: false },
    public: { owner: true, pal: true, stranger: true, anon: true },
  };
  for (const visibility of ['private', 'pals', 'public']) {
    await setVis('ana', visibility);
    for (const [who, c] of Object.entries(viewers)) {
      const res = await c.get('/u/ana?preview=1');
      const allowed = expected[visibility][who];
      assert.equal(res.statusCode, allowed ? 200 : 404, `passport ${visibility}/${who}`);
      // Visit and badge show on the passport only when allowed.
      assert.equal(res.body.includes('A Park</a>'), allowed, `visit ${visibility}/${who}`);
      assert.equal(res.body.includes('First Stamp'), allowed, `badge ${visibility}/${who}`);
      if (who === 'pal') {
        const feed = (await c.get('/pals')).body;
        assert.equal(feed.includes('stamped <a href="/st-pete/parks/a-park">'), visibility !== 'private', `feed visit ${visibility}`);
        assert.equal(feed.includes('First Stamp'), visibility !== 'private', `feed badge ${visibility}`);
      }
    }
  }
  // Unknown handle: same 404 as a private passport.
  assert.equal((await client(app).get('/u/nobody-here')).statusCode, 404);
});

test('invite link: accept makes pals both ways; self and repeat are handled; regenerate kills the old link', async () => {
  const { app, db, people, inviteLink } = await world();
  const link = await inviteLink('ana');
  assert.match((await client(app).get(link)).body, /ana invited you to be Park Pals/);
  assert.match((await people.ana.c.get(link)).body, /This is your own invite link/);
  assert.equal((await people.ben.c.post(`${link}/accept`)).statusCode, 303);
  assert.match((await people.ben.c.get(link)).body, /already Park Pals/);
  assert.equal(db.prepare('SELECT COUNT(*) FROM pal_links').pluck().get(), 1);
  assert.match((await people.ana.c.get('/pals')).body, /@ben</);
  assert.match((await people.ben.c.get('/pals')).body, /@ana</);

  await people.ana.c.post('/pals/invite/regenerate');
  assert.equal((await people.cat.c.get(link)).statusCode, 404);
  assert.equal((await people.cat.c.post(`${link}/accept`)).statusCode, 404);
  const fresh = await inviteLink('ana');
  assert.notEqual(fresh, link);
  assert.equal((await people.cat.c.post(`${fresh}/accept`)).statusCode, 303);
});

test('signed-out invitees are sent to sign up and come back to the invite', async () => {
  const { app, inviteLink } = await world();
  const link = await inviteLink('ana');
  const page = await client(app).get(link);
  assert.ok(page.body.includes(`/signup?next=${encodeURIComponent(link)}`));
  const c = client(app);
  const res = await c.post('/signup', { display_name: 'Dee', email: 'dee@example.com', password: PW, next: link });
  assert.equal(res.headers.location, link);
});

test('removing a pal unlinks both and revokes Better Together', async () => {
  const { db, people, befriend, now, setVis } = await world();
  await befriend('ana', 'ben');
  await setVis('ana', 'pals');
  await setVis('ben', 'pals');
  await people.ana.c.post('/st-pete/parks/a-park/stamp', {});
  now.advanceMinutes(30);
  await people.ben.c.post('/st-pete/parks/a-park/stamp', {});
  const together = (who) => db.prepare(`SELECT COUNT(*) FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
    WHERE b.slug = 'together' AND ub.user_id = ?`).pluck().get(people[who].id);
  // Whoever stamped first also gets it when the pal stamps later.
  assert.equal(together('ana'), 1);
  assert.equal(together('ben'), 1);
  await people.ana.c.post('/pals/ben/remove');
  assert.equal(db.prepare('SELECT COUNT(*) FROM pal_links').pluck().get(), 0);
  assert.equal(together('ana'), 0);
  assert.equal(together('ben'), 0);
});

test('accepting an invite after stamping together awards Better Together', async () => {
  const { db, people, befriend, setVis } = await world();
  await setVis('ana', 'pals');
  await setVis('ben', 'public');
  await people.ana.c.post('/st-pete/parks/b-park/stamp', {});
  await people.ben.c.post('/st-pete/parks/b-park/stamp', {});
  await befriend('ana', 'ben');
  const n = db.prepare("SELECT COUNT(*) FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE b.slug = 'together'").pluck().get();
  assert.equal(n, 2);
});

test('leaderboard: me and visible pals by parks, then points; private pals are left out', async () => {
  const { people, befriend, setVis } = await world();
  await befriend('ana', 'ben');
  await befriend('ana', 'cat');
  await people.ben.c.post('/st-pete/parks/a-park/stamp', {});
  await people.ben.c.post('/st-pete/parks/b-park/stamp', {});
  await people.cat.c.post('/st-pete/parks/a-park/stamp', { visited_on: '2026-06-01' });
  await setVis('ben', 'pals');
  // cat stays private
  const body = (await people.ana.c.get('/pals')).body;
  const board = body.slice(body.indexOf('class="leaderboard"'), body.indexOf('</ol>'));
  assert.ok(board.indexOf('/u/ben') < board.indexOf('You'), 'ben (2 parks) ranks above me (0)');
  assert.ok(!board.includes('/u/cat'), 'private pal left out');
  assert.match(board, /2 parks · 20 pts/);
});

test('feed pages hold 20 items, newest first', async () => {
  const { db, people, befriend, setVis } = await world();
  await befriend('ana', 'ben');
  await setVis('ben', 'pals');
  const park = db.prepare("SELECT id FROM parks WHERE slug = 'a-park'").pluck().get();
  const ins = db.prepare(`INSERT INTO visits (user_id, park_id, visited_on, visited_at, method, created_at)
    VALUES (?, ?, ?, ?, 'honor', ?)`);
  for (let i = 0; i < 25; i++) {
    const day = `2026-05-${String(i + 1).padStart(2, '0')}`;
    ins.run(people.ben.id, park, day, `${day}T16:00:00.000Z`, `${day}T16:00:00.000Z`);
  }
  const p1 = palsFeed(db, people.ana.id, { page: 1 });
  assert.equal(p1.items.length, FEED_PAGE_SIZE);
  assert.equal(p1.hasMore, true);
  assert.equal(p1.items[0].visited_on, '2026-05-25');
  const p2 = palsFeed(db, people.ana.id, { page: 2 });
  assert.equal(p2.items.length, 5);
  assert.equal(p2.hasMore, false);
  assert.match((await people.ana.c.get('/pals?page=2')).body, /href="\/pals\?page=1"/);
});

test('share nudge after a stamp while private; 3 dismissals stop it; sharing sets pals', async () => {
  const { db, people } = await world();
  const stampPage = async (slug, date) => {
    const res = await people.ana.c.post(`/st-pete/parks/${slug}/stamp`, date ? { visited_on: date } : {});
    return (await people.ana.c.get(res.headers.location)).body;
  };
  const dates = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04'];
  for (let i = 0; i < 3; i++) {
    const body = await stampPage('a-park', dates[i]);
    assert.match(body, /Share your passport with Park Pals\?/);
    await people.ana.c.post('/account/nudge/dismiss', { back: '/st-pete/parks/a-park' });
  }
  assert.ok(!(await stampPage('a-park', dates[3])).includes('Share your passport with Park Pals?'));
  const res = await people.ana.c.post('/account/visibility', { default_visibility: 'pals', back: '/st-pete/parks/a-park' });
  assert.equal(res.headers.location, '/st-pete/parks/a-park');
  assert.equal(db.prepare('SELECT default_visibility FROM users WHERE id = ?').pluck().get(people.ana.id), 'pals');
  assert.equal((await people.ana.c.post('/account/visibility', { default_visibility: 'everyone' })).statusCode, 422);
});

test('new accounts are private; deleting an account removes its pal links and its /u page', async () => {
  const { db, people, befriend, setVis } = await world();
  assert.equal(db.prepare('SELECT default_visibility FROM users WHERE id = ?').pluck().get(people.cat.id), 'private');
  await befriend('ana', 'ben');
  await setVis('ana', 'public');
  assert.equal((await people.cat.c.get('/u/ana')).statusCode, 200);
  await people.ana.c.post('/account/delete', { delete_password: PW });
  assert.equal(db.prepare('SELECT COUNT(*) FROM pal_links').pluck().get(), 0);
  assert.equal(db.prepare('SELECT COUNT(*) FROM pal_invites WHERE user_id = ?').pluck().get(people.ana.id), 0);
  assert.equal((await people.cat.c.get('/u/ana')).statusCode, 404);
});

test("Better Together never reveals a private pal's visits", async () => {
  const { db, people, befriend, setVis } = await world();
  await befriend('ana', 'ben'); // ana stays private
  await people.ana.c.post('/st-pete/parks/b-park/stamp', { visited_on: '2026-05-10' });
  const benHasIt = () => db.prepare(`SELECT COUNT(*) FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
    WHERE b.slug = 'together' AND ub.user_id = ?`).pluck().get(people.ben.id);
  // Ben probes Ana's real park and day: no badge, because Ana's passport is private.
  const res = await people.ben.c.post('/st-pete/parks/b-park/stamp', { visited_on: '2026-05-10' });
  assert.ok(!(await people.ben.c.get(res.headers.location)).body.includes('Better Together'));
  assert.equal(benHasIt(), 0);
  // Once Ana shares with pals, the same shared day earns it on the next check.
  await setVis('ana', 'pals');
  await people.ben.c.post('/st-pete/parks/a-park/stamp', {});
  assert.equal(benHasIt(), 1);
});

test('deleting the shared visit revokes Better Together for the pal too', async () => {
  const { db, people, befriend, setVis } = await world();
  await befriend('ana', 'ben');
  await setVis('ana', 'pals');
  await setVis('ben', 'pals');
  await people.ana.c.post('/st-pete/parks/a-park/stamp', {});
  await people.ben.c.post('/st-pete/parks/a-park/stamp', {});
  const count = () => db.prepare("SELECT COUNT(*) FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE b.slug = 'together'").pluck().get();
  assert.equal(count(), 2);
  const benVisit = db.prepare('SELECT id FROM visits WHERE user_id = ?').pluck().get(people.ben.id);
  await people.ben.c.post(`/visits/${benVisit}/delete`, {});
  assert.equal(count(), 0);
});

test("a removed pal can't re-accept the old invite link", async () => {
  const { db, people, inviteLink } = await world();
  const link = await inviteLink('ana');
  await people.ben.c.post(`${link}/accept`);
  await people.ana.c.post('/pals/ben/remove');
  assert.equal((await people.ben.c.post(`${link}/accept`)).statusCode, 404);
  assert.equal(db.prepare('SELECT COUNT(*) FROM pal_links').pluck().get(), 0);
  assert.match((await people.ana.c.get('/pals?done=removed')).body, /invite link was renewed/);
});

test('the pals list links only to passports you can see', async () => {
  const { people, befriend, setVis } = await world();
  await befriend('ana', 'ben');
  await befriend('ana', 'cat');
  await setVis('ben', 'pals');
  const body = (await people.ana.c.get('/pals')).body;
  const list = body.slice(body.indexOf('class="pal-list"'));
  assert.match(list, /<a href="\/u\/ben">ben<\/a>/);
  assert.ok(!list.includes('href="/u/cat"'));
  assert.match(list, /cat <span class="muted">@cat<\/span>/);
});

// ---------- Friend codes and pal requests ----------

const codeOf = async (who, people) => (await people[who].c.get('/pals')).body.match(/id="my-code"[^>]*value="([A-Z0-9]{4}-[A-Z0-9]{4})"/)[1];

test('friend code: 8 characters with no look-alikes; typing it sends a request; accepting makes pals both ways', async () => {
  const { db, people } = await world();
  const code = await codeOf('ana', people);
  assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/);
  assert.equal(await codeOf('ana', people), code); // stable until renewed

  // Any case, spaces or no dash.
  const res = await people.ben.c.post('/pals/code', { code: ` ${code.replace('-', ' ').toLowerCase()} ` });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/pals?done=requested');
  assert.equal(db.prepare('SELECT COUNT(*) FROM pal_links').pluck().get(), 0); // not pals yet
  assert.match((await people.ben.c.get('/pals')).body, /Waiting for an answer[\s\S]*@ana/);
  const anaPage = (await people.ana.c.get('/pals')).body;
  assert.match(anaPage, /<strong>ben<\/strong> <span class="muted">@ben<\/span> wants to be Park Pals/);

  const id = db.prepare('SELECT id FROM pal_requests').pluck().get();
  assert.equal((await people.cat.c.post(`/pals/requests/${id}/accept`)).statusCode, 404); // not cat's to answer
  assert.equal((await people.ben.c.post(`/pals/requests/${id}/accept`)).statusCode, 404); // the sender can't accept
  assert.equal((await people.ana.c.post(`/pals/requests/${id}/accept`)).headers.location, '/pals?done=accepted');
  assert.equal(db.prepare('SELECT COUNT(*) FROM pal_links').pluck().get(), 1);
  assert.equal(db.prepare('SELECT COUNT(*) FROM pal_requests').pluck().get(), 0);
  assert.match((await people.ben.c.get('/pals')).body, /@ana</);

  const again = await people.ben.c.post('/pals/code', { code });
  assert.equal(again.statusCode, 422);
  assert.match(again.body, /already Park Pals with ana/);
});

test('pal requests: decline and cancel; self, repeat, mutual request; a new code kills the old one', async () => {
  const { db, people } = await world();
  const ana = await codeOf('ana', people);
  const ben = await codeOf('ben', people);
  assert.match((await people.ana.c.post('/pals/code', { code: ana })).body, /your own code/);

  await people.cat.c.post('/pals/code', { code: ana });
  assert.match((await people.cat.c.post('/pals/code', { code: ana })).body, /You already asked ana/);
  const id = db.prepare('SELECT id FROM pal_requests').pluck().get();
  assert.equal((await people.ana.c.post(`/pals/requests/${id}/decline`)).headers.location, '/pals?done=declined');
  assert.doesNotMatch((await people.cat.c.get('/pals')).body, /Waiting for an answer/); // just gone
  assert.equal(db.prepare('SELECT COUNT(*) FROM pal_links').pluck().get(), 0);

  await people.cat.c.post('/pals/code', { code: ben });
  const rid = db.prepare('SELECT id FROM pal_requests').pluck().get();
  assert.equal((await people.ben.c.post(`/pals/requests/${rid}/cancel`)).statusCode, 404); // only the sender cancels
  assert.equal((await people.cat.c.post(`/pals/requests/${rid}/cancel`)).headers.location, '/pals?done=cancelled');

  // Mutual: ben asked ana; ana typing ben's code makes them pals right away.
  await people.ben.c.post('/pals/code', { code: ana });
  assert.equal((await people.ana.c.post('/pals/code', { code: ben })).headers.location, '/pals?done=accepted');
  assert.equal(db.prepare('SELECT COUNT(*) FROM pal_links').pluck().get(), 1);
  assert.equal(db.prepare('SELECT COUNT(*) FROM pal_requests').pluck().get(), 0);

  // A request that's also covered by an invite link is cleared when they become pals.
  await people.cat.c.post('/pals/code', { code: ana });
  const link = (await people.ana.c.get('/pals')).body.match(/\/pals\/invite\/[A-Za-z0-9_-]+/)[0];
  await people.cat.c.post(`${link}/accept`);
  assert.equal(db.prepare('SELECT COUNT(*) FROM pal_requests').pluck().get(), 0);

  await people.ana.c.post('/pals/code/regenerate');
  assert.notEqual(await codeOf('ana', people), ana);
  assert.match((await people.cat.c.post('/pals/code', { code: ana })).body, /doesn(&#39;|')t match anyone/);
});

test("pal codes can't be guessed: 10 wrong codes an hour, 20 requests a day", async () => {
  const { app, db, people, now } = await world();
  const ana = await codeOf('ana', people);
  for (let i = 0; i < 10; i++) assert.equal((await people.cat.c.post('/pals/code', { code: 'ZZZZZZZZ' })).statusCode, 422);
  const locked = await people.cat.c.post('/pals/code', { code: ana });
  assert.equal(locked.statusCode, 429);
  assert.match(locked.body, /Try again in an hour/);
  now.advanceMinutes(61);
  assert.equal((await people.cat.c.post('/pals/code', { code: ana })).statusCode, 303);

  // Daily cap on requests sent.
  const more = [];
  for (let i = 0; i < 20; i++) {
    const c = client(app);
    await c.post('/signup', { display_name: `p${i}`, email: `p${i}@example.com`, password: PW });
    more.push(await (async () => (await c.get('/pals')).body.match(/id="my-code"[^>]*value="([A-Z0-9-]{9})"/)[1])());
  }
  for (let i = 0; i < 19; i++) assert.equal((await people.cat.c.post('/pals/code', { code: more[i] })).statusCode, 303);
  const capped = await people.cat.c.post('/pals/code', { code: more[19] });
  assert.equal(capped.statusCode, 429);
  assert.match(capped.body, /20 requests today/);
  assert.equal(db.prepare('SELECT COUNT(*) FROM pal_requests WHERE from_user = ?').pluck().get(people.cat.id), 20);
});

test("a dead invite link explains itself (still a 404) and doesn't say whose it was", async () => {
  const { app, people, inviteLink } = await world();
  const link = await inviteLink('ana');
  await people.ana.c.post('/pals/invite/regenerate');
  for (const res of [await people.ben.c.get(link), await people.ben.c.get(`${link.slice(0, -1)}`), await client(app).get(link)]) {
    assert.equal(res.statusCode, 404);
    assert.match(res.body, /This invite link doesn(&#39;|')t work anymore/);
    assert.doesNotMatch(res.body, /\bana\b/);
  }
  assert.match((await people.ben.c.get(link)).body, /href="\/pals#add"/);
  assert.match((await client(app).get(link)).body, /href="\/signup\?next=\/pals"/);
});

test('deleting an account removes its friend code and pal requests', async () => {
  const { db, people } = await world();
  const ana = await codeOf('ana', people);
  await people.ben.c.post('/pals/code', { code: ana });
  await people.ana.c.post('/pals/code', { code: await codeOf('cat', people) });
  await people.ana.c.post('/account/delete', { delete_password: PW });
  assert.equal(db.prepare('SELECT COUNT(*) FROM pal_requests').pluck().get(), 0);
  assert.equal(db.prepare('SELECT COUNT(*) FROM pal_codes WHERE user_id = ?').pluck().get(people.ana.id), 0);
});

test("QA: cancelling doesn't give a daily request back; a non-code isn't a guess; accepting a request checks badges", async () => {
  const { db, people } = await world();
  const ana = await codeOf('ana', people);
  for (let i = 0; i < 20; i++) {
    assert.equal((await people.cat.c.post('/pals/code', { code: ana })).statusCode, 303);
    const id = db.prepare('SELECT id FROM pal_requests').pluck().get();
    await people.cat.c.post(`/pals/requests/${id}/cancel`);
  }
  assert.equal((await people.cat.c.post('/pals/code', { code: ana })).statusCode, 429);

  for (let i = 0; i < 12; i++) {
    const res = await people.ben.c.post('/pals/code', { code: i % 2 ? '' : 'hello' });
    assert.equal(res.statusCode, 422);
    assert.match(res.body, /Type the 8-character code/);
  }
  assert.equal(db.prepare('SELECT COUNT(*) FROM pal_code_failures').pluck().get(), 0);

  // Ana and Ben stamp the same park the same day, then become pals by request: Better Together.
  for (const who of ['ana', 'ben']) await people[who].c.post('/st-pete/parks/a-park/stamp', {});
  await people.ben.c.post('/pals/code', { code: ana });
  const rid = db.prepare('SELECT id FROM pal_requests').pluck().get();
  await people.ana.c.post('/account/visibility', { default_visibility: 'pals' });
  await people.ben.c.post('/account/visibility', { default_visibility: 'pals' });
  await people.ana.c.post(`/pals/requests/${rid}/accept`);
  const together = db.prepare(`SELECT COUNT(*) FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE b.slug = 'together'`).pluck().get();
  assert.equal(together, 2);
});
