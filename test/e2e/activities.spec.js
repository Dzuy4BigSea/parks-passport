import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './axe.js';
import { signUp } from './helpers.js';

// SPEC Flow 12: healthy activities, on a phone.
test.use({ viewport: { width: 375, height: 800 } });

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

test('stamp a park, log activities, undo one, and see the week on the passport', async ({ page }) => {
  await signUp(page, { name: 'Robin' });
  await page.goto('/st-pete/parks/crescent-lake-park');
  const panel = page.locator('#activities');
  await expect(panel).toContainText('Stamp this park today to unlock');
  await expect(panel.getByRole('button', { name: /^Log/ })).toHaveCount(0);

  await page.getByText('No GPS? Stamp on the honor system').click();
  await page.getByRole('button', { name: 'Stamp it' }).click();
  await expect(panel.getByRole('heading', { name: 'Things to do here' })).toBeVisible();

  // A facility activity (Crescent Lake has trails), with minutes typed.
  const trail = panel.locator('.act', { hasText: 'Trail time' });
  await trail.getByLabel('Minutes').fill('30');
  await trail.getByRole('button', { name: 'Log Trail time' }).click();
  await expect(page.locator('#activities [role="status"]')).toHaveText('Logged Trail time: +3 points.');
  await expect(panel.locator('.act', { hasText: 'Trail time' })).toContainText('✓ 30 min');

  // An any-park activity from a pillar group, by keyboard.
  await panel.locator('#act-calm summary').click();
  await panel.getByRole('button', { name: 'Log Breathe' }).focus();
  await page.keyboard.press('Enter');
  await expect(panel.locator('.act', { hasText: 'Breathe' })).toContainText('✓ Done');
  await expect(panel.getByRole('button', { name: 'Undo Breathe' })).toBeVisible(); // its group stays open
  expect(await noSideways(page)).toBe(false);
  await expectNoAxeViolations(page);

  // A bad amount shows next to the activity.
  const walk = panel.locator('.act', { hasText: 'Park walk' });
  await panel.locator('#act-move summary').click();
  await walk.getByLabel('Minutes').fill('500');
  await walk.getByLabel('Minutes').evaluate((el) => el.removeAttribute('max'));
  await walk.getByRole('button', { name: 'Log Park walk' }).click();
  await expect(page.locator('#activities .act', { hasText: 'Park walk' }).getByRole('alert')).toHaveText('Enter the minutes, from 1 to 180.');

  await panel.locator('#act-calm summary').click();
  await panel.getByRole('button', { name: 'Undo Breathe' }).click();
  await expect(panel.getByRole('button', { name: 'Log Breathe' })).toBeVisible();

  await page.goto('/st-pete/passport');
  const week = page.locator('.week-card');
  await expect(week).toContainText('Movement 30 / 150 min');
  await expect(week).toContainText('Time in parks 30 / 120 min');
  expect(await noSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
});

test('Paws and Kids editions add their activities', async ({ page }) => {
  await signUp(page);
  await page.goto('/account');
  await page.getByLabel(/Paws: I bring a pet/).check();
  await page.getByLabel(/Kids: I bring kids/).check();
  await page.getByRole('button', { name: 'Update editions' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved your editions.' })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.goto('/st-pete/parks/crescent-lake-park');
  await expect(page.locator('#photo_visibility')).toHaveValue('private');
  await page.getByText('No GPS? Stamp on the honor system').click();
  await page.getByRole('button', { name: 'Stamp it' }).click();
  const panel = page.locator('#activities');
  await expect(panel.locator('.act', { hasText: 'Off-leash play' })).toBeVisible(); // dog park here
  await panel.locator('#act-paws summary').click();
  await panel.getByRole('button', { name: 'Log Sniffari' }).click();
  await expect(panel.locator('.act', { hasText: 'Sniffari' })).toContainText('✓ Done');
  await panel.locator('#act-kids summary').click();
  await expect(panel.getByRole('button', { name: 'Log Nature Bingo' })).toBeVisible();
  await expectNoAxeViolations(page);
});
