import { test, expect } from '@playwright/test';

// The park list opens nearest first (SPEC Flow 2): asked once, A–Z if you say no.
const CRESCENT = { latitude: 27.788453, longitude: -82.641303 };

test.describe('location allowed', () => {
  test.use({ geolocation: CRESCENT, permissions: ['geolocation'], viewport: { width: 412, height: 900 } });
  test('the list sorts itself and the closest park is highlighted; Clear goes back to A–Z for good', async ({ page }) => {
    await page.goto('/st-pete/parks');
    await expect(page).toHaveURL(/lat=27\.78845&lng=-82\.64130/);
    await expect(page.locator('.result-count')).toContainText('nearest first');
    const first = page.locator('.park-card').first();
    await expect(first).toHaveClass(/is-nearest/);
    await expect(first.locator('h2')).toHaveText('Crescent Lake Park');
    await expect(first.locator('.nearest-tag')).toHaveText('Closest to you');
    await expect(page.locator('.park-card.is-nearest')).toHaveCount(1);
    await page.getByRole('link', { name: 'Clear', exact: true }).click();
    await expect(page).toHaveURL(/\/st-pete\/parks\?sort=az$/);
    await page.waitForTimeout(800);
    await expect(page).toHaveURL(/sort=az$/); // didn't re-sort itself
    await expect(page.locator('.park-card h2').first()).toHaveText('Abercrombie Park');
    await expect(page.locator('.park-card.is-nearest')).toHaveCount(0);
  });

  test('a search or filter is never re-sorted on its own', async ({ page }) => {
    await page.goto('/st-pete/parks?q=lake');
    await page.waitForTimeout(800);
    await expect(page).toHaveURL(/\?q=lake$/);
  });
});

test('location denied: the full A–Z list, and the site doesn’t ask again', async ({ page }) => {
  await page.goto('/st-pete/parks');
  await page.waitForTimeout(800);
  await expect(page).toHaveURL(/\/st-pete\/parks$/);
  await expect(page.locator('.park-card h2').first()).toHaveText('Abercrombie Park');
  await expect(page.locator('#near-me-status')).toHaveText(''); // no scolding on load
  expect(await page.evaluate(() => localStorage.getItem('pp-near-asked'))).toBe('1');
});
