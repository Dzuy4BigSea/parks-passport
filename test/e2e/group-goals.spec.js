// M36 (SPEC Flow 24): an owner picks a ready-made goal; the group page shows progress; axe at 375 px.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expectNoAxeViolations } from './axe.js';
import { signUp } from './helpers.js';

const AT_PARK = { latitude: 27.8065, longitude: -82.75531, accuracy: 15 }; // Abercrombie Park

test.use({ viewport: { width: 375, height: 800 }, geolocation: AT_PARK, permissions: ['geolocation'] });
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

test('an owner starts a goal; a check-in reaches it and the team badge shows; no sideways scroll', async ({ page }) => {
  const owner = await signUp(page, { name: 'Goal Getter' });
  const db = new Database(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
  db.prepare('UPDATE users SET group_create_limit = 3 WHERE email = ?').run(owner.email);
  db.close();
  await page.goto('/groups');
  await page.getByLabel('Group name').fill('Goal Crew');
  await page.getByLabel('Emoji').fill('🎯');
  await page.getByRole('button', { name: 'Start the group' }).click();

  await page.getByRole('radio', { name: 'Our own goal:' }).check();
  await page.getByLabel('How many').fill('1');
  await page.getByLabel('Days', { exact: true }).fill('7');
  await page.getByRole('button', { name: 'Start the goal' }).click();
  await expect(page.locator('.goal-card')).toContainText('1 check-in together in 7 days');
  await expectNoAxeViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // One GPS check-in reaches it: the team badge lands in Team badges.
  await page.goto('/st-pete/parks/abercrombie-park');
  await page.getByRole('button', { name: 'Check in here' }).click();
  await expect(page).toHaveURL(/stamped=/);
  await page.goto('/st-pete/passport');
  await expect(page.locator('#team-badges')).toContainText('Team Effort');
  await expect(page.locator('#team-badges')).toContainText('With Goal Crew');
  await expectNoAxeViolations(page);
});
