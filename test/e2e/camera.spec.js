import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { signUp } from './helpers.js';

const jpeg = () => sharp({ create: { width: 600, height: 600, channels: 3, background: '#2f6f4e' } }).jpeg().toBuffer();

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('a selfie for the profile photo and a camera shot for park photos fill the photo field', async ({ page }) => {
    await signUp(page);
    await page.goto('/account');
    await expect(page.getByRole('button', { name: 'Take a selfie' })).toBeVisible();
    await expect(page.locator('input[capture="user"]')).toHaveCount(1);
    await page.locator('input[capture="user"]').setInputFiles({ name: 'selfie.jpg', mimeType: 'image/jpeg', buffer: await jpeg() });
    expect(await page.locator('#avatar-file').evaluate((i) => i.files[0]?.name)).toBe('selfie.jpg');
    await page.getByRole('button', { name: 'Upload photo' }).click();
    await expect(page.getByRole('button', { name: 'Replace photo' })).toBeVisible();

    await page.goto('/st-pete/parks/abercrombie-park');
    await expect(page.locator('input[capture="environment"]')).toHaveCount(2); // stamp photo + Add a photo
    await expect(page.getByRole('button', { name: 'Take a photo' }).last()).toBeVisible();
  });
});

test('no camera buttons on a desktop browser', async ({ page }) => {
  await signUp(page);
  await page.goto('/account');
  await expect(page.locator('.camera-btn')).toHaveCount(0);
});
