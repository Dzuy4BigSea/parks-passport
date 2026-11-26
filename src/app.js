import fs from 'node:fs';
import { notify, unreadCount } from './domain/notifications.js';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import compress from '@fastify/compress';
import { removePhotoFiles, removeAvatar } from './lib/images.js';
import { fileKeysForUser } from './domain/photos.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { html } from './views/html.js';
import { layout } from './views/layout.js';
import { homePage, privacyPage, creditsPage } from './views/pages/static.js';
import { photoCredits } from './domain/city-photos.js';
import { countActiveParks } from './domain/parks.js';
import { takeUnseenBadges } from './domain/badges/index.js';
import { emailSettings } from './domain/settings.js';
import { buildEvent, queueEvent, takeEvents, parseConsent, CONSENT_COOKIE } from './lib/analytics.js';
import consentRoutes from './routes/consent.js';
import { totalPoints } from './domain/points.js';
import { levelFor } from './domain/levels.js';
import { getTheme, listCities, nearestCity, cityByKey, cityById } from './domain/city.js';
import { cityContext } from './lib/city-context.js';
import { weeklyStreak, visitDates } from './domain/engagement.js';
import { homeData } from './domain/home.js';
import { garyTip } from './views/gary.js';
import { parseLatLng } from './domain/geo.js';
import { localDate } from './domain/time.js';
import { authPlugin, requireUser } from './lib/auth.js';
import parkRoutes from './routes/parks.js';
import authRoutes from './routes/auth.js';
import visitRoutes from './routes/visits.js';
import passportRoutes from './routes/passport.js';
import palRoutes from './routes/pals.js';
import photoRoutes from './routes/photos.js';
import adminRoutes from './routes/admin.js';
import ideaRoutes from './routes/ideas.js';
import activityRoutes from './routes/activities.js';
import notificationRoutes from './routes/notifications.js';
import groupRoutes from './routes/groups.js';
import { myGroups, groupAllowance } from './domain/groups.js';
import { goalSummary } from './domain/group-goals.js';
import { canSendFeedback } from './domain/founding.js';
import communityRoutes from './routes/community.js';
import messageRoutes from './routes/messages.js';
import outfitRoutes from './routes/outfits.js';
import { outfitFor } from './domain/outfits.js';
import { createWeather } from './lib/weather.js';
import { takeMessages } from './domain/messages.js';
import { shareNudge } from './views/pages/pals.js';

