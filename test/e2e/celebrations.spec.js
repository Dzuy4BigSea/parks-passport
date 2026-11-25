// Celebrations (SPEC Flow 11, "Game feel"): the passport opening, badge reveals and inspecting a
// badge. Every other spec runs with celebrations off (playwright.config.js); these turn them on.
import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './axe.js';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PASSWORD, uniqueEmail } from './helpers.js';

test.use({
  viewport: { width: 375, height: 800 },
  storageState: { cookies: [{ name: 'pp_consent', value: 'v1.a0.d0', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] },
});
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204, body: '' }));
});

async function signUpCelebrating(page, name = 'Cel Ebrate', email = uniqueEmail('cel')) {
  await page.goto('/signup');
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
}

test('the passport opens, a surprise badge is revealed, a badge can be inspected; axe clean, no sideways scroll', async ({ page }) => {
  await signUpCelebrating(page);
  const welcome = page.getByRole('dialog', { name: 'Welcome, Cel!' });
  await expect(welcome).toBeVisible();
  await expect(page).toHaveURL(/\/st-pete\/passport$/); // the ?welcome flag is dropped
  await expect(welcome.getByText('Cel Ebrate')).toBeVisible();
  await expectNoAxeViolations(page);
  await welcome.getByRole('button', { name: 'Start exploring' }).click();
  await expect(welcome).toBeHidden();
  await expect(page.locator('html')).not.toHaveClass(/fx-locked/);
  await expect(page.locator('#main')).toBeFocused();

  // The first park page: a surprise badge, face down until tapped.
  await page.goto('/st-pete/parks/abercrombie-park');
  const reveal = page.getByRole('dialog', { name: 'Surprise badge!' });
  await expect(reveal).toBeVisible();
  await expect(reveal.getByRole('button', { name: /Tap to reveal/ })).toBeFocused();
  await expect(reveal.locator('.reveal-name')).toBeHidden(); // no peeking before the tap
  await reveal.getByRole('button', { name: /Tap to reveal/ }).click();
  await expect(reveal.locator('.reveal-name')).toHaveText('Trail Planner');
  await expectNoAxeViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await reveal.getByRole('button', { name: 'Awesome!' }).click();
  await expect(reveal).toBeHidden();
  await expect(page.locator('html')).not.toHaveClass(/fx-locked/);
  // Without JS the same news is in the page (role=status), and it stays.
  await expect(page.locator('.announcements')).toContainText('New badge: Trail Planner');

  // Inspect it on the passport: a card that flips to its story. Escape closes.
  await page.goto('/passport');
  await page.getByRole('button', { name: 'Look closer: Trail Planner' }).click();
  const card = page.getByRole('dialog', { name: 'Trail Planner' });
  await expect(card).toBeVisible();
  await expectNoAxeViolations(page);
  await card.getByRole('button', { name: 'Flip it over' }).click();
  await expect(card.getByText('The story')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(page.getByRole('button', { name: 'Look closer: Trail Planner' })).toBeFocused();
});

test('celebrations can be turned off on this device; with reduced motion they still show, without movement', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signUpCelebrating(page, 'Still Life');
  await expect(page.getByRole('dialog', { name: 'Welcome, Still!' })).toBeVisible();
  await page.getByRole('button', { name: 'Start exploring' }).click();
  await page.goto('/account');
  const box = page.getByLabel(/Show celebrations/);
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect(page.locator('#celebrations-status')).toHaveText('Celebrations are off for this device.');
  // Off: the new badge is in the page, with no full-screen card.
  await page.goto('/st-pete/parks/crescent-lake-park');
  await expect(page.locator('.announcements')).toContainText('New badge: Trail Planner');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/account');
  await expect(page.getByLabel(/Show celebrations/)).not.toBeChecked();
});

