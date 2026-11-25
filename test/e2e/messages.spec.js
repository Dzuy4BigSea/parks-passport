// M30 (SPEC Flow 20): an admin writes a message with a badge, previews its effect, sends it to a
// ticked member (never "everyone": the e2e database is shared with the other specs), and the
// member gets it full screen on their next page, then the badge reveal.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expectNoAxeViolations } from './axe.js';
import { signUp } from './helpers.js';

test.use({ viewport: { width: 375, height: 800 } });
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('write, preview and send a message with a badge; the member sees it, then the badge', async ({ browser, page }, testInfo) => {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, storageState: testInfo.project.use.storageState, viewport: { width: 375, height: 800 } });
  const member = await context.newPage();
  const { name } = await signUp(member, { name: `Mia ${Date.now()}` });

  const admin = await signUp(page, { name: 'Max Admin' });
  const db = new Database(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
  db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(admin.email);
  db.close();

  // Tick the member, then "Message ticked members".
  await page.goto('/admin/users');
  await page.getByRole('checkbox', { name: `Give the badge to ${name}` }).check();
  await page.getByRole('button', { name: 'Message ticked members' }).click();
  await expect(page.getByRole('heading', { name: 'Write a message' })).toBeVisible();
  await expect(page.getByLabel(/Picked members: Mia/)).toBeChecked();
  await page.getByLabel('Title').fill('Thank you for being an early adopter!');
  await page.getByLabel('Message').fill('You were here before almost anyone.\n\nHere’s a little something.');
  await page.getByLabel('🎉 Celebration').check();
  await page.getByRole('checkbox', { name: 'Two-City Explorer' }).check();
  await expectNoAxeViolations(page);
  expect(await noSideScroll(page)).toBe(true);

  // Preview: the same dialog the member will see, without sending anything.
  await page.getByRole('button', { name: 'Preview this message' }).click();
  const preview = page.getByRole('dialog', { name: 'Thank you for being an early adopter!' });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Let’s go!' })).toBeFocused();
  await expectNoAxeViolations(page);
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
  // A sample of another effect.
  await page.getByRole('button', { name: 'Play Heads-up' }).click();
  await expect(page.getByRole('dialog', { name: 'Heads-up: maintenance tonight' })).toBeVisible();
  await page.getByRole('button', { name: 'Got it' }).click();

  await page.getByRole('button', { name: 'Save and review' }).click();
  await expect(page.getByText('Reaches')).toBeVisible();
  await page.getByLabel('Yes, send it to 1 member').check();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Published. Members see it on their next page.');

  // The member's next page: the message first, then the badge it brought.
  await member.goto('/st-pete/parks');
  const message = member.getByRole('dialog', { name: 'Thank you for being an early adopter!' });
  await expect(message).toBeVisible();
  await expect(message).toContainText('Here’s a little something.');
  await expect(message).toContainText('Two-City Explorer');
  await expectNoAxeViolations(member);
  expect(await noSideScroll(member)).toBe(true);
  await message.getByRole('button', { name: 'Let’s go!' }).click();
  // With celebrations off (as this suite runs), the badge is announced in the page, not flipped.
  await expect(member.getByRole('dialog')).toHaveCount(0);
  await expect(member.locator('.announcements')).toContainText('New badge: Two-City Explorer');
  await expect(member.locator('.announcements .gift-note')).toHaveText('From Max Admin: “Thank you for being an early adopter!”');

  // Once only.
  await member.goto('/st-pete/parks');
  await expect(member.getByRole('dialog')).toHaveCount(0);
  await context.close();
});
