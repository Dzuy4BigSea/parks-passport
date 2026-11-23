import { test, expect } from '@playwright/test';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expectNoAxeViolations } from './axe.js';
import { signUp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

// The e2e tests share one database; other specs rely on Auburn Street Park having no location.
function resetAuburn() {
  const db = new Database(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
  db.prepare("UPDATE parks SET lat = NULL, lng = NULL, needs_pin = 1 WHERE slug = 'auburn-street-park'").run();
  db.close();
}

function makeAdmin(email) {
  const db = new Database(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
  db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(email);
  db.close();
}

test('members get 404 for /admin', async ({ page }) => {
  await signUp(page);
  expect((await page.goto('/admin')).status()).toBe(404);
  await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
});

test('admin pages pass axe, and the pin picker sets coordinates from a map click', async ({ page }) => {
  const { email } = await signUp(page, { name: 'Admin' });
  makeAdmin(email);
  await page.goto('/parks');
  await page.getByRole('link', { name: 'Admin' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Admin');
  await expectNoAxeViolations(page);

  await page.getByRole('link', { name: /Pins to check/ }).click();
  await expect(page.locator('.admin-table')).toContainText('Auburn Street Park');
  await expectNoAxeViolations(page);
  await page.getByRole('link', { name: 'Auburn Street Park' }).click();
  await expect(page.getByLabel('Latitude')).toHaveValue('');
  await expectNoAxeViolations(page);

  // Click the middle of the map (centered on St. Pete) to drop the pin.
  const map = page.getByRole('region', { name: 'Map for placing the park pin' });
  await expect(map.locator('.leaflet-control-zoom')).toBeVisible(); // map ready
  await map.scrollIntoViewIfNeeded();
  const box = await map.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const lat = Number(await page.getByLabel('Latitude').inputValue());
  const lng = Number(await page.getByLabel('Longitude').inputValue());
  expect(Math.abs(lat - 27.7731)).toBeLessThan(0.01);
  expect(Math.abs(lng + 82.64)).toBeLessThan(0.01);
  await page.getByLabel('Pin still needs checking').uncheck();
  await page.getByRole('button', { name: 'Save park' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

  // The park now has a map on its public page.
  try {
    await page.goto('/parks/auburn-street-park');
    await expect(page.locator('#park-map')).toHaveCount(1);
  } finally {
    resetAuburn();
  }
});

test('badge form shows only the chosen rule\'s settings', async ({ page }) => {
  const { email } = await signUp(page, { name: 'Admin' });
  makeAdmin(email);
  await page.goto('/admin/badges/new');
  await expectNoAxeViolations(page);
  await expect(page.getByLabel('N (how many)')).toBeVisible();
  await expect(page.getByLabel('Amenity')).toBeHidden();
  await page.getByLabel('Rule', { exact: true }).selectOption('time_of_day');
  await expect(page.getByLabel('From (local time)')).toBeVisible();
  await expect(page.getByLabel('N (how many)')).toBeHidden();
  await page.getByLabel('Rule', { exact: true }).selectOption('category_count');
  await expect(page.getByLabel('Amenity')).toBeVisible();
  await expect(page.getByLabel('N (how many)')).toBeVisible();
});

for (const url of ['/admin', '/admin/parks', '/admin/badges', '/admin/moderation', '/admin/users', '/admin/import', '/admin/email']) {
  test(`${url} fits at 375px and passes axe`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const { email } = await signUp(page, { name: 'Admin' });
    makeAdmin(email);
    await page.goto(url);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await expectNoAxeViolations(page);
  });
}