test('several badges queue up; long names and descriptions fit; Escape works after a click inside', async ({ page }) => {
  const email = uniqueEmail('queue');
  await signUpCelebrating(page, 'Q Ueue', email);
  await page.getByRole('button', { name: 'Start exploring' }).click();
  // Two unseen badges (disabled, so nobody else's board changes), one with the longest text the admin allows.
  const db = new Database(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
  const userId = db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(email);
  const stamp = Date.now();
  const long = { name: 'Supercalifragilisticexpialidocious Trailblazing Explorer Pro', desc: 'D'.repeat(60) + ' ' + 'a long description '.repeat(7) };
  for (const [slug, name, desc] of [[`qa-a-${stamp}`, 'Quick One', 'Short.'], [`qa-b-${stamp}`, long.name.slice(0, 60), long.desc.slice(0, 200)]]) {
    const { lastInsertRowid } = db.prepare(`INSERT INTO badges (slug, name, description, art, rule_type, rule_params, kind, enabled, created_at)
      VALUES (?, ?, ?, '🏅', 'parks_count', '{"n":999}', 'known', 0, 'x')`).run(slug, name, desc);
    db.prepare("INSERT INTO user_badges (user_id, badge_id, awarded_at, source_type) VALUES (?, ?, '2026-01-01T00:00:00Z', 'test')").run(userId, lastInsertRowid);
  }
  db.close();
  await page.goto('/pals');
  const reveal = page.getByRole('dialog', { name: 'Badge unlocked!' });
  await expect(reveal.locator('.reveal-count')).toHaveText('1 of 2');
  await reveal.getByRole('button', { name: /Tap to reveal/ }).click();
  await reveal.getByRole('button', { name: 'Next' }).click();
  await expect(reveal.locator('.reveal-count')).toHaveText('2 of 2');
  await reveal.getByRole('button', { name: /Tap to reveal/ }).click();
  await expect(reveal.locator('.reveal-name')).toContainText('Supercalifragilistic');
  const fits = await page.locator('.reveal-front').evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);
  await expectNoAxeViolations(page);
  // A click on plain text inside moves focus off the buttons; Escape still closes.
  await reveal.locator('.reveal-kicker').click();
  await page.keyboard.press('Escape');
  await expect(reveal).toBeHidden();
  await expect(page.locator('html')).not.toHaveClass(/fx-locked/);
});

test.describe('with celebrations off', () => {
  test.use({ storageState: { cookies: [{ name: 'pp_consent', value: 'v1.a0.d0', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }],
    origins: [{ origin: 'http://127.0.0.1:8181', localStorage: [{ name: 'pp-celebrations', value: 'off' }] }] } });
  test('sign-up lands on the passport with no welcome card', async ({ page }) => {
    await signUpCelebrating(page, 'No Fuss');
    await expect(page).toHaveURL(/\/st-pete\/passport$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test('the passport opening goes first; a waiting badge is revealed right after it closes', async ({ page }) => {
  const email = uniqueEmail('stack');
  await signUpCelebrating(page, 'Stack Ed', email);
  await page.getByRole('button', { name: 'Start exploring' }).click();
  const db = new Database(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
  const userId = db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(email);
  const { lastInsertRowid } = db.prepare(`INSERT INTO badges (slug, name, description, art, rule_type, rule_params, kind, enabled, created_at)
    VALUES (?, 'Stacked', 'One at a time.', '🎉', 'parks_count', '{"n":999}', 'known', 0, 'x')`).run(`qa-stack-${Date.now()}`);
  db.prepare("INSERT INTO user_badges (user_id, badge_id, awarded_at, source_type) VALUES (?, ?, '2026-01-01T00:00:00Z', 'test')").run(userId, lastInsertRowid);
  db.close();
  await page.goto('/passport?welcome=1');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByRole('button', { name: 'Start exploring' }).click();
  const reveal = page.getByRole('dialog', { name: 'Badge unlocked!' });
  await expect(reveal).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/fx-locked/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveClass(/fx-locked/);
});

// Messages from the team (SPEC Flow 20): the message opens with its effect, then the badge it
// brought is revealed. Inserted straight into the database for this member only (the e2e database
// is shared, so never "everyone").
test('a message from the team opens first, then its badge is revealed', async ({ page }) => {
  const email = uniqueEmail('msg');
  await signUpCelebrating(page, 'Mo Message', email);
  await page.getByRole('button', { name: 'Start exploring' }).click();
  const db = new Database(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
  const userId = db.prepare('SELECT id FROM users WHERE email = ?').pluck().get(email);
  const badgeId = db.prepare("SELECT id FROM badges WHERE slug = 'two-cities'").pluck().get();
  const at = new Date().toISOString();
  const id = db.prepare(`INSERT INTO team_messages (title, body, effect, audience, existing_only, badge_ids, status, published_at, created_at, updated_at)
    VALUES ('Happy Thanksgiving!', 'Thank you for exploring with us.', 'autumn', 'picked', 0, ?, 'live', ?, ?, ?)`).run(JSON.stringify([badgeId]), at, at, at).lastInsertRowid;
  db.prepare('INSERT INTO team_message_recipients (message_id, user_id) VALUES (?, ?)').run(id, userId);
  db.close();

  await page.goto('/st-pete/parks');
  const message = page.getByRole('dialog', { name: 'Happy Thanksgiving!' });
  await expect(message).toBeVisible();
  await expect(page.locator('.fx-drift')).toHaveCount(1); // falling leaves
  await expect(page.locator('.fx-reveal')).toHaveCount(0); // not yet
  await message.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((x) => x.finished))); // popped in
  await expectNoAxeViolations(page);
  await message.getByRole('button', { name: 'Let’s go!' }).click();
  const reveal = page.locator('.fx-reveal'); // "Badge unlocked!" (this test message has no author)
  await expect(reveal).toBeVisible();
  await reveal.getByRole('button', { name: /Tap to reveal/ }).click();
  await expect(reveal.locator('.reveal-name')).toHaveText('Two-City Explorer');
});
