import net from 'node:net';
import { isPublicIp } from './geoip.js';

// Per-connection limits for actions bots abuse (sign-ups, sign-in and reset emails). In memory:
// one container, and a restart just starts the windows over. Nothing is written to disk and the
// IP is only a key in this process's memory. Loopback and private addresses (local dev, tests,
// health checks) are never limited. req.ip must come from the trusted proxy hop (app.js).

const MAX_KEYS = 10_000; // memory bound: past this, expired keys go, then everything (fail open)

// IPv6 clients usually get a whole /64, so the /64 is the key; IPv4 is the address.
export function limitKey(ip) {
  ip = String(ip).replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  if (net.isIP(ip) !== 6) return ip;
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return `${full.slice(0, 4).map((x) => x.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** createRateLimiter({ limit, windowMs, now }) -> { hit(ip) -> boolean } (true = allowed). */
export function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  const hits = new Map(); // key -> timestamps within the window
  return {
    hit(ip) {
      if (!isPublicIp(String(ip || ''))) return true;
      const key = limitKey(ip);
      const t = now();
      const recent = (hits.get(key) || []).filter((at) => t - at < windowMs);
      const allowed = recent.length < limit;
      if (allowed) recent.push(t);
      hits.set(key, recent);
      if (hits.size > MAX_KEYS) {
        for (const [k, v] of hits) if (!v.some((at) => t - at < windowMs)) hits.delete(k);
        if (hits.size > MAX_KEYS) hits.clear();
      }
      return allowed;
    },
    size: () => hits.size,
  };
}
