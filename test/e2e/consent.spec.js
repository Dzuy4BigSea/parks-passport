import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './axe.js';
import { stubGtm } from './analytics.js';
import { signUp } from './helpers.js';

// No saved choice: these tests see the banner like a first-time visitor.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
  await stubGtm(page);
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

const gaCookie = async (context) => (await context.cookies()).find((c) => c.name.startsWith('_ga'));

test('banner on first visit; no _ga cookie until Accept, then one; choice remembered', async ({ page, context }) => {
  await page.goto('/st-pete/parks');
  const banner = page.getByRole('region', { name: 'Cookies' });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Accept' })).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Reject' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__fakeGtmLoaded)).toBe(true);
  await expectNoAxeViolations(page);
  expect(await gaCookie(context)).toBeUndefined();

  await banner.getByRole('button', { name: 'Accept' }).click();
  await expect(banner).toHaveCount(0);
  await expect.poll(() => gaCookie(context)).toBeTruthy();
  await page.waitForFunction(() => Array.isArray(window.dataLayer));
  const pushed = await page.evaluate(() => window.dataLayer.filter((e) => e.event === 'consent_update'));
  expect(pushed).toEqual([{ event: 'consent_update', analytics: true, ads: false }]);

  await page.reload();
  await expect(page.getByRole('region', { name: 'Cookies' })).toHaveCount(0);
  expect((await context.cookies()).find((c) => c.name === 'pp_consent').value).toBe('v1.a1.d0');
});

test('Reject keeps _ga away, even after navigating', async ({ page, context }) => {
  await page.goto('/st-pete/parks');
  await page.getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByRole('region', { name: 'Cookies' })).toHaveCount(0);
  await page.goto('/st-pete/parks/abercrombie-park');
  await expect.poll(() => page.evaluate(() => window.__fakeGtmLoaded)).toBe(true);
  expect(await gaCookie(context)).toBeUndefined();
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('the banner forms work and return to the page', async ({ page, context }) => {
    await page.goto('/st-pete/parks/abercrombie-park');
    await page.getByRole('button', { name: 'Reject' }).click();
    await expect(page).toHaveURL(/\/parks\/abercrombie-park$/);
    await expect(page.getByRole('region', { name: 'Cookies' })).toHaveCount(0);
    expect((await context.cookies()).find((c) => c.name === 'pp_consent').value).toBe('v1.a0.d0');
  });
});

test('Cookie settings in the footer reopens the choices; keyboard only', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Accept' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Cookies' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Cookie settings' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cookie settings');
  await expectNoAxeViolations(page);
  await expect(page.getByRole('checkbox', { name: /Analytics/ })).toBeChecked();
  await page.getByRole('checkbox', { name: /Analytics/ }).uncheck();
  await page.getByRole('button', { name: 'Save my choices' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect((await context.cookies()).find((c) => c.name === 'pp_consent').value).toBe('v1.a0.d0');
});

test('the banner does not cover the main action at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto('/');
  const banner = await page.getByRole('region', { name: 'Cookies' }).boundingBox();
  const action = await page.getByRole('link', { name: 'Find a park' }).boundingBox();
  const overlaps = !(action.y >= banner.y + banner.height || action.y + action.height <= banner.y);
  expect(overlaps).toBe(false);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('dataLayer gets the spec events with exact keys and no personal data', async ({ page }) => {
  const events = async () => {
    await page.waitForFunction(() => Array.isArray(window.dataLayer));
    return page.evaluate(() => window.dataLayer.filter((e) => e && e.event && !e.event.startsWith('gtm.')));
  };
  await page.goto('/st-pete/parks?q=lake&cat=dog-park');
  expect(await events()).toEqual([{ event: 'park_search', has_query: true, filter_count: 1 }]);
  await page.getByRole('button', { name: 'Reject' }).click();

  await signUp(page, { name: 'Dee Tester', email: `dee-${Date.now()}@example.com` });
  expect(await events()).toEqual([{ event: 'sign_up', method: 'password' }]);

  await page.goto('/st-pete/parks/woodlawn-park');
  // The first park page opened is also a surprise badge (M19), with no personal data in it.
  expect(await events()).toEqual([{ event: 'park_view', park_slug: 'woodlawn-park' }, { event: 'badge_earned', badge_slug: 'trail-planner', kind: 'hidden' }]);
  await page.locator('#honor summary').click();
  await page.getByRole('button', { name: 'Stamp it' }).click();
  await expect(page.locator('.stamp-result')).toBeVisible();
  const after = await events();
  expect(after).toContainEqual({ event: 'check_in', park_slug: 'woodlawn-park', method: 'honor' });
  expect(after).toContainEqual({ event: 'badge_earned', badge_slug: 'first-stamp', kind: 'known' });

  await page.getByLabel('5 stars').check();
  await page.getByLabel('Comment (optional)').fill('Lovely, write to me at dee@example.com');
  await page.getByRole('button', { name: 'Save rating' }).click();
  await expect(page.locator('.rating-summary')).toContainText('5.0 out of 5');
  expect(await events()).toContainEqual({ event: 'rating_submit', park_slug: 'woodlawn-park', stars: 5 });

  const all = JSON.stringify(await page.evaluate(() => window.dataLayer));
  expect(all).not.toContain('@');
  expect(all).not.toContain('Dee Tester');
});
