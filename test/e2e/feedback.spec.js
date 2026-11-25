import { test, expect } from '@playwright/test';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expectNoAxeViolations } from './axe.js';
import { signUp } from './helpers.js';

// Founding explorers' feedback (SPEC Flow 16). The e2e database fills the 75 Founding Member
// numbers quickly, so this gives the member Early Bird Edition, which also unlocks the button.
function giveEarlyBird(email) {
  const db = new Database(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  const badge = db.prepare("SELECT id FROM badges WHERE slug = 'early-bird-100'").get();
  db.prepare(`INSERT OR IGNORE INTO user_badges (user_id, badge_id, awarded_at, source_type, source_id, seen_at)
    VALUES (?, ?, ?, 'grant', NULL, ?)`).run(user.id, badge.id, new Date().toISOString(), new Date().toISOString());
  db.close();
}

test('send feedback from the lower-right button at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const { email } = await signUp(page, { name: 'Fern' });
  giveEarlyBird(email);
  await page.goto('/st-pete/parks');
  const fab = page.getByRole('link', { name: 'Feedback' });
  await expect(fab).toBeVisible();
  await fab.click();
  const dialog = page.getByRole('dialog', { name: /first explorers/ });
  await expect(dialog).toBeVisible();
  await expectNoAxeViolations(page);
  await dialog.getByLabel('💡 Idea').check();
  await dialog.getByLabel('Your feedback').fill('Could the map remember my zoom?');
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(dialog.getByRole('heading', { name: 'Thank you. We read every one.' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(fab).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
