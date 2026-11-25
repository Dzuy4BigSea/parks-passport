// Gary on every screen (SPEC Flow 21), and talking back to him as a founding explorer (Flow 16).
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

// The e2e database fills the 75 Founding Member numbers quickly, so this gives the member Early Bird
// Edition, which also lets them talk back; with on = false, every founding badge is taken away.
function setFoundingExplorer(email, on) {
  const db = new Database(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (on) {
    const badge = db.prepare("SELECT id FROM badges WHERE slug = 'early-bird-100'").get();
    db.prepare(`INSERT OR IGNORE INTO user_badges (user_id, badge_id, awarded_at, source_type, source_id, seen_at)
      VALUES (?, ?, ?, 'grant', NULL, ?)`).run(user.id, badge.id, new Date().toISOString(), new Date().toISOString());
  } else {
    db.prepare("DELETE FROM user_badges WHERE user_id = ? AND badge_id IN (SELECT id FROM badges WHERE slug IN ('early-bird-100', 'founding-member'))").run(user.id);
  }
  db.close();
}

test('anyone: Gary gives a tip for this screen, and Escape or a tap outside closes it', async ({ page }) => {
  await page.goto('/st-pete/parks');
  const gary = page.locator('.gary-fab');
  await expect(gary).toHaveAccessibleName('Ask Gary');
  await gary.click();
  const panel = page.getByRole('group', { name: 'Gary says' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('.gary-msg.is-gary')).toContainText(/park/i);
  await expect(panel.getByRole('button', { name: 'Talk to Gary' })).toHaveCount(0); // visitors only get the tip
  await expectNoAxeViolations(page);
  expect(await noSideScroll(page)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(gary).toBeFocused();
  await gary.click();
  await expect(panel).toBeVisible();
  await page.locator('h1').click();
  await expect(panel).toBeHidden();
});

test('a founding explorer talks back: Gary\'s tip, their message, then his thank-you', async ({ page }) => {
  const { email } = await signUp(page, { name: 'Fern' });
  setFoundingExplorer(email, true);
  await page.goto('/st-pete/parks');
  await page.locator('.gary-fab').click();
  const panel = page.getByRole('group', { name: 'Gary says' });
  await panel.getByRole('button', { name: 'Talk to Gary' }).click();
  await expect(panel).toContainText('goes to the Parks Passport team as feedback');
  await panel.getByLabel('🛠️ Something\'s broken').check();
  await panel.getByLabel('Your feedback').fill('The map jumps when I zoom.');
  await expectNoAxeViolations(page);
  await panel.getByRole('button', { name: 'Send to the team' }).click();
  const bubbles = panel.locator('.gary-msg:not(.is-typing)');
  await expect(bubbles).toHaveCount(3);
  await expect(bubbles.nth(1)).toHaveText(/You\s*The map jumps when I zoom\./);
  await expect(bubbles.nth(2)).toContainText(/Thank|thanks/);
  await expect(panel.locator('form')).toBeHidden(); // a three-message chat, then it ends
  await expect(panel.getByRole('button', { name: 'Close Gary' })).toBeFocused();
  expect(await noSideScroll(page)).toBe(true);
  await expectNoAxeViolations(page);

  // Not a founding explorer: the tip only.
  setFoundingExplorer(email, false);
  await page.goto('/st-pete/parks');
  await page.locator('.gary-fab').click();
  await expect(page.getByRole('button', { name: 'Talk to Gary' })).toHaveCount(0);
});
