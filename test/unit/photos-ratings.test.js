import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { makeApp, client, testClock } from './helpers.js';
import { importParksCsv, PARK_CSV_COLUMNS } from '../../src/domain/csv-import.js';
import { storePhoto, photoPath } from '../../src/lib/images.js';
import { totalPoints } from '../../src/domain/points.js';

const PW = 'correct horse battery';

// A JPEG with GPS EXIF, like a phone photo.
async function phonePhoto({ width = 3000, height = 2000 } = {}) {
  return sharp({ create: { width, height, channels: 3, background: '#3a7d44' } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'TestPhone', Model: 'Model X' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '27/1 48/1 2340/100', GPSLongitudeRef: 'W', GPSLongitude: '82/1 45/1 1910/100' },
    })
    .toBuffer();
}

test('photos are re-encoded to max 2000 px plus a 400 px thumbnail, with all EXIF (incl. GPS) removed', async () => {
  const input = await phonePhoto();
  const inMeta = await sharp(input).metadata();
  assert.ok(inMeta.exif && inMeta.exif.includes(Buffer.from('TestPhone')), 'fixture has EXIF');
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'pp-img-'));
  const stored = await storePhoto(input, dir);
  assert.deepEqual([stored.width, stored.height], [2000, 1333]);
  const full = fs.readFileSync(photoPath(dir, stored.fileKey, 'full'));
  const thumb = fs.readFileSync(photoPath(dir, stored.fileKey, 'thumb'));
  for (const file of [full, thumb]) {
    const m = await sharp(file).metadata();
    assert.equal(m.format, 'jpeg');
    assert.equal(m.exif, undefined, 'no EXIF block');
    assert.ok(!file.includes(Buffer.from('TestPhone')) && !file.includes(Buffer.from('GPS')), 'no EXIF strings');
  }
  const tm = await sharp(thumb).metadata();
  assert.deepEqual([tm.width, tm.height], [400, 400]);
});

test('uploads are validated by content: wrong types, HEIC and oversize files are refused', async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'pp-img-'));
  assert.match((await storePhoto(Buffer.from('not an image at all'), dir)).error, /not a photo we can read/);
  const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).gif().toBuffer();
  assert.match((await storePhoto(gif, dir)).error, /Use a JPEG, PNG or WebP/);
  const fakeHeic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(64)]);
  assert.match((await storePhoto(fakeHeic, dir)).error, /HEIC/);
  assert.match((await storePhoto(Buffer.alloc(10 * 1024 * 1024 + 1), dir)).error, /over 10 MB/);
  const png = await sharp({ create: { width: 50, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  assert.ok((await storePhoto(png, dir)).fileKey);
  assert.deepEqual(fs.readdirSync(dir).length, 1); // only the PNG's month folder was created
});

async function world() {
  const now = testClock('2026-06-06T16:00:00Z');
  const { app, db, uploadsDir } = makeApp({ now });
  importParksCsv(db, [PARK_CSV_COLUMNS.join(','), 'a-park,A Park,,,27.80,-82.70,,,,0'].join('\n'));
  const people = {};
  for (const name of ['ana', 'ben', 'cat']) {
    const c = client(app);
    await c.post('/signup', { display_name: name, email: `${name}@example.com`, password: PW });
    people[name] = { c, id: db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(`${name}@example.com`) };
  }
  const link = (await people.ana.c.get('/pals')).body.match(/\/pals\/invite\/[A-Za-z0-9_-]+/)[0];
  await people.ben.c.post(`${link}/accept`); // ana and ben are pals; cat is a stranger
  return { app, db, now, uploadsDir, people };
}

const upload = async (c, fields = {}) => c.postMultipart('/st-pete/parks/a-park/photos',
  { caption: 'Sunset', ...fields }, { photo: { buffer: await phonePhoto({ width: 800, height: 600 }), filename: 'IMG_1.jpg', type: 'image/jpeg' } });

test('upload a photo: stored, shown on the park page, served to the owner', async () => {
  const { db, people } = await world();
  const res = await upload(people.ana.c, { visibility: 'public' });
  assert.equal(res.statusCode, 303);
  const photo = db.prepare('SELECT * FROM photos').get();
  assert.equal(photo.caption, 'Sunset');
  assert.equal(photo.visibility, 'public');
  const page = await people.cat.c.get('/st-pete/parks/a-park');
  assert.match(page.body, new RegExp(`/photos/${photo.id}/thumb`));
  const img = await people.cat.c.get(`/photos/${photo.id}/full`);
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers['content-type'], 'image/jpeg');
});

