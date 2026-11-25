import { requireUser, safeNext } from '../lib/auth.js';
import {
  inviteTokenFor, regenerateInvite, inviterForToken, acceptInvite, removePal, palsOf, leaderboard, palsFeed,
  friendCodeFor, regenerateFriendCode, formatCode, requestByCode, palRequests, answerRequest, cancelRequest, CODE_LIMITS,
} from '../domain/pals.js';
import { areFriends, canViewOwner, VISIBILITY } from '../domain/visibility.js';
import { badgeBoard } from '../domain/badges/index.js';
import { totalPoints } from '../domain/points.js';
import { levelFor } from '../domain/levels.js';
import { palsPage, invitePage, deadInvitePage } from '../views/pages/pals.js';
import { passportPage } from '../views/pages/passport.js';
import { passportData } from '../domain/passport.js';

export default async function palRoutes(app) {
  const { db } = app;
  const now = () => app.now();

  const NOTICES = {
    accepted: "You're now Park Pals!",
    regenerated: 'New invite link made. The old one no longer works.',
    removed: 'Pal removed. Your invite link was renewed, so the old one no longer works.',
    code: 'New friend code made. The old one no longer works.',
    requested: "Request sent. You'll be Park Pals when they accept.",
    declined: 'Request declined. If they keep asking, make a new friend code below.',
    cancelled: 'Request cancelled.',
  };
  const showPals = (req, reply, extra = {}) => {
    const user = req.user;
    const page = Math.max(1, Math.min(1000, Number.parseInt(req.query?.page, 10) || 1));
    return reply.page(palsPage({
      user, csrf: req.csrfToken(), page, notice: NOTICES[req.query?.done],
      inviteUrl: `${app.config.baseUrl}/pals/invite/${inviteTokenFor(db, user.id, { now: now(), onCreate: () => app.track(user.id, 'pal_invite_created') })}`,
      friendCode: formatCode(friendCodeFor(db, user.id, { now: now() })), requests: palRequests(db, user.id),
      pals: palsOf(db, user.id).map((p) => ({ ...p, visible: canViewOwner(db, user.id, p.id, p.default_visibility) })), board: leaderboard(db, user.id), feed: palsFeed(db, user.id, { page }),
      ...extra,
    }));
  };

  app.get('/pals', { preHandler: requireUser }, async (req, reply) => showPals(req, reply));

  // Friend codes: typing a code sends a request; the code's owner accepts or declines it.
  const CODE_ERRORS = {
    format: () => 'Type the 8-character code your friend shared, like ABCD-EFGH.',
    invalid: () => "That code doesn't match anyone. Check it and try again.",
    limited: () => 'Too many codes that didn\'t match. Try again in an hour.',
    self: () => "That's your own code. Share it with a friend.",
    already: (to) => `You're already Park Pals with ${to.display_name}.`,
    pending: (to) => `You already asked ${to.display_name}. They'll see it on their Pals page.`,
    daily: () => `That's ${CODE_LIMITS.requestsPerDay} requests today. Try again tomorrow.`,
  };
  app.post('/pals/code', { preHandler: requireUser }, async (req, reply) => {
    const result = requestByCode(db, req.user, req.body.code, { now: now(), random: app.random });
    if (result.error) {
      return showPals(req, reply.code(result.error === 'limited' || result.error === 'daily' ? 429 : 422), {
        codeError: CODE_ERRORS[result.error](result.to), codeValue: String(req.body.code ?? '').slice(0, 20),
      });
    }
    if (result.paired) app.track(req.user.id, 'pal_accepted');
    return reply.redirect(`/pals?done=${result.paired ? 'accepted' : 'requested'}`, 303);
  });
  app.post('/pals/code/regenerate', { preHandler: requireUser }, async (req, reply) => {
    regenerateFriendCode(db, req.user.id, { now: now() });
    return reply.redirect('/pals?done=code', 303);
  });
  const requestId = (req) => (/^\d+$/.test(req.params.id) ? Number(req.params.id) : 0);
  for (const action of ['accept', 'decline']) {
    app.post(`/pals/requests/:id/${action}`, { preHandler: requireUser }, async (req, reply) => {
      const result = answerRequest(db, req.user.id, requestId(req), action === 'accept', { now: now(), random: app.random });
      if (!result) return reply.callNotFound();
      if (action === 'accept') app.track(req.user.id, 'pal_accepted');
      return reply.redirect(`/pals?done=${action === 'accept' ? 'accepted' : 'declined'}`, 303);
    });
  }
  app.post('/pals/requests/:id/cancel', { preHandler: requireUser }, async (req, reply) => {
    if (!cancelRequest(db, req.user.id, requestId(req))) return reply.callNotFound();
    return reply.redirect('/pals?done=cancelled', 303);
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

  // A link that no longer works says so (still a 404) and points to what to do instead.
  const deadLink = (req, reply) => reply.code(404).page(deadInvitePage({ user: req.user }));

  app.get('/pals/invite/:token', async (req, reply) => {
    const inviter = inviterForToken(db, req.params.token);
    if (!inviter) return deadLink(req, reply);
    return reply.page(invitePage({
      inviter, user: req.user, csrf: req.csrfToken(), token: req.params.token, state: inviteState(inviter, req.user),
    }));
  });

  app.post('/pals/invite/:token/accept', { preHandler: requireUser }, async (req, reply) => {
    const inviter = inviterForToken(db, req.params.token);
    if (!inviter) return deadLink(req, reply);
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
      badges: badgeBoard(db, owner.id).filter((b) => b.state === 'earned'), readOnly: true, theme: app.theme(),
    }));
  });
}
