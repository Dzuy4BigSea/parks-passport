import { distanceMeters } from './geo.js';

export const MAX_ACCURACY_ALLOWANCE_M = 100;

/**
 * Whether a reported position counts as being at the park: within the park's check-in radius
 * plus the reported accuracy, with the accuracy allowance capped at 100 m.
 */
export function evaluateCheckin(park, { lat, lng, accuracy }) {
  if (park.lat == null || park.lng == null) return { ok: false, reason: 'no_location' };
  const distance = distanceMeters({ lat, lng }, park);
  const allowance = Math.min(Math.max(Number(accuracy) || 0, 0), MAX_ACCURACY_ALLOWANCE_M);
  return { ok: distance <= park.checkin_radius_m + allowance, distance_m: distance };
}

// Parses lat/lng/accuracy from a form; null unless valid.
export function parsePosition(body) {
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const accuracy = Number(body.accuracy);
  if (![lat, lng].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : 0 };
}