// Paths with tokens or handles in the URL: no analytics scripts there (see reply.page).
const NO_ANALYTICS = [/^\/reset$/, /^\/auth\/magic$/, /^\/account\/delete\/confirm$/, /^\/pals\/invite\//, /^\/join\//, /^\/u\//];

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Builds the app with injected dependencies so tests can supply a temp DB, mailer, clock, etc.
 * config: { baseUrl, secureCookies, uploadsDir }
 */
export function buildApp({
  db, mailer, secretBox = null, now = () => new Date(), random = Math.random, weather = null, logger = false, themeAi = null, ideaAi = null, geoip = null,
  config = { baseUrl: 'http://localhost:8080', secureCookies: false, uploadsDir: './data/uploads' },
} = {}) {
  if (!db) throw new Error('buildApp needs a db');
  if (!mailer) throw new Error('buildApp needs a mailer');
  // Trust only proxies on loopback and private networks: the shared nginx reaches us over the
  // Docker network (CLAUDE.md "How traffic reaches an app"). req.ip is then the rightmost public
  // address in X-Forwarded-For, the one nginx appended, never one a client typed further left
  // (rate limits and the nearest-city suggestion depend on it).
  // Request logs keep the path only: query strings can hold a location ("Use my location") or a token.
  const pathOnly = (url) => String(url || '').split('?')[0];
  const loggerOpts = logger === true ? { serializers: { req: (req) => ({ method: req.method, url: pathOnly(req.url), hostname: req.hostname, remoteAddress: req.ip }) } } : logger;
  const app = Fastify({ logger: loggerOpts, trustProxy: 'loopback,linklocal,uniquelocal', bodyLimit: 1024 * 1024 });

  app.decorate('db', db);
  app.decorate('mailer', mailer);
  app.decorate('now', now);
  app.decorate('random', random); // injectable for lucky badges in tests
  // Today's weather per city, for Gary's outfit (SPEC Flow 22). Injectable (tests use a fake).
  app.decorate('weather', weather || createWeather({ now, log: { warn: (obj, msg) => app.log.warn(obj, msg) } }));
  app.decorate('config', config);
  app.decorate('secretBox', secretBox); // encrypts the admin-saved SendGrid key
  // app.track(userId, name, params): an analytics event for the user's next page (see lib/analytics.js).
  app.decorate('theme', () => getTheme(db)); // the default city (emails); pages use req.city
  app.decorate('geoip', geoip); // lib/geoip.js: { lookup(ip) } or null (nearest-city suggestion off)
  app.decorate('themeAi', themeAi); // Admin › City theme generator (lib/theme-ai.js); null = off
  app.decorate('ideaAi', ideaAi); // Admin › Badge ideas suggestions (lib/idea-ai.js); null = off
  app.decorate('track', (userId, name, params = {}) => queueEvent(db, userId, name, params, { now: now(), log: app.log }));
  app.decorate('emailSettings', () => emailSettings(db, { envFrom: config.mailFrom || '' }));
  // Removes a user's photo files before their rows are deleted (rows cascade).
  app.decorate('beforeUserDelete', async (userId) => {
    await removeAvatar(config.uploadsDir, db.prepare('SELECT avatar_key FROM users WHERE id = ?').pluck().get(userId));
    for (const key of fileKeysForUser(db, userId)) await removePhotoFiles(config.uploadsDir, key);
  });

  // Fire-and-forget email; errors are logged. Tests await app.mailIdle().
  const inflight = new Set();
  app.decorate('sendMailInBackground', (message) => {
    const p = Promise.resolve()
      .then(() => mailer.send(message))
      .catch((err) => app.log.error({ err: err.message }, 'email send failed'))
      .finally(() => inflight.delete(p));
    inflight.add(p);
  });
  app.decorate('mailIdle', () => Promise.all(inflight));
  // Background jobs (the city theme generator); tests await app.themeJobIdle().
  const jobs = new Set();
  app.decorate('trackJob', (p) => { jobs.add(p); p.finally(() => jobs.delete(p)); });
  app.decorate('themeJobIdle', () => Promise.all(jobs));
  app.addHook('onClose', async () => db.close());

  // gzip/brotli for text responses (HTML, CSS, JS; Leaflet's ESM build is 424 KB uncompressed).
  app.register(compress, { global: true, threshold: 1024, encodings: ['br', 'gzip'] });
  app.register(formbody);
  // Multipart (uploads) is registered only around the photo routes: see lib/uploads.js.
  app.register(cookie);
  app.register(authPlugin, { db, now, secureCookies: config.secureCookies });
  app.register(cityContext, { db, secureCookies: config.secureCookies }); // req.city (SPEC Flow 14)
  app.register(fastifyStatic, {
    root: path.join(ROOT, 'public'), prefix: '/', index: false, wildcard: false, maxAge: '1h',
  });
  app.register(fastifyStatic, {
    root: path.join(ROOT, 'node_modules', 'leaflet', 'dist'), prefix: '/vendor/leaflet/',
    decorateReply: false, maxAge: '30d', immutable: true,
  });

  // Per-city share images that exist (public/og/<key>.jpg), read once.
  const shareImages = new Set(fs.existsSync(path.join(ROOT, 'public', 'og')) ? fs.readdirSync(path.join(ROOT, 'public', 'og')) : []);

  // New badges and level-ups, announced once on the next page the user sees.
  function takeAnnouncements(user) {
    const badges = takeUnseenBadges(db, user.id, { now: now() });
    const level = levelFor(totalPoints(db, user.id));
    let levelUp = null;
    if (level.index > user.level_seen) {
      db.prepare('UPDATE users SET level_seen = ? WHERE id = ?').run(level.index, user.id);
      levelUp = level;
      notify(db, user.id, { kind: 'level', text: `You reached ${level.name}.`, link: '/passport' }, { now: now() });
    }
    return badges.length || levelUp ? { badges, levelUp } : null;
  }

  // reply.page({ title, body, status?, ... }) renders a full HTML page in the layout.
  app.decorateReply('page', function page(view) {
    if (view.status) this.code(view.status);
    const req = this.request;
    // HEAD runs the GET handler but discards the body: don't use up announcements on it.
    const delivering = req.user && this.statusCode < 400 && req.method !== 'HEAD';
    // Messages from the team first (SPEC Flow 20): their badges are given now, so they're announced below.
    const messages = delivering && !req.url.startsWith('/admin') ? takeMessages(db, req.user, { now: now() }) : [];
    const announcements = delivering ? takeAnnouncements(req.user) : null;
    // After a stamp or a new badge, nudge a private passport towards sharing (until dismissed 3 times).
    const nudge = req.user && (announcements || view.offerShare) && req.user.default_visibility === 'private'
      && req.user.share_nudge_dismissals < 3 ? shareNudge({ csrf: req.csrfToken(), back: req.url }) : null;
    // Analytics: page events, events queued by earlier redirects, and new badges / level-ups.
    const events = [];
    const add = (name, params) => { try { events.push(buildEvent(name, params)); } catch (err) { req.log.warn(err.message); } };
    for (const [name, params] of view.events || []) add(name, params);
    if (req.user && this.statusCode < 400) events.push(...takeEvents(db, req.user.id));
    for (const b of announcements?.badges || []) add('badge_earned', { badge_slug: b.slug, kind: b.kind });
    if (announcements?.levelUp) add('level_up', { level: announcements.levelUp.name });
    const consent = parseConsent(req.cookies[CONSENT_COOKIE]);
    // Pages whose URL carries a secret (one-time or invite tokens) or a person's handle never load
    // GTM/Umami, and nothing copies their query string into other links.
    const pathname = req.url.split(/[?#]/)[0];
    const private_ = NO_ANALYTICS.some((re) => re.test(pathname)) || /[?&]next=(%2F|\/)pals(%2F|\/)invite/i.test(req.url);
    const path = private_ ? pathname : req.url.split('#')[0];
    return this.type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(String(layout({
        ...view, user: req.user, csrf: req.csrfToken(), announcements, messages, nudge, random: app.random,
        // What Gary wears (SPEC Flow 22): the member's choice, or today's weather where they're looking.
        gary: view.gary || outfitFor(db, req.user, app.weather.current(view.city || req.city)).outfit, events, consent, path,
        theme: view.city || req.city, cities: listCities(db).filter((c) => c.listed),
        baseUrl: config.baseUrl, shareImages,
        canonicalPath: private_ ? null : pathname,
        // Streak and points for the phone header (members only).
        status: req.user ? { streak: weeklyStreak(visitDates(db, req.user.id), localDate(now(), req.city.time_zone)), points: totalPoints(db, req.user.id), unread: unreadCount(db, req.user.id) } : null,
        analytics: private_ ? null : config.analytics || null,
        feedback: req.user ? canSendFeedback(db, req.user.id) : false,
        // The banner asks only when there is something to consent to (GTM) and no choice yet.
        showConsentBanner: !private_ && Boolean(config.analytics?.gtmId) && !consent.chosen && !path.startsWith('/consent'),
      })));
  });

  app.get('/healthz', async (req, reply) => {
    try {
      db.prepare('SELECT 1').get();
      return reply.type('text/plain').send('ok');
    } catch {
      return reply.code(503).type('text/plain').send('db unavailable');
    }
  });

  // Home for one city: the landing page, or the member's dashboard. `suggest` is the nearest
  // listed city to the visitor's IP when it isn't this one (only on "/" before they pick a city).
  function home(req, reply, city, suggest = null) {
    const user = req.user;
    let dash = null;
    if (user) {
      // ?lat&lng comes from "Use my location"; it's used for this page only, never stored.
      dash = homeData(db, user, city, { now: now(), near: parseLatLng(req.query.lat, req.query.lng) });
      dash.tip = garyTip(dash.tipInput);
      dash.groups = { groups: myGroups(db, user.id).map((g) => ({ ...g, goal: goalSummary(db, g.id, { now: now() }) })), allowance: groupAllowance(db, user) };
    }
    const gary = outfitFor(db, user, app.weather.current(city)).outfit;
    return reply.page({ city, gary, ...homePage({
      total: countActiveParks(db, city.id), theme: city, user, dash, gary, today: localDate(now(), city.time_zone),
      cities: listCities(db).filter((c) => c.listed), suggest, csrf: req.csrfToken(),
    }) });
  }

  // Within this distance of a city's center, the home page offers to switch to it.
  // Signed in, opening the site ("/") goes to the member's home city (and from there they stay in
  // whatever city they browse) and, when they're near another city
  // (their IP, or "Use my location"), offers it while they're there, unless they said "Not now" today.
  const SUGGEST_WITHIN_M = 160_000;
  const AWAY_COOKIE = 'pp_away';
  app.get('/', async (req, reply) => {
    let suggest = null;
    const homeCity = req.user?.home_city_id && !req.cityAsked ? cityById(db, req.user.home_city_id) : null;
    if (homeCity) {
      req.city = homeCity;
      reply.rememberCity(homeCity);
    }
    if (req.user) {
      const point = parseLatLng(req.query.lat, req.query.lng) || app.geoip?.lookup(req.ip) || null;
      const near = nearestCity(db, point);
      if (near && near.city.key !== req.city.key && near.distance_m <= SUGGEST_WITHIN_M && req.cookies[AWAY_COOKIE] !== near.city.key) {
        suggest = { ...near.city, away: true };
      }
    } else if (!req.cityRemembered && app.geoip) {
      const near = nearestCity(db, app.geoip.lookup(req.ip));
      if (near && near.city.key !== req.city.key && near.distance_m <= SUGGEST_WITHIN_M) suggest = near.city;
    }
    return home(req, reply, req.city, suggest);
  });
  app.post('/city/away/dismiss', { preHandler: requireUser }, async (req, reply) => {
    const city = cityByKey(db, String(req.body.city || ''));
    if (city) reply.setCookie(AWAY_COOKIE, city.key, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: 86400 });
    return reply.redirect('/', 303);
  });
  app.get('/:city', async (req, reply) => (req.cityFromUrl ? home(req, reply, req.city) : reply.callNotFound()));
  app.get('/privacy', async (req, reply) => reply.page(privacyPage()));
  app.get('/credits', async (req, reply) => {
    const theme = req.city;
    const credits = photoCredits(theme.key);
    if (!credits.length) return reply.callNotFound();
    return reply.page(creditsPage({ theme, credits }));
  });
  app.register(parkRoutes);
  app.register(authRoutes);
  app.register(visitRoutes);
  app.register(passportRoutes);
  app.register(palRoutes);
  app.register(photoRoutes);
  app.register(adminRoutes);
  app.register(ideaRoutes);
  app.register(activityRoutes);
  app.register(notificationRoutes);
  app.register(groupRoutes);
  app.register(communityRoutes);
  app.register(messageRoutes);
  app.register(outfitRoutes);
  app.register(consentRoutes);

  // Friendly HTML errors instead of Fastify's JSON (e.g. an upload over the size limit).
  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    const text = status === 413 || err.code === 'FST_FILES_LIMIT'
      ? 'That upload is too big. Photos can be up to 10 MB, one at a time.'
      : status === 415 ? "This form can't take that kind of upload."
        : status < 500 ? 'Something about that request was wrong. Go back and try again.'
          : 'Something went wrong on our side. Try again in a minute.';
    reply.code(status);
    return reply.page({ title: 'Something went wrong', body: html`<h1>Sorry</h1><p>${text}</p><p><a href="/parks">Back to parks</a></p>` });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404);
    return reply.page({ title: 'Not found', body: html`<h1>Page not found</h1><p><a href="/parks">Browse all parks</a></p>` });
  });

  return app;
}
