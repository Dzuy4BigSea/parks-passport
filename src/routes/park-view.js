import { visitsAtPark } from '../domain/visits.js';
import { photosForPark } from '../domain/photos.js';
import { ratingSummary, visibleReviews, myRating } from '../domain/ratings.js';
import { localDate } from '../domain/time.js';
import { parkPage } from '../views/pages/park.js';

/**
 * Renders a park page with everything the viewer may see. `problem` ({ text, area, offerHonor })
 * shows an error next to the stamp, photo or rating form, with status 422.
 */
export function renderParkPage(app, req, reply, park, { problem = null, stamped = null, flash = null, events = [] } = {}) {
  const { db } = app;
  const user = req.user;
  if (problem) reply.code(422);
  return reply.page({ events, ...parkPage({
    park, user, csrf: req.csrfToken(), today: localDate(app.now()), problem, stamped, flash,
    myVisits: user ? visitsAtPark(db, user.id, park.id) : [],
    photos: photosForPark(db, user, park.id),
    summary: ratingSummary(db, park.id),
    reviews: visibleReviews(db, user, park.id),
    mine: user ? myRating(db, user.id, park.id) : null,
  }) });
}
