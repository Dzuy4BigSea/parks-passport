// M24 (SPEC Flow 9): an admin ticks members in Admin › Members and gives them Early Bird Edition, a
// numbered limited edition; the member gets a holographic reveal with their number.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expectNoAxeViolations } from './axe.js';
import { signUp } from './helpers.js';

const SHOTS = process.env.PP_SHOTS_DIR; // set to save screenshots of the foil for a look

test.use({ viewport: { width: 375, height: 800 } });
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

test('Early Bird Edition: given from the members list, revealed as a numbered holographic card', async ({ browser, page }, testInfo) => {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL,
    storageState: { cookies: [{ name: 'pp_consent', value: 'v1.a0.d0', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] },
    viewport: { width: 375, height: 800 } });
  const member = await context.newPage();
  await signUp(member, { name: 'Holo Fan' });
  await member.getByRole('button', { name: 'Start exploring' }).click();

  const admin = await signUp(page, { name: 'Ed Admin' });
  const db = new Database(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
  db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(admin.email);
  // Sign-up already gave Holo Fan an Early Bird (while copies last): take it back so this tests the admin's gift.
  db.prepare(`DELETE FROM user_badges WHERE badge_id = (SELECT id FROM badges WHERE slug = 'early-bird-100')
    AND user_id = (SELECT id FROM users WHERE display_name = 'Holo Fan' ORDER BY id DESC LIMIT 1)`).run();
  db.close();

  await page.goto('/admin/users');
  const option = page.getByLabel('Badge', { exact: true }).locator('option', { hasText: /^Early Bird Edition \(limited: \d+ of 100 left\)$/ });
  await page.getByLabel('Badge', { exact: true }).selectOption(await option.getAttribute('value'));
  await page.getByLabel('Note (optional)').fill('Thanks for being here early!');
  await page.getByRole('checkbox', { name: 'Give the badge to Holo Fan' }).check();
  await expectNoAxeViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Give to ticked members' }).click();
  await expect(page.getByRole('status')).toHaveText('Gave the badge to 1 member.');

  await member.goto('/st-pete/parks');
  const reveal = member.getByRole('dialog', { name: 'Limited edition!' });
  await expect(reveal).toBeVisible();
  await reveal.getByRole('button', { name: /Tap to reveal/ }).click();
  await expect(reveal.locator('.reveal-name')).toHaveText('Early Bird Edition');
  await expect(reveal.locator('.reveal-serial')).toHaveText(/^#\d+ of 100$/);
  await expect(reveal.locator('.reveal-note')).toHaveText('From Parks Passport: “Thanks for being here early!”');
  await expect(reveal.locator('.reveal-front .holo-foil')).toBeVisible();
  await expectNoAxeViolations(member);
  await member.waitForTimeout(700); // let the flip finish
  if (SHOTS) await member.screenshot({ path: `${SHOTS}/holo-reveal.png` });
  await reveal.getByRole('button', { name: 'Awesome!' }).click();

  await member.goto('/st-pete/passport');
  const tile = member.locator('.badge.is-holo', { hasText: 'Early Bird Edition' });
  await expect(tile).toContainText(/Limited edition #\d+ of 100 · Earned/);
  if (SHOTS) await tile.screenshot({ path: `${SHOTS}/holo-tile.png` });
  await member.getByRole('button', { name: 'Look closer: Early Bird Edition' }).click();
  const card = member.getByRole('dialog', { name: 'Early Bird Edition' });
  await expect(card.locator('.inspect-card.is-holo .holo-foil')).toBeVisible();
  await expectNoAxeViolations(member);
  if (SHOTS) await member.screenshot({ path: `${SHOTS}/holo-inspect.png` });
  await context.close();
});
