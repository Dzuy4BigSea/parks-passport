import crypto from 'node:crypto';
import { notify } from './notifications.js';
import { markMilestone } from './milestones.js';
import { awardBadges, revokeUnmetBadges } from './badges/index.js';

const pair = (a, b) => (a < b ? [a, b] : [b, a]);
const newToken = () => crypto.randomBytes(18).toString('base64url');

// The user's invite token, created on first use.
export function inviteTokenFor(db, userId, { now = new Date(), onCreate = () => {} } = {}) {
  const row = db.prepare('SELECT token FROM pal_invites WHERE user_id = ?').get(userId);
  if (row) return row.token;
  onCreate();
  const token = newToken();
  db.prepare('INSERT INTO pal_invites (user_id, token, created_at) VALUES (?, ?, ?)').run(userId, token, now.toISOString());
  return token;
}

// Replaces the user's invite token; the old link stops working.
export function regenerateInvite(db, userId, { now = new Date() } = {}) {
  const token = newToken();
  db.prepare(`INSERT INTO pal_invites (user_id, token, created_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, created_at = excluded.created_at`)
    .run(userId, token, now.toISOString());
  return token;
}

export const inviterForToken = (db, token) => (typeof token === 'string' && token.length <= 64
  ? db.prepare(`SELECT u.* FROM pal_invites i JOIN users u ON u.id = i.user_id WHERE i.token = ?`).get(token) || null
  : null);

/**
 * Accepts an invite: makes the two users pals (both directions) and checks badges for both.
 * Returns { ok } or { error: 'self' | 'already' }.
 */
export function acceptInvite(db, inviter, accepter, { now = new Date(), random = Math.random } = {}) {
  if (inviter.id === accepter.id) return { error: 'self' };
  return makePals(db, inviter.id, accepter.id, { now, random }) ? { ok: true } : { error: 'already' };
}

// Links two users (both directions), clears any requests between them and checks badges for
// both. Returns false if they were already pals.
function makePals(db, userId, otherId, { now = new Date(), random = Math.random } = {}) {
  const [a, b] = pair(userId, otherId);
  const linked = db.transaction(() => {
    const { changes } = db.prepare('INSERT OR IGNORE INTO pal_links (user_a, user_b, created_at) VALUES (?, ?, ?)')
      .run(a, b, now.toISOString());
    db.prepare('DELETE FROM pal_requests WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)').run(a, b, b, a);
    return changes > 0;
  })();
  if (!linked) return false;
  const names = new Map(db.prepare('SELECT id, display_name FROM users WHERE id IN (?, ?)').raw().all(a, b));
  for (const [me, other] of [[a, b], [b, a]]) {
    notify(db, me, { kind: 'pal_new', text: `You and ${names.get(other)} are now Park Pals.`, link: '/pals', actorId: other }, { now });
  }
  for (const id of [a, b]) markMilestone(db, id, 'pal', { now });
  for (const id of [a, b]) awardBadges(db, id, { type: 'pal', id: id === a ? b : a }, { now, random });
  return true;
}

// ---------- Friend codes and pal requests (SPEC Flow 8) ----------
// A code only lets someone ask; the code's owner decides. Codes are 8 characters from 31
// (no 0/O, 1/I/L): about 850 billion, and wrong guesses are limited per person.

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LIMITS = { failuresPerHour: 10, requestsPerDay: 20 };

