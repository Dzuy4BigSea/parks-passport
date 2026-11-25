import fp from 'fastify-plugin';
import { cityByKey, defaultCity } from '../domain/city.js';

// The city a request is about (SPEC Flow 14), as req.city:
//   1. the first path segment, when it names a city (/westminster/parks); that city is remembered;
//   2. else ?city=<key> on a GET (invite links carry the inviter's city); that city is remembered;
//   3. else the remembered city (a cookie holding only the city key);
//   4. else the default city (St. Pete).
// The home page may also suggest the nearest city to the visitor's IP (routes in app.js).
export const cityCookieName = (secure) => (secure ? '__Host-pp_city' : 'pp_city');
const YEAR = 365 * 86400;

export const cityContext = fp(async function cityContext(app, { db, secureCookies }) {
  const name = cityCookieName(secureCookies);
  const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge: YEAR };
  app.decorateRequest('city', null);
  app.decorateRequest('cityFromUrl', false);
  app.decorateRequest('cityAsked', false); // a valid ?city= on a GET
  app.decorateRequest('cityRemembered', false); // the visitor chose a city before (a cookie)
  app.decorateReply('rememberCity', function rememberCity(city) {
    if (this.request.cookies[name] !== city.key) this.setCookie(name, city.key, cookieOpts);
    return this;
  });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/healthz') return; // must answer (503) even when the database can't be read
    const first = req.url.split(/[?#]/)[0].split('/')[1] || '';
    const fromUrl = first ? cityByKey(db, first) : null; // keys are lowercase slugs: exact match
    const asked = !fromUrl && req.method === 'GET' ? cityByKey(db, new URLSearchParams(req.url.split('?')[1] || '').get('city') || '') : null;
    const remembered = cityByKey(db, req.cookies[name] || '');
    req.cityRemembered = Boolean(remembered || asked);
    req.cityFromUrl = Boolean(fromUrl);
    req.cityAsked = Boolean(asked);
    req.city = fromUrl || asked || remembered || defaultCity(db);
    if ((fromUrl || asked) && req.method === 'GET') reply.rememberCity(req.city);
  });
}, { name: 'city-context', dependencies: ['@fastify/cookie'] });
