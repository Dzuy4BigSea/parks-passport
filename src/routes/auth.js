import { requireUser, safeNext } from '../lib/auth.js';
import { magicLinkEmail, passwordResetEmail, deleteAccountEmail } from '../views/email.js';
import { emailCopy } from '../domain/email-copy.js';
import { inviteForToken, acceptInvites } from '../domain/invites.js';
import { canUseIdeas } from '../domain/ideas.js';
import { verifyPassword, burnPasswordCheck } from '../lib/crypto.js';
import {
  createUser, findUserByEmail, findUserById, createSession, deleteSession, deleteAllSessions,
  createAuthToken, peekAuthToken, consumeAuthToken, isLoginLocked, recordLoginFailure,
  clearLoginFailures, setPassword, validatePassword, deleteUser, normalizeEmail,
  canSendAuthToken, revokeAuthTokens,
} from '../domain/users.js';
import {
  signupPage, loginPage, checkEmailPage, sendFailedPage, linkExpiredPage, magicConfirmPage,
  forgotPage, resetPage, accountPage, deleteConfirmPage, accountDeletedPage,
} from '../views/pages/auth.js';

import { createRateLimiter } from '../lib/rate-limit.js';
import fs from 'node:fs';
import { withUploads } from '../lib/uploads.js';
import { storeAvatar, removeAvatar, avatarPath, AVATAR_KEY_RE } from '../lib/images.js';
import { canViewOwner } from '../domain/visibility.js';
import { html } from '../views/html.js';

const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
const HOUR = 60 * 60 * 1000;

