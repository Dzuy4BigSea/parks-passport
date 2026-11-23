import { openDb } from '../../src/db/index.js';
import { buildApp } from '../../src/app.js';

// In-memory mailer that records messages.
export function memoryMailer() {
  const sent = [];
  return {
    sent,
    fail: false,
    async send(msg) {
      if (this.fail) throw new Error('mail down');
      sent.push(msg);
    },
    linkIn(msg) { return msg.text.match(/https?:\/\/\S+/)[0]; },
  };
}

// A test clock that can be moved forward.
export function testClock(start = '2026-06-01T12:00:00Z') {
  let t = new Date(start).getTime();
  const now = () => new Date(t);
  now.advanceMinutes = (m) => { t += m * 60000; };
  return now;
}

export function makeApp({ db = openDb(':memory:'), mailer = memoryMailer(), now = testClock(), random = () => 0.99, secureCookies = false } = {}) {
  const app = buildApp({ db, mailer, now, random, config: { baseUrl: 'http://test.local', secureCookies } });
  return { app, db, mailer, now };
}

// Minimal cookie jar + form poster for app.inject.
export function client(app) {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const store = (res) => {
    for (const c of res.cookies) {
      if (c.maxAge === 0 || c.expires?.getTime?.() === 0 || c.value === '') jar.delete(c.name);
      else jar.set(c.name, c.value);
    }
    return res;
  };
  const csrfValue = () => [...jar].find(([k]) => k.endsWith('pp_csrf'))?.[1];
  const api = {
    jar,
    async get(url) {
      return store(await app.inject({ method: 'GET', url, headers: { cookie: cookieHeader() } }));
    },
    async post(url, fields = {}, { csrf = true } = {}) {
      if (csrf && !csrfValue()) await api.get('/');
      const body = new URLSearchParams({ ...(csrf ? { _csrf: csrfValue() } : {}), ...fields }).toString();
      return store(await app.inject({
        method: 'POST', url, payload: body,
        headers: { cookie: cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' },
      }));
    },
  };
  return api;
}
