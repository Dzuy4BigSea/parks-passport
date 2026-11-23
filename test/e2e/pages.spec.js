import { test, expect } from '@playwright/test';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expectNoAxeViolations } from './axe.js';
import { signUp } from './helpers.js';

// SPEC end-to-end check: axe on every page with zero violations, and no sideways scrolling at 375 px.
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

async function check(page, url, { status = 200 } = {}) {
  const res = await page.goto(url);
  expect(res.status(), url).toBe(status);
  await expectNoAxeViolations(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow, `${url} scrolls sideways`).toBe(false);
}

test.use({ viewport: { width: 375, height: 800 } });

test('signed-out pages', async ({ page }) => {
  for (const url of ['/', '/parks', '/parks?q=lake&cat=playground', '/parks/abercrombie-park', '/parks/auburn-street-park',
    '/signup', '/login', '/forgot', '/privacy', '/consent']) {
    await check(page, url);
  }
  await check(page, '/reset?token=expired', { status: 400 });
  await check(page, '/auth/magic?token=expired', { status: 400 });
  await check(page, '/no-such-page', { status: 404 });
});

test('signed-in pages, including admin', async ({ page }) => {
  const { email } = await signUp(page, { name: 'Page Check' });
  const db = new Database(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
  db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(email);
  const handle = db.prepare('SELECT handle FROM users WHERE email = ?').pluck().get(email);
  db.close();
  for (const url of ['/', '/stamp', '/passport', '/pals', '/account', `/u/${handle}?preview=1`, '/parks?unvisited=1',
    '/admin', '/admin/parks', '/admin/parks/new', '/admin/import', '/admin/badges', '/admin/badges/new',
    '/admin/moderation', '/admin/users', '/admin/email', '/admin/city']) {
    await check(page, url);
  }
});
