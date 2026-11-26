import { test, expect } from '@playwright/test';
import path from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { expectNoAxeViolations } from './axe.js';
import { signUp } from './helpers.js';

// Nonprofit ads and activity tips (SPEC Flow 25). The e2e database is shared, so these ads only
// target Fossil Park (no other spec uses it) and are deleted afterwards.
const PARK = '/st-pete/parks/fossil-park';
const openDb = () => new Database(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
const ymd = (d) => d.toISOString().slice(0, 10);
const png = (color) => sharp({ create: { width: 600, height: 500, channels: 3, background: color } }).png().toBuffer();

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

test.afterAll(() => {
  const db = openDb();
  db.prepare("DELETE FROM ads WHERE name LIKE 'E2E %'").run();
  db.prepare("DELETE FROM nonprofits WHERE name = 'E2E Calm Sangha'").run();
  db.close();
});

test('an admin makes a two-image ad for one park; it shows at the bottom and slides; a tip opens and closes', async ({ page, context }) => {
  await context.clearPermissions();
  await page.setViewportSize({ width: 375, height: 800 });
  const { email } = await signUp(page, { name: 'Ad Admin' });
  const db = openDb();
  db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(email);
  const cityId = db.prepare("SELECT id FROM city_themes WHERE key = 'st-pete'").pluck().get();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO nonprofits (name, url, mission, reason, status, city_id, created_at, updated_at)
    VALUES ('E2E Calm Sangha', 'https://calm.example.org', 'Free meditation.', 'local', 'active', ?, ?, ?)`).run(cityId, now, now);
  db.close();

  // Make the ad: one park, today through next week.
  await page.goto('/admin/ads');
  await page.getByRole('link', { name: 'Make an ad' }).click();
  await page.getByLabel('Name (only admins see it)').fill('E2E Fossil calm');
  await page.getByLabel('Nonprofit').selectOption({ label: 'E2E Calm Sangha' });
  await page.getByLabel('Start date', { exact: true }).fill(ymd(new Date(Date.now() - 86400e3)));
  await page.getByLabel('End date', { exact: true }).fill(ymd(new Date(Date.now() + 7 * 86400e3)));
  await expect(page.getByLabel('Heading')).toBeHidden(); // tip fields only for tips
  await page.getByLabel('These parks').check();
  await page.locator('.scope-parks summary', { hasText: 'St. Petersburg' }).click();
  await page.getByLabel('Fossil Park', { exact: true }).check();
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'Save and add images' }).click();
  await expect(page.getByText('Ad saved. Add its images next, then switch it on.')).toBeVisible();

  for (const [color, alt] of [['#00b3a4', 'Teal: breathe in'], ['#ff4d88', 'Pink: breathe out']]) {
    await page.getByLabel('Add an image').setInputFiles({ name: 'ad.png', mimeType: 'image/png', buffer: await png(color) });
    await page.getByLabel("What it shows (for people who can't see it)").fill(alt);
    await page.getByRole('button', { name: 'Add image' }).click();
    await expect(page.getByText('Image added.')).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Images (2 of 5)' })).toBeVisible();
  await page.getByLabel('Show it between its dates').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expectNoAxeViolations(page);
  await page.goto('/admin/ads');
  await expect(page.locator('.admin-table')).toContainText('Running');

  // The park page: the ad at the bottom, sliding with Previous / Pause / Next.
  await page.goto(PARK);
  const ad = page.locator('.np-ad');
  await expect(ad).toContainText('Local nonprofit · E2E Calm Sangha');
  await ad.scrollIntoViewIfNeeded();
  await expect(ad.locator('li.is-current img')).toHaveAttribute('alt', 'Teal: breathe in');
  await ad.getByRole('button', { name: 'Next image' }).click();
  await expect(ad.locator('li.is-current img')).toHaveAttribute('alt', 'Pink: breathe out');
  const pause = ad.getByRole('button', { name: 'Pause slides' });
  await pause.click();
  await expect(ad.getByRole('button', { name: 'Play slides' })).toHaveAttribute('aria-pressed', 'true');
  await expect(ad.locator('li.is-current a')).toHaveAttribute('href', /^\/go\/ad\/\d+\?from=\d+$/);
  await expectNoAxeViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  // An activity tip on a calm activity, reusing the ad's images.
  const db2 = openDb();
  const adId = db2.prepare("SELECT id FROM ads WHERE name = 'E2E Fossil calm'").pluck().get();
  const act = db2.prepare("SELECT id, name FROM activities WHERE pillar = 'calm' AND category IS NULL AND edition = 'core' AND active = 1 ORDER BY sort, id LIMIT 1").get();
  const tipId = Number(db2.prepare(`INSERT INTO ads (nonprofit_id, name, placement, activity_id, title, body, active, starts_on, ends_on, all_cities, park_scope, created_at, updated_at)
    SELECT nonprofit_id, 'E2E Tip', 'activity', ?, 'Three calm breaths', 'Sit somewhere shady.' || char(10) || char(10) || 'Breathe in for four.', 1, starts_on, ends_on, 1, 'parks', created_at, updated_at FROM ads WHERE id = ?`).run(act.id, adId).lastInsertRowid);
  db2.prepare('INSERT INTO ad_targets (ad_id, kind, value) SELECT ?, kind, value FROM ad_targets WHERE ad_id = ?').run(tipId, adId);
  db2.prepare('INSERT INTO ad_slides (ad_id, image_key, animated, alt, sort) SELECT ?, image_key, animated, alt, sort FROM ad_slides WHERE ad_id = ?').run(tipId, adId);
  db2.close();

  // Locked until today's stamp (honor system here), then "Tips from …" opens a pop-up.
  await page.goto(PARK);
  await expect(page.getByRole('link', { name: /Tips from E2E Calm Sangha/ })).toHaveCount(0);
  await page.getByText('No GPS? Stamp on the honor system').click();
  await page.getByRole('button', { name: 'Stamp it' }).click();
  await expect(page.locator('.stamp-result')).toContainText('Stamped!');
  const group = page.locator('.act-group', { has: page.getByText(act.name, { exact: true }) });
  await group.locator('summary').click();
  const tip = group.getByRole('link', { name: /Tips from E2E Calm Sangha/ });
  await tip.click();
  const dialog = page.getByRole('dialog', { name: 'Three calm breaths' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Breathe in for four.');
  await expect(dialog.getByRole('link', { name: 'Visit E2E Calm Sangha' })).toHaveAttribute('href', /^\/go\/ad\/\d+\?from=\d+$/);
  await expectNoAxeViolations(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(tip).toBeFocused();
});
