import { requireUser } from '../lib/auth.js';
import { canSendFeedback } from '../domain/founding.js';
import { sendFeedback, allFeedback, setFeedbackDone } from '../domain/feedback.js';
import { feedbackPage, adminFeedbackPage } from '../views/pages/community.js';

// Community features: feedback from founding explorers (SPEC Flow 16). Pages that aren't for this
// member 404 (never 403).
export default async function communityRoutes(app) {
  const { db } = app;
  const now = () => app.now();
  const idOf = (req) => (/^\d+$/.test(req.params.id) ? Number(req.params.id) : null);

  // ---------- Feedback (Founding Members and Early Bird Edition holders) ----------
  const feedbackOnly = { preHandler: [requireUser, async (req, reply) => { if (!canSendFeedback(db, req.user.id)) return reply.callNotFound(); }] };
  const wantsJson = (req) => String(req.headers.accept || '').includes('application/json');

  app.get('/feedback', feedbackOnly, async (req, reply) => reply.page(feedbackPage({
    csrf: req.csrfToken(), page: typeof req.query.from === 'string' ? req.query.from : '', sent: req.query.done === 'sent',
  })));
  app.post('/feedback', feedbackOnly, async (req, reply) => {
    const result = sendFeedback(db, req.user.id, req.body, { now: now() });
    if (wantsJson(req)) return reply.code(result.error ? 422 : 200).send(result.error ? { error: result.error } : { ok: true });
    if (result.error) {
      return reply.code(422).page(feedbackPage({ csrf: req.csrfToken(), page: req.body.page, error: result.error, values: result.values }));
    }
    return reply.redirect('/feedback?done=sent', 303);
  });

  // ---------- Admin ----------
  app.register(async (admin) => {
    admin.addHook('onRequest', async (req, reply) => {
      if (!req.user?.is_admin) return reply.callNotFound();
    });
    admin.get('/feedback', async (req, reply) => {
      const done = req.query.show === 'done';
      return reply.page(adminFeedbackPage({ csrf: req.csrfToken(), items: allFeedback(db, { done }), done }));
    });
    admin.post('/feedback/:id', async (req, reply) => {
      const id = idOf(req);
      if (!id || !setFeedbackDone(db, id, req.body.done === '1', { now: now() })) return reply.callNotFound();
      return reply.redirect(`/admin/feedback${req.body.done === '1' ? '' : '?show=done'}`, 303);
    });
  }, { prefix: '/admin' });
}
