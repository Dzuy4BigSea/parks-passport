const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

// Great-circle distance in meters (haversine).
export function distanceMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const metersToMiles = (m) => m / 1609.344;

// "1.3 mi", one decimal place.
export const formatMiles = (m) => `${metersToMiles(m).toFixed(1)} mi`;

// Parses a lat/lng pair from query strings; returns null unless both are valid.
export function parseLatLng(lat, lng) {
  const a = Number(lat);
  const b = Number(lng);
  if (lat === undefined || lng === undefined || lat === '' || lng === '') return null;
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lng: b };
}

// Walking under ~30 minutes (80 m a minute), otherwise a rough city drive time.
export function travelTime(meters) {
  const walk = Math.max(1, Math.round(meters / 80));
  if (walk <= 30) return `${walk} min walk`;
  return `${Math.max(2, Math.round(meters / 450))} min drive`;
}
