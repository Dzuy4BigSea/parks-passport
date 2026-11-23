import { requireUser, safeNext } from '../lib/auth.js';
import { verifyPassword, burnPasswordCheck } from '../lib/crypto.js';
import {
  createUser, findUserByEmail, findUserById, createSession, deleteSession, deleteAllSessions,
  createAuthToken, peekAuthToken, consumeAuthToken, isLoginLocked, recordLoginFailure,
  clearLoginFailures, setPassword, validatePassword, deleteUser, normalizeEmail,
} from '../domain/users.js';
import { SESSION_COOKIE } from '../lib/auth.js';
import {
  signupPage, loginPage, checkEmailPage, sendFailedPage, linkExpiredPage, magicConfirmPage,
  forgotPage, resetPage, accountPage, deleteConfirmPage, accountDeletedPage,
} from '../views/pages/auth.js';

const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');

export default async function authRoutes(app) {
  const { db, mailer } = app;
  const now = () => app.now();
  const link = (path, token) => `${app.config.baseUrl}${path}?token=${encodeURIComponent(token)}`;

  const startSession = (reply, userId) => reply.signIn(createSession(db, userId, { now: now() }));

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

  app.post('/signup', async (req, reply) => {
    const values = { display_name: str(req.body.display_name, 100), email: str(req.body.email, 300) };
    const { user, errors } = await createUser(db, { ...values, password: str(req.body.password) }, { now: now() });
    if (errors) {
      reply.code(422);
      return reply.page(signupPage({ csrf: req.csrfToken(), values, errors, next: str(req.body.next) }));
    }
    startSession(reply, user.id);
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
    const user = email ? findUserByEmail(db, email) : null;
    const ok = user ? await verifyPassword(password, user.password_hash) : (await burnPasswordCheck(password), false);
    if (!ok) {
      recordLoginFailure(db, email, { now: now() });
      reply.code(401);
      return reply.page(loginPage({ csrf, values: { email }, next, errors: { form: 'Email or password is incorrect.' } }));
    }
    clearLoginFailures(db, email);
    startSession(reply, user.id);
    return reply.redirect(safeNext(next), 303);
  });

  // Magic link
  app.post('/login/magic', async (req, reply) => {
    const user = findUserByEmail(db, str(req.body.magic_email));
    if (!user) return reply.page(checkEmailPage());
    const token = createAuthToken(db, user.id, 'magic_link', { now: now() });
    const next = str(req.body.next);
    const url = link('/auth/magic', token) + (next ? `&next=${encodeURIComponent(next)}` : '');
    return sendOrFail(reply, {
      to: user.email,
      subject: 'Your Parks Passport sign-in link',
      text: `Hi ${user.display_name},\n\nSign in to Parks Passport:\n${url}\n\nThis link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.\n`,
    }, checkEmailPage());
  });

  app.get('/auth/magic', async (req, reply) => {
    const token = str(req.query.token);
    if (!peekAuthToken(db, token, 'magic_link', { now: now() })) return reply.page(linkExpiredPage());
    return reply.page(magicConfirmPage({ csrf: req.csrfToken(), token, next: str(req.query.next) }));
  });

  app.post('/auth/magic', async (req, reply) => {
    const row = consumeAuthToken(db, str(req.body.token), 'magic_link', { now: now() });
    if (!row) return reply.page(linkExpiredPage());
    startSession(reply, row.user_id);
    return reply.redirect(safeNext(req.body.next), 303);
  });

  // Forgot / reset password
  app.get('/forgot', async (req, reply) => reply.page(forgotPage({ csrf: req.csrfToken() })));

  app.post('/forgot', async (req, reply) => {
    const user = findUserByEmail(db, str(req.body.email));
    const page = checkEmailPage({ what: 'a password reset link' });
    if (!user) return reply.page(page);
    const token = createAuthToken(db, user.id, 'password_reset', { now: now() });
    return sendOrFail(reply, {
      to: user.email,
      subject: 'Reset your Parks Passport password',
      text: `Hi ${user.display_name},\n\nChoose a new password:\n${link('/reset', token)}\n\nThis link works once and expires in 15 minutes. If you didn't ask for it, ignore this email; your password hasn't changed.\n`,
    }, page);
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
    clearLoginFailures(db, findUserById(db, row.user_id).email);
    startSession(reply, row.user_id);
    return reply.redirect('/passport', 303);
  });

  // Log out
  app.post('/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) deleteSession(db, token);
    reply.signOut();
    return reply.redirect('/', 303);
  });

  // Account and deletion
  app.get('/account', { preHandler: requireUser }, async (req, reply) =>
    reply.page(accountPage({ csrf: req.csrfToken(), user: req.user })));

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

  app.post('/account/delete/email', { preHandler: requireUser }, async (req, reply) => {
    const token = createAuthToken(db, req.user.id, 'delete_account', { now: now() });
    return sendOrFail(reply, {
      to: req.user.email,
      subject: 'Confirm deleting your Parks Passport account',
      text: `Hi ${req.user.display_name},\n\nTo permanently delete your account and everything in it, open:\n${link('/account/delete/confirm', token)}\n\nThis link works once and expires in 15 minutes. If you didn't ask for this, ignore this email.\n`,
    }, checkEmailPage({ what: 'a link to confirm deleting your account' }));
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
