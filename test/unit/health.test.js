import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { buildApp } from '../../src/app.js';
import { html, raw } from '../../src/views/html.js';

test('/healthz returns 200 ok when the DB is open', async () => {
  const app = buildApp({ db: openDb(':memory:') });
  const res = await app.inject('/healthz');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
  await app.close();
});

test('/healthz returns 503 when the DB is unreachable', async () => {
  const db = openDb(':memory:');
  const app = buildApp({ db });
  await app.ready();
  const realPrepare = db.prepare.bind(db);
  db.prepare = () => { throw new Error('gone'); };
  const res = await app.inject('/healthz');
  assert.equal(res.statusCode, 503);
  db.prepare = realPrepare;
  await app.close();
});

test('unknown routes return 404 HTML', async () => {
  const app = buildApp({ db: openDb(':memory:') });
  const res = await app.inject('/nope');
  assert.equal(res.statusCode, 404);
  assert.match(res.headers['content-type'], /text\/html/);
  await app.close();
});

test('migrations are recorded and idempotent', () => {
  const db = openDb(':memory:');
  const count = db.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get();
  assert.ok(count >= 1);
});

test('html escapes interpolated values but not nested html', () => {
  const out = String(html`<p>${'<script>'}${html`<b>${'&'}</b>`}${raw('<i>x</i>')}</p>`);
  assert.equal(out, '<p>&lt;script&gt;<b>&amp;</b><i>x</i></p>');
});
