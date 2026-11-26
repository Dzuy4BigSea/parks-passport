import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './axe.js';
import { signUp } from './helpers.js';

// Abercrombie Park's pin (from the City's map).
const AT_PARK = { latitude: 27.8065, longitude: -82.75531, accuracy: 15 };
const FAR_AWAY = { latitude: 27.7731, longitude: -82.6400, accuracy: 15 }; // downtown, ~11 km

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

test('signed out: the park page asks you to log in to stamp', async ({ page }) => {
  await page.goto('/st-pete/parks/abercrombie-park');
  await expect(page.getByRole('link', { name: 'Log in to stamp this park' }))
    .toHaveAttribute('href', '/login?next=%2Fst-pete%2Fparks%2Fabercrombie-park');
});

test.describe('at the park', () => {
  test.use({ geolocation: AT_PARK, permissions: ['geolocation'] });

  test('GPS check-in stamps the park, shows points, and blocks a second stamp today', async ({ page }) => {
    await signUp(page);
    await page.goto('/st-pete/parks/abercrombie-park');
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Check in here' }).click();
    await expect(page).toHaveURL(/\/parks\/abercrombie-park\?stamped=\d+$/);
    const result = page.locator('.stamp-result');
    await expect(result).toContainText('Stamped! +15 points');
    await expect(result).toContainText('first stamp: +10');
    await expect(result).toContainText('GPS verified: +5');
    await expect(page.locator('.stamped-today')).toHaveText('✓ Stamped today.');
    await expect(page.locator('.my-visits')).toContainText('GPS verified · 15 pts');
    await expectNoAxeViolations(page);

    // The list marks the park as stamped, and "Not visited yet" hides it (A–Z: with location
    // allowed, the plain list would sort itself by distance).
    await page.goto('/st-pete/parks?sort=az');
    const card = page.locator('.park-card', { hasText: 'Abercrombie Park' });
    await expect(card.locator('.stamp-badge')).toHaveText('✓ Stamped');
    await page.getByLabel('Not visited yet').check();
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/unvisited=1/);
    await expect(page.locator('.park-card', { hasText: 'Abercrombie Park' })).toHaveCount(0);
    await expect(page.locator('.result-count')).toHaveText('101 of 102 parks match');

    // A second stamp the same day (honor form posted directly) is refused.
    await page.goto('/st-pete/parks/abercrombie-park');
    const res = await page.request.post('/st-pete/parks/abercrombie-park/stamp', {
      form: { _csrf: (await page.context().cookies()).find((c) => c.name === 'pp_csrf').value, visited_on: '' },
    });
    expect(res.status()).toBe(422);
    expect(await res.text()).toContain('Already stamped today');
  });
});

test.describe('away from the park', () => {
  test.use({ geolocation: FAR_AWAY, permissions: ['geolocation'] });

  test('shows the distance and offers "Stamp anyway (honor system)"', async ({ page }) => {
    await signUp(page);
    await page.goto('/st-pete/parks/abercrombie-park');
    await page.getByRole('button', { name: 'Check in here' }).click();
    await expect(page.getByRole('alert')).toContainText(/You're \d+\.\d mi from this park/);
    await page.getByRole('button', { name: 'Stamp anyway (honor system)' }).click();
    await expect(page.locator('.stamp-result')).toContainText('Stamped! +10 points');
    await expect(page.locator('.my-visits')).toContainText('Honor system');
  });
});

test.describe('location denied', () => {
  test.use({ permissions: [] });

  test('falls back to the honor system; backdating works, future dates are refused', async ({ page, context }) => {
    await context.clearPermissions();
    await signUp(page);
    await page.goto('/st-pete/parks/abercrombie-park');
    await page.getByRole('button', { name: 'Check in here' }).click();
    await expect(page.locator('#checkin-status')).toContainText("couldn't get your location");
    await expect(page.locator('#honor')).toHaveAttribute('open', '');

    // A future date is rejected by the server even if the browser's max is bypassed.
    const dateInput = page.getByLabel('Date of your visit');
    await dateInput.evaluate((el) => el.removeAttribute('max'));
    await dateInput.fill('2099-01-01');
    await page.getByRole('button', { name: 'Stamp it' }).click();
    await expect(page.getByRole('alert')).toContainText("You can't stamp a date in the future.");

    await page.getByLabel('Date of your visit').fill('2025-03-15');
    await page.getByRole('button', { name: /Stamp/ }).last().click();
    await expect(page.locator('.stamp-result')).toContainText('Stamped! +10 points');
    await expect(page.locator('.my-visits')).toContainText('March 15, 2025 · Honor system');
  });
});

test.describe('deleting a visit', () => {
  test.use({ geolocation: AT_PARK, permissions: ['geolocation'] });

  test('removes it from your visits', async ({ page }) => {
    await signUp(page);
    await page.goto('/st-pete/parks/abercrombie-park');
    await page.getByRole('button', { name: 'Check in here' }).click();
    await expect(page.locator('.my-visits li')).toHaveCount(1);
    await page.getByRole('button', { name: /Delete visit on/ }).click();
    await expect(page).toHaveURL(/\/parks\/abercrombie-park$/);
    await expect(page.locator('.my-visits')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Check in here' })).toBeVisible();
  });
});

test.describe('on a phone', () => {
  test.use({ geolocation: AT_PARK, permissions: ['geolocation'], viewport: { width: 375, height: 800 } });

  test('the stamp panel fits and the result screenshot is taken', async ({ page }, info) => {
    await signUp(page);
    await page.goto('/st-pete/parks/abercrombie-park');
    await page.getByRole('button', { name: 'Check in here' }).click();
    await expect(page.locator('.stamp-result')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: info.outputPath('stamped-375.png') });
  });
});
