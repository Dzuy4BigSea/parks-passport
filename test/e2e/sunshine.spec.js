import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './axe.js';
import { signUp } from './helpers.js';

// Drops of Sunshine (SPEC Flow 17): one box, the park already chosen, a happy send.
const CRESCENT = { latitude: 27.788453, longitude: -82.641303 }; // Crescent Lake Park, St. Pete

test.describe('with location allowed', () => {
  test.use({ geolocation: CRESCENT, permissions: ['geolocation'], viewport: { width: 375, height: 800 } });
  test('the closest park is picked, one tap sends, and the sun comes out', async ({ page }) => {
    await signUp(page, { name: 'Sunny' });
    await page.goto('/sunshine?city=st-pete');
    await expect(page.locator('[data-sunshine-to]')).toHaveText('Crescent Lake Park');
    await expectNoAxeViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await page.getByLabel('Your note').fill('The new shade sails are wonderful. Thank you!');
    await page.getByRole('button', { name: /Send a drop of sunshine/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your drop of sunshine is on its way.');
    await expect(page.getByText('Thank you for thanking Crescent Lake Park.')).toBeVisible();
    // The drops animate (they're hidden with reduced motion).
    await expect(page.locator('.sun-drop').first()).toHaveCSS('animation-name', 'sun-drop');
    await expectNoAxeViolations(page);
  });
});

test('reduced motion: a still sun; and a note to the whole department', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signUp(page, { name: 'Calm' });
  await page.goto('/sunshine?city=st-pete');
  await page.getByText("Change who it's for").click();
  await page.getByLabel('Send it to').selectOption('department');
  await expect(page.locator('[data-sunshine-to]')).toHaveText('the parks department');
  await page.getByLabel('Your note').fill('Thank you, Parks & Rec!');
  await page.getByRole('button', { name: /Send a drop of sunshine/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your drop of sunshine is on its way.');
  await expect(page.locator('.sun-drop').first()).toBeHidden();
  await expect(page.locator('.sun-core')).toHaveCSS('animation-name', 'none');
});
