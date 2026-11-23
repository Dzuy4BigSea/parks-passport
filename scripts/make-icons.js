// Dev-only: renders public/icons/icon.svg to the PNG sizes the manifest needs.
//   node scripts/make-icons.js
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(import.meta.dirname, '..', 'public', 'icons');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const browser = await chromium.launch();
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: path.join(dir, `icon-${size}.png`), omitBackground: true });
  await page.close();
}
await browser.close();
