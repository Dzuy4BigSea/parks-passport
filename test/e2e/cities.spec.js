// Multi-city (SPEC Flow 14): Westminster, CA alongside St. Pete.
import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './axe.js';
import { signUp } from './helpers.js';

const AT_SIGLER = { latitude: 33.757335, longitude: -118.002137, accuracy: 15 };

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

test('Westminster pages: landing, parks and a park, axe clean and no sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const [url, heading] of [['/westminster', 'Your passport to Westminster parks'], ['/westminster/parks', 'Westminster parks'], ['/westminster/parks/sigler-park', 'Sigler Park']]) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await expectNoAxeViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.goto('/westminster');
  await page.getByRole('link', { name: 'St. Petersburg, Florida' }).click();
  await expect(page).toHaveURL(/\/st-pete$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your passport to St. Pete parks');
});

test.describe('at Sigler Park', () => {
  test.use({ geolocation: AT_SIGLER, permissions: ['geolocation'] });

  test('a member stamps a Westminster park by GPS; the passport has a tab for each city', async ({ page }) => {
    await signUp(page);
    await page.goto('/westminster/parks/sigler-park');
    await page.getByRole('button', { name: 'Check in here' }).click();
    await expect(page).toHaveURL(/\/westminster\/parks\/sigler-park\?stamped=\d+$/);
    await expect(page.locator('.stamp-result')).toContainText('Stamped! +15 points');
    await page.goto('/passport');
    await expect(page).toHaveURL(/\/westminster\/passport$/);
    await expect(page.locator('.passport-count')).toHaveText('1 of 25 parks stamped');
    const tabs = page.getByRole('navigation', { name: 'Cities in this passport' });
    await expect(tabs.getByRole('link', { name: /Westminster/ })).toHaveAttribute('aria-current', 'page');
    await tabs.getByRole('link', { name: /St\. Pete/ }).click();
    await expect(page.locator('.passport-count')).toHaveText('0 of 102 parks stamped');
    await expectNoAxeViolations(page);
  });
});
