// Reactions between Park Pals (SPEC Flow 26). A pal taps one of five reactions on a stamp, badge or
// photo they can see in the Pals feed; tapping again takes it back. The owner gets one grouped
// notification per item ("Ana and 2 others reacted 🎉 to your stamp at Crescent Lake Park").
import { notify } from './notifications.js';

export const REACTIONS = {
  party: { emoji: '🎉', label: 'Nice one' },
  tree: { emoji: '🌳', label: 'Love this park' },
  fire: { emoji: '🔥', label: 'On fire' },
  clap: { emoji: '👏', label: 'Bravo' },
  sun: { emoji: '☀️', label: 'Sunshine' },
};
export const TARGETS = ['visit', 'badge', 'photo'];

const pair = (x, y) => (x < y ? [x, y] : [y, x]);
const arePals = (db, x, y) => {
  const [a, b] = pair(x, y);
  return Boolean(db.prepare('SELECT 1 FROM pal_links WHERE user_a = ? AND user_b = ?').get(a, b));
};

/**
 * The item a pal may react to, or null: it must exist and be shown to them in the Pals feed (their
 * pal's stamps and badges while that pal shares their passport; photos shared with pals or anyone).
 * Returns { ownerId, what, link } for the notification.
 */
export function reactable(db, userId, type, id, ownerIdForBadge = null) {
  const item = itemOf(db, type, id, ownerIdForBadge);
  if (!item || !item.shared || item.ownerId === userId || !arePals(db, userId, item.ownerId)) return null;
  return { ownerId: item.ownerId, what: item.what, link: item.link };
}

// The item behind a reaction: its owner, whether it's shared with pals, and how to name it.
function itemOf(db, type, id, ownerIdForBadge) {
  let item = null;
  if (type === 'visit') {
    item = db.prepare(`SELECT v.user_id AS ownerId, u.default_visibility AS vis, p.name AS park, p.slug, c.key AS city
      FROM visits v JOIN users u ON u.id = v.user_id JOIN parks p ON p.id = v.park_id JOIN city_themes c ON c.id = p.city_id WHERE v.id = ?`).get(id);
    if (item) item = { ...item, what: `your stamp at ${item.park}`, link: `/${item.city}/parks/${item.slug}`, shared: item.vis !== 'private' };
  } else if (type === 'photo') {
    item = db.prepare(`SELECT ph.user_id AS ownerId, ph.visibility AS vis, ph.hidden, p.name AS park, p.slug, c.key AS city
      FROM photos ph JOIN parks p ON p.id = ph.park_id JOIN city_themes c ON c.id = p.city_id WHERE ph.id = ?`).get(id);
    if (item) item = { ...item, what: `your photo of ${item.park}`, link: `/${item.city}/parks/${item.slug}#photos`, shared: item.vis !== 'private' && !item.hidden };
  } else if (type === 'badge' && ownerIdForBadge) {
    item = db.prepare(`SELECT ub.user_id AS ownerId, u.default_visibility AS vis, b.name AS badge
      FROM user_badges ub JOIN users u ON u.id = ub.user_id JOIN badges b ON b.id = ub.badge_id WHERE ub.badge_id = ? AND ub.user_id = ?`).get(id, ownerIdForBadge);
    if (item) item = { ...item, what: `your ${item.badge} badge`, link: '/passport#badges', shared: item.vis !== 'private' };
  }
  return item;
}

/**
 * Toggles one reaction. Returns { on, counts, mine } or null if this pal can't react to it.
 * Adding one refreshes the owner's grouped notification for the item (newest on top).
 */
