// M35 (SPEC Flow 23): start a group, share its code, a friend asks to join and is approved; axe at 375 px.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expectNoAxeViolations } from './axe.js';
import { signUp, freshPage } from './helpers.js';

test.use({ viewport: { width: 375, height: 800 } });
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

test('a Troop Leader starts a group; a friend asks with the code and is approved; no sideways scroll', async ({ page, browser }, info) => {
  const owner = await signUp(page, { name: 'Tess Leader' });
  // Unlocked by an admin-set limit here (the 10 GPS check-ins are covered by unit tests).
  const db = new Database(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
  db.prepare('UPDATE users SET group_create_limit = 3 WHERE email = ?').run(owner.email);
  db.close();

  await page.goto('/groups');
  await expectNoAxeViolations(page);
  await page.getByLabel('Group name').fill('Sunrise Run Club');
  await page.getByLabel('Emoji').fill('🏃');
  await page.getByRole('button', { name: 'Start the group' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sunrise Run Club');
  await expect(page.getByRole('status')).toContainText('Your group is ready');
  await expectNoAxeViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const code = (await page.locator('.friend-code').innerText()).trim();

  const friend = await freshPage(browser, info);
  await friend.setViewportSize({ width: 375, height: 800 });
  await signUp(friend, { name: 'Finn Friend' });
  await friend.goto('/groups');
  await friend.getByLabel('Group code').fill(code);
  await friend.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(friend.getByRole('status')).toHaveText('Asked. The owner will see your request.');

  await page.reload();
  await page.getByRole('button', { name: 'Approve Finn Friend' }).click();
  await expect(page.locator('.group-board')).toContainText('Finn Friend');

  await friend.goto('/');
  await expect(friend.locator('.groups-mini')).toContainText('Sunrise Run Club');
  await friend.getByRole('link', { name: 'Sunrise Run Club' }).click();
  await expect(friend.locator('.group-board li')).toHaveCount(2);
  await expectNoAxeViolations(friend);
  expect(await friend.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
