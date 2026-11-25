// Today's weather for a city (SPEC Flow 22: Gary dresses for it), from Open-Meteo (no key). Only a
// city's center is ever sent, never a member's location. Pages never wait for it: `current(city)`
// answers from a one-hour cache and refreshes in the background, so the first page after a quiet
// hour shows Classic Gary and the next one the weather outfit. Errors and slow answers (2 s) just
// leave the cache as it was.

export const CONDITIONS = { rain: 'rainy', snow: 'snowy', cold: 'cold', hot: 'hot', mild: 'mild' };

/** Open-Meteo's WMO weather code and the temperature (°F) -> rain | snow | cold | hot | mild. */
export function conditionFrom({ code, tempF }) {
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
  if (tempF <= 45) return 'cold';
  if (tempF >= 85) return 'hot';
  return 'mild';
}

export function createWeather({ fetch = globalThis.fetch, now = () => new Date(), ttlMs = 3600e3, timeoutMs = 2000, log = null } = {}) {
  const cache = new Map(); // city key -> { at, value, pending }

  async function load(city) {
    const { lat, lng } = city.center;
    const q = new URLSearchParams({ latitude: lat.toFixed(3), longitude: lng.toFixed(3), current: 'temperature_2m,weather_code', temperature_unit: 'fahrenheit', timezone: 'auto' });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'parks-passport' } });
    if (!res.ok) throw new Error(`weather HTTP ${res.status}`);
    const data = await res.json();
    const tempF = Number(data?.current?.temperature_2m);
    const code = Number(data?.current?.weather_code);
    if (!Number.isFinite(tempF) || !Number.isFinite(code)) throw new Error('weather: unexpected answer');
    return { condition: conditionFrom({ code, tempF }), tempF: Math.round(tempF), code };
  }

  /** Fetches now and caches it (resolves to the value, or null on any failure). */
  async function refresh(city) {
    if (!city?.key || !city.center) return null;
    const entry = cache.get(city.key) || {};
    if (entry.pending) return entry.pending;
    entry.pending = load(city)
      .then((value) => { cache.set(city.key, { at: now().getTime(), value }); return value; })
      .catch((err) => { log?.warn?.({ city: city.key, err: err.message }, 'weather unavailable'); cache.set(city.key, { ...entry, pending: null, at: now().getTime() }); return null; });
    cache.set(city.key, entry);
    return entry.pending;
  }

  return {
    refresh,
    /** The cached weather ({ condition, tempF } or null), refreshed in the background when stale. */
    current(city) {
      if (!city?.key || !city.center) return null;
      const entry = cache.get(city.key);
      if (!entry || (!entry.pending && now().getTime() - (entry.at || 0) > ttlMs)) refresh(city);
      return entry?.value || null;
    },
  };
}
