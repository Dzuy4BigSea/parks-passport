import { visitsAtPark } from '../domain/visits.js';
import { photosForPark } from '../domain/photos.js';
import { withFaces } from '../domain/visibility.js';
import { ratingSummary, visibleReviews, myRating } from '../domain/ratings.js';
import { localDate } from '../domain/time.js';
import { parkPage } from '../views/pages/park.js';
import { areaForPark, motifForPark, cityById, defaultCity } from '../domain/city.js';
import { nextParks, closestBadge } from '../domain/engagement.js';
import { badgeBoard } from '../domain/badges/index.js';
import { palsWhoStamped } from '../domain/pals.js';
import { isSaved } from '../domain/saved.js';
import { activitiesForPark, visitToday, logsForVisit } from '../domain/activities.js';
import { spotlightFor, recordView, isBot } from '../domain/nonprofits.js';
import { adForPark, tipsFor, recordAdView } from '../domain/ads.js';

/**
 * Renders a park page with everything the viewer may see. `problem` ({ text, area, offerHonor })
 * shows an error next to the stamp, photo or rating form, with status 422.
 */
export function renderParkPage(app, req, reply, park, { problem = null, stamped = null, flash = null, activityFlash = null, events = [] } = {}) {
  const { db } = app;
  const user = req.user;
  if (problem) reply.code(422);
  // The park's own city: its theme, and its clock for "today".
  const theme = cityById(db, park.city_id) || defaultCity(db);
  const today = localDate(app.now(), theme.time_zone);
  // After a stamp: the park's motif on the stamp, and what to go for next.
  const celebrate = stamped && user ? {
    motif: motifForPark(theme, park.slug),
    next: { nextPark: nextParks(db, user.id, { cityId: theme.id })[0] || null, nextBadge: closestBadge(badgeBoard(db, user.id, { cityId: theme.id })) },
  } : null;
  // Healthy activities: what this member can do here, and what they've logged today.
  let activities = null;
  if (user) {
    const visit = visitToday(db, user.id, park.id, today);
    const logs = visit ? logsForVisit(db, visit.id) : [];
    const list = activitiesForPark(db, user, park);
    // Today's logs stay listed with their Undo, even if the activity was switched off since.
    const listed = new Set(list.map((a) => a.id));
    for (const l of logs) if (!listed.has(l.activity_id)) list.push(db.prepare('SELECT * FROM activities WHERE id = ?').get(l.activity_id));
    activities = { list, logs, stampedToday: Boolean(visit), flash: activityFlash, tips: visit ? tipsFor(db, park, theme, { now: app.now(), random: app.random }) : new Map() };
  }
  // One nonprofit spotlight (SPEC Flow 18); a view is counted for real page loads only.
  const spotlight = spotlightFor(db, park, { now: app.now() });
  if (spotlight && req.method === 'GET' && !problem && !isBot(req.headers['user-agent'])) recordView(db, spotlight.id, park.id, { now: app.now() });
  // One nonprofit ad at the bottom (SPEC Flow 25), counted like the spotlight.
  const ad = adForPark(db, park, theme, { now: app.now(), random: app.random });
  if (ad && req.method === 'GET' && !problem && !isBot(req.headers['user-agent'])) recordAdView(db, ad.id, park.id, { now: app.now() });
  return reply.page({ events, ...parkPage({
    spotlight, ad,
    activities,
    theme, area: areaForPark(theme, park), celebrate,
    park, user, csrf: req.csrfToken(), today, problem, stamped, flash,
    myVisits: user ? visitsAtPark(db, user.id, park.id) : [],
    palsHere: user ? palsWhoStamped(db, user.id, [park.id]).get(park.id) || [] : [],
    photos: withFaces(db, user?.id ?? null, photosForPark(db, user, park.id), 'user_id'),
    summary: ratingSummary(db, park.id),
    reviews: withFaces(db, user?.id ?? null, visibleReviews(db, user, park.id), 'user_id'),
    mine: user ? myRating(db, user.id, park.id) : null,
    saved: user ? isSaved(db, user.id, park.id) : false,
  }) });
}
