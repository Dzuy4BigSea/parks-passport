import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { signUp, PASSWORD } from './helpers.js';

// A stand-in for Umami's tracker that records umami.track() calls.
const FAKE_UMAMI = 'window.__umamiCalls = []; window.umami = { track: function (name, data) { window.__umamiCalls.push([name, data]); } };';

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/stats/script.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_UMAMI }));
});

const events = async (page) => {
  await page.waitForFunction(() => Array.isArray(window.dataLayer));
  return page.evaluate(() => window.dataLayer.filter((e) => e && e.event && !e.event.startsWith('gtm.')));
};
const umamiCalls = (page) => page.evaluate(() => window.__umamiCalls || []);

async function honorStamp(page, slug, date) {
  await page.goto(`/parks/${slug}`);
  await page.locator('#honor').evaluate((d) => { d.open = true; }); // already open on parks without a pin
  await page.getByLabel('Date of your visit').fill(date);
  await page.getByRole('button', { name: 'Stamp it' }).click();
  await expect(page.locator('.stamp-result')).toBeVisible();
}

test('login, photo_upload and level_up reach dataLayer and Umami with the spec keys', async ({ page }) => {
  const { email } = await signUp(page, { name: 'Lee Events' });
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/passport$/);
  expect(await events(page)).toEqual([{ event: 'login', method: 'password' }]);
  await expect.poll(() => umamiCalls(page)).toEqual([['login', { method: 'password' }]]);

  await page.goto('/parks/woodlawn-park');
  const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#2f6f4e' } }).jpeg().toBuffer();
  await page.getByLabel('Add a photo', { exact: true }).setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await page.getByRole('button', { name: 'Upload photo' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Photo added.' })).toBeVisible();
  expect(await events(page)).toContainEqual({ event: 'photo_upload', park_slug: 'woodlawn-park' });

  // Five new parks = 50 points = Trail Finder.
  const parks = ['allendale-park', 'auburn-street-park', 'azalea-park', 'bay-vista-park', 'baywood-park'];
  for (const [i, slug] of parks.entries()) await honorStamp(page, slug, `2026-01-0${i + 1}`);
  const last = await events(page);
  expect(last).toContainEqual({ event: 'level_up', level: 'Trail Finder' });
  await expect.poll(async () => (await umamiCalls(page)).map(([n]) => n)).toContain('level_up');
  const all = JSON.stringify(await page.evaluate(() => [window.dataLayer, window.__umamiCalls]));
  expect(all).not.toContain('@');
  expect(all).not.toContain('Lee Events');
});

test('keyboard only: stamp a park on the honor system and rate it', async ({ page }) => {
  await signUp(page);
  await page.goto('/parks/bartlett-park');
  // Tab to the honor-system summary and open it with Enter.
  const summary = page.locator('#honor summary');
  for (let i = 0; i < 60 && !(await summary.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(summary).toBeFocused();
  await page.keyboard.press('Enter');
  const stampButton = page.getByRole('button', { name: 'Stamp it' });
  for (let i = 0; i < 10 && !(await stampButton.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(stampButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.stamp-result')).toBeVisible();

  // Rate it: Tab to the first star radio, arrow to 4 stars, Tab to Save, Enter.
  const firstStar = page.getByLabel('1 star', { exact: true });
  for (let i = 0; i < 60 && !(await firstStar.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(firstStar).toBeFocused();
  await page.keyboard.press('Space');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('4 stars')).toBeChecked();
  const save = page.getByRole('button', { name: 'Save rating' });
  for (let i = 0; i < 10 && !(await save.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(save).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.rating-summary')).toContainText('4.0 out of 5');
});

for (const width of [375, 768, 1440]) {
  test(`passport and Pals pages fit at ${width}px, with screenshots`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await signUp(page);
    for (const [name, url] of [['passport', '/passport'], ['pals', '/pals']]) {
      await page.goto(url);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow, `${url} at ${width}px`).toBe(false);
      await page.screenshot({ path: info.outputPath(`${name}-${width}.png`) });
    }
  });
}
