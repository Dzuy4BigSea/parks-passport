import { test, expect } from '@playwright/test';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expectNoAxeViolations } from './axe.js';
import { signUp } from './helpers.js';

// Badge ideas (SPEC Flow 13): submit on a phone, triage on a desktop.

const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

function makeSuperAdmin(email) {
  const db = new Database(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
  db.prepare('UPDATE users SET is_admin = 1, is_super_admin = 1 WHERE email = ?').run(email);
  db.close();
}

test('submit an idea at 375 px, then keep it and create a badge at 1440 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const { email } = await signUp(page, { name: 'Idea Boss' });
  makeSuperAdmin(email);

  await page.goto('/ideas');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Badge ideas');
  await expectNoAxeViolations(page);
  expect(await noSideways(page)).toBe(false);
  const name = `Dawn Patrol ${Date.now()}`;
  await page.getByLabel('Badge name').fill(name);
  await page.getByLabel('Earn it when you…').fill('stamp a park before sunrise');
  await page.getByRole('button', { name: 'Submit idea' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your idea is in' })).toBeVisible();
  await expect(page.locator('.idea-list')).toContainText(name);
  await expectNoAxeViolations(page);
  expect(await noSideways(page)).toBe(false);

  await page.goto('/admin/ideas?status=new');
  await expectNoAxeViolations(page);
  expect(await noSideways(page)).toBe(false);

  await page.setViewportSize({ width: 1440, height: 900 });
  const card = page.locator('.idea-card').filter({ hasText: name });
  await card.getByLabel('Keep').check();
  await card.getByLabel('Fits rule').selectOption('time_of_day');
  await card.getByRole('button', { name: /^Save/ }).click();
  await page.goto('/admin/ideas?status=keep');
  await expectNoAxeViolations(page);
  await page.locator('.idea-card').filter({ hasText: name }).getByRole('link', { name: /Create badge/ }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(name);
  await expect(page.locator('#rule_type')).toHaveValue('time_of_day');
  await expectNoAxeViolations(page);
});
