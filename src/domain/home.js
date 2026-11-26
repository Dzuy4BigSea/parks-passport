import { totalPoints } from './points.js';
import { levelFor } from './levels.js';
import { badgeBoard } from './badges/index.js';
import { passportData } from './passport.js';
import { listParks, parkCardExtras } from './parks.js';
import { travelTime } from './geo.js';
import { weeklyStreak, visitDates, closestBadge, weekPunches } from './engagement.js';
import { weekSummary } from './activities.js';
import { palsFeed, palsWhoStamped } from './pals.js';
import { collections } from './city.js';
import { localDate } from './time.js';

// Everything the signed-in home page shows, for one member in one city (theme; the route adds
// Gary's tip). Only their own data, plus what their Park Pals share. `near` is a position the
// member just shared (never stored). Points, level, streak and recent stamps count every city.
export function homeData(db, user, theme, { now = new Date(), near = null } = {}) {
  const points = totalPoints(db, user.id);
  const { parks, history } = passportData(db, user.id, { cityId: theme.id });
  const stampedSet = new Set(parks.filter((p) => p.first_visit).map((p) => p.id));
  const today = localDate(now, theme.time_zone);
  const dates = visitDates(db, user.id);
  const streak = weeklyStreak(dates, today);

  // Where "closest" is measured from: the member's shared position, else the park of their latest
  // stamp, else the city's first area (downtown).
  const lastHere = history.find((v) => v.city_key === theme.key);
  const lastStamp = lastHere ? parks.find((p) => p.slug === lastHere.park_slug && p.lat != null) : null;
  const anchor = near || (lastStamp ? { lat: lastStamp.lat, lng: lastStamp.lng } : theme.areas[0] || theme.center || null);
  const nearby = anchor
    ? listParks(db, { cityId: theme.id, near: anchor }).filter((p) => !stampedSet.has(p.id) && p.distance_m != null).slice(0, 8)
    : [];
  const nearestSet = new Set(nearby.slice(0, 3).map((p) => p.slug));

  // Neighborhoods with the fewest parks left (started ones first).
  const groups = collections(theme, parks).filter((g) => g.slug !== 'other' && g.stamped < g.total);
  const almost = groups.sort((a, b) => (Boolean(b.stamped) - Boolean(a.stamped)) || (a.total - a.stamped) - (b.total - b.stamped)).slice(0, 2);

  const board = badgeBoard(db, user.id, { cityId: theme.id });
  const nextBadge = closestBadge(board);
  const recent = history.slice(0, 4).map((v) => ({ slug: v.park_slug, city_key: v.city_key, name: v.park_name, visited_on: v.visited_on }));
  const stampedToday = history.find((v) => v.visited_on === today);
  const day = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86400000);
  const lore = theme.motifs.length ? theme.motifs[day % theme.motifs.length] : null;
  // How Gary describes where the closest park is: honest about what the distance is measured from.
  const where = near ? `${travelTime(nearby[0]?.distance_m ?? 0)} away` : lastStamp ? 'close to your last stamp' : 'right downtown';
  const nearest = nearby[0] ? { ...nearby[0], where } : null;

  return {
    stamped: stampedSet.size, stampedSet, points, level: levelFor(points), streak, nextBadge, recent,
    punches: weekPunches(dates, today, 8),
    week: weekSummary(db, user.id, { now, timeZone: theme.time_zone }),
    nearby, anchor, nearFromYou: Boolean(near), extras: parkCardExtras(db, nearby.map((p) => p.id)),
    palsHere: palsWhoStamped(db, user.id, nearby.map((p) => p.id)),
    almost,
    dots: parks.map((p) => ({ lat: p.lat, lng: p.lng, name: p.name, slug: p.slug, stamped: stampedSet.has(p.id), next: nearestSet.has(p.slug) })),
    pals: palsFeed(db, user.id).items.slice(0, 3),
    // What Gary needs to pick his tip (views/gary.js).
    tipInput: {
      stamped: stampedSet.size,
      stampedToday: stampedToday ? { slug: stampedToday.park_slug, city_key: stampedToday.city_key, name: stampedToday.park_name } : null,
      streak, nextBadge, nearest, almost: almost[0] || null, lore, cityKey: theme.key,
    },
  };
}
