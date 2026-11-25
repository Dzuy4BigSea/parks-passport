import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './axe.js';
import { PASSWORD, uniqueEmail, lastEmailTo, signUp, freshPage } from './helpers.js';

test('sign up lands on /passport and the nav shows the account', async ({ page }) => {
  await page.goto('/signup');
  await expectNoAxeViolations(page);
  await signUp(page, { name: 'Robin' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Robin's passport");
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
});

test('sign up with an existing email shows an inline error', async ({ page, browser }) => {
  const { email } = await signUp(page);
  const other = await freshPage(browser, test.info());
  await other.goto('/signup');
  await other.getByLabel('Display name').fill('Someone');
  await other.getByLabel('Email').fill(email.toUpperCase());
  await other.getByLabel('Password').fill(PASSWORD);
  await other.getByRole('button', { name: 'Create account' }).click();
  await expect(other.locator('#email-error')).toHaveText('An account with this email already exists.');
  await expect(other.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
  await expectNoAxeViolations(other);
});

test('invalid email and short password show inline errors', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Display name').fill('Sam');
  await page.getByLabel('Email').fill('nope');
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('#email-error')).toContainText('Enter a valid email address');
  await expect(page.locator('#password-error')).toHaveText('Use at least 10 characters.');
  await expect(page.getByRole('alert')).toContainText("There's a problem");
  await expectNoAxeViolations(page);
});

test('log in, log out, and a wrong password shows a generic error', async ({ page, context }) => {
  const { email } = await signUp(page);
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.goto('/st-pete/passport');
  await expect(page).toHaveURL(/\/login\?next=%2Fst-pete%2Fpassport/);
  await expectNoAxeViolations(page);

  await page.locator('#email').fill(email);
  await page.locator('#password').fill('not my password');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Email or password is incorrect.');

  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/passport$/);
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === 'pp_session');
  expect(session.httpOnly).toBe(true);
  expect(session.sameSite).toBe('Lax');
});

test('magic link signs in once; reusing it says expired', async ({ page, browser }) => {
  const { email } = await signUp(page);
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.goto('/login');
  await page.locator('#magic_email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check your email');

  const { link } = await lastEmailTo(email);
  await page.goto(link);
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/passport$/);

  const other = await freshPage(browser, test.info());
  await other.goto(link);
  await expect(other.getByRole('heading', { level: 1 })).toHaveText('This link has expired');
});

test('forgot password resets it and signs in', async ({ page }) => {
  const { email } = await signUp(page);
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.goto('/forgot');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a reset link' }).click();
  const { link } = await lastEmailTo(email);
  await page.goto(link);
  await page.getByLabel('New password').fill('my new park password');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page).toHaveURL(/\/passport$/);
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('my new park password');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/passport$/);
});

test('delete my account removes it; the email can sign up again', async ({ page }) => {
  const email = uniqueEmail('delete');
  await signUp(page, { email });
  await page.getByRole('link', { name: 'Account' }).click();
  await expectNoAxeViolations(page);
  await page.getByLabel('Confirm with your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your account is deleted');
  await page.goto('/st-pete/passport');
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Email or password is incorrect.');
  await signUp(page, { email });
});

test('header fits at 375px when signed in', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signUp(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: test.info().outputPath('passport-375-signed-in.png') });
});