test('a bad upload shows an inline error and saves nothing', async () => {
  const { db, people } = await world();
  const res = await people.ana.c.postMultipart('/st-pete/parks/a-park/photos', { caption: 'x' },
    { photo: { buffer: Buffer.from('%PDF-1.4 not a photo'), filename: 'doc.jpg', type: 'image/jpeg' } });
  assert.equal(res.statusCode, 422);
  assert.match(res.body, /role="alert" tabindex="-1" data-announce>That file is not a photo we can read/);
  assert.equal(db.prepare('SELECT COUNT(*) FROM photos').pluck().get(), 0);
});

test('permissions matrix over HTTP: photo and review comment, owner / pal / stranger / signed-out', async () => {
  const { app, db, people } = await world();
  await upload(people.ana.c, { visibility: 'private' });
  await people.ana.c.post('/st-pete/parks/a-park/rating', { stars: '4', comment: 'Lovely sunset spot', visibility: 'private' });
  const photoId = db.prepare('SELECT id FROM photos').pluck().get();
  const viewers = { owner: people.ana.c, pal: people.ben.c, stranger: people.cat.c, anon: client(app) };
  const expected = {
    private: { owner: true, pal: false, stranger: false, anon: false },
    pals: { owner: true, pal: true, stranger: false, anon: false },
    public: { owner: true, pal: true, stranger: true, anon: true },
  };
  for (const visibility of ['private', 'pals', 'public']) {
    db.prepare('UPDATE photos SET visibility = ?').run(visibility);
    db.prepare('UPDATE ratings SET visibility = ?').run(visibility);
    for (const [who, c] of Object.entries(viewers)) {
      const allowed = expected[visibility][who];
      assert.equal((await c.get(`/photos/${photoId}/thumb`)).statusCode, allowed ? 200 : 404, `photo ${visibility}/${who}`);
      const page = (await c.get('/st-pete/parks/a-park')).body;
      assert.equal(page.includes(`/photos/${photoId}/thumb`), allowed, `photo listed ${visibility}/${who}`);
      assert.equal(page.includes('Lovely sunset spot'), allowed, `comment ${visibility}/${who}`);
      // The aggregate always counts the rating.
      assert.match(page, /<strong>4\.0<\/strong> out of 5 · 1 rating/, `average ${visibility}/${who}`);
    }
  }
});

test('hidden photos and comments: only the owner sees them, labeled; stars still count', async () => {
  const { db, people } = await world();
  await upload(people.ana.c, { visibility: 'public' });
  await people.ana.c.post('/st-pete/parks/a-park/rating', { stars: '2', comment: 'Rude words', visibility: 'public' });
  db.prepare('UPDATE photos SET hidden = 1').run();
  db.prepare('UPDATE ratings SET comment_hidden = 1').run();
  const id = db.prepare('SELECT id FROM photos').pluck().get();
  assert.equal((await people.cat.c.get(`/photos/${id}/full`)).statusCode, 404);
  const others = (await people.cat.c.get('/st-pete/parks/a-park')).body;
  assert.ok(!others.includes('Rude words'));
  assert.match(others, /<strong>2\.0<\/strong> out of 5/);
  assert.equal((await people.ana.c.get(`/photos/${id}/full`)).statusCode, 200);
  const own = (await people.ana.c.get('/st-pete/parks/a-park')).body;
  assert.equal((own.match(/Hidden by moderator/g) || []).length, 2);
});

test('edit and delete a photo: visibility and caption change; delete removes the files', async () => {
  const { db, uploadsDir, people } = await world();
  await upload(people.ana.c, { visibility: 'private' });
  const photo = db.prepare('SELECT * FROM photos').get();
  await people.ana.c.post(`/photos/${photo.id}`, { caption: 'New caption', visibility: 'pals', back: '/st-pete/parks/a-park' });
  assert.deepEqual({ ...db.prepare('SELECT caption, visibility FROM photos').get() }, { caption: 'New caption', visibility: 'pals' });
  assert.equal((await people.cat.c.post(`/photos/${photo.id}/delete`, { back: '/' })).statusCode, 404, "can't delete others'");
  const files = ['full', 'thumb'].map((s) => photoPath(uploadsDir, photo.file_key, s));
  assert.ok(files.every((f) => fs.existsSync(f)));
  await people.ana.c.post(`/photos/${photo.id}/delete`, { back: '/st-pete/parks/a-park' });
  assert.equal(db.prepare('SELECT COUNT(*) FROM photos').pluck().get(), 0);
  assert.ok(files.every((f) => !fs.existsSync(f)));
});

