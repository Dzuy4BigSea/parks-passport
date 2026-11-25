import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './axe.js';
import { signUp } from './helpers.js';

// One-tap stamping from the phone tab bar, the celebration, and the "what next" dashboard.
const AT_CRESCENT_LAKE = { latitude: 27.78795, longitude: -82.64004, accuracy: 15 };
const IN_THE_BAY = { latitude: 27.7600, longitude: -82.6000, accuracy: 15 };

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

test.describe('on a phone at a park', () => {
  test.use({ viewport: { width: 375, height: 800 }, geolocation: AT_CRESCENT_LAKE, permissions: ['geolocation'] });

  test('the tab bar Stamp button stamps the park in one tap and celebrates', async ({ page }) => {
    await signUp(page);
    const tabbar = page.getByRole('navigation', { name: 'Quick' });
    await expect(tabbar).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await tabbar.getByRole('link', { name: 'Stamp' }).click();
    await expect(page).toHaveURL(/\/parks\/crescent-lake-park\?stamped=\d+$/);
    const result = page.locator('.stamp-result');
    await expect(result).toContainText('Stamped! +15 points');
    await expect(result).toContainText('GPS verified: +5');
    await expect(result).toContainText(/to earn|Closest new park/);
    await expectNoAxeViolations(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hi, Sam');
    await expect(page.locator('.passport-count')).toHaveText('1 of 102 parks stamped');
    await expect(page.getByText('1 week in a row').first()).toBeVisible();
    await expect(page.locator('.home-near')).toContainText('Closest new parks');
    await expect(page.locator('.gary-says')).toContainText('Crescent Lake Park'); // stamped today
    await expectNoAxeViolations(page);

    // The passport groups stamps into neighborhood collections.
    await page.goto('/st-pete/passport');
    await expect(page.locator('.collection')).not.toHaveCount(0);
    await expect(page.locator('.stamp.is-stamped', { hasText: 'Crescent Lake Park' }).locator('.seal')).toBeVisible();
  });
});

test.describe('on a phone away from parks', () => {
  test.use({ viewport: { width: 375, height: 800 }, geolocation: IN_THE_BAY, permissions: ['geolocation'] });

  test('the finder lists the closest parks and stamps nothing', async ({ page }) => {
    await signUp(page);
    await page.goto('/stamp');
    await expect(page.getByRole('alert')).toContainText('from the closest park');
    await expect(page.locator('.finder-list li')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.goto('/st-pete/passport');
    await expect(page.locator('.passport-count')).toHaveText('0 of 102 parks stamped');
  });
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce', viewport: { width: 375, height: 800 } });

  test('pages render fully without animation', async ({ page }) => {
    await page.goto('/');
    const anim = await page.locator('.hero-motifs .tile').first().evaluate((el) => getComputedStyle(el).animationName);
    expect(anim).toBe('none');
    await expectNoAxeViolations(page);
  });
});
