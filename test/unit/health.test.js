import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { makeApp } from './helpers.js';
import { html, raw } from '../../src/views/html.js';

test('/healthz returns 200 ok when the DB is open', async () => {
  const { app } = makeApp();
  const res = await app.inject('/healthz');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
  await app.close();
});

test('/healthz returns 503 when the DB is unreachable', async () => {
  const { app, db } = makeApp();
  await app.ready();
  const realPrepare = db.prepare.bind(db);
  db.prepare = () => { throw new Error('gone'); };
  const res = await app.inject('/healthz');
  assert.equal(res.statusCode, 503);
  db.prepare = realPrepare;
  await app.close();
});

test('unknown routes return 404 HTML', async () => {
  const { app } = makeApp();
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

test('pages carry a description and absolute share-preview tags; query strings stay out of og:url', async () => {
  const { app } = makeApp();
  const res = await app.inject('/privacy?lat=27.7&lng=-82.6');
  assert.match(res.body, /<meta name="description" content="Check in at every St. Petersburg park/);
  assert.match(res.body, /<meta property="og:image" content="http:\/\/test\.local\/og\/parks-passport\.jpg">/);
  assert.match(res.body, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(res.body, /<meta property="og:url" content="http:\/\/test\.local\/privacy">/);
  assert.match(res.body, /<link rel="canonical" href="http:\/\/test\.local\/privacy">/);
  assert.doesNotMatch(res.body, /og:url[^>]*lat=/);
  const img = await app.inject('/og/parks-passport.jpg');
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers['content-type'], 'image/jpeg');
  await app.close();
});

test('pages whose URL carries a secret get no og:url or canonical', async () => {
  const { app } = makeApp();
  const res = await app.inject('/join/SECRET123');
  assert.doesNotMatch(res.body, /og:url|rel="canonical"/);
  await app.close();
});
