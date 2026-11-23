import { requireUser, safeNext } from '../lib/auth.js';
import {
  inviteTokenFor, regenerateInvite, inviterForToken, acceptInvite, removePal, palsOf, leaderboard, palsFeed,
} from '../domain/pals.js';
import { areFriends, canViewOwner, VISIBILITY } from '../domain/visibility.js';
import { badgeBoard } from '../domain/badges/index.js';
import { totalPoints } from '../domain/points.js';
import { levelFor } from '../domain/levels.js';
import { palsPage, invitePage } from '../views/pages/pals.js';
import { passportPage } from '../views/pages/passport.js';
import { passportData } from '../domain/passport.js';

export default async function palRoutes(app) {
  const { db } = app;
  const now = () => app.now();

  app.get('/pals', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.page, 10) || 1));
    const notice = { accepted: "You're now Park Pals!", regenerated: 'New invite link made. The old one no longer works.', removed: 'Pal removed. Your invite link was renewed, so the old one no longer works.' }[req.query.done];
    return reply.page(palsPage({
      user, csrf: req.csrfToken(), page, notice,
      inviteUrl: `${app.config.baseUrl}/pals/invite/${inviteTokenFor(db, user.id, { now: now(), onCreate: () => app.track(user.id, 'pal_invite_created') })}`,
      pals: palsOf(db, user.id).map((p) => ({ ...p, visible: canViewOwner(db, user.id, p.id, p.default_visibility) })), board: leaderboard(db, user.id), feed: palsFeed(db, user.id, { page }),
    }));
  });

  app.post('/pals/invite/regenerate', { preHandler: requireUser }, async (req, reply) => {
    regenerateInvite(db, req.user.id, { now: now() });
    app.track(req.user.id, 'pal_invite_created');
    return reply.redirect('/pals?done=regenerated', 303);
  });

  const inviteState = (inviter, user) => {
    if (!user) return 'signed-out';
    if (inviter.id === user.id) return 'self';
    return areFriends(db, inviter.id, user.id) ? 'already' : 'open';
  };

  app.get('/pals/invite/:token', async (req, reply) => {
    const inviter = inviterForToken(db, req.params.token);
    if (!inviter) return reply.callNotFound();
    return reply.page(invitePage({
      inviter, user: req.user, csrf: req.csrfToken(), token: req.params.token, state: inviteState(inviter, req.user),
    }));
  });

  app.post('/pals/invite/:token/accept', { preHandler: requireUser }, async (req, reply) => {
    const inviter = inviterForToken(db, req.params.token);
    if (!inviter) return reply.callNotFound();
    const result = acceptInvite(db, inviter, req.user, { now: now(), random: app.random });
    if (result.ok) app.track(req.user.id, 'pal_accepted');
    if (result.error) {
      return reply.page(invitePage({ inviter, user: req.user, csrf: req.csrfToken(), token: req.params.token, state: result.error }));
    }
    return reply.redirect('/pals?done=accepted', 303);
  });

  app.post('/pals/:handle/remove', { preHandler: requireUser }, async (req, reply) => {
    const pal = db.prepare('SELECT id FROM users WHERE handle = ?').get(String(req.params.handle));
    if (!pal || !removePal(db, req.user.id, pal.id, { now: now() })) return reply.callNotFound();
    return reply.redirect('/pals?done=removed', 303);
  });

  app.post('/account/visibility', { preHandler: requireUser }, async (req, reply) => {
    const v = req.body.default_visibility;
    if (!VISIBILITY.includes(v)) return reply.code(422).type('text/plain').send('Choose who can see your passport.');
    db.prepare('UPDATE users SET default_visibility = ? WHERE id = ?').run(v, req.user.id);
    if (req.body.source === 'nudge') app.track(req.user.id, 'share_prompt_action', { action: 'share' });
    const back = typeof req.body.back === 'string' && req.body.back ? safeNext(req.body.back) : '/account?done=visibility';
    return reply.redirect(back, 303);
  });

  app.post('/account/nudge/dismiss', { preHandler: requireUser }, async (req, reply) => {
    db.prepare('UPDATE users SET share_nudge_dismissals = share_nudge_dismissals + 1 WHERE id = ?').run(req.user.id);
    app.track(req.user.id, 'share_prompt_action', { action: 'dismiss' });
    return reply.redirect(safeNext(req.body.back), 303);
  });

  // Someone's passport, if its visibility lets this viewer see it; otherwise 404 (never 403),
  // so it doesn't reveal whether the account exists.
  app.get('/u/:handle', async (req, reply) => {
    const owner = db.prepare('SELECT * FROM users WHERE handle = ?').get(String(req.params.handle));
    if (!owner || !canViewOwner(db, req.user?.id ?? null, owner.id, owner.default_visibility)) return reply.callNotFound();
    if (req.user?.id === owner.id && req.query.preview !== '1') return reply.redirect('/passport');
    const points = totalPoints(db, owner.id);
    return reply.page(passportPage({
      ...passportData(db, owner.id), user: owner, csrf: req.csrfToken(), points, level: levelFor(points),
      badges: badgeBoard(db, owner.id).filter((b) => b.state === 'earned'), readOnly: true,
    }));
  });
}
