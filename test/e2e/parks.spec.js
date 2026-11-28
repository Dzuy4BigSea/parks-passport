import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './axe.js';

// Map tiles come from OpenStreetMap; keep tests offline and fast.
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

const cardNames = (page) => page.locator('.park-card h2').allTextContents();

test('/parks lists every active park alphabetically and passes axe', async ({ page }) => {
  await page.goto('/st-pete/parks');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('St. Pete parks');
  const names = await cardNames(page);
  expect(names).toHaveLength(111);
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  await expect(page.locator('.result-count')).toHaveText('111 parks');
  await expectNoAxeViolations(page);
});

test('search filters by name, case-insensitively', async ({ page }) => {
  await page.goto('/st-pete/parks');
  await page.getByLabel('Search by park name').fill('lake');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/q=lake/);
  const names = await cardNames(page);
  expect(names.length).toBeGreaterThan(0);
  expect(names).toContain('Crescent Lake Park');
  for (const n of names) expect(n.toLowerCase()).toContain('lake');
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('search and filters work as a plain GET form', async ({ page }) => {
    await page.goto('/st-pete/parks');
    await expect(page.getByRole('button', { name: 'Sort by nearest' })).toBeHidden();
    await page.getByLabel('Search by park name').fill('LAKE');
    await page.locator('summary', { hasText: 'Amenities' }).click();
    await page.getByLabel('Dog park').check();
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/q=LAKE.*cat=dog-park/);
    expect(await cardNames(page)).toEqual(['Crescent Lake Park', 'Lake Vista Park']);
  });
});

test('amenity filters show only parks that have all of them', async ({ page }) => {
  await page.goto('/st-pete/parks?cat=dog-park');
  const dogParks = await cardNames(page);
  expect(dogParks.length).toBe(6); // 5 city dog parks + Fort De Soto (county)
  for (const card of await page.locator('.park-card').all()) {
    await expect(card.locator('.chips')).toContainText('Dog park');
  }
  await page.goto('/st-pete/parks?cat=dog-park&cat=lake');
  const both = await cardNames(page);
  expect(both.length).toBeLessThan(dogParks.length);
  for (const card of await page.locator('.park-card').all()) {
    await expect(card.locator('.chips')).toContainText('Dog park');
    await expect(card.locator('.chips')).toContainText('Lake');
  }
  await expect(page.locator('.result-count')).toContainText('of 111 parks match');
  await expectNoAxeViolations(page);
});

test.describe('near me', () => {
  test.use({ geolocation: { latitude: 27.8065, longitude: -82.75531 }, permissions: ['geolocation'] });
  test('sorts by distance and shows miles to one decimal', async ({ page }) => {
    // From the A–Z list (the plain list sorts itself on load: test/e2e/nearest.spec.js).
    await page.goto('/st-pete/parks?sort=az');
    await page.getByRole('button', { name: 'Sort by nearest' }).click();
    await expect(page).toHaveURL(/lat=27\.80650&lng=-82\.75531/);
    await expect(page.locator('.park-card h2').first()).toHaveText('Abercrombie Park');
    const distances = await page.locator('.distance').allTextContents();
    expect(distances.length).toBeGreaterThan(90);
    for (const d of distances) expect(d).toMatch(/^\d+\.\d mi away$/);
    const miles = distances.map((d) => parseFloat(d));
    expect(miles).toEqual([...miles].sort((a, b) => a - b));
    await expect(page.locator('.result-count')).toHaveText('111 parks, nearest first');
  });
});

test.describe('near me denied', () => {
  test.use({ permissions: [] });
  test('keeps the list alphabetical and explains why', async ({ page, context }) => {
    await context.clearPermissions();
    await page.goto('/st-pete/parks');
    await page.getByRole('button', { name: 'Sort by nearest' }).click();
    await expect(page.locator('#near-me-status')).toContainText("couldn't get your location");
    await expect(page).not.toHaveURL(/lat=/);
    await expect(page.locator('.park-card h2').first()).toHaveText('Abercrombie Park');
    await expect(page.locator('.distance')).toHaveCount(0);
  });
});

test('park page shows details, map pin, amenities and City link', async ({ page }) => {
  await page.goto('/st-pete/parks/abercrombie-park');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Abercrombie Park');
  await expect(page.locator('.park-header .address')).toContainText('38th Ave');
  await expect(page.getByRole('region', { name: 'Map showing Abercrombie Park' })).toBeVisible();
  await expect(page.locator('.leaflet-interactive')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Scenic view' })).toHaveAttribute('href', '/st-pete/parks?cat=scenic-view');
  await expect(page.getByText('No ratings yet.')).toBeVisible();
  await expect(page.locator('.park-manager')).toHaveText('Managed by the City of St. Petersburg');
  await expect(page.getByRole('link', { name: /on the official website/ }))
    .toHaveAttribute('href', 'https://www.stpeteparksrec.org/parks___facilities/abercrombie_park.php');
  await expectNoAxeViolations(page);
});

test('a park without a location says so instead of showing a map', async ({ page }) => {
  await page.goto('/st-pete/parks/auburn-street-park');
  await expect(page.getByText("We don't have this park's location yet.")).toBeVisible();
  await expect(page.locator('#park-map')).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test('unknown park slug returns 404', async ({ page }) => {
  const res = await page.goto('/st-pete/parks/not-a-real-park');
  expect(res.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
});

test('manifest and icons are served for add-to-home-screen', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
});

for (const width of [375, 768, 1440]) {
  test(`no horizontal scroll at ${width}px, with screenshots`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, url] of [['home', '/'], ['parks', '/st-pete/parks'], ['park', '/st-pete/parks/abercrombie-park']]) {
      await page.goto(url);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow, `${url} overflows at ${width}px`).toBe(false);
      await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: false });
    }
  });
}
