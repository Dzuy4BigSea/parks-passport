// Dev-only: renders the 1200×630 social share images (Open Graph / Twitter card).
//   node scripts/make-og-image.js                  every city pack
//   node scripts/make-og-image.js westminster      just one (or several) city keys
// St. Pete's card (public/og/parks-passport.jpg, also the default) uses its pier photo. Other
// cities (public/og/<key>.jpg) use their own landmark icons on their accent colors, so no photo
// license is needed. The layout picks public/og/<key>.jpg for a city's pages when it exists.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeSvg } from '../src/lib/svg-sanitize.js';

const root = path.join(import.meta.dirname, '..');
const pub = path.join(root, 'public');
const citiesDir = path.join(root, 'seed', 'cities');
const dataUrl = (file, type) => `data:${type};base64,${fs.readFileSync(path.join(pub, file)).toString('base64')}`;
// Gary standing still: his animations would be caught mid-frame.
const gary = fs.readFileSync(path.join(pub, 'brand', 'gary.svg'), 'utf8').replace(/<style>[\s\S]*?<\/style>/, '');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const STYLE = `
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
.photo { position: relative; border-radius: 48px 0 0 48px; overflow: hidden; }
.photo svg.gary { position: absolute; z-index: 1; left: -40px; bottom: -6px; width: 330px; height: 330px; }
.stamp { position: absolute; z-index: 1; top: 44px; right: 44px; width: 150px; height: 150px; border-radius: 50%; border: 6px dashed #fffaf0; display: grid; place-items: center; transform: rotate(-12deg);
  background: rgba(255, 77, 136, 0.9); color: #fffaf0; font-size: 26px; font-weight: 800; text-align: center; line-height: 1.05; }
.motifs { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 34px; padding: 46px 40px 40px 60px; color: #fffaf0; opacity: 0.9; transform: rotate(-6deg) scale(1.08); }
.motifs svg { width: 100%; height: auto; }
`;

function card({ short, photoCss, art, stampText }) {
  return `<!doctype html><style>${STYLE}${photoCss}</style>
<div class="card">
  <div class="copy">
    <div class="brand"><img src="${dataUrl('icons/icon.svg', 'image/svg+xml')}" alt="">Parks Passport</div>
    <h1>Stamp every <em>${esc(short)}</em> park you visit.</h1>
    <p>Check in by GPS, earn badges and explore with your Park Pals.</p>
    <div class="url">parkspassport.dzuynguyen.com</div>
  </div>
  <div class="photo">${art}${gary.replace('<svg', '<svg class="gary"')}<div class="stamp">${stampText}</div></div>
</div>`;
}

function cityCard(key) {
  const city = JSON.parse(fs.readFileSync(path.join(citiesDir, key, 'city.json'), 'utf8'));
  const short = city.copy?.short || city.name;
  if (key === 'st-pete') {
    return {
      file: 'parks-passport.jpg',
      html: card({
        short, stampText: 'ST. PETE<br>PARKS', art: '',
        photoCss: `.photo { background: url(${dataUrl('city/st-pete/pier-sunrise.webp', 'image/webp')}) center / cover; }
.photo::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(160deg, #ff7a59, #ffc83d 45%, #00b3a4); mix-blend-mode: multiply; opacity: 0.75; }`,
      }),
    };
  }
  // No photo: the city's motifs, repeated to fill a 4×3 grid, on its two accent colors.
  const icons = (city.motifs || []).map((m) => sanitizeSvg(m.svg)).filter(Boolean);
  const grid = Array.from({ length: 12 }, (_, i) => icons[i % icons.length] || '').join('');
  const words = short.toUpperCase().split(/\s+/);
  return {
    file: `${key}.jpg`,
    html: card({
      short, art: `<div class="motifs">${grid}</div>`,
      stampText: `${esc(words.join(' '))}<br>PARKS`,
      photoCss: `.photo { background: linear-gradient(160deg, ${city.accent}, ${city.accent_2}); }
.stamp { font-size: ${short.length > 9 ? 20 : 26}px; }`,
    }),
  };
}

const keys = process.argv.slice(2).length ? process.argv.slice(2)
  : fs.readdirSync(citiesDir).filter((k) => fs.existsSync(path.join(citiesDir, k, 'city.json')));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
fs.mkdirSync(path.join(pub, 'og'), { recursive: true });
for (const key of keys) {
  const { file, html } = cityCard(key);
  await page.setContent(html);
  await page.evaluate('document.fonts.ready');
  await page.screenshot({ path: path.join(pub, 'og', file), type: 'jpeg', quality: 88 });
  console.log(`public/og/${file}`);
}
await browser.close();
