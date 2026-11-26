import { test, expect } from '@playwright/test';

// "Open in Maps" on a park page hands the park to the device's own map app.
const PARK = '/st-pete/parks/crescent-lake-park';
const UAS = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
};

for (const [device, href] of [
  ['android', /^geo:27\.\d+,-82\.\d+\?q=27\.\d+,-82\.\d+\(Crescent%20Lake%20Park\)$/],
  ['iphone', /^https:\/\/maps\.apple\.com\/\?ll=27\.\d+,-82\.\d+&q=Crescent%20Lake%20Park$/],
]) {
  test.describe(device, () => {
    test.use({ userAgent: UAS[device] });
    test(`opens ${device === 'android' ? 'the default map app (geo:)' : 'Apple Maps'}`, async ({ page }) => {
      await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
      await page.goto(PARK);
      await expect(page.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute('href', href);
    });
  });
}

test('on a computer it stays OpenStreetMap', async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.goto(PARK);
  await expect(page.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute('href', /^https:\/\/www\.openstreetmap\.org\/\?mlat=/);
});
