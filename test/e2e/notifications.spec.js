// M21 (SPEC Flows 8 and 9): an admin gives a member a badge with a note; the member sees it pop up
// on their next page, and in the notification center behind the bell.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expectNoAxeViolations } from './axe.js';
import { signUp } from './helpers.js';

test.use({ viewport: { width: 375, height: 800 } });
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

test('an admin gives a badge; it pops up for the member with the note, and the bell shows it', async ({ browser, page }, testInfo) => {
  const admin = await signUp(page, { name: 'Ada Admin' });
  const db = new Database(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
  db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(admin.email);
  // A streak, so the admin's phone header has every chip (streak, points, bell, Admin).
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO visits (user_id, park_id, visited_on, visited_at, method, points, created_at)
    SELECT u.id, (SELECT id FROM parks WHERE slug = 'abercrombie-park'), ?, ?, 'honor', 10, ? FROM users u WHERE u.email = ?`)
    .run(today, new Date().toISOString(), new Date().toISOString(), admin.email);
  const slug = `gift-${Date.now()}`;
  db.prepare(`INSERT INTO badges (slug, name, description, art, rule_type, rule_params, kind, enabled, created_at)
    VALUES (?, 'Cleanup Crew', 'Helped at a park cleanup.', '🧹', 'manual', '{}', 'hidden', 1, 'x')`).run(slug);

  // The member, in their own browser, with celebrations on.
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL,
    storageState: { cookies: [{ name: 'pp_consent', value: 'v1.a0.d0', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] },
    viewport: { width: 375, height: 800 } });
  const member = await context.newPage();
  const { email } = await signUp(member, { name: 'Gift Ee' });
  await member.getByRole('button', { name: 'Start exploring' }).click();
  const memberId = db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(email);
  db.close();

  await page.goto(`/admin/users/${memberId}/badges`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Give Gift Ee a badge');
  await expectNoAxeViolations(page);
  await expect(page.locator('.header-chips .pill-streak')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel('Badge').selectOption({ label: 'Cleanup Crew (given only)' });
  await page.getByLabel('Note (optional)').fill('Thanks for helping at the cleanup!');
  await page.getByRole('button', { name: 'Give badge' }).click();
  await expect(page.getByRole('status')).toContainText('Badge given. It pops up the next time they open the app.');
  await expect(page.locator('.given-list')).toContainText('given by Ada Admin');

  // Next time the member opens the app: the gift, face down, then the note.
  await member.goto('/st-pete/parks');
  const reveal = member.getByRole('dialog', { name: 'A gift for you!' });
  await expect(reveal).toBeVisible();
  await reveal.getByRole('button', { name: /Tap to reveal/ }).click();
  await expect(reveal.locator('.reveal-name')).toHaveText('Cleanup Crew');
  await expect(reveal.locator('.reveal-desc')).toHaveText('Helped at a park cleanup.');
  await expect(reveal.locator('.reveal-note')).toHaveText('From Ada Admin: “Thanks for helping at the cleanup!”');
  await expectNoAxeViolations(member);
  await reveal.getByRole('button', { name: 'Awesome!' }).click();

  // The bell: one unread; the list; then read.
  const bell = member.getByRole('link', { name: /^Notifications/ });
  await expect(bell).toHaveAccessibleName('Notifications, 1 unread');
  await bell.click();
  await expect(member.getByRole('heading', { level: 1 })).toHaveText('Notifications');
  await expect(member.locator('.notification.is-new')).toContainText('Ada Admin gave you the Cleanup Crew badge');
  await expectNoAxeViolations(member);
  expect(await member.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await member.reload();
  await expect(member.locator('.notification.is-new')).toHaveCount(0);
  await expect(member.getByRole('link', { name: /^Notifications/ })).toHaveAccessibleName('Notifications');
  // On a wider screen the bell is in the main nav.
  await member.setViewportSize({ width: 1280, height: 800 });
  await member.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Notifications' }).click();
  await expect(member).toHaveURL(/\/notifications$/);
  await context.close();
});
