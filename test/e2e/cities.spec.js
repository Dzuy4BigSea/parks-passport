// Multi-city (SPEC Flow 14): Westminster, CA alongside St. Pete.
import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './axe.js';
import { signUp, freshPage } from './helpers.js';

const AT_SIGLER = { latitude: 33.757335, longitude: -118.002137, accuracy: 15 };

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

test('Westminster pages: landing, parks and a park, axe clean and no sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const [url, heading] of [['/westminster', 'Your passport to Westminster parks'], ['/westminster/parks', 'Westminster parks'], ['/westminster/parks/sigler-park', 'Sigler Park']]) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await expectNoAxeViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.goto('/westminster');
  await page.getByRole('link', { name: 'St. Petersburg, Florida' }).click();
  await expect(page).toHaveURL(/\/st-pete$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your passport to St. Pete parks');
});

test.describe('at Sigler Park', () => {
  test.use({ geolocation: AT_SIGLER, permissions: ['geolocation'] });

  test('a member stamps a Westminster park by GPS; the passport shows tabs only for cities with stamps', async ({ page }) => {
    await signUp(page);
    await page.goto('/westminster/parks/sigler-park');
    await page.getByRole('button', { name: 'Check in here' }).click();
    await expect(page).toHaveURL(/\/westminster\/parks\/sigler-park\?stamped=\d+$/);
    await expect(page.locator('.stamp-result')).toContainText('Stamped! +15 points');
    await page.goto('/passport');
    await expect(page).toHaveURL(/\/westminster\/passport$/);
    await expect(page.locator('.passport-count')).toHaveText('1 of 25 parks stamped');
    // Only one city stamped: no tabs.
    const tabs = page.getByRole('navigation', { name: 'Cities in this passport' });
    await expect(tabs).toHaveCount(0);
    // Looking at another city's passport: that city and the stamped one.
    await page.goto('/st-pete/passport');
    await expect(page.locator('.passport-count')).toHaveText('0 of 102 parks stamped');
    await expect(tabs.getByRole('link')).toHaveText([/St\. Pete/, /Westminster/]);
    await expect(tabs.getByRole('link', { name: /St\. Pete/ })).toHaveAttribute('aria-current', 'page');
    await tabs.getByRole('link', { name: /Westminster/ }).click();
    await expect(page.locator('.passport-count')).toHaveText('1 of 25 parks stamped');
    await expectNoAxeViolations(page);
  });
});

test('profile photo upload and pal faces: axe clean at 375 px', async ({ page, browser }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const sharp = (await import('sharp')).default;
  const photo = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#e4572e' } }).jpeg().toBuffer();
  await signUp(page, { name: 'Ana Pal' });
  await page.goto('/account');
  await page.getByLabel('Choose a profile photo').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: photo });
  await page.getByRole('button', { name: 'Upload photo' }).click();
  await expect(page.locator('p.notice[role=status]')).toHaveText('Profile photo saved.');
  await expect(page.locator('.announcements')).toContainText('New badge: Say Cheese'); // a surprise (M19)
  await expect(page.locator('#photo img.avatar')).toBeVisible();
  await expectNoAxeViolations(page);
  // Share with pals, invite a friend who stamps a park: Ana sees their face on the card.
  await page.getByLabel('My Park Pals').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.goto('/pals');
  const link = await page.locator('#invite-link').inputValue();
  const friend = await freshPage(browser, testInfo);
  await friend.setViewportSize({ width: 375, height: 800 });
  await signUp(friend, { name: 'Ben Pal' });
  await friend.goto(link);
  await friend.getByRole('button', { name: 'Accept and become Park Pals' }).click();
  await friend.goto('/account');
  await friend.getByLabel('My Park Pals').check();
  await friend.getByRole('button', { name: 'Save', exact: true }).click();
  await friend.goto('/westminster/parks/liberty-park');
  await friend.getByText('No GPS? Stamp on the honor system').click();
  await friend.getByRole('button', { name: 'Stamp it' }).click();
  await page.goto('/westminster/parks?pals=1');
  await expect(page.locator('.pal-faces')).toContainText('Ben Pal stamped this');
  await expectNoAxeViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/westminster/parks/liberty-park');
  await expect(page.locator('.pals-here')).toContainText('Ben Pal stamped this.');
  await expectNoAxeViolations(page);
});