test('a photo stamp is method photo and earns the +3 photo bonus; deleting the photo removes it', async () => {
  const { db, people } = await world();
  const res = await people.ana.c.postMultipart('/st-pete/parks/a-park/stamp', { visited_on: '2026-06-01' },
    { photo: { buffer: await phonePhoto({ width: 600, height: 400 }), filename: 'a.jpg', type: 'image/jpeg' } });
  assert.equal(res.statusCode, 303);
  const visit = db.prepare('SELECT * FROM visits').get();
  assert.equal(visit.method, 'photo');
  assert.equal(visit.points, 13);
  const photo = db.prepare('SELECT * FROM photos').get();
  assert.equal(photo.visit_id, visit.id);
  assert.equal(photo.visibility, 'private'); // account default
  await people.ana.c.post(`/photos/${photo.id}/delete`, { back: '/st-pete/passport' });
  assert.equal(db.prepare('SELECT points FROM visits').pluck().get(), 10);
  assert.equal(totalPoints(db, people.ana.id), 10);
});

test('a stamp with a bad photo is refused and nothing is saved', async () => {
  const { db, people } = await world();
  const res = await people.ana.c.postMultipart('/st-pete/parks/a-park/stamp', {},
    { photo: { buffer: Buffer.from('nope'), filename: 'a.jpg', type: 'image/jpeg' } });
  assert.equal(res.statusCode, 422);
  assert.equal(db.prepare('SELECT COUNT(*) FROM visits').pluck().get(), 0);
});

test('ratings: one per user per park, first earns +2, update keeps it, delete reverses it', async () => {
  const { db, people } = await world();
  await people.ana.c.post('/st-pete/parks/a-park/rating', { stars: '5', comment: 'Great' });
  assert.equal(totalPoints(db, people.ana.id), 2);
  await people.ana.c.post('/st-pete/parks/a-park/rating', { stars: '3', comment: 'Okay' });
  assert.equal(db.prepare('SELECT COUNT(*) FROM ratings').pluck().get(), 1);
  assert.equal(db.prepare('SELECT stars FROM ratings').pluck().get(), 3);
  assert.equal(totalPoints(db, people.ana.id), 2);
  await people.ben.c.post('/st-pete/parks/a-park/rating', { stars: '4' });
  assert.match((await people.cat.c.get('/st-pete/parks/a-park')).body, /<strong>3\.5<\/strong> out of 5 · 2 ratings/);
  await people.ana.c.post('/st-pete/parks/a-park/rating/delete', {});
  assert.equal(totalPoints(db, people.ana.id), 0);
  assert.match((await people.cat.c.get('/st-pete/parks/a-park')).body, /<strong>4\.0<\/strong> out of 5 · 1 rating/);
});

test('rating validation: stars 1–5 and comments up to 500 characters', async () => {
  const { db, people } = await world();
  for (const stars of ['0', '6', '2.5', '']) {
    assert.equal((await people.ana.c.post('/st-pete/parks/a-park/rating', { stars })).statusCode, 422, `stars ${stars}`);
  }
  const res = await people.ana.c.post('/st-pete/parks/a-park/rating', { stars: '4', comment: 'x'.repeat(501) });
  assert.equal(res.statusCode, 422);
  assert.match(res.body, /Keep your comment to 500 characters/);
  assert.equal(db.prepare('SELECT COUNT(*) FROM ratings').pluck().get(), 0);
});

test('pals feed shows a pal\'s shared photos but not private ones', async () => {
  const { db, people } = await world();
  await upload(people.ana.c, { visibility: 'private' });
  assert.ok(!(await people.ben.c.get('/pals')).body.includes('added a photo'));
  db.prepare("UPDATE photos SET visibility = 'pals'").run();
  assert.match((await people.ben.c.get('/pals')).body, /ana<\/a> added a photo of <a href="\/st-pete\/parks\/a-park">A Park/);
});

test('deleting an account removes its photos (files too) and ratings', async () => {
  const { db, uploadsDir, people } = await world();
  await upload(people.ana.c);
  await people.ana.c.post('/st-pete/parks/a-park/rating', { stars: '5' });
  const key = db.prepare('SELECT file_key FROM photos').pluck().get();
  await people.ana.c.post('/account/delete', { delete_password: PW });
  assert.equal(db.prepare('SELECT COUNT(*) FROM photos').pluck().get(), 0);
  assert.equal(db.prepare('SELECT COUNT(*) FROM ratings').pluck().get(), 0);
  assert.ok(!fs.existsSync(photoPath(uploadsDir, key, 'full')));
});

