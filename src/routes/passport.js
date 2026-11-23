import { requireUser } from '../lib/auth.js';
import { badgeBoard } from '../domain/badges/index.js';
import { totalPoints } from '../domain/points.js';
import { levelFor } from '../domain/levels.js';
import { passportPage } from '../views/pages/passport.js';

export default async function passportRoutes(app) {
  const { db } = app;

  app.get('/passport', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    // Every active park, with this user's first and latest visit dates if stamped.
    const parks = db.prepare(`SELECT p.id, p.slug, p.name, p.lat, p.lng,
        MIN(v.visited_on) AS first_visit, COUNT(v.id) AS visit_count
      FROM parks p LEFT JOIN visits v ON v.park_id = p.id AND v.user_id = ?
      WHERE p.active = 1 GROUP BY p.id ORDER BY p.name COLLATE NOCASE`).all(user.id);
    const history = db.prepare(`SELECT v.id, v.visited_on, v.method, v.points, p.name AS park_name, p.slug AS park_slug
      FROM visits v JOIN parks p ON p.id = v.park_id WHERE v.user_id = ?
      ORDER BY v.visited_on DESC, v.id DESC`).all(user.id);
    const points = totalPoints(db, user.id);
    return reply.page(passportPage({
      user, csrf: req.csrfToken(), parks, history, points, level: levelFor(points), badges: badgeBoard(db, user.id),
    }));
  });
}
