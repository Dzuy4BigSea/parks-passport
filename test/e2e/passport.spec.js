import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './axe.js';
import { signUp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

async function honorStamp(page, slug, date) {
  await page.goto(`/parks/${slug}`);
  await page.locator('#honor summary').click();
  if (date) await page.getByLabel('Date of your visit').fill(date);
  await page.getByRole('button', { name: 'Stamp it' }).click();
  await expect(page.locator('.stamp-result')).toBeVisible();
}

test('empty passport: 0 stamped, every park an outline, badges to work towards', async ({ page }) => {
  await signUp(page, { name: 'Jo' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Jo's passport");
  await expect(page.locator('.passport-count')).toHaveText('0 of 102 parks stamped');
  await expect(page.locator('.level-name')).toHaveText('Day Tripper');
  await expect(page.locator('.level-next')).toHaveText('50 points to Trail Finder');
  await expect(page.locator('.stamp')).toHaveCount(102);
  await expect(page.locator('.stamp.is-stamped')).toHaveCount(0);
  await expect(page.getByText('No visits yet.')).toBeVisible();
  await expectNoAxeViolations(page);
});

test('stamping announces the badge once and fills in the passport', async ({ page }) => {
  await signUp(page);
  await honorStamp(page, 'abercrombie-park', '2026-03-14');
  const status = page.locator('.announcements');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toContainText('New badge: First Stamp');
  await page.reload();
  await expect(page.locator('.announcements')).toHaveCount(0);

  await honorStamp(page, 'crescent-lake-park');
  await page.goto('/passport');
  await expect(page.locator('.passport-count')).toHaveText('2 of 102 parks stamped');
  await expect(page.locator('.points')).toHaveText('20 points');

  // Stamp grid: stamped parks show their first-visit date.
  const aber = page.locator('.stamp', { hasText: 'Abercrombie Park' });
  await expect(aber).toHaveClass(/is-stamped/);
  await expect(aber).toContainText('Stamped Mar 14, 2026');
  await expect(page.locator('.stamp', { hasText: 'Allendale Park' })).toContainText('Not yet');

  // Map: one marker per park with a location, labeled stamped / not yet.
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(101);
  await expect(page.locator('.leaflet-marker-icon.pin-stamped')).toHaveCount(2);
  await expect(page.locator('.leaflet-marker-icon[title="Abercrombie Park: stamped"]')).toHaveText('✓');
  await expect(page.locator('.leaflet-marker-icon[title="Allendale Park: not yet"]')).toHaveText('○');

  // Badges: earned with date, known with progress, hidden as "?" with a hint.
  const first = page.locator('.badge.earned', { hasText: 'First Stamp' });
  await expect(first).toContainText(/Earned \w+ \d+, \d{4}/);
  await expect(page.locator('.badge.known', { hasText: 'Five Parks' })).toContainText('2 / 5 parks');
  const hidden = page.locator('.badge.mystery', { hasText: 'Some parks are best before breakfast.' });
  await expect(hidden).toContainText('Hidden badge');
  await expect(hidden).not.toContainText('Early Bird');

  // History: newest first, with date, park and method.
  const rows = page.locator('.history li');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Crescent Lake Park');
  await expect(rows.nth(0)).toContainText('Honor system');
  await expect(rows.nth(1)).toContainText('March 14, 2026');
  await expectNoAxeViolations(page);
});

test('deleting from history revokes a badge that is no longer met', async ({ page }) => {
  await signUp(page);
  await honorStamp(page, 'abercrombie-park');
  await page.goto('/passport');
  await expect(page.locator('.badge.earned', { hasText: 'First Stamp' })).toHaveCount(1);
  await page.getByRole('button', { name: /Delete visit to Abercrombie Park/ }).click();
  await expect(page).toHaveURL(/\/passport$/);
  await expect(page.locator('.passport-count')).toHaveText('0 of 102 parks stamped');
  await expect(page.locator('.badge.earned', { hasText: 'First Stamp' })).toHaveCount(0);
  await expect(page.locator('.badge.known', { hasText: 'First Stamp' })).toContainText('0 / 1 parks');
});

for (const width of [375, 1440]) {
  test(`passport fits at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await signUp(page);
    await honorStamp(page, 'abercrombie-park');
    await page.goto('/passport');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: info.outputPath(`passport-${width}.png`), fullPage: true });
  });
}

test('park names are shown as text in map tooltips, never run as HTML', async ({ page }) => {
  const Database = (await import('better-sqlite3')).default;
  const path = (await import('node:path')).default;
  const db = new Database(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
  const evil = '<img src=x onerror="window.__xss=1">Allendale Park';
  db.prepare("UPDATE parks SET name = ? WHERE slug = 'allendale-park'").run(evil);
  try {
    await signUp(page);
    await page.goto('/passport');
    const marker = page.getByTitle(`${evil}: not yet`, { exact: true });
    await marker.hover();
    await expect(page.locator('.leaflet-tooltip')).toHaveText(`${evil}: not yet`);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await page.goto('/parks/allendale-park');
    await page.locator('.leaflet-interactive').hover();
    await expect(page.locator('.leaflet-tooltip')).toHaveText(evil);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  } finally {
    db.prepare("UPDATE parks SET name = 'Allendale Park' WHERE slug = 'allendale-park'").run();
    db.close();
  }
});

test('announcements and stamp results get focus so screen readers read them', async ({ page }) => {
  await signUp(page);
  await honorStamp(page, 'abercrombie-park');
  // The badge announcement comes first in the page, so it gets focus.
  await expect(page.locator('.announcements')).toBeFocused();
  await page.reload(); // announcement shown once; the stamp result (?stamped=) remains
  await expect(page.locator('.stamp-result')).toBeFocused();
});
