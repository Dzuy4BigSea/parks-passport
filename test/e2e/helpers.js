import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';

export const PASSWORD = 'correct horse battery';
export const uniqueEmail = (tag = 'user') => `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

// Newest email sent to `to`, from the app's outbox (MAIL_TRANSPORT=outbox).
export async function lastEmailTo(to) {
  const dir = path.join(process.env.PP_E2E_DATA_DIR, 'outbox');
  let found;
  await expect.poll(() => {
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
    found = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).filter((m) => m.includes(`To: ${to}\n`)).at(-1);
    return Boolean(found);
  }).toBe(true);
  return { raw: found, link: found.match(/https?:\/\/\S+/)[0] };
}

export async function signUp(page, { email = uniqueEmail(), name = 'Sam Explorer', password = PASSWORD } = {}) {
  await page.goto('/signup');
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/passport$/);
  return { email, name, password };
}

// A page in a fresh browser context (separate cookies), with the project's baseURL.
export async function freshPage(browser, testInfo) {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, storageState: testInfo.project.use.storageState });
  return context.newPage();
}
