import { safeNext } from '../lib/auth.js';
import { parseConsent, serializeConsent, CONSENT_COOKIE, CONSENT_MAX_AGE } from '../lib/analytics.js';
import { consentPage } from '../views/pages/consent.js';

export default async function consentRoutes(app) {
  app.get('/consent', async (req, reply) => reply.page(consentPage({
    csrf: req.csrfToken(), consent: parseConsent(req.cookies[CONSENT_COOKIE]),
    back: safeNext(typeof req.query.back === 'string' ? req.query.back : '/'), saved: req.query.saved === '1',
  })));

  // choice: accept (analytics), reject (nothing), or custom (the analytics/ads checkboxes).
  // Scripts post with Accept: application/json and get 204; forms without JS are redirected back.
  app.post('/consent', async (req, reply) => {
    const choice = req.body.choice;
    const consent = choice === 'accept' ? { analytics: true, ads: false }
      : choice === 'custom' ? { analytics: req.body.analytics === '1', ads: req.body.ads === '1' }
        : { analytics: false, ads: false };
    reply.setCookie(CONSENT_COOKIE, serializeConsent(consent), {
      path: '/', maxAge: CONSENT_MAX_AGE, sameSite: 'lax', secure: app.config.secureCookies, httpOnly: true,
    });
    // With JS the page records consent_update itself; the no-JS path queues it for the next page.
    if ((req.headers.accept || '').includes('application/json')) return reply.code(204).send();
    if (req.user) app.track(req.user.id, 'consent_update', consent);
    const back = safeNext(req.body.back);
    return reply.redirect(choice === 'custom' ? `/consent?saved=1&back=${encodeURIComponent(back)}` : back, 303);
  });
}
