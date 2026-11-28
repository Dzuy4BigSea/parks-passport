import { requireUser } from '../lib/auth.js';
import { teamBadgesOf } from '../domain/group-goals.js';
import { badgeBoard } from '../domain/badges/index.js';
import { totalPoints } from '../domain/points.js';
import { levelFor } from '../domain/levels.js';
import { passportData, cityProgress } from '../domain/passport.js';
import { listCities } from '../domain/city.js';
import { passportPage } from '../views/pages/passport.js';
import { cityPath } from '../views/urls.js';
import { nextUp } from '../domain/engagement.js';
import { weekSummary } from '../domain/activities.js';
import { urlCity, queryOf } from './city-params.js';
import { wantToGo } from '../domain/saved.js';
import { palNudge } from '../domain/pals.js';
import { adForPassport, recordAdView } from '../domain/ads.js';
import { isBot } from '../domain/nonprofits.js';

export default async function passportRoutes(app) {
  const { db } = app;

  // One passport per member, one page per city (its stamps); points, levels and most badges count
  // every city. /passport goes to the current city's page.
  app.get('/passport', { preHandler: requireUser }, async (req, reply) => reply.redirect(cityPath(req.city, '/passport') + queryOf(req)));

  app.get('/:city/passport', { preHandler: requireUser }, async (req, reply) => {
    const city = urlCity(req);
    if (!city) return reply.callNotFound();
    const user = req.user;
    const points = totalPoints(db, user.id);
    const badges = badgeBoard(db, user.id, { cityId: city.id });
    // A nonprofit ad at the bottom (SPEC Flow 25); own passport only, never /u/:handle.
    const ad = adForPassport(db, city, { now: app.now(), random: app.random });
    if (ad && req.method === 'GET' && !isBot(req.headers['user-agent'])) recordAdView(db, ad.id, 0, { now: app.now() });
    return reply.page(passportPage({
      ad,
      ...passportData(db, user.id, { cityId: city.id }), user, csrf: req.csrfToken(), points, level: levelFor(points),
      badges, theme: city, cities: cityProgress(db, user.id, listCities(db)),
      next: { ...nextUp(db, user.id, badges, { now: app.now(), timeZone: city.time_zone, cityId: city.id }), pals: palNudge(db, user.id) },
      week: weekSummary(db, user.id, { now: app.now(), timeZone: city.time_zone }),
      welcome: req.query.welcome === '1', // right after sign-up: the passport opening
      wantToGo: wantToGo(db, user.id, { cityId: city.id }), // private: only on your own passport
      teamBadges: teamBadgesOf(db, user.id), // own passport only: they name the groups
    }));
  });
}