test('decompression bombs are refused before decoding', async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'pp-img-'));
  const bomb = await sharp({ create: { width: 10000, height: 6000, channels: 3, background: '#fff' } }).png().toBuffer();
  assert.ok(bomb.length < 10 * 1024 * 1024, 'small file');
  assert.match((await storePhoto(bomb, dir)).error, /over 50 megapixels/);
});

test('a truncated image gets the inline message and leaves no files', async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'pp-img-'));
  const good = await phonePhoto({ width: 800, height: 600 });
  const res = await storePhoto(good.subarray(0, Math.floor(good.length / 2)), dir);
  assert.match(res.error, /not a photo we can read/);
  const leftover = fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.jpg'));
  assert.deepEqual(leftover, []);
});

test('uploads are only parsed on the photo routes; other POSTs refuse multipart', async () => {
  const { people } = await world();
  const res = await people.ana.c.postMultipart('/login', { email: 'x@example.com', password: 'whatever!!' },
    { photo: { buffer: Buffer.alloc(1024), filename: 'a.bin' } });
  assert.equal(res.statusCode, 415);
  assert.match(res.body, /<h1>Sorry<\/h1>/);
});

test('comments with line breaks count them as one character, like the browser', async () => {
  const { db, people } = await world();
  const comment = Array.from({ length: 100 }, () => 'abcd').join('\r\n'); // 499 chars counted as the browser does
  assert.equal(comment.replace(/\r\n/g, '\n').length, 499);
  const res = await people.ana.c.post('/st-pete/parks/a-park/rating', { stars: '4', comment });
  assert.equal(res.statusCode, 303);
  assert.ok(!db.prepare('SELECT comment FROM ratings').pluck().get().includes('\r'));
});

test('a failed rating keeps the typed comment and focuses the error', async () => {
  const { people } = await world();
  const res = await people.ana.c.post('/st-pete/parks/a-park/rating', { stars: '9', comment: 'Keep me' });
  assert.equal(res.statusCode, 422);
  assert.match(res.body, /data-announce>Choose from 1 to 5 stars\./);
  assert.match(res.body, />Keep me<\/textarea>/);
});

test('same-day photos count toward a GPS stamp, in either order', async () => {
  const { db, people } = await world();
  // Stamp by GPS first, then upload from the park page the same day.
  await people.ana.c.post('/st-pete/parks/a-park/checkin', { lat: '27.8', lng: '-82.7', accuracy: '10' });
  const v = db.prepare('SELECT * FROM visits WHERE user_id = ?').get(people.ana.id);
  assert.equal(v.method, 'gps');
  assert.equal(v.points, 15);
  await upload(people.ana.c);
  assert.equal(db.prepare('SELECT visit_id FROM photos WHERE user_id = ?').pluck().get(people.ana.id), v.id);
  assert.equal(db.prepare('SELECT points FROM visits WHERE id = ?').pluck().get(v.id), 18);
  assert.equal(totalPoints(db, people.ana.id), 18);

  // Upload first, then stamp by GPS the same day.
  await upload(people.ben.c);
  assert.equal(db.prepare('SELECT visit_id FROM photos WHERE user_id = ?').pluck().get(people.ben.id), null);
  const res = await people.ben.c.post('/st-pete/parks/a-park/checkin', { lat: '27.8', lng: '-82.7', accuracy: '10' });
  const page = (await people.ben.c.get(res.headers.location)).body;
  assert.match(page, /Stamped! \+18 points/);
  assert.match(page, /photo: \+3/);
  assert.equal(totalPoints(db, people.ben.id), 18);
});

test('photos from another day do not attach to a stamp', async () => {
  const { db, now, people } = await world();
  await upload(people.ana.c);
  now.advanceMinutes(24 * 60);
  await people.ana.c.post('/st-pete/parks/a-park/checkin', { lat: '27.8', lng: '-82.7', accuracy: '10' });
  assert.equal(db.prepare('SELECT visit_id FROM photos').pluck().get(), null);
  assert.equal(totalPoints(db, people.ana.id), 15);
});

test('admins can open a private photo; captions are cut to 200 characters', async () => {
  const { db, people } = await world();
  await upload(people.ana.c, { visibility: 'private', caption: 'x'.repeat(250) });
  const photo = db.prepare('SELECT * FROM photos').get();
  assert.equal(photo.caption.length, 200);
  assert.equal((await people.cat.c.get(`/photos/${photo.id}/full`)).statusCode, 404);
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(people.cat.id);
  assert.equal((await people.cat.c.get(`/photos/${photo.id}/full`)).statusCode, 200);
});