export default async function authRoutes(app) {
  const { db, mailer } = app;
  const now = () => app.now();
  const link = (path, token) => `${app.config.baseUrl}${path}?token=${encodeURIComponent(token)}`;
  // Bot protection (SPEC Flow 1): per-connection limits on sign-ups and on sign-in and reset
  // emails, which go out from our SendGrid account. Clock: wall time (the window is real time).
  const signupLimit = createRateLimiter({ limit: 5, windowMs: HOUR });
  const emailLimit = createRateLimiter({ limit: 5, windowMs: HOUR });
  const tooMany = (reply, what) => reply.code(429).page({
    title: 'Try again later',
    body: html`<div class="narrow"><h1>Slow down a little</h1><p role="alert">Too many ${what} from this connection. Try again in an hour.</p></div>`,
  });
  // Shared fields for the branded email templates (views/email.js).
  const brand = () => ({ baseUrl: app.config.baseUrl, tagline: app.theme().tagline });

  // Signing in replaces any session the browser already had.
  const startSession = (req, reply, userId) => {
    const previous = req.cookies[app.cookieNames.session];
    if (previous) deleteSession(db, previous);
    return reply.signIn(createSession(db, userId, { now: now() }));
  };

  // Links for signed-out flows are sent in the background, so the response is the same
  // (and as fast) whether or not the email has an account. Failures are logged.
  const sendInBackground = (message) => app.sendMailInBackground(message);

  // Creates and emails a link unless this user already got 3 for this purpose in 15 minutes.
  function emailLink(user, purpose, build) {
    if (!canSendAuthToken(db, user.id, purpose, { now: now() })) return;
    const token = createAuthToken(db, user.id, purpose, { now: now() });
    sendInBackground(build(token));
  }

  async function sendOrFail(reply, message, page) {
    try {
      await mailer.send(message);
      return reply.page(page);
    } catch (err) {
      app.log.error({ err: err.message }, 'email send failed');
      return reply.page(sendFailedPage());
    }
  }

  // Sign up
  app.get('/signup', async (req, reply) => {
    if (req.user) return reply.redirect('/passport');
    return reply.page(signupPage({ csrf: req.csrfToken(), next: str(req.query.next) }));
  });

  // Invite links from Admin › Members: the sign-up form, filled in from the invite. Sign-up is open
  // to everyone, so an expired link still offers it. The token stays out of analytics (app.js).
  app.get('/join/:token', async (req, reply) => {
    if (req.user) return reply.redirect('/passport');
    const invite = inviteForToken(db, req.params.token, { now: now() });
    return reply.page(signupPage({
      csrf: req.csrfToken(), invite, cityName: req.city.copy.short, next: safeNext(str(req.query.next)) === str(req.query.next) ? str(req.query.next) : '',
      values: invite ? { email: invite.email, display_name: invite.name } : {},
      inviteNotice: invite ? null : 'This invite link has expired or was already used. You can still create a passport here.',
    }));
  });

  app.post('/signup', async (req, reply) => {
    // A hidden field people never see; bots that fill every field land on the home page, no account.
    if (str(req.body.website)) return reply.redirect('/', 303);
    if (!signupLimit.hit(req.ip)) return tooMany(reply, 'sign-ups');
    const values = { display_name: str(req.body.display_name, 100), email: str(req.body.email, 300) };
    const { user, errors } = await createUser(db, { ...values, password: str(req.body.password) }, { now: now() });
    if (errors) {
      reply.code(422);
      return reply.page(signupPage({ csrf: req.csrfToken(), values, errors, next: str(req.body.next) }));
    }
    acceptInvites(db, user.email, user.id, { now: now() });
    startSession(req, reply, user.id);
    app.track(user.id, 'sign_up', { method: 'password' });
    return reply.redirect(safeNext(req.body.next), 303);
  });

  // Log in with password
  app.get('/login', async (req, reply) => {
    if (req.user) return reply.redirect('/passport');
    return reply.page(loginPage({ csrf: req.csrfToken(), next: str(req.query.next) }));
  });

  app.post('/login', async (req, reply) => {
    const email = normalizeEmail(str(req.body.email));
    const password = str(req.body.password);
    const next = str(req.body.next);
    const csrf = req.csrfToken();
    if (isLoginLocked(db, email, { now: now() })) {
      reply.code(429);
      return reply.page(loginPage({ csrf, values: { email }, next, errors: { form: 'Too many attempts. Try again in 15 minutes, or use a sign-in link.' } }));
    }
    // Record the attempt before the (async) password check, so parallel guesses all count.
    const attemptId = recordLoginFailure(db, email, { now: now() });
    const user = email ? findUserByEmail(db, email) : null;
    const ok = user ? await verifyPassword(password, user.password_hash) : (await burnPasswordCheck(password), false);
    if (!ok) {
      reply.code(401);
      return reply.page(loginPage({ csrf, values: { email }, next, errors: { form: 'Email or password is incorrect.' } }));
    }
    db.prepare('DELETE FROM login_failures WHERE rowid = ?').run(attemptId);
    clearLoginFailures(db, email);
    startSession(req, reply, user.id);
    app.track(user.id, 'login', { method: 'password' });
    return reply.redirect(safeNext(next), 303);
  });

  // Magic link
  app.post('/login/magic', async (req, reply) => {
    if (!emailLimit.hit(req.ip)) return tooMany(reply, 'sign-in emails');
    const user = findUserByEmail(db, str(req.body.magic_email));
    const next = str(req.body.next);
    if (user) {
      emailLink(user, 'magic_link', (token) => ({
        to: user.email,
        ...magicLinkEmail({ ...brand(), subject: app.emailSettings().subject_magic_link, copy: emailCopy(db, 'magic_link'), name: user.display_name,
          url: `${link('/auth/magic', token)}${next ? `&next=${encodeURIComponent(next)}` : ''}` }),
      }));
    }
    return reply.page(checkEmailPage());
  });

  app.get('/auth/magic', async (req, reply) => {
    const token = str(req.query.token);
    if (!peekAuthToken(db, token, 'magic_link', { now: now() })) return reply.page(linkExpiredPage());
    return reply.page(magicConfirmPage({ csrf: req.csrfToken(), token, next: str(req.query.next) }));
  });

  app.post('/auth/magic', async (req, reply) => {
    const row = consumeAuthToken(db, str(req.body.token), 'magic_link', { now: now() });
    if (!row) return reply.page(linkExpiredPage());
    startSession(req, reply, row.user_id);
    app.track(row.user_id, 'login', { method: 'magic_link' });
    return reply.redirect(safeNext(req.body.next), 303);
  });

  // Forgot / reset password
  app.get('/forgot', async (req, reply) => reply.page(forgotPage({ csrf: req.csrfToken() })));

  app.post('/forgot', async (req, reply) => {
    if (!emailLimit.hit(req.ip)) return tooMany(reply, 'reset emails');
    const user = findUserByEmail(db, str(req.body.email));
    if (user) {
      emailLink(user, 'password_reset', (token) => ({
        to: user.email,
        ...passwordResetEmail({ ...brand(), subject: app.emailSettings().subject_password_reset, copy: emailCopy(db, 'password_reset'), name: user.display_name, url: link('/reset', token) }),
      }));
    }
    return reply.page(checkEmailPage({ what: 'a password reset link' }));
  });

  app.get('/reset', async (req, reply) => {
    const token = str(req.query.token);
    if (!peekAuthToken(db, token, 'password_reset', { now: now() })) return reply.page(linkExpiredPage());
    return reply.page(resetPage({ csrf: req.csrfToken(), token }));
  });

  app.post('/reset', async (req, reply) => {
    const token = str(req.body.token);
    const password = str(req.body.password);
    if (!peekAuthToken(db, token, 'password_reset', { now: now() })) return reply.page(linkExpiredPage());
    const error = validatePassword(password);
    if (error) {
      reply.code(422);
      return reply.page(resetPage({ csrf: req.csrfToken(), token, errors: { password: error } }));
    }
    const row = consumeAuthToken(db, token, 'password_reset', { now: now() });
    if (!row) return reply.page(linkExpiredPage());
    await setPassword(db, row.user_id, password);
    deleteAllSessions(db, row.user_id);
    revokeAuthTokens(db, row.user_id, { now: now() }); // older reset/magic links stop working too
    clearLoginFailures(db, findUserById(db, row.user_id).email);
    startSession(req, reply, row.user_id);
    return reply.redirect('/passport', 303);
  });

  // Log out
  app.post('/logout', async (req, reply) => {
    const token = req.cookies[app.cookieNames.session];
    if (token) deleteSession(db, token);
    reply.signOut();
    return reply.redirect('/', 303);
  });

  // Account and deletion
  const VISIBILITY_SAVED = { private: 'only you', pals: 'your Park Pals', public: 'anyone with the link' };
  app.get('/account', { preHandler: requireUser }, async (req, reply) =>
    reply.page(accountPage({
      csrf: req.csrfToken(), user: req.user, ideas: canUseIdeas(db, req.user),
      notice: req.query.done === 'visibility' ? `Saved. Your passport is now visible to ${VISIBILITY_SAVED[req.user.default_visibility]}.`
        : req.query.done === 'editions' ? 'Saved your editions.'
          : { avatar: 'Profile photo saved.', avatar_removed: 'Profile photo removed.' }[req.query.done] || null,
    })));

  // Profile photo (SPEC Flow 8): one per member, seen by whoever can see their passport.
  withUploads(app, (scope) => scope.post('/account/avatar', { preHandler: requireUser }, async (req, reply) => {
    const file = Buffer.isBuffer(req.body.photo) && req.body.photo.length ? req.body.photo : null;
    const stored = await storeAvatar(file, app.config.uploadsDir);
    if (stored.error) {
      return reply.code(422).page(accountPage({ csrf: req.csrfToken(), user: req.user, ideas: canUseIdeas(db, req.user), errors: { photo: stored.error } }));
    }
    // The key as it is now (another upload may have finished since this request began).
    const old = db.prepare('SELECT avatar_key FROM users WHERE id = ?').pluck().get(req.user.id);
    db.prepare('UPDATE users SET avatar_key = ? WHERE id = ?').run(stored.key, req.user.id);
    await removeAvatar(app.config.uploadsDir, old);
    return reply.redirect('/account?done=avatar#photo', 303);
  }));
  app.post('/account/avatar/delete', { preHandler: requireUser }, async (req, reply) => {
    const old = db.prepare('SELECT avatar_key FROM users WHERE id = ?').pluck().get(req.user.id);
    db.prepare('UPDATE users SET avatar_key = NULL WHERE id = ?').run(req.user.id);
    await removeAvatar(app.config.uploadsDir, old);
    return reply.redirect('/account?done=avatar_removed#photo', 303);
  });
  // Served only to people who can see the member's passport (404 otherwise, never 403). The key in
  // the URL changes with every new photo, so it can be cached.
  app.get('/avatars/:id/:file', async (req, reply) => {
    const m = /^([a-f0-9]{32})\.jpg$/.exec(req.params.file);
    const owner = m && /^\d+$/.test(req.params.id) ? findUserById(db, Number(req.params.id)) : null;
    if (!owner || owner.avatar_key !== m[1] || !AVATAR_KEY_RE.test(m[1])
      || !canViewOwner(db, req.user?.id ?? null, owner.id, owner.default_visibility)) return reply.callNotFound();
    const file = avatarPath(app.config.uploadsDir, m[1]);
    if (!fs.existsSync(file)) return reply.callNotFound();
    // no-cache: browsers re-check each time, so a photo stops showing as soon as access ends.
    return reply.type('image/jpeg').header('Cache-Control', 'private, no-cache').header('X-Content-Type-Options', 'nosniff')
      .send(fs.createReadStream(file));
  });

  const removeAccount = async (reply, userId) => {
    await app.beforeUserDelete(userId); // removes stored files (photos) before rows cascade
    deleteUser(db, userId);
    reply.signOut();
    return reply.page(accountDeletedPage());
  };

  app.post('/account/delete', { preHandler: requireUser }, async (req, reply) => {
    if (!(await verifyPassword(str(req.body.delete_password), req.user.password_hash))) {
      reply.code(422);
      return reply.page(accountPage({
        csrf: req.csrfToken(), user: req.user,
        errors: { delete_password: 'That password is incorrect.' },
      }));
    }
    return removeAccount(reply, req.user.id);
  });

  // Signed in, so no enumeration risk: this one waits and reports a failed send.
  app.post('/account/delete/email', { preHandler: requireUser }, async (req, reply) => {
    const page = checkEmailPage({ what: 'a link to confirm deleting your account' });
    if (!canSendAuthToken(db, req.user.id, 'delete_account', { now: now() })) return reply.page(page);
    const token = createAuthToken(db, req.user.id, 'delete_account', { now: now() });
    return sendOrFail(reply, {
      to: req.user.email,
      ...deleteAccountEmail({ ...brand(), subject: app.emailSettings().subject_delete_account, copy: emailCopy(db, 'delete_account'), name: req.user.display_name, url: link('/account/delete/confirm', token) }),
    }, page);
  });

  app.get('/account/delete/confirm', async (req, reply) => {
    const token = str(req.query.token);
    if (!peekAuthToken(db, token, 'delete_account', { now: now() })) return reply.page(linkExpiredPage());
    return reply.page(deleteConfirmPage({ csrf: req.csrfToken(), token }));
  });

  app.post('/account/delete/confirm', async (req, reply) => {
    const row = consumeAuthToken(db, str(req.body.token), 'delete_account', { now: now() });
    if (!row) return reply.page(linkExpiredPage());
    return removeAccount(reply, row.user_id);
  });
}
