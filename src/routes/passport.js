import { requireUser } from '../lib/auth.js';
import { badgeBoard } from '../domain/badges/index.js';
import { totalPoints } from '../domain/points.js';
import { levelFor } from '../domain/levels.js';
import { passportData } from '../domain/passport.js';
import { passportPage } from '../views/pages/passport.js';

export default async function passportRoutes(app) {
  const { db } = app;

  app.get('/passport', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    const points = totalPoints(db, user.id);
    return reply.page(passportPage({
      ...passportData(db, user.id), user, csrf: req.csrfToken(), points, level: levelFor(points),
      badges: badgeBoard(db, user.id),
    }));
  });
}
