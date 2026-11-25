// Lighthouse budget (SPEC: mobile Performance >= 90 on /, /parks, /parks/:slug, /passport; St. Pete's city URLs).
// Each page is audited RUNS times (default 3) and judged on the median, as Lighthouse recommends.
//   npm run lighthouse
// Starts the app on a temp database with GTM enabled (served by a local stand-in, consent
// denied: the banner shows), signs up a user for /passport, and runs Lighthouse's default mobile
// audit on each page. Reports go to lighthouse-report/. Exits 1 if any page is under budget.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import puppeteer from 'puppeteer-core'; // ships with lighthouse
import { chromium } from '@playwright/test';

const BUDGET = Number(process.env.LH_BUDGET || 0.9);
const RUNS = Number(process.env.LH_RUNS || 3);
const PORT = 8231;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(process.cwd(), 'lighthouse-report');
const FAKE_GTM = 'window.dataLayer=window.dataLayer||[];window.__fakeGtm=true;';

const gtm = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'max-age=3600' });
  res.end(FAKE_GTM);
});
await new Promise((r) => gtm.listen(0, '127.0.0.1', r));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-lh-'));
const server = spawn(process.execPath, ['src/server.js'], {
  env: {
    ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, NODE_ENV: 'test',
    MAIL_TRANSPORT: 'outbox', BASE_URL: BASE, GTM_ID: 'GTM-LHTEST1', GTM_SCRIPT_ORIGIN: `http://127.0.0.1:${gtm.address().port}`,
  },
  stdio: 'inherit',
});
const stop = () => { server.kill(); gtm.close(); };

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
}

// Sign up and stamp a park over HTTP so /passport has content; returns the cookie header.
async function signedInCookie() {
  const jar = new Map();
  const keep = (res) => {
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); jar.set(k, v); }
  };
  const header = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  keep(await fetch(`${BASE}/signup`));
  const post = async (url, fields) => keep(await fetch(`${BASE}${url}`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: header(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: jar.get('pp_csrf'), ...fields }),
  }));
  await post('/signup', { display_name: 'Lighthouse', email: 'lh@example.com', password: 'correct horse battery' });
  await post('/st-pete/parks/abercrombie-park/stamp', {});
  return jar;
}

const pages = [
  ['home', '/'],
  ['parks', '/st-pete/parks'],
  ['park', '/st-pete/parks/abercrombie-park'],
  ['passport', '/st-pete/passport', true],
];

let failed = false;
let chrome;
try {
  await waitUp();
  const jar = await signedInCookie();
  chrome = await chromeLauncher.launch({
    chromePath: chromium.executablePath(),
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  });
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, url, auth] of pages) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      // Signed-in pages: put the session cookie in the browser and keep it (Lighthouse otherwise
      // clears storage, and Chrome ignores a Cookie passed as an extra header).
      let browser;
      let page;
      if (auth) {
        browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}` });
        page = await browser.newPage();
        await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, url: BASE })));
      }
      const result = await lighthouse(`${BASE}${url}`, {
        port: chrome.port, output: 'html', logLevel: 'error',
        onlyCategories: ['performance', 'accessibility', 'best-practices'],
        ...(auth ? { disableStorageReset: true } : {}),
      }, undefined, page);
      if (page) { await page.close(); browser.disconnect(); }
      runs.push(result);
    }
    // Median by performance score; its report is the one saved.
    runs.sort((x, y) => x.lhr.categories.performance.score - y.lhr.categories.performance.score);
    const result = runs[Math.floor(runs.length / 2)];
    fs.writeFileSync(path.join(OUT, `${name}.html`), result.report);
    // A redirect (e.g. /passport to /login) would audit the wrong page.
    const landed = new URL(result.lhr.finalDisplayedUrl).pathname;
    if (landed !== url) { failed = true; console.error(`  ✘ ${url} ended up at ${landed}`); continue; }
    const c = result.lhr.categories;
    const perf = c.performance.score;
    const a = result.lhr.audits;
    const all = runs.map((r) => Math.round(r.lhr.categories.performance.score * 100)).join('/');
    console.log(`${url.padEnd(26)} performance ${Math.round(perf * 100)} (runs ${all})  accessibility ${Math.round(c.accessibility.score * 100)}  best-practices ${Math.round(c['best-practices'].score * 100)}  (LCP ${a['largest-contentful-paint'].displayValue}, TBT ${a['total-blocking-time'].displayValue}, CLS ${a['cumulative-layout-shift'].displayValue})`);
    if (perf < BUDGET) { failed = true; console.error(`  ✘ ${url} performance ${Math.round(perf * 100)} is under ${BUDGET * 100}`); }
  }
} finally {
  await chrome?.kill();
  stop();
}
process.exit(failed ? 1 : 0);
