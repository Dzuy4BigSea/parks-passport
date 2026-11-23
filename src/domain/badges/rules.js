/**
 * Badge rule types. Each takes (params, ctx) and returns { earned, progress?, target? }.
 * progress/target drive the "7 / 10 parks" display for known badges.
 *
 * ctx = {
 *   visits: [{ id, park_id, visited_on, visited_at, created_at, method }],   // the user's visits
 *   parkCategories: Map<park_id, Set<category>>,
 *   activeParkIds: Set<park_id>,
 *   palSameDay: boolean,            // a pal stamped the same park on the same day (M6)
 *   trigger: { type: 'visit' | 'photo' | 'rating' | 'pal', id },
 *   random: () => number,           // injectable for tests
 * }
 */
import { TIME_ZONE } from '../time.js';

const distinctParks = (visits) => new Set(visits.map((v) => v.park_id));
const count = (n, target, unit) => ({ earned: n >= target, progress: Math.min(n, target), target, unit });

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// Days since epoch for a YYYY-MM-DD date (UTC math, no DST surprises).
const dayNumber = (ymd) => Math.floor(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86400000);
// 1970-01-01 was a Thursday. Weeks start Monday; weekends are keyed by their Saturday.
const weekdayOf = (day) => (day + 4) % 7; // 0 = Sunday … 6 = Saturday
const mondayOf = (day) => day - ((weekdayOf(day) + 6) % 7);

export const RULES = {
  parks_count: {
    label: 'Stamp N different parks',
    params: { n: 'number' },
    evaluate: ({ n }, ctx) => count(distinctParks(ctx.visits).size, n, 'parks'),
  },

  category_count: {
    label: 'Stamp N different parks with an amenity',
    params: { category: 'category', n: 'number' },
    evaluate: ({ category, n }, ctx) => {
      const parks = [...distinctParks(ctx.visits)].filter((id) => ctx.parkCategories.get(id)?.has(category));
      return count(parks.length, n, 'parks');
    },
  },

  same_park_count: {
    label: 'Stamp the same park on N different days',
    params: { n: 'number' },
    evaluate: ({ n }, ctx) => {
      const per = new Map();
      for (const v of ctx.visits) per.set(v.park_id, (per.get(v.park_id) || 0) + 1);
      return count(Math.max(0, ...per.values()), n, 'visits');
    },
  },

  time_of_day: {
    label: 'Stamp a park between two times (local)',
    params: { start: 'time', end: 'time' },
    // Only stamps made on the day of the visit have a real time (backdated ones don't).
    evaluate: ({ start, end }, ctx) => ({
      earned: ctx.visits.some((v) => {
        if (v.visited_at !== v.created_at) return false; // backdated: no real time of day
        const t = timeFmt.format(new Date(v.visited_at));
        return start <= end ? t >= start && t < end : t >= start || t < end;
      }),
    }),
  },

  weekend_parks: {
    label: 'Stamp N different parks in one weekend (Sat–Sun)',
    params: { n: 'number' },
    evaluate: ({ n }, ctx) => {
      const byWeekend = new Map();
      for (const v of ctx.visits) {
        const day = dayNumber(v.visited_on);
        const wd = weekdayOf(day);
        if (wd !== 6 && wd !== 0) continue;
        const saturday = wd === 6 ? day : day - 1;
        if (!byWeekend.has(saturday)) byWeekend.set(saturday, new Set());
        byWeekend.get(saturday).add(v.park_id);
      }
      return count(Math.max(0, ...[...byWeekend.values()].map((s) => s.size)), n, 'parks in a weekend');
    },
  },

  weekly_streak: {
    label: 'Stamp at least once a week for N weeks in a row',
    params: { n: 'number' },
    evaluate: ({ n }, ctx) => {
      const weeks = [...new Set(ctx.visits.map((v) => mondayOf(dayNumber(v.visited_on))))].sort((a, b) => a - b);
      let best = 0;
      let run = 0;
      for (let i = 0; i < weeks.length; i++) {
        run = i > 0 && weeks[i] - weeks[i - 1] === 7 ? run + 1 : 1;
        best = Math.max(best, run);
      }
      return count(best, n, 'weeks');
    },
  },

  pal_same_day: {
    label: 'Stamp a park on the same day as a Park Pal',
    params: {},
    evaluate: (_params, ctx) => ({ earned: Boolean(ctx.palSameDay) }),
  },

  all_parks: {
    label: 'Stamp every park',
    params: {},
    evaluate: (_params, ctx) => {
      const stamped = distinctParks(ctx.visits);
      const done = [...ctx.activeParkIds].filter((id) => stamped.has(id)).length;
      return { earned: ctx.activeParkIds.size > 0 && done === ctx.activeParkIds.size, progress: done, target: ctx.activeParkIds.size, unit: 'parks' };
    },
  },

  lucky: {
    label: 'Awarded at random on a stamp',
    params: { probability: 'number' },
    // Only rolls when a stamp triggered the evaluation; never re-rolled on other events.
    evaluate: ({ probability }, ctx) => ({ earned: ctx.trigger?.type === 'visit' && ctx.random() < probability }),
  },
};

export const RULE_TYPES = Object.keys(RULES);
