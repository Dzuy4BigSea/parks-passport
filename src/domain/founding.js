import { notify } from './notifications.js';
import { nextSerial } from './badges/index.js';

// Founding Members (SPEC Flow 16): the first 75 accounts get the badge automatically, numbered in
// sign-up order. A counter in settings (not a count of current holders) decides who's next, so a
// deleted account never hands its number on. After 75, admins give it by hand (Admin › Members),
// without a number. Stored as a given badge (source_type 'grant', no admin), so the rules never
// take it back.

export const FOUNDING_SLUG = 'founding-member';
export const FOUNDING_LIMIT = 75;
const KEY = 'founding_awarded';
const BACKFILLED = 'founding_backfilled'; // the start-up backfill runs once, so a taken-back badge stays taken back
// Holding either of these unlocks the feedback button.
export const EARLY_BIRD_SLUG = 'early-bird-100';
export const FEEDBACK_BADGES = [FOUNDING_SLUG, EARLY_BIRD_SLUG];

const awardedSoFar = (db) => Number(db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(KEY) || 0);

/** Gives the next numbered Founding Member badge to this member, while numbers last. Returns the number or null. */
export function awardFounding(db, userId, { now = new Date() } = {}) {
  const badge = db.prepare('SELECT id, name FROM badges WHERE slug = ?').get(FOUNDING_SLUG);
  if (!badge) return null;
  return db.transaction(() => {
    const n = awardedSoFar(db);
    if (n >= FOUNDING_LIMIT) return null;
    if (db.prepare('SELECT 1 FROM user_badges WHERE user_id = ? AND badge_id = ?').get(userId, badge.id)) return null;
    const serial = n + 1;
    db.prepare(`INSERT INTO user_badges (user_id, badge_id, awarded_at, source_type, source_id, serial)
      VALUES (?, ?, ?, 'grant', NULL, ?)`).run(userId, badge.id, now.toISOString(), serial);
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(KEY, String(serial), now.toISOString());
    notify(db, userId, {
      kind: 'gift', text: `Welcome, Founding Member #${serial}! You're one of the first ${FOUNDING_LIMIT} explorers. Tell us anything with the Feedback button.`,
      link: '/passport#badges',
    }, { now });
    return serial;
  })();
}

/** At start: members who joined before this existed get their numbers, oldest first. Returns how many. */
export function backfillFounding(db, { now = new Date() } = {}) {
  if (!db.prepare("SELECT 1 FROM badges WHERE slug = ?").get(FOUNDING_SLUG)) return 0; // seeded first
  if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(BACKFILLED)) return 0;
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(BACKFILLED, '1', now.toISOString());
  if (awardedSoFar(db) >= FOUNDING_LIMIT) return 0;
  let given = 0;
  for (const id of db.prepare('SELECT id FROM users ORDER BY created_at, id').pluck().all()) {
    if (awardedSoFar(db) >= FOUNDING_LIMIT) break;
    if (awardFounding(db, id, { now })) given += 1;
  }
  return given;
}

/** Whether this member holds Founding Member or Early Bird Edition (and so sees the feedback button). */
export function canSendFeedback(db, userId) {
  if (!userId) return false;
  return Boolean(db.prepare(`SELECT 1 FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ? AND b.slug IN (${FEEDBACK_BADGES.map(() => '?').join(', ')}) LIMIT 1`).get(userId, ...FEEDBACK_BADGES));
}

/**
 * Early Bird Edition: every new member gets the next number (lowest free, like an admin's gift)
 * until all of its limited copies are given. Returns the number or null.
 */
export function awardEarlyBird(db, userId, { now = new Date() } = {}) {
  const badge = db.prepare('SELECT id, name, limited_count FROM badges WHERE slug = ?').get(EARLY_BIRD_SLUG);
  if (!badge?.limited_count) return null;
  return db.transaction(() => {
    if (db.prepare('SELECT 1 FROM user_badges WHERE user_id = ? AND badge_id = ?').get(userId, badge.id)) return null;
    const serial = nextSerial(db, badge.id);
    if (serial > badge.limited_count) return null;
    db.prepare(`INSERT INTO user_badges (user_id, badge_id, awarded_at, source_type, source_id, serial)
      VALUES (?, ?, ?, 'grant', NULL, ?)`).run(userId, badge.id, now.toISOString(), serial);
    notify(db, userId, { kind: 'gift', text: `You're Early Bird #${serial} of ${badge.limited_count}. Welcome to Parks Passport!`, link: '/passport#badges' }, { now });
    return serial;
  })();
}
