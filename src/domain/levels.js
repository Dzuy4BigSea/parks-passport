import { createLevels } from '../gamification/index.js';

// Passport levels by total points. The one place to change names or thresholds.
export const LEVELS = [
  { name: 'Day Tripper', min: 0 },
  { name: 'Trail Finder', min: 50 },
  { name: 'Explorer', min: 150 },
  { name: 'Ranger', min: 400 },
  { name: 'Park Legend', min: 1000 },
  // The long climb (SPEC Flow 7): each step about 1.5x the last.
  { name: 'Trailblazer', min: 1600 },
  { name: 'Pathfinder', min: 2500 },
  { name: 'Summit Seeker', min: 3800 },
  { name: 'Wayfinder', min: 5600 },
  { name: 'Grand Ranger', min: 8000 },
];

/**
 * { index, name, min, next (level or null), toNext (points needed), progress (0..1 to next) }
 */
export const levelFor = createLevels(LEVELS);
