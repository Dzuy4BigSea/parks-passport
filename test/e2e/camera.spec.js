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
    // Folded away until "Update pic" is tapped.
    await expect(page.getByRole('button', { name: 'Take a selfie' })).toBeHidden();
    await page.getByText('Update pic', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Take a selfie' })).toBeVisible();
    await expect(page.locator('input[capture="user"]')).toHaveCount(1);
    await page.locator('input[capture="user"]').setInputFiles({ name: 'selfie.jpg', mimeType: 'image/jpeg', buffer: await jpeg() });
    expect(await page.locator('#avatar-file').evaluate((i) => i.files[0]?.name)).toBe('selfie.jpg');
    await page.getByRole('button', { name: 'Upload photo' }).click();
    await expect(page.getByText('Profile photo saved.')).toBeVisible();
    await page.getByText('Update pic', { exact: true }).click();
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

test('profile photo: fit it in the circle, then only that square is uploaded; the button says Uploading… and ignores a second tap', async ({ page }) => {
  await signUp(page);
  await page.goto('/account');
  // 800x400: left half red, right half blue.
  const photo = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#0000ff' } })
    .composite([{ input: await sharp({ create: { width: 400, height: 400, channels: 3, background: '#ff0000' } }).png().toBuffer(), left: 0, top: 0 }])
    .jpeg().toBuffer();
  await page.getByText('Update pic', { exact: true }).click();
  await page.getByLabel('Choose a profile photo').setInputFiles({ name: 'wide.jpg', mimeType: 'image/jpeg', buffer: photo });
  const frame = page.locator('.crop-frame');
  await expect(frame).toBeVisible();
  await expect(page.getByRole('button', { name: 'Center' })).toBeVisible();
  // Drag the photo right as far as it goes: the circle shows the red (left) half.
  const box = await frame.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  // Send the form into a hidden frame so this page stays put and its busy state can be checked.
  let posts = 0;
  let sent = null;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/account/avatar')) { posts += 1; sent = req.postDataBuffer(); }
  });
  await page.evaluate(() => {
    const f = document.createElement('iframe');
    f.name = 'sink';
    f.hidden = true;
    document.body.append(f);
    document.querySelector('form.photo-form').target = 'sink';
  });
  await page.getByRole('button', { name: 'Upload photo' }).click();
  await expect(page.locator('.is-busy')).toHaveText('Uploading…');
  await expect(page.locator('.is-busy')).toHaveAttribute('aria-disabled', 'true');
  await page.locator('.is-busy').click({ force: true }); // a second tap does nothing
  await expect.poll(() => posts).toBe(1);
  await page.waitForTimeout(300);
  expect(posts).toBe(1);
  await page.goto('/account');
  await page.getByText('Update pic', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replace photo' })).toBeVisible();
  // The browser sent a 512 px square, all red.
  const start = sent.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  const jpeg = sent.subarray(start);
  const { data, info } = await sharp(jpeg).resize(4, 4).raw().toBuffer({ resolveWithObject: true });
  expect(data[0]).toBeGreaterThan(200);
  expect(data[2]).toBeLessThan(60);
  expect(info.channels).toBe(3);
  expect((await sharp(jpeg).metadata()).width).toBe(512);
});
