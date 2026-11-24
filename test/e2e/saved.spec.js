import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './axe.js';
import { signUp, freshPage } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

const heart = (page, name) => page.getByRole('button', { name: `Want to go: ${name}` });

test('save and unsave parks with the heart, filter Want to go, and see it on the passport', async ({ page }) => {
  await signUp(page);

  // Hearts toggle in place on /parks (JS), with no page load.
  await page.goto('/parks');
  await expect(heart(page, 'Crescent Lake Park')).toHaveAttribute('aria-pressed', 'false');
  await heart(page, 'Crescent Lake Park').click();
  await expect(heart(page, 'Crescent Lake Park')).toHaveAttribute('aria-pressed', 'true');
  await heart(page, 'Lake Vista Park').click();
  await expect(heart(page, 'Lake Vista Park')).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/\/parks$/);
  await expectNoAxeViolations(page);

  // The Want to go filter shows just those two, and survives a reload.
  await page.getByRole('checkbox', { name: 'Want to go' }).check();
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/saved=1/);
  await expect(page.locator('.park-card h2')).toHaveText(['Crescent Lake Park', 'Lake Vista Park']);
  await expect(page.locator('.result-count')).toHaveText('2 of 102 parks match');
  await expectNoAxeViolations(page);

  // Park page: a labeled toggle; unsave there.
  await page.goto('/parks/lake-vista-park');
  const toggle = page.getByRole('button', { name: 'Want to go' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expectNoAxeViolations(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Want to go' })).toHaveAttribute('aria-pressed', 'false');

  // Passport: saved, not-yet-stamped parks.
  await page.goto('/passport');
  const section = page.locator('#want-to-go');
  await expect(section.getByRole('link')).toHaveText(['Crescent Lake Park']);
  await expectNoAxeViolations(page);

  // Stamping a saved park takes it off the list.
  await page.goto('/parks/crescent-lake-park');
  await page.locator('#honor summary').click();
  await page.getByRole('button', { name: 'Stamp it' }).click();
  await page.goto('/passport');
  await expect(page.locator('#want-to-go')).toContainText('Nothing here yet');
});

test.describe('without JavaScript', () => {
  // Reduced motion: with JS off, Playwright's stability check stalls on the cards' entrance animation.
  test.use({ javaScriptEnabled: false, reducedMotion: 'reduce' });
  test('the heart is a plain POST form that redirects back', async ({ page }) => {
    await signUp(page);
    await page.goto('/parks?q=abercrombie');
    await heart(page, 'Abercrombie Park').click();
    await expect(page).toHaveURL(/\/parks\?q=abercrombie$/);
    await expect(heart(page, 'Abercrombie Park')).toHaveAttribute('aria-pressed', 'true');
    await heart(page, 'Abercrombie Park').click();
    await expect(heart(page, 'Abercrombie Park')).toHaveAttribute('aria-pressed', 'false');
  });
});

test('saved parks stay private: not on a public passport, and not in another member\'s list', async ({ page, browser }, info) => {
  await signUp(page, { name: 'Wren' });
  await page.goto('/parks/abercrombie-park');
  await page.getByRole('button', { name: 'Want to go' }).click();
  await expect(page.getByRole('button', { name: 'Want to go' })).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/account');
  await page.getByLabel('Anyone with the link').check();
  await page.getByRole('button', { name: 'Save' }).click();
  const publicUrl = await page.locator('a[href^="/u/"]').first().getAttribute('href');

  const anon = await freshPage(browser, info);
  expect((await anon.goto(publicUrl)).status()).toBe(200);
  await expect(anon.getByRole('heading', { level: 1 })).toHaveText("Wren's passport");
  await expect(anon.getByText('Want to go')).toHaveCount(0);
  await expect(anon.locator('.save-form')).toHaveCount(0);
  await anon.goto('/parks');
  await expect(anon.locator('.save-form')).toHaveCount(0);

  const other = await freshPage(browser, info);
  await signUp(other, { name: 'Other' });
  await other.goto('/parks?saved=1');
  await expect(other.locator('.park-card')).toHaveCount(0);
  await other.goto(publicUrl);
  await expect(other.getByText('Want to go')).toHaveCount(0);
});