function newCode() {
  return Array.from({ length: 8 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
}

/** "ABCD-EFGH" for display. */
export const formatCode = (code) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** What someone typed, as a stored code (or null): any case, spaces and dashes ignored. */
export function normalizeCode(input) {
  const code = String(input ?? '').toUpperCase().replace(/[\s-]+/g, '');
  return code.length === 8 && [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null;
}

// The user's friend code, created on first use.
export function friendCodeFor(db, userId, { now = new Date() } = {}) {
  const row = db.prepare('SELECT code FROM pal_codes WHERE user_id = ?').get(userId);
  return row ? row.code : regenerateFriendCode(db, userId, { now });
}

// Replaces the user's friend code; the old one stops working. Retries the rare collision.
export function regenerateFriendCode(db, userId, { now = new Date() } = {}) {
  for (;;) {
    const code = newCode();
    if (db.prepare('SELECT 1 FROM pal_codes WHERE code = ? AND user_id != ?').get(code, userId)) continue;
    db.prepare(`INSERT INTO pal_codes (user_id, code, created_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET code = excluded.code, created_at = excluded.created_at`).run(userId, code, now.toISOString());
    return code;
  }
}

/**
 * Sends a pal request to the owner of a code. Returns { sent, to } or { paired, to } (they had
 * already asked me, so we're pals now) or { error, to? }:
 * 'limited' | 'format' | 'invalid' | 'self' | 'already' | 'pending' | 'daily'.
 */
export function requestByCode(db, user, input, { now = new Date(), random = Math.random } = {}) {
  const hourAgo = new Date(now.getTime() - 3600e3).toISOString();
  db.prepare('DELETE FROM pal_code_failures WHERE at < ?').run(hourAgo);
  if (db.prepare('SELECT COUNT(*) FROM pal_code_failures WHERE user_id = ?').pluck().get(user.id) >= CODE_LIMITS.failuresPerHour) {
    return { error: 'limited' };
  }
  const code = normalizeCode(input);
  if (!code) return { error: 'format' }; // not a code at all: no lookup, so not a guess
  const to = db.prepare(`SELECT u.id, u.display_name, u.handle FROM pal_codes c JOIN users u ON u.id = c.user_id
    WHERE c.code = ?`).get(code);
  if (!to) {
    db.prepare('INSERT INTO pal_code_failures (user_id, at) VALUES (?, ?)').run(user.id, now.toISOString());
    return { error: 'invalid' };
  }
  if (to.id === user.id) return { error: 'self' };
  if (areLinked(db, user.id, to.id)) return { error: 'already', to };
  // They asked me first: entering their code is a yes.
  if (db.prepare('SELECT 1 FROM pal_requests WHERE from_user = ? AND to_user = ?').get(to.id, user.id)) {
    makePals(db, user.id, to.id, { now, random });
    return { paired: true, to };
  }
  if (db.prepare('SELECT 1 FROM pal_requests WHERE from_user = ? AND to_user = ?').get(user.id, to.id)) return { error: 'pending', to };
  // Counted from a log that cancel, decline and accept never shorten.
  const dayAgo = new Date(now.getTime() - 86400e3).toISOString();
  db.prepare('DELETE FROM pal_request_sends WHERE at < ?').run(dayAgo);
  if (db.prepare('SELECT COUNT(*) FROM pal_request_sends WHERE user_id = ?').pluck().get(user.id) >= CODE_LIMITS.requestsPerDay) {
    return { error: 'daily' };
  }
  db.transaction(() => {
    db.prepare('INSERT INTO pal_requests (from_user, to_user, created_at) VALUES (?, ?, ?)').run(user.id, to.id, now.toISOString());
    db.prepare('INSERT INTO pal_request_sends (user_id, at) VALUES (?, ?)').run(user.id, now.toISOString());
    notify(db, to.id, { kind: 'pal_request', text: `${user.display_name} wants to be Park Pals.`, link: '/pals#requests', actorId: user.id }, { now });
  })();
  return { sent: true, to };
}

const areLinked = (db, x, y) => {
  const [a, b] = pair(x, y);
  return Boolean(db.prepare('SELECT 1 FROM pal_links WHERE user_a = ? AND user_b = ?').get(a, b));
};

/** Requests to me and from me, newest first, with the other person's name and handle. */
export function palRequests(db, userId) {
  const q = (col, other) => db.prepare(`SELECT r.id, r.created_at, u.display_name, u.handle FROM pal_requests r
    JOIN users u ON u.id = r.${other} WHERE r.${col} = ? ORDER BY r.created_at DESC, r.id DESC`).all(userId);
  return { incoming: q('to_user', 'from_user'), outgoing: q('from_user', 'to_user') };
}

/** Accepts or declines a request sent to me. Returns { ok, from } or null if it isn't mine. */
export function answerRequest(db, userId, requestId, accept, { now = new Date(), random = Math.random } = {}) {
  const r = db.prepare(`SELECT r.*, u.display_name FROM pal_requests r JOIN users u ON u.id = r.from_user
    WHERE r.id = ? AND r.to_user = ?`).get(requestId, userId);
  if (!r) return null;
  if (accept) makePals(db, userId, r.from_user, { now, random });
  else db.prepare('DELETE FROM pal_requests WHERE id = ?').run(r.id);
  return { ok: true, from: r.display_name };
}

/** Withdraws a request I sent. */
export const cancelRequest = (db, userId, requestId) =>
  db.prepare('DELETE FROM pal_requests WHERE id = ? AND from_user = ?').run(requestId, userId).changes > 0;

// Removes a pal. The remover's invite link is renewed so the removed pal can't simply re-accept it.
export function removePal(db, userId, palId, { now = new Date() } = {}) {
  const [a, b] = pair(userId, palId);
  const { changes } = db.prepare('DELETE FROM pal_links WHERE user_a = ? AND user_b = ?').run(a, b);
  if (changes) {
    regenerateInvite(db, userId, { now });
    for (const id of [userId, palId]) revokeUnmetBadges(db, id);
  }
  return changes > 0;
}

export const palIdsOf = (db, userId) => db.prepare(`SELECT user_b FROM pal_links WHERE user_a = ?
  UNION SELECT user_a FROM pal_links WHERE user_b = ?`).pluck().all(userId, userId);

export const palsOf = (db, userId) => db.prepare(`SELECT u.id, u.display_name, u.handle, u.default_visibility, u.avatar_key
  FROM users u WHERE u.id IN (SELECT user_b FROM pal_links WHERE user_a = ? UNION SELECT user_a FROM pal_links WHERE user_b = ?)
  ORDER BY u.display_name COLLATE NOCASE`).all(userId, userId);

// Pals who stamped this park on this day (for "Better Together" in either order).
export const palsAtParkOnDay = (db, userId, parkId, day) => db.prepare(`SELECT DISTINCT v.user_id FROM visits v
  WHERE v.park_id = ? AND v.visited_on = ? AND v.user_id IN
    (SELECT user_b FROM pal_links WHERE user_a = ? UNION SELECT user_a FROM pal_links WHERE user_b = ?)`)
  .pluck().all(parkId, day, userId, userId);

/**
 * Leaderboard: me plus pals whose passport I can see (pals or public), ranked by unique parks
 * stamped, then points.
 */
export function leaderboard(db, userId) {
  return db.prepare(`SELECT u.id, u.display_name, u.handle, u.avatar_key,
      (SELECT COUNT(DISTINCT park_id) FROM visits v WHERE v.user_id = u.id) AS parks,
      (SELECT COALESCE(SUM(points), 0) FROM point_events pe WHERE pe.user_id = u.id) AS points
    FROM users u
    WHERE u.id = ? OR (u.default_visibility IN ('pals', 'public') AND u.id IN
      (SELECT user_b FROM pal_links WHERE user_a = ? UNION SELECT user_a FROM pal_links WHERE user_b = ?))
    ORDER BY parks DESC, points DESC, u.display_name COLLATE NOCASE`).all(userId, userId, userId);
}

/**
 * Pals feed, newest first: stamps and badges from pals whose passport I can see, and pals'
 * photos whose own visibility is pals or public (and not hidden). page is 1-based.
 * Returns { items, hasMore }.
 */
export const FEED_PAGE_SIZE = 20;
export function palsFeed(db, userId, { page = 1 } = {}) {
  const offset = (Math.max(1, page) - 1) * FEED_PAGE_SIZE;
  const rows = db.prepare(`WITH visible AS (
      SELECT u.id FROM users u WHERE u.default_visibility IN ('pals', 'public') AND u.id IN
        (SELECT user_b FROM pal_links WHERE user_a = @me UNION SELECT user_a FROM pal_links WHERE user_b = @me))
    SELECT 'stamp' AS type, v.created_at AS at, v.user_id, v.visited_on, v.method,
           p.name AS park_name, p.slug AS park_slug, (SELECT key FROM city_themes WHERE id = p.city_id) AS city_key, NULL AS badge_name, NULL AS badge_art,
           NULL AS photo_id, NULL AS caption
      FROM visits v JOIN parks p ON p.id = v.park_id WHERE v.user_id IN (SELECT id FROM visible)
    UNION ALL
    SELECT 'badge', ub.awarded_at, ub.user_id, NULL, NULL, NULL, NULL, NULL, b.name, b.art, NULL, NULL
      FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id IN (SELECT id FROM visible)
    UNION ALL
    SELECT 'photo', ph.created_at, ph.user_id, NULL, NULL, p.name, p.slug, (SELECT key FROM city_themes WHERE id = p.city_id), NULL, NULL, ph.id, ph.caption
      FROM photos ph JOIN parks p ON p.id = ph.park_id
      WHERE ph.visibility IN ('pals', 'public') AND ph.hidden = 0 AND ph.user_id IN
        (SELECT user_b FROM pal_links WHERE user_a = @me UNION SELECT user_a FROM pal_links WHERE user_b = @me)
    ORDER BY at DESC LIMIT @limit OFFSET @offset`).all({ me: userId, limit: FEED_PAGE_SIZE + 1, offset });
  const users = new Map();
  const userOf = (id) => {
    if (!users.has(id)) users.set(id, db.prepare('SELECT id, display_name, handle, avatar_key, default_visibility FROM users WHERE id = ?').get(id));
    return users.get(id);
  };
  return {
    items: rows.slice(0, FEED_PAGE_SIZE).map((r) => ({ ...r, user: userOf(r.user_id) })),
    hasMore: rows.length > FEED_PAGE_SIZE,
  };
}

/**
 * "Your pals were here": for each park in parkIds, the pals who stamped it, most recent first.
 * Only pals who share their passport (pals or public) count, the same rule as the feed, so a
 * private pal's visits never show. Returns Map<park_id, [{ id, display_name, handle, avatar_key,
 * default_visibility, last_on }]>. No coordinates or other private fields.
 */
export function palsWhoStamped(db, userId, parkIds) {
  const out = new Map();
  if (!userId || !parkIds.length) return out;
  const rows = db.prepare(`SELECT v.park_id, u.id, u.display_name, u.handle, u.avatar_key, u.default_visibility,
      MAX(v.visited_on) AS last_on
    FROM visits v JOIN users u ON u.id = v.user_id
    WHERE v.park_id IN (${parkIds.map(() => '?').join(',')})
      AND u.default_visibility IN ('pals', 'public')
      AND u.id IN (SELECT user_b FROM pal_links WHERE user_a = ? UNION SELECT user_a FROM pal_links WHERE user_b = ?)
    GROUP BY v.park_id, u.id ORDER BY last_on DESC, u.display_name COLLATE NOCASE`).all(...parkIds, userId, userId);
  for (const r of rows) {
    if (!out.has(r.park_id)) out.set(r.park_id, []);
    out.get(r.park_id).push(r);
  }
  return out;
}
