// Memory under load (PLAN M10): the app must stay well inside its 512 MB container limit.
//   npm run check:memory
// Starts the app on a temp database, then runs bursts of concurrent page views, stamps and
// photo uploads (2000x1500 JPEGs, the heaviest work) while sampling the server's resident
// memory. Fails if the peak goes over LIMIT_MB (default 400, leaving headroom under 512).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const LIMIT_MB = Number(process.env.LIMIT_MB || 400);
const PORT = 8233;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-load-'));
const server = spawn(process.execPath, ['src/server.js'], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, NODE_ENV: 'test', MAIL_TRANSPORT: 'outbox', BASE_URL: BASE },
  stdio: 'ignore',
});

const rssMb = () => {
  const m = /VmRSS:\s+(\d+) kB/.exec(fs.readFileSync(`/proc/${server.pid}/status`, 'utf8'));
  return m ? Number(m[1]) / 1024 : 0;
};
let peak = 0;
const sampler = setInterval(() => { try { peak = Math.max(peak, rssMb()); } catch { /* exited */ } }, 50);

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
}

async function user(i) {
  const jar = new Map();
  const keep = (res) => { for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const k = kv.slice(0, kv.indexOf('=')); jar.set(k, kv.slice(k.length + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  keep(await fetch(`${BASE}/signup`));
  const form = (fields) => ({ method: 'POST', redirect: 'manual', headers: { cookie: cookie(), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: jar.get('pp_csrf'), ...fields }) });
  keep(await fetch(`${BASE}/signup`, form({ display_name: `Load ${i}`, email: `load${i}@example.com`, password: 'correct horse battery' })));
  return {
    get: (url) => fetch(`${BASE}${url}`, { headers: { cookie: cookie() } }).then((r) => r.arrayBuffer()),
    post: (url, fields) => fetch(`${BASE}${url}`, form(fields)),
    upload: (url, buf) => {
      const fd = new FormData();
      fd.append('_csrf', jar.get('pp_csrf'));
      fd.append('photo', new Blob([buf], { type: 'image/jpeg' }), 'load.jpg');
      return fetch(`${BASE}${url}`, { method: 'POST', redirect: 'manual', headers: { cookie: cookie() }, body: fd });
    },
  };
}

let exitCode = 0;
try {
  await waitUp();
  const idle = rssMb();
  const users = await Promise.all(Array.from({ length: 10 }, (_, i) => user(i)));
  const photo = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#2f6f4e' } })
    .composite([{ input: Buffer.from('<svg width="2000" height="1500"><rect x="100" y="100" width="1800" height="1300" fill="#f2c14e" opacity="0.5"/></svg>') }])
    .jpeg({ quality: 95 }).toBuffer();
  const parks = ['abercrombie-park', 'crescent-lake-park', 'lake-vista-park', 'north-shore-park', 'bartlett-park'];
  const t0 = Date.now();
  for (let round = 0; round < 3; round++) {
    await Promise.all(users.flatMap((u, i) => [
      ...['/', '/parks', '/parks?q=lake&cat=playground', `/parks/${parks[i % 5]}`, '/passport', '/pals'].map((p) => u.get(p)),
      u.post(`/parks/${parks[(i + round) % 5]}/stamp`, {}),
      u.upload(`/parks/${parks[i % 5]}/photos`, photo),
      u.upload(`/parks/${parks[(i + 1) % 5]}/photos`, photo),
    ]));
  }
  const photos = fs.readdirSync(path.join(dataDir, 'uploads'), { recursive: true }).filter((f) => String(f).endsWith('.jpg') && !String(f).includes('thumb')).length;
  console.log(`idle ${idle.toFixed(0)} MB, peak ${peak.toFixed(0)} MB under load (limit ${LIMIT_MB} MB, container 512 MB)`);
  console.log(`${users.length} users, 3 rounds: ${3 * users.length * 6} page views, ${3 * users.length} stamps, ${photos} photos stored, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (photos !== 3 * users.length * 2) { console.error(`✘ expected ${3 * users.length * 2} photos, got ${photos}`); exitCode = 1; }
  if (peak > LIMIT_MB) { console.error(`✘ peak memory ${peak.toFixed(0)} MB is over ${LIMIT_MB} MB`); exitCode = 1; }
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  clearInterval(sampler);
  server.kill();
}
process.exit(exitCode);
