// Notification center (SPEC Flow 8): a member's own list of what happened to them, newest first,
// behind the bell in the header. In the app only (no email or push). Private to the member.
// Text is written here, by the server; links are paths in this app. A notification that names
// another member (actor_id) goes away if that member deletes their account.

export const KEEP = 200; // per member; older ones are dropped

export function notify(db, userId, { kind, text, link = '', actorId = null }, { now = new Date() } = {}) {
  if (!userId) return;
  db.prepare(`INSERT INTO notifications (user_id, kind, text, link, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId, kind, String(text).slice(0, 300), link, actorId, now.toISOString());
  db.prepare(`DELETE FROM notifications WHERE user_id = ? AND id NOT IN
    (SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?)`).run(userId, userId, KEEP);
}

export const unreadCount = (db, userId) => db.prepare('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL').pluck().get(userId);

export const PAGE_SIZE = 30;

/** A page of notifications, newest first: { items, hasMore }. */
export function listNotifications(db, userId, { page = 1 } = {}) {
  const rows = db.prepare(`SELECT id, kind, text, link, created_at, read_at FROM notifications WHERE user_id = ?
    ORDER BY id DESC LIMIT ? OFFSET ?`).all(userId, PAGE_SIZE + 1, (Math.max(1, page) - 1) * PAGE_SIZE);
  return { items: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

export const markAllRead = (db, userId, { now = new Date() } = {}) =>
  db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now.toISOString(), userId).changes;
