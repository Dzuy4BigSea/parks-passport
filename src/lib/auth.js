import fp from 'fastify-plugin';
import { randomToken, safeEqual } from './crypto.js';
import { userForSession, SESSION_DAYS } from '../domain/users.js';

// In production the cookies use the __Host- prefix: browsers then refuse them unless they are
// Secure, Path=/ and host-only, so sibling *.dzuynguyen.com sites can't plant or overwrite them.
export const cookieNames = (secure) => ({
  session: secure ? '__Host-pp_session' : 'pp_session',
  csrf: secure ? '__Host-pp_csrf' : 'pp_csrf',
});

/**
 * Adds to every request:
 *  - req.user: the signed-in user or null
 *  - req.csrfToken(): the CSRF token for forms (pp_csrf cookie, issued on the first request)
 * and rejects state-changing requests whose `_csrf` field doesn't match the cookie (403).
 * Registered with fastify-plugin so the hooks apply to every route; register after @fastify/cookie.
 */
export const authPlugin = fp(async function auth(app, { db, now, secureCookies }) {
  const cookieBase = { path: '/', httpOnly: true, sameSite: 'lax', secure: secureCookies };
  const names = cookieNames(secureCookies);
  const SESSION_COOKIE = names.session;
  const CSRF_COOKIE = names.csrf;
  app.decorate('cookieNames', names);

  app.decorateRequest('user', null);
  app.decorateRequest('_csrf', null);
  app.decorateRequest('csrfToken', function csrfToken() {
    return this._csrf;
  });

  app.decorateReply('signIn', function signIn(token) {
    return this.setCookie(SESSION_COOKIE, token, { ...cookieBase, maxAge: SESSION_DAYS * 86400 });
  });
  app.decorateReply('signOut', function signOut() {
    return this.clearCookie(SESSION_COOKIE, cookieBase);
  });

  app.addHook('onRequest', async (req, reply) => {
    req.user = userForSession(db, req.cookies[SESSION_COOKIE], { now: now() });
    req._csrf = req.cookies[CSRF_COOKIE];
    if (!req._csrf) {
      req._csrf = randomToken();
      reply.setCookie(CSRF_COOKIE, req._csrf, { ...cookieBase, maxAge: 30 * 86400 });
    }
  });

  app.addHook('preHandler', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const sent = req.body && typeof req.body === 'object' ? req.body._csrf : undefined;
    const cookie = req.cookies[CSRF_COOKIE];
    if (!cookie || !sent || !safeEqual(sent, cookie)) {
      return reply.code(403).type('text/plain').send('Your form expired. Go back, reload the page and try again.');
    }
  });
}, { name: 'auth', dependencies: ['@fastify/cookie'] });

// Route guard: redirects signed-out visitors to /login?next=<path>.
export async function requireUser(req, reply) {
  if (!req.user) return reply.redirect(`/login?next=${encodeURIComponent(req.url)}`);
}

// Only allows local paths as post-login destinations.
// Printable ASCII only (anything else is invalid in a Location header), no "//" or backslash.
export const safeNext = (next) =>
  typeof next === 'string' && /^\/(?!\/)[\x21-\x5b\x5d-\x7e]*$/.test(next) ? next : '/passport';
