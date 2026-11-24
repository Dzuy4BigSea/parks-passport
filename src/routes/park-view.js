import { visitsAtPark } from '../domain/visits.js';
import { photosForPark } from '../domain/photos.js';
import { ratingSummary, visibleReviews, myRating } from '../domain/ratings.js';
import { localDate } from '../domain/time.js';
import { parkPage } from '../views/pages/park.js';
import { areaForPark, motifForPark } from '../domain/city.js';
import { nextParks, closestBadge } from '../domain/engagement.js';
import { badgeBoard } from '../domain/badges/index.js';
import { isSaved } from '../domain/saved.js';

/**
 * Renders a park page with everything the viewer may see. `problem` ({ text, area, offerHonor })
 * shows an error next to the stamp, photo or rating form, with status 422.
 */
export function renderParkPage(app, req, reply, park, { problem = null, stamped = null, flash = null, events = [] } = {}) {
  const { db } = app;
  const user = req.user;
  if (problem) reply.code(422);
  const theme = app.theme();
  // After a stamp: the park's motif on the stamp, and what to go for next.
  const celebrate = stamped && user ? {
    motif: motifForPark(theme, park.slug),
    next: { nextPark: nextParks(db, user.id)[0] || null, nextBadge: closestBadge(badgeBoard(db, user.id)) },
  } : null;
  return reply.page({ events, ...parkPage({
    theme, area: areaForPark(theme, park), celebrate,
    park, user, csrf: req.csrfToken(), today: localDate(app.now()), problem, stamped, flash,
    myVisits: user ? visitsAtPark(db, user.id, park.id) : [],
    photos: photosForPark(db, user, park.id),
    summary: ratingSummary(db, park.id),
    reviews: visibleReviews(db, user, park.id),
    mine: user ? myRating(db, user.id, park.id) : null,
    saved: user ? isSaved(db, user.id, park.id) : false,
  }) });
}
