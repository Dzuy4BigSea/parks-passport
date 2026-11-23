import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const PORT = 8181;
// Fresh data dir per run, so tests never touch real data.
const DATA_DIR = path.join(os.tmpdir(), `parks-passport-e2e-${process.pid}`);

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node src/server.js',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR, NODE_ENV: 'test' },
  },
});
