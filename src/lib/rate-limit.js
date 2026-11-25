import { isPublicIp } from './geoip.js';

// Per-connection limits for actions bots abuse (sign-ups, sign-in and reset emails). In memory:
// one container, and a restart just starts the windows over. Nothing is written to disk and the
// IP is only a key in this process's memory. Loopback and private addresses (local dev, tests,
// health checks) are never limited.

/** createRateLimiter({ limit, windowMs, now }) -> { hit(ip) -> boolean } (true = allowed). */
export function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  const hits = new Map(); // ip -> timestamps within the window
  return {
    hit(ip) {
      if (!isPublicIp(String(ip || ''))) return true;
      const t = now();
      const recent = (hits.get(ip) || []).filter((at) => t - at < windowMs);
      const allowed = recent.length < limit;
      if (allowed) recent.push(t);
      hits.set(ip, recent);
      // Forget idle addresses now and then so the map stays small.
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((at) => t - at < windowMs)) hits.delete(k);
      return allowed;
    },
  };
}
