import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { expectNoAxeViolations } from './axe.js';
import { signUp, freshPage } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

const jpeg = () => sharp({ create: { width: 1200, height: 900, channels: 3, background: '#2f6f4e' } })
  .jpeg().withExif({ IFD0: { Make: 'TestPhone' } }).toBuffer();

test('rate a park, then upload a public photo that a signed-out visitor can see', async ({ page, browser }, info) => {
  await signUp(page, { name: 'Pat' });
  await page.goto('/st-pete/parks/crescent-lake-park');
  await expect(page.getByText('No ratings yet.')).toBeVisible();

  await page.getByLabel('4 stars').check();
  await page.getByLabel('Comment (optional)').fill('Great walking loop around the lake.');
  await page.getByLabel('Who can read your comment').selectOption('public');
  await page.getByRole('button', { name: 'Save rating' }).click();
  await expect(page.locator('.rating-summary')).toContainText('4.0 out of 5 · 1 rating');
  await expect(page.locator('.reviews')).toContainText('Great walking loop around the lake.');
  await expect(page.getByRole('button', { name: 'Update rating' })).toBeVisible();

  await page.getByLabel('Add a photo', { exact: true }).setInputFiles({ name: 'lake.jpg', mimeType: 'image/jpeg', buffer: await jpeg() });
  await page.getByLabel('Caption (optional)').fill('Morning at the lake');
  await page.locator('#photo_visibility').selectOption('public');
  await page.getByRole('button', { name: 'Upload photo' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Photo added.' })).toBeVisible();
  const img = page.getByRole('img', { name: 'Morning at the lake' });
  await expect(img).toBeVisible();
  expect(await img.evaluate((el) => el.naturalWidth)).toBe(400);
  await expectNoAxeViolations(page);

  const anon = await freshPage(browser, info);
  await anon.goto('/st-pete/parks/crescent-lake-park');
  await expect(anon.getByRole('img', { name: 'Morning at the lake' })).toBeVisible();
  await expect(anon.locator('.reviews')).toContainText('Great walking loop');
  await expect(anon.getByRole('button', { name: 'Upload photo' })).toHaveCount(0);
});

test('a private photo is not visible to others, and its URL is a 404', async ({ page, browser }, info) => {
  await signUp(page);
  await page.goto('/st-pete/parks/abercrombie-park');
  await page.getByLabel('Add a photo', { exact: true }).setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: await jpeg() });
  await page.getByRole('button', { name: 'Upload photo' }).click();
  const src = await page.locator('.photo img').first().getAttribute('src');
  const other = await freshPage(browser, info);
  await other.goto('/st-pete/parks/abercrombie-park');
  await expect(other.locator('.photo img')).toHaveCount(0);
  expect((await other.request.get(src)).status()).toBe(404);
});

test('stamp with a photo on the honor system: +13 points', async ({ page }) => {
  await signUp(page);
  await page.goto('/st-pete/parks/abercrombie-park');
  await page.locator('#honor summary').click();
  await page.getByLabel('Add a photo (optional, +3 points)').setInputFiles({ name: 's.jpg', mimeType: 'image/jpeg', buffer: await jpeg() });
  await page.getByRole('button', { name: 'Stamp it' }).click();
  await expect(page.locator('.stamp-result')).toContainText('Stamped! +13 points');
  await expect(page.locator('.stamp-result')).toContainText('photo: +3');
  await expect(page.locator('.my-visits')).toContainText('Photo · 13 pts');
});

test('an unreadable file shows an inline error', async ({ page }) => {
  await signUp(page);
  await page.goto('/st-pete/parks/abercrombie-park');
  await page.getByLabel('Add a photo', { exact: true }).setInputFiles({ name: 'notes.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('hello') });
  await page.getByRole('button', { name: 'Upload photo' }).click();
  await expect(page.locator('#photos [role="alert"]')).toContainText('not a photo we can read');
});

test('park page with photos and ratings fits at 375px', async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await signUp(page);
  await page.goto('/st-pete/parks/abercrombie-park');
  await page.getByLabel('Add a photo', { exact: true }).setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: await jpeg() });
  await page.getByRole('button', { name: 'Upload photo' }).click();
  await page.getByLabel('5 stars').check();
  await page.getByRole('button', { name: 'Save rating' }).click();
  await expect(page.locator('.rating-summary')).toContainText('5.0 out of 5');
  await expect(page.locator('.leaflet-interactive')).toHaveCount(1); // map fully set up
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.locator('#ratings').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('park-photos-375.png'), fullPage: true });
});

test('several photos at once; the uploader\'s face stays small in the credit', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signUp(page, { name: 'Multi' });
  await page.goto('/account');
  await page.getByLabel('Choose a profile photo').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: await jpeg() });
  await page.getByRole('button', { name: 'Upload photo' }).click();
  await expect(page.locator('p.notice[role=status]')).toHaveText('Profile photo saved.');

  await page.goto('/st-pete/parks/crescent-lake-park');
  const picker = page.getByLabel('Add a photo', { exact: true });
  await expect(page.getByText('You can pick up to 10 at once.')).toBeVisible();
  const files = ['a', 'b', 'c'].map(async (n) => ({ name: `${n}.jpg`, mimeType: 'image/jpeg', buffer: await jpeg() }));
  await picker.setInputFiles(await Promise.all(files));
  await expect(page.getByText('3 photos chosen.')).toBeVisible();
  await page.getByLabel('Caption (optional)').fill('Lake day');
  await page.getByRole('button', { name: 'Upload photo' }).click();
  await expect(page.getByRole('status').filter({ hasText: '3 photos added.' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Lake day' })).toHaveCount(3);
  // The profile photo in "by Multi" is a 20 px face, not a photo-sized image.
  const face = page.locator('.photo-by img.avatar').first();
  await expect(face).toBeVisible();
  expect((await face.boundingBox()).width).toBeLessThanOrEqual(24);
  await expectNoAxeViolations(page);
});
