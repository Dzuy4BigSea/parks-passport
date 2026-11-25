// First-time actions ("milestones") for the surprise badges (SPEC Flow 7, "Reward schedule"):
// the first park page you open, your first profile photo, pal, rating or photo, and planning a
// trip late at night. Each is recorded once per member; the first time also checks badges, so a
// hidden badge can pop up right then. Only the action and when: no park, place or content.
import { awardBadges } from './badges/index.js';

export const MILESTONES = {
  park_view: 'Opened a park page',
  avatar: 'Added a profile photo',
  pal: 'Made a Park Pal',
  rating: 'Rated a park',
  photo: 'Shared a park photo',
  night_plan: 'Looked at parks between 9 pm and 4 am',
};

/** Marks a first-time action without checking badges (for callers that check right after). */
export function markMilestone(db, userId, action, { now = new Date() } = {}) {
  if (!userId || !Object.hasOwn(MILESTONES, action)) return false;
  return db.prepare('INSERT OR IGNORE INTO user_milestones (user_id, action, first_at) VALUES (?, ?, ?)')
    .run(userId, action, now.toISOString()).changes > 0;
}

/** Records a first-time action. Returns the badges it awarded ([] if it wasn't the first time). */
export function recordMilestone(db, userId, action, { now = new Date(), random = Math.random } = {}) {
  if (!userId || !Object.hasOwn(MILESTONES, action)) return [];
  const { changes } = db.prepare('INSERT OR IGNORE INTO user_milestones (user_id, action, first_at) VALUES (?, ?, ?)')
    .run(userId, action, now.toISOString());
  return changes ? awardBadges(db, userId, { type: 'milestone', id: null }, { now, random }) : [];
}

/** Whether `now` is between 9 pm and 4 am in a time zone (late-night trip planning). */
export function isNight(now, timeZone) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  return hour >= 21 || hour < 4;
}
