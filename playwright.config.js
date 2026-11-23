import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const PORT = 8181;
// Fresh data dir per run, so tests never touch real data. Set once in the main process so
// workers (which inherit env) read the same outbox.
process.env.PP_E2E_DATA_DIR ??= path.join(os.tmpdir(), `parks-passport-e2e-${process.pid}`);
const DATA_DIR = process.env.PP_E2E_DATA_DIR;

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
    // Most tests start with cookies already rejected so the consent banner stays out of the way;
    // the consent specs clear this.
    storageState: { cookies: [{ name: 'pp_consent', value: 'v1.a0.d0', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node src/server.js',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR, NODE_ENV: 'test', MAIL_TRANSPORT: 'outbox', BASE_URL: `http://127.0.0.1:${PORT}`,
      // A fake GTM container served by the tests (see test/e2e/analytics.js).
      GTM_ID: 'GTM-TEST123', GTM_SCRIPT_ORIGIN: 'https://gtm.test.invalid',
      // Umami's script is stubbed by the tests that check it (test/e2e/flows.spec.js).
      UMAMI_WEBSITE_ID: '0f2c3d4e-1234-4abc-8def-123456789abc', UMAMI_SCRIPT_URL: '/stats/script.js' },
  },
});
