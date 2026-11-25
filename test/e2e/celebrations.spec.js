// Celebrations (SPEC Flow 11, "Game feel"): the passport opening, badge reveals and inspecting a
// badge. Every other spec runs with celebrations off (playwright.config.js); these turn them on.
import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './axe.js';
import { PASSWORD, uniqueEmail } from './helpers.js';

test.use({
  viewport: { width: 375, height: 800 },
  storageState: { cookies: [{ name: 'pp_consent', value: 'v1.a0.d0', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] },
});
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

async function signUpCelebrating(page, name = 'Cel Ebrate') {
  await page.goto('/signup');
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Email').fill(uniqueEmail('cel'));
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
}

test('the passport opens, a surprise badge is revealed, a badge can be inspected; axe clean, no sideways scroll', async ({ page }) => {
  await signUpCelebrating(page);
  const welcome = page.getByRole('dialog', { name: 'Welcome, Cel!' });
  await expect(welcome).toBeVisible();
  await expect(page).toHaveURL(/\/st-pete\/passport$/); // the ?welcome flag is dropped
  await expect(welcome.getByText('Cel Ebrate')).toBeVisible();
  await expectNoAxeViolations(page);
  await welcome.getByRole('button', { name: 'Start exploring' }).click();
  await expect(welcome).toBeHidden();

  // The first park page: a surprise badge, face down until tapped.
  await page.goto('/st-pete/parks/abercrombie-park');
  const reveal = page.getByRole('dialog', { name: 'Surprise badge!' });
  await expect(reveal).toBeVisible();
  await expect(reveal.getByRole('button', { name: /Tap to reveal/ })).toBeFocused();
  await reveal.getByRole('button', { name: /Tap to reveal/ }).click();
  await expect(reveal.locator('.reveal-name')).toHaveText('Trail Planner');
  await expectNoAxeViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await reveal.getByRole('button', { name: 'Awesome!' }).click();
  await expect(reveal).toBeHidden();
  // Without JS the same news is in the page (role=status), and it stays.
  await expect(page.locator('.announcements')).toContainText('New badge: Trail Planner');

  // Inspect it on the passport: a card that flips to its story. Escape closes.
  await page.goto('/passport');
  await page.getByRole('button', { name: 'Look closer: Trail Planner' }).click();
  const card = page.getByRole('dialog', { name: 'Trail Planner' });
  await expect(card).toBeVisible();
  await expectNoAxeViolations(page);
  await card.getByRole('button', { name: 'Flip it over' }).click();
  await expect(card.getByText('The story')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(page.getByRole('button', { name: 'Look closer: Trail Planner' })).toBeFocused();
});

test('celebrations can be turned off on this device; with reduced motion they still show, without movement', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signUpCelebrating(page, 'Still Life');
  await expect(page.getByRole('dialog', { name: 'Welcome, Still!' })).toBeVisible();
  await page.getByRole('button', { name: 'Start exploring' }).click();
  await page.goto('/account');
  const box = page.getByLabel(/Show celebrations/);
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect(page.locator('#celebrations-status')).toHaveText('Celebrations are off for this device.');
  // Off: the new badge is in the page, with no full-screen card.
  await page.goto('/st-pete/parks/crescent-lake-park');
  await expect(page.locator('.announcements')).toContainText('New badge: Trail Planner');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/account');
  await expect(page.getByLabel(/Show celebrations/)).not.toBeChecked();
});
