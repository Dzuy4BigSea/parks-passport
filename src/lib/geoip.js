import fs from 'node:fs';
import net from 'node:net';
import maxmind from 'maxmind';

// Rough visitor location from their IP address, for the home page's "nearest city" suggestion
// (SPEC Flow 13). Reads a MaxMind GeoLite2-City database file on this server: the IP is never
// sent anywhere, stored or logged, and only the city-level point is used. Off (null) without
// GEOIP_DB or when the file is missing.

// Loopback, private, link-local and unique-local addresses have no location.
const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^::1$/, /^f[cd]/i, /^fe80:/i];

export const isPublicIp = (ip) => net.isIP(ip) !== 0 && !PRIVATE.some((re) => re.test(ip));

/**
 * Opens the database. Returns { lookup(ip) -> { lat, lng } | null } or null when off.
 * `open` is injectable for tests.
 */
export async function createGeoIp({ file, log = null, open = (f) => maxmind.open(f, { watchForUpdates: false }) } = {}) {
  if (!file) return null;
  if (!fs.existsSync(file)) {
    log?.warn({ file }, 'GEOIP_DB is set but the file is missing; the nearest-city suggestion is off');
    return null;
  }
  const reader = await open(file);
  return {
    lookup(ip) {
      if (!isPublicIp(ip)) return null;
      try {
        const loc = reader.get(ip)?.location;
        return loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude) ? { lat: loc.latitude, lng: loc.longitude } : null;
      } catch {
        return null;
      }
    },
  };
}
