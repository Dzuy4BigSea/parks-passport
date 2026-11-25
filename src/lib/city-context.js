import fp from 'fastify-plugin';
import { cityByKey, defaultCity } from '../domain/city.js';

// The city a request is about (SPEC Flow 13), as req.city:
//   1. the first path segment, when it names a city (/westminster/parks); that city is remembered;
//   2. else the remembered city (a cookie holding only the city key);
//   3. else the default city (St. Pete).
// The home page may also suggest the nearest city to the visitor's IP (routes in app.js).
export const cityCookieName = (secure) => (secure ? '__Host-pp_city' : 'pp_city');
const YEAR = 365 * 86400;

export const cityContext = fp(async function cityContext(app, { db, secureCookies }) {
  const name = cityCookieName(secureCookies);
  const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge: YEAR };
  app.decorateRequest('city', null);
  app.decorateRequest('cityFromUrl', false);
  app.decorateRequest('cityRemembered', false); // the visitor chose a city before (a cookie)
  app.decorateReply('rememberCity', function rememberCity(city) {
    if (this.request.cookies[name] !== city.key) this.setCookie(name, city.key, cookieOpts);
    return this;
  });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/healthz') return; // must answer (503) even when the database can't be read
    const first = req.url.split(/[?#]/)[0].split('/')[1] || '';
    const fromUrl = first ? cityByKey(db, first) : null; // keys are lowercase slugs: exact match
    const remembered = cityByKey(db, req.cookies[name] || '');
    req.cityRemembered = Boolean(remembered);
    req.cityFromUrl = Boolean(fromUrl);
    req.city = fromUrl || remembered || defaultCity(db);
    if (fromUrl && req.method === 'GET') reply.rememberCity(fromUrl);
  });
}, { name: 'city-context', dependencies: ['@fastify/cookie'] });
