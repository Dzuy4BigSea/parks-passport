import { test, expect } from '@playwright/test';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expectNoAxeViolations } from './axe.js';
import { signUp, freshPage } from './helpers.js';

// Reactions between Park Pals (SPEC Flow 26).
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

test('a pal reacts to a stamp in place; the owner gets one grouped notification; axe clean at 375px', async ({ page, browser, context }, info) => {
  await context.clearPermissions();
  await page.setViewportSize({ width: 375, height: 800 });
  const ana = await signUp(page, { name: 'Ana Reacts' });
  await page.goto('/st-pete/parks/woodlawn-park');
  await page.getByText('No GPS? Stamp on the honor system').click();
  await page.getByRole('button', { name: 'Stamp it' }).click();
  await expect(page.locator('.stamp-result')).toContainText('Stamped!');

  const ben = await freshPage(browser, info);
  await ben.setViewportSize({ width: 375, height: 800 });
  const benUser = await signUp(ben, { name: 'Ben Reacts' });
  const db = new Database(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
  const id = (email) => db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(email);
  const [a, b] = [id(ana.email), id(benUser.email)].sort((x, y) => x - y);
  db.prepare("UPDATE users SET default_visibility = 'pals' WHERE email = ?").run(ana.email);
  db.prepare('INSERT INTO pal_links (user_a, user_b, created_at) VALUES (?, ?, ?)').run(a, b, new Date().toISOString());
  db.close();

  await ben.goto('/pals');
  const item = ben.locator('.feed-item', { hasText: 'Ana Reacts stamped' });
  const bar = item.getByRole('group', { name: "React to Ana Reacts's stamp" });
  await expect(bar.getByRole('button')).toHaveCount(5);
  const party = bar.getByRole('button', { name: /Nice one/ });
  await party.click();
  await expect(party).toHaveAttribute('aria-pressed', 'true');
  await expect(party).toContainText('1');
  await expect(ben).toHaveURL(/\/pals$/); // in place, no reload
  await bar.getByRole('button', { name: /Love this park/ }).click();
  await expect(bar.getByRole('button', { name: /Love this park/ })).toHaveAttribute('aria-pressed', 'true');
  await expectNoAxeViolations(ben);
  expect(await ben.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  // Tap again to take it back.
  await party.click();
  await expect(party).toHaveAttribute('aria-pressed', 'false');
  await expect(party.locator('.react-count')).toHaveText('');

  await page.goto('/notifications');
  await expect(page.locator('main')).toContainText('Ben Reacts reacted');
  await expect(page.locator('main')).toContainText('to your stamp at Woodlawn Park.');
  await expectNoAxeViolations(page);
});
