// M32 (SPEC Flow 22): an admin approves an outfit in Admin › Gary; a member picks it in Account ›
// Gary's wardrobe, and Gary wears it in the lower right.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expectNoAxeViolations } from './axe.js';
import { signUp } from './helpers.js';

test.use({ viewport: { width: 375, height: 800 } });
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

test('approve the sun hat, pick it in the wardrobe, and Gary wears it', async ({ page }) => {
  const { email } = await signUp(page, { name: 'Wardrobe Admin' });
  const db = new Database(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
  db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(email);
  db.close();

  await page.goto('/admin/gary');
  const card = page.locator('#outfit-sun-hat');
  await expect(card.getByRole('img', { name: 'Gary in the Sun hat outfit' })).toBeVisible();
  if (await card.getByRole('button', { name: 'Approve Sun hat' }).count()) await card.getByRole('button', { name: 'Approve Sun hat' }).click();
  await expect(page.locator('#outfit-sun-hat .status-pill').first()).toHaveText('Approved');
  await expectNoAxeViolations(page);

  await page.goto('/account');
  await page.getByRole('link', { name: /Gary’s wardrobe/ }).click();
  await expect(page.getByRole('heading', { name: 'Gary’s wardrobe' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Dress for the weather/ })).toBeChecked();
  await page.getByRole('radio', { name: /^Sun hat/ }).check();
  await expectNoAxeViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved. Gary’s changed.');
  await expect(page.getByRole('radio', { name: /^Sun hat/ })).toBeChecked();
  // The lower-right Gary wears the sun hat's coral shirt.
  await page.goto('/st-pete/parks');
  await expect(page.locator('.gary-fab svg path[fill="#ff7a59"]').first()).toBeAttached();
});
