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

// Group invites and join requests can be answered right here while they're open (SPEC Flow 23).
// The group comes from the notification's own link, which the server wrote.
const actorOf = (db, id) => db.prepare('SELECT actor_id FROM notifications WHERE id = ?').pluck().get(id);
function withGroupAction(db, userId, n) {
  if (n.kind === 'group_invite') {
    const groupId = Number(/^\/groups\?invite=(\d+)#invites$/.exec(n.link)?.[1]) || null;
    if (!groupId) return n; // older notifications: just the link
    const open = Boolean(db.prepare('SELECT 1 FROM group_invites WHERE group_id = ? AND to_user = ?').get(groupId, userId));
    const member = Boolean(db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId));
    return { ...n, group: { kind: 'invite', id: groupId, open, member } };
  }
  if (n.kind === 'group_request') {
    const groupId = Number(/^\/groups\/(\d+)#requests$/.exec(n.link)?.[1]) || null;
    const requester = actorOf(db, n.id);
    if (!groupId || !requester) return n;
    const owner = Boolean(db.prepare('SELECT 1 FROM member_groups WHERE id = ? AND owner_id = ?').get(groupId, userId));
    const open = owner && Boolean(db.prepare('SELECT 1 FROM group_requests WHERE group_id = ? AND user_id = ?').get(groupId, requester));
    const member = Boolean(db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, requester));
    return { ...n, group: { kind: 'request', id: groupId, userId: requester, open, member } };
  }
  return n;
}

/** A page of notifications, newest first: { items, hasMore }. */
export function listNotifications(db, userId, { page = 1 } = {}) {
  // A pal request carries its open request (if it's still open), so it can be answered right here.
  const rows = db.prepare(`SELECT n.id, n.kind, n.text, n.link, n.created_at, n.read_at, a.display_name AS actor,
      CASE WHEN n.kind = 'pal_request' THEN (SELECT r.id FROM pal_requests r WHERE r.from_user = n.actor_id AND r.to_user = n.user_id) END AS request_id,
      CASE WHEN n.kind = 'pal_request' THEN EXISTS (SELECT 1 FROM pal_links l WHERE (l.user_a = n.actor_id AND l.user_b = n.user_id)
        OR (l.user_b = n.actor_id AND l.user_a = n.user_id)) END AS now_pals
    FROM notifications n LEFT JOIN users a ON a.id = n.actor_id WHERE n.user_id = ?
    ORDER BY n.id DESC LIMIT ? OFFSET ?`).all(userId, PAGE_SIZE + 1, (Math.max(1, page) - 1) * PAGE_SIZE);
  // The other member's name as it is now (they may have changed it since).
  const items = rows.slice(0, PAGE_SIZE).map(({ actor, ...n }) => withGroupAction(db, userId, { ...n, text: n.text.replace('{actor}', actor || 'Someone') }));
  return { items, hasMore: rows.length > PAGE_SIZE };
}

export const markAllRead = (db, userId, { now = new Date() } = {}) =>
  db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now.toISOString(), userId).changes;
