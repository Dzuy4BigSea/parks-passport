// Admin › Messages (SPEC Flow 20). Admins only; everyone else gets 404.
import {
  validateMessage, saveDraft, messageById, recipientIds, badgeIdsOf, reachCount, publishMessage, endMessage, deleteDraft,
  messagesForAdmin, stateOf, utcToZoned,
} from '../domain/messages.js';
import { listCities } from '../domain/city.js';
import { adminMessagesPage, adminMessageForm, adminMessagePage } from '../views/pages/messages.js';

export default async function messageRoutes(app) {
  const { db } = app;
  const now = () => app.now();
  const idOf = (req) => (/^\d+$/.test(req.params.id) ? Number(req.params.id) : null);
  const badges = () => db.prepare('SELECT id, slug, name, art FROM badges ORDER BY name COLLATE NOCASE').all();
  const usersById = (ids) => (ids.length
    ? db.prepare(`SELECT id, display_name FROM users WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY display_name COLLATE NOCASE`).all(...ids) : []);
  const tz = (req) => req.city.time_zone;
  const NOTICES = { published: 'Published. Members see it on their next page.', ended: 'Ended. Nobody else will see it.', deleted: 'Draft deleted.' };

  app.register(async (r) => {
    r.addHook('onRequest', async (req, reply) => {
      if (!req.user?.is_admin) return reply.callNotFound();
    });

    const formPage = (req, extra) => adminMessageForm({ csrf: req.csrfToken(), cities: listCities(db), badges: badges(), timeZone: tz(req), ...extra });
    const reviewPage = (req, m, notice = null) => adminMessagePage({
      csrf: req.csrfToken(), m: { ...m, seen: db.prepare('SELECT COUNT(*) FROM team_message_views WHERE message_id = ?').pluck().get(m.id) },
      state: stateOf(m, now()), reach: reachCount(db, m, { now: now() }), timeZone: tz(req), notice,
      badges: badgeIdsOf(m).map((id) => db.prepare('SELECT name, art FROM badges WHERE id = ?').get(id)).filter(Boolean),
      picked: usersById(recipientIds(db, m.id)),
    });

    r.get('/messages', async (req, reply) => reply.page(adminMessagesPage({
      csrf: req.csrfToken(), items: messagesForAdmin(db), now: now(), timeZone: tz(req), notice: NOTICES[req.query.done] || null,
    })));

    r.get('/messages/new', async (req, reply) => reply.page(formPage(req, {})));
    // From Admin › Members: the ticked members become the audience.
    r.post('/messages/compose', async (req, reply) => {
      const ids = [].concat(req.body.user_id || []).filter((v) => /^\d+$/.test(String(v))).map(Number);
      return reply.page(formPage(req, { picked: usersById(ids), values: { audience: ids.length ? 'picked' : 'everyone' } }));
    });

    const save = (req, reply, id) => {
      const result = validateMessage(db, req.body, { timeZone: tz(req) });
      const picked = usersById(result.userIds || result.values?.user_ids || []);
      if (result.errors) return reply.code(422).page(formPage(req, { id, values: result.values, errors: result.errors, picked }));
      const saved = saveDraft(db, { admin: req.user, id, message: result.message, userIds: result.userIds }, { now: now() });
      if (!saved) return reply.callNotFound();
      return reply.redirect(`/admin/messages/${saved}`, 303);
    };
    r.post('/messages', async (req, reply) => save(req, reply, null));

    r.get('/messages/:id', async (req, reply) => {
      const m = messageById(db, idOf(req));
      if (!m) return reply.callNotFound();
      return reply.page(reviewPage(req, m, NOTICES[req.query.done] || null));
    });
    r.get('/messages/:id/edit', async (req, reply) => {
      const m = messageById(db, idOf(req));
      if (!m || m.status !== 'draft') return reply.callNotFound();
      return reply.page(formPage(req, {
        id: m.id, picked: usersById(recipientIds(db, m.id)),
        values: {
          ...m, city: m.audience === 'city' ? m.audience_ref : '', badge: m.audience === 'badge' ? m.audience_ref : '',
          badge_ids: badgeIdsOf(m), starts_local: utcToZoned(m.starts_at, tz(req)), ends_local: utcToZoned(m.ends_at, tz(req)),
        },
      }));
    });
    r.post('/messages/:id', async (req, reply) => {
      const m = messageById(db, idOf(req));
      if (!m || m.status !== 'draft') return reply.callNotFound();
      return save(req, reply, m.id);
    });
    r.post('/messages/:id/publish', async (req, reply) => {
      const m = messageById(db, idOf(req));
      if (!m) return reply.callNotFound();
      if (req.body.confirm !== '1' || !publishMessage(db, m.id, { now: now() })) return reply.redirect(`/admin/messages/${m.id}`, 303);
      return reply.redirect(`/admin/messages/${m.id}?done=published`, 303);
    });
    r.post('/messages/:id/end', async (req, reply) => {
      const m = messageById(db, idOf(req));
      if (!m) return reply.callNotFound();
      endMessage(db, m.id, { now: now() });
      return reply.redirect(`/admin/messages/${m.id}?done=ended`, 303);
    });
    r.post('/messages/:id/delete', async (req, reply) => {
      const m = messageById(db, idOf(req));
      if (!m || !deleteDraft(db, m.id)) return reply.callNotFound();
      return reply.redirect('/admin/messages?done=deleted', 303);
    });
  }, { prefix: '/admin' });
}