export function toggleReaction(db, userId, { type, id, reaction, owner = null }, { now = new Date() } = {}) {
  if (!TARGETS.includes(type) || !Object.hasOwn(REACTIONS, reaction) || !Number.isInteger(id)) return null;
  const item = reactable(db, userId, type, id, owner);
  if (!item) return null;
  const key = [type, id, item.ownerId, userId, reaction];
  const had = db.prepare(`SELECT 1 FROM reactions WHERE target_type = ? AND target_id = ? AND owner_id = ? AND user_id = ? AND reaction = ?`).get(...key);
  db.transaction(() => {
    if (had) {
      db.prepare('DELETE FROM reactions WHERE target_type = ? AND target_id = ? AND owner_id = ? AND user_id = ? AND reaction = ?').run(...key);
    } else {
      db.prepare('INSERT INTO reactions (target_type, target_id, owner_id, user_id, reaction, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(...key, now.toISOString());
      groupedNotice(db, item, { type, id }, now);
    }
  })();
  const summary = reactionsFor(db, userId, [{ type, id, ownerId: item.ownerId }]).get(refOf(type, id, item.ownerId));
  return { on: !had, ownerId: item.ownerId, ...summary };
}

const refOf = (type, id, ownerId) => `${type}:${id}:${ownerId}`;

// One notification per item: replaced (so it moves to the top, unread) each time a reaction is added.
// It has no actor_id, so it outlives any one reactor's account; its text is rebuilt from the
// reactions there now each time it's shown (reactionNoticeText), and a database trigger removes
// it once none are left (migration 034).
function groupedNotice(db, item, { type, id }, now) {
  const ref = `reaction:${refOf(type, id, item.ownerId)}`;
  db.prepare('DELETE FROM notifications WHERE user_id = ? AND ref = ?').run(item.ownerId, ref);
  notify(db, item.ownerId, { kind: 'reaction', text: reactionNoticeText(db, ref) || '', link: item.link, ref }, { now });
}

/** "Ana and 2 others reacted 🎉🌳 to your stamp at A Park." as things stand now; null if none are left. */
export function reactionNoticeText(db, ref) {
  const m = /^reaction:(visit|badge|photo):(\d+):(\d+)$/.exec(String(ref));
  if (!m) return null;
  const [type, id, ownerId] = [m[1], Number(m[2]), Number(m[3])];
  const where = 'target_type = ? AND target_id = ? AND owner_id = ?';
  const latest = db.prepare(`SELECT u.display_name FROM reactions r JOIN users u ON u.id = r.user_id WHERE ${where.replace(/(\w+) =/g, 'r.$1 =')}
    ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`).pluck().get(type, id, ownerId);
  const item = itemOf(db, type, id, ownerId);
  if (!latest || !item) return null;
  const people = db.prepare(`SELECT COUNT(DISTINCT user_id) FROM reactions WHERE ${where}`).pluck().get(type, id, ownerId);
  const emoji = db.prepare(`SELECT reaction FROM reactions WHERE ${where} GROUP BY reaction ORDER BY COUNT(*) DESC, MIN(created_at)`)
    .pluck().all(type, id, ownerId).map((r) => REACTIONS[r].emoji).join('');
  const others = people - 1;
  return `${latest}${others > 0 ? ` and ${others} other${others === 1 ? '' : 's'}` : ''} reacted ${emoji} to ${item.what}.`;
}

/**
 * Counts and my own reactions for feed items: Map(ref → { counts: { party: 2, … }, mine: Set }).
 * items = [{ type, id, ownerId }].
 */
export function reactionsFor(db, userId, items) {
  const out = new Map();
  const q = db.prepare('SELECT reaction, user_id FROM reactions WHERE target_type = ? AND target_id = ? AND owner_id = ?');
  for (const it of items) {
    const counts = {};
    const mine = new Set();
    for (const r of q.all(it.type, it.id, it.ownerId)) {
      counts[r.reaction] = (counts[r.reaction] || 0) + 1;
      if (r.user_id === userId) mine.add(r.reaction);
    }
    out.set(refOf(it.type, it.id, it.ownerId), { counts, mine });
  }
  return out;
}

export const reactionRef = refOf;
