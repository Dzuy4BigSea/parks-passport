import {
  canUseIdeas, isSuperAdmin, submitIdea, myIdeas, listContributors, addContributor, removeContributor, allIdeas, ideaCounts,
  openIdeas, triageIdea, applySuggestion, exportBrief, STATUSES,
} from '../domain/ideas.js';
import { ideaJob, startIdeaJob } from '../domain/idea-job.js';
import { createInvite } from '../domain/invites.js';
import { findUserByEmail, normalizeEmail } from '../domain/users.js';
import { emailCopy } from '../domain/email-copy.js';
import { memberEmail } from '../views/email.js';
import { ideasPage, adminIdeasPage } from '../views/pages/ideas.js';

// Badge ideas (SPEC Flow 13). Everything 404s for people without access (never 403).
export default async function ideaRoutes(app) {
  const { db } = app;
  const now = () => app.now();
  const idOf = (req) => (/^\d+$/.test(req.params.id) ? Number(req.params.id) : null);

  // /ideas: admins and contributors submit ideas and see their own.
  app.register(async (r) => {
    r.addHook('onRequest', async (req, reply) => {
      if (!canUseIdeas(db, req.user)) return reply.callNotFound();
    });
    const show = (req, reply, extra = {}) => reply.page(ideasPage({ csrf: req.csrfToken(), ideas: myIdeas(db, req.user.id), ...extra }));
    r.get('/ideas', async (req, reply) => show(req, reply, { notice: req.query.done === 'added' ? 'Thanks! Your idea is in.' : null }));
    r.post('/ideas', async (req, reply) => {
      const result = submitIdea(db, req.user, req.body, { now: now() });
      if (result.errors) return show(req, reply.code(422), { errors: result.errors, values: result.values });
      return reply.redirect('/ideas?done=added', 303);
    });
  });

  // Admin › Badge ideas: sharing for every admin, triage for the super admin only.
  app.register(async (admin) => {
    admin.addHook('onRequest', async (req, reply) => {
      if (!req.user?.is_admin) return reply.callNotFound();
    });
    const superOnly = { onRequest: async (req, reply) => { if (!isSuperAdmin(req.user)) return reply.callNotFound(); } };

    const page = (req, reply, extra = {}) => {
      const isSuper = isSuperAdmin(req.user);
      const status = Object.hasOwn(STATUSES, req.query?.status) ? req.query.status : '';
      return reply.page(adminIdeasPage({
        csrf: req.csrfToken(), isSuper, contributors: listContributors(db), status,
        ...(isSuper ? {
          ideas: allIdeas(db, { status }), counts: ideaCounts(db), openIdeas: openIdeas(db),
          job: ideaJob(db, { now: now() }), aiAvailable: Boolean(app.ideaAi?.available),
        } : {}),
        ...extra,
      }));
    };
    const back = (req) => `/admin/ideas${Object.hasOwn(STATUSES, req.body?.status) ? `?status=${req.body.status}` : ''}`;

    admin.get('/ideas', async (req, reply) => page(req, reply, {
      notice: {
        shared: 'Shared. They have access and an email is on its way.', removed: 'Removed. Their ideas stay.', saved: 'Saved.',
        started: 'Claude is reviewing the new ideas. Refresh in a minute.',
      }[req.query.done] || null,
    }));

    // Share: adds the email to the contributors and sends the "Badge ideas" email. Someone
    // without an account gets an invite link that lands on /ideas after sign-up.
    admin.post('/ideas/contributors', async (req, reply) => {
      const email = normalizeEmail(req.body.share_email);
      const member = findUserByEmail(db, email);
      let invite = null;
      if (!member) {
        invite = createInvite(db, { email, name: '', inviter: req.user }, { now: now(), allowRecent: true });
        if (invite.error) return page(req, reply.code(422), { shareError: invite.error, shareValues: invite.values });
      }
      const added = addContributor(db, email, req.user, { now: now() });
      if (added.error) return page(req, reply.code(422), { shareError: added.error, shareValues: added.values });
      const url = member ? `${app.config.baseUrl}/ideas` : `${app.config.baseUrl}/join/${invite.token}?next=/ideas`;
      const msg = memberEmail({
        kind: 'idea_share', copy: { ...emailCopy(db, 'idea_share'), subject: app.emailSettings().subject_idea_share },
        baseUrl: app.config.baseUrl, tagline: app.theme().tagline, name: member?.display_name || 'there', inviter: req.user.display_name, url,
      });
      try {
        await app.mailer.send({ to: added.email, ...msg });
      } catch (err) {
        req.log.warn({ err: err.message }, 'idea share email failed');
        // Undo so it can be retried right away.
        if (invite) db.prepare('DELETE FROM invites WHERE id = ?').run(invite.invite.id);
        if (!added.already) db.prepare('DELETE FROM idea_contributors WHERE email = ?').run(added.email);
        return page(req, reply.code(502), { shareError: `The email couldn't be sent: ${err.message}`, shareValues: { email } });
      }
      return reply.redirect('/admin/ideas?done=shared', 303);
    });
    admin.post('/ideas/contributors/:id/remove', async (req, reply) => {
      const id = idOf(req);
      if (!id || !removeContributor(db, id)) return reply.callNotFound();
      return reply.redirect('/admin/ideas?done=removed', 303);
    });

    // Triage (super admin).
    admin.post('/ideas/:id/triage', superOnly, async (req, reply) => {
      const id = idOf(req);
      const result = id ? triageIdea(db, id, req.body, { now: now() }) : { error: 'not_found' };
      if (result.error === 'not_found') return reply.callNotFound();
      if (result.error) return page(req, reply.code(422), { error: `Idea #${id}: ${result.error}` });
      return reply.redirect(`${back(req)}#idea-${id}`, 303);
    });
    admin.post('/ideas/:id/apply', superOnly, async (req, reply) => {
      const id = idOf(req);
      const result = id ? applySuggestion(db, id, { now: now() }) : { error: 'not_found' };
      if (result.error === 'not_found') return reply.callNotFound();
      if (result.error) return page(req, reply.code(422), { error: `Idea #${id}: ${result.error}` });
      return reply.redirect(`/admin/ideas#idea-${id}`, 303);
    });
    admin.post('/ideas/suggest', superOnly, async (req, reply) => {
      const job = startIdeaJob(db, app.ideaAi, { now, log: req.log });
      if (job) app.trackJob(job);
      return reply.redirect(`/admin/ideas${job ? '?done=started' : ''}`, 303);
    });
    admin.get('/ideas/export.md', superOnly, async (req, reply) => reply
      .type('text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="badge-ideas-${now().toISOString().slice(0, 10)}.md"`)
      .header('Cache-Control', 'no-store')
      .send(exportBrief(db, { now: now() })));
  }, { prefix: '/admin' });
}
