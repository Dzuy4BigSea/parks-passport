import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './axe.js';
import { signUp, freshPage } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

test('invite a pal, share, see each other in the feed and leaderboard, then go public', async ({ page, browser }, info) => {
  // Ana signs up and stamps a park; her passport starts private and she gets the nudge.
  await signUp(page, { name: 'Ana' });
  await page.goto('/st-pete/parks/abercrombie-park');
  await page.locator('#honor summary').click();
  await page.getByRole('button', { name: 'Stamp it' }).click();
  await expect(page.getByText('Share your passport with Park Pals?')).toBeVisible();
  await page.getByRole('button', { name: 'Share with Park Pals' }).click();
  await expect(page).toHaveURL(/\/parks\/abercrombie-park/);
  await expect(page.getByText('Share your passport with Park Pals?')).toHaveCount(0);

  await page.getByRole('link', { name: 'Pals', exact: true }).click();
  await expectNoAxeViolations(page);
  const link = await page.getByLabel('Your invite link').inputValue();
  expect(link).toMatch(/\/pals\/invite\/[A-Za-z0-9_-]+$/);

  // Ben opens the link signed out, signs up from it, and accepts.
  const ben = await freshPage(browser, info);
  await ben.goto(new URL(link).pathname);
  await expect(ben.getByRole('heading', { level: 1 })).toHaveText('Ana invited you to be Park Pals');
  await expectNoAxeViolations(ben);
  await ben.getByRole('link', { name: 'Create your passport' }).click();
  await ben.getByLabel('Display name').fill('Ben');
  await ben.getByLabel('Email').fill(`ben-${Date.now()}@example.com`);
  await ben.getByLabel('Password').fill('correct horse battery');
  await ben.getByRole('button', { name: 'Create account' }).click();
  await ben.getByRole('button', { name: 'Accept and become Park Pals' }).click();
  await expect(ben.getByRole('status').first()).toContainText("You're now Park Pals!");

  // Ben sees Ana's stamp and badge in the feed, and Ana on the leaderboard.
  await expect(ben.locator('.feed')).toContainText('Ana stamped Abercrombie Park');
  await expect(ben.locator('.feed')).toContainText('First Stamp');
  await expect(ben.locator('.leaderboard')).toContainText('Ana');
  await ben.getByRole('link', { name: 'Ana' }).first().click();
  await expect(ben.getByRole('heading', { level: 1 })).toHaveText("Ana's passport");
  await expect(ben.locator('.passport-count')).toHaveText('1 of 102 parks stamped');
  await expect(ben.getByRole('button', { name: /Delete visit/ })).toHaveCount(0);
  const anaUrl = new URL(ben.url()).pathname;

  // Signed out, Ana's pals-only passport is a 404.
  const anon = await freshPage(browser, info);
  expect((await anon.goto(anaUrl)).status()).toBe(404);

  // Ana goes public; now anyone can see it.
  await page.goto('/account');
  await page.getByLabel('Anyone with the link').check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').first()).toContainText('visible to anyone with the link');
  expect((await anon.goto(anaUrl)).status()).toBe(200);
  await expect(anon.locator('.passport-count')).toHaveText('1 of 102 parks stamped');
  await expectNoAxeViolations(anon);

  // Ana removes Ben; Ben no longer sees her in the feed.
  await page.goto('/pals');
  await page.getByRole('button', { name: 'Remove Ben as a pal' }).click();
  await ben.goto('/pals');
  await expect(ben.locator('.feed')).toHaveCount(0);
});

test('Pals page fits at 375px', async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signUp(page);
  await page.goto('/pals');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: info.outputPath('pals-375.png'), fullPage: true });
});
