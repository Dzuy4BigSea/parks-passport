import { requireUser } from '../lib/auth.js';
import { listNotifications, markAllRead } from '../domain/notifications.js';
import { notificationsPage } from '../views/pages/notifications.js';

export default async function notificationRoutes(app) {
  const { db } = app;
  // Opening the list marks everything read (the ones that were unread still say "New" this time).
  app.get('/notifications', { preHandler: requireUser }, async (req, reply) => {
    const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.page, 10) || 1));
    const { items, hasMore } = listNotifications(db, req.user.id, { page });
    const unreadIds = new Set(items.filter((n) => !n.read_at).map((n) => n.id));
    if (req.method === 'GET') markAllRead(db, req.user.id, { now: app.now() });
    return reply.page(notificationsPage({ items, page, hasMore, unreadIds, timeZone: req.city.time_zone }));
  });
}
