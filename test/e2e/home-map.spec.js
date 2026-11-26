import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

// "Your St. Pete" on the signed-in home: the dot drawing gives way to a real street map with every park.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('the home map turns into a street map with every park, and a pin opens its park', async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await signUp(page);
  await page.goto('/?city=st-pete');
  const box = page.locator('.home-map');
  const dots = await box.locator('.constellation circle.c-dot').count();
  expect(dots).toBeGreaterThan(50);
  await box.scrollIntoViewIfNeeded();
  await expect(box).toHaveClass(/is-live/);
  await expect(box.locator('.constellation')).toHaveCount(0);
  await expect(box.getByRole('region', { name: /Map of St\. Pete parks: 0 of \d+ stamped/ })).toBeVisible();
  await expect(box.locator('.hpin')).toHaveCount(dots);
  await expect(box.locator('.hpin-next').first()).toBeVisible();
  const pin = box.locator('.hpin-next').first();
  const name = (await pin.getAttribute('title')).split(':')[0];
  await pin.dispatchEvent('click'); // downtown pins overlap at this zoom
  await expect(page).toHaveURL(/\/st-pete\/parks\/[a-z0-9-]+$/);
  await expect(page.locator('h1')).toContainText(name);
});

test('if the map can\'t load, the dot drawing stays and still links to the parks', async ({ page }) => {
  await page.route('**/vendor/leaflet/leaflet-src.esm.js', (route) => route.abort());
  await signUp(page);
  await page.goto('/?city=st-pete');
  const box = page.locator('.home-map');
  await box.scrollIntoViewIfNeeded();
  await expect(box.locator('.constellation')).toBeVisible();
  await expect(box.locator('.home-street-map')).toHaveCount(0);
  await box.locator('.constellation').click();
  await expect(page).toHaveURL(/\/st-pete\/parks/);
});
