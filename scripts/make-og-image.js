// Dev-only: renders the 1200×630 social share image (Open Graph / Twitter card) to
// public/og/parks-passport.jpg from the brand mark, Gary and a St. Pete photo.
//   node scripts/make-og-image.js
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const pub = path.join(import.meta.dirname, '..', 'public');
const dataUrl = (file, type) => `data:${type};base64,${fs.readFileSync(path.join(pub, file)).toString('base64')}`;
// Gary standing still: his animations would be caught mid-frame.
const gary = fs.readFileSync(path.join(pub, 'brand', 'gary.svg'), 'utf8').replace(/<style>[\s\S]*?<\/style>/, '');

const html = `<!doctype html><style>
@font-face { font-family: Bricolage; src: url(${dataUrl('fonts/bricolage-grotesque.woff2', 'font/woff2')}) format('woff2'); font-weight: 200 800; }
html, body { margin: 0; }
.card { width: 1200px; height: 630px; display: grid; grid-template-columns: 640px 560px; background: #f6f1e7; font-family: Bricolage, sans-serif; color: #0e2a33; overflow: hidden; }
.copy { padding: 64px 0 56px 72px; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 18px; font-size: 34px; font-weight: 700; }
.brand img { width: 64px; height: 64px; }
h1 { font-size: 76px; line-height: 0.98; letter-spacing: -0.02em; margin: 52px 0 24px; font-weight: 800; }
h1 em { font-style: normal; color: #c8155a; }
p { font-size: 30px; line-height: 1.3; margin: 0; color: #4a5f66; font-weight: 500; }
.url { margin-top: auto; font-size: 24px; font-weight: 700; color: #00756c; }
.photo { position: relative; background: url(${dataUrl('city/st-pete/pier-sunrise.webp', 'image/webp')}) center / cover; border-radius: 48px 0 0 48px; }
.photo::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(160deg, #ff7a59, #ffc83d 45%, #00b3a4); mix-blend-mode: multiply; opacity: 0.75; }
.photo svg { position: absolute; z-index: 1; left: -40px; bottom: -6px; width: 330px; height: 330px; }
.stamp { position: absolute; z-index: 1; top: 44px; right: 44px; width: 150px; height: 150px; border-radius: 50%; border: 6px dashed #fffaf0; display: grid; place-items: center; transform: rotate(-12deg);
  background: rgba(255, 77, 136, 0.9); color: #fffaf0; font-size: 26px; font-weight: 800; text-align: center; line-height: 1.05; }
</style>
<div class="card">
  <div class="copy">
    <div class="brand"><img src="${dataUrl('icons/icon.svg', 'image/svg+xml')}" alt="">Parks Passport</div>
    <h1>Stamp every <em>St. Pete</em> park you visit.</h1>
    <p>Check in by GPS, earn badges and explore with your Park Pals.</p>
    <div class="url">parkspassport.dzuynguyen.com</div>
  </div>
  <div class="photo">${gary}<div class="stamp">ST. PETE<br>PARKS</div></div>
</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate('document.fonts.ready');
fs.mkdirSync(path.join(pub, 'og'), { recursive: true });
await page.screenshot({ path: path.join(pub, 'og', 'parks-passport.jpg'), type: 'jpeg', quality: 88 });
await browser.close();
