// Passport levels by total points. The one place to change names or thresholds.
export const LEVELS = [
  { name: 'Day Tripper', min: 0 },
  { name: 'Trail Finder', min: 50 },
  { name: 'Explorer', min: 150 },
  { name: 'Ranger', min: 400 },
  { name: 'Park Legend', min: 1000 },
];

/**
 * { index, name, min, next (level or null), toNext (points needed), progress (0..1 to next) }
 */
export function levelFor(points) {
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) if (points >= LEVELS[i].min) index = i;
  const level = LEVELS[index];
  const next = LEVELS[index + 1] || null;
  return {
    index,
    name: level.name,
    min: level.min,
    next,
    toNext: next ? next.min - points : 0,
    progress: next ? (points - level.min) / (next.min - level.min) : 1,
  };
}
