import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './axe.js';

test('home page loads and passes axe', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your passport to St. Pete parks');
  await expect(page.getByText('Not affiliated with the City of St. Petersburg')).toBeVisible();
  await expect(page.getByRole('heading', { name: "Hey, I'm Gary. Glad you're here." })).toBeVisible();
  await expect(page.getByRole('img', { name: /Gary, waving hello/ })).toBeVisible();
  await expectNoAxeViolations(page);
});

test('/healthz returns ok', async ({ request }) => {
  const res = await request.get('/healthz');
  expect(res.status()).toBe(200);
  expect(await res.text()).toBe('ok');
});

test('no horizontal scroll at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
