/**
 * Parks Passport's badge rule types, plugged into the gamification engine (src/gamification/).
 * Badge rule types. Each takes (params, ctx) and returns { earned, progress?, target? }.
 * progress/target drive the "7 / 10 parks" display for known badges.
 *
 * ctx = {
 *   visits: [{ id, park_id, visited_on, visited_at, created_at, method, city_id, time_zone }],
 *   parkCity: Map<park_id, city_id>,
 *   parkCategories: Map<park_id, Set<category>>,
 *   activeParkIds: Set<park_id>,
 *   palSameDay: boolean,            // a pal stamped the same park on the same day (M6)
 *   activityLogs: [{ slug, pillar, edition, category, park_id, logged_on, minutes, miles }],
 *   trigger: { type: 'visit' | 'photo' | 'rating' | 'pal' | 'activity', id },
 *   random: () => number,           // injectable for tests
 * }
 */
import { DEFAULT_TIME_ZONE } from '../time.js';
import { countProgress as count } from '../../gamification/index.js';

const distinctParks = (visits) => new Set(visits.map((v) => v.park_id));

// "HH:MM" on the clock where the park is (each city has its own time zone).
const timeFmts = new Map();
const localTime = (iso, timeZone = DEFAULT_TIME_ZONE) => {
  if (!timeFmts.has(timeZone)) timeFmts.set(timeZone, new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  return timeFmts.get(timeZone).format(new Date(iso));
};

// Days since epoch for a YYYY-MM-DD date (UTC math, no DST surprises).
export const dayNumber = (ymd) => Math.floor(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86400000);
// 1970-01-01 was a Thursday. Weeks start Monday; weekends are keyed by their Saturday.
const weekdayOf = (day) => (day + 4) % 7; // 0 = Sunday … 6 = Saturday
export const mondayOf = (day) => day - ((weekdayOf(day) + 6) % 7);

/** A lucky drop's chance on a member's nth stamp: chance, halving every half_life stamps, never below floor. */
export const luckyChance = (n, { chance, floor = 0, half_life = 1 }) => Math.max(floor, chance * 0.5 ** ((n - 1) / half_life));

export const RULES = {
  gps_checkins: {
    label: 'Check in by GPS N times',
    params: { n: 'number' },
    evaluate: ({ n }, ctx) => count(ctx.visits.filter((v) => v.method === 'gps').length, n, 'GPS check-ins'),
  },

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
        const t = localTime(v.visited_at, v.time_zone);
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

  cities_count: {
    label: 'Stamp parks in N different cities',
    params: { n: 'number' },
    evaluate: ({ n }, ctx) => count(new Set(ctx.visits.map((v) => v.city_id).filter((c) => c != null)).size, n, 'cities'),
  },

  lucky: {
    label: 'Awarded at random on a stamp',
    params: { probability: 'number' },
    permanent: true, // a lucky drop is never taken back
    // Only rolls when a stamp triggered the evaluation; never re-rolled on other events.
    evaluate: ({ probability }, ctx) => ({ earned: ctx.trigger?.type === 'visit' && ctx.random() < probability }),
  },

  // ---- Reward schedule (SPEC Flow 7): surprises early, rarer later ----

  manual: {
    label: 'Given by an admin only (never earned automatically)',
    params: {},
    evaluate: () => ({ earned: false }),
  },

  milestone: {
    label: 'Do something for the first time (a surprise)',
    params: { action: 'milestone' },
    evaluate: ({ action }, ctx) => ({ earned: Boolean(ctx.milestones?.has(action)) }),
  },

  // Lucky drops in a fixed order, at most one per stamp (one roll per stamp, for the next unearned
  // drop). The chance starts high and halves every half_life stamps, down to a floor: frequent
  // for newcomers, an occasional surprise for regulars.
  lucky_drop: {
    label: 'Lucky drop on a stamp (likely early, rarer later; one per stamp, in order)',
    params: { order: 'number', chance: 'chance', floor: 'chance', half_life: 'number' },
    permanent: true,
    evaluate: ({ order, chance, floor = 0, half_life = 1 }, ctx) => {
      if (ctx.trigger?.type !== 'visit' || order !== ctx.nextLuckyOrder || ctx.lucky?.dropped) return { earned: false };
      const earned = ctx.luckyRoll < luckyChance(Math.max(1, ctx.lucky?.rolls || ctx.visits.length), { chance, floor, half_life });
      if (earned && ctx.lucky) ctx.lucky.dropped = true; // two drops sharing an order: still only one
      return { earned };
    },
  },

  // ---- Healthy activities (docs/healthy-activities.md) ----
  // `target` picks which logs count: "any", "pillar:<pillar>", "edition:<edition>" or "activity:<slug>".

  activity_count: {
    label: 'Log N activities (of a kind)',
    params: { target: 'target', n: 'number' },
    evaluate: ({ target, n }, ctx) => count(logsFor(ctx, target).length, n, 'activities'),
  },

  activity_parks: {
    label: 'Log activities (of a kind) at N different parks',
    params: { target: 'target', n: 'number' },
    evaluate: ({ target, n }, ctx) => count(new Set(logsFor(ctx, target).map((l) => l.park_id)).size, n, 'parks'),
  },

  activity_sum: {
    label: 'Log a total of minutes or miles (within a window of days; 0 = all time)',
    params: { target: 'target', metric: 'metric', total: 'amount', window_days: 'days' },
    evaluate: ({ target, metric, total, window_days: windowDays }, ctx) => {
      const days = byDay(logsFor(ctx, target), (l) => l[metric] || 0);
      const best = windowDays ? bestWindow(days, windowDays, (vals) => vals.reduce((s, v) => s + v, 0)) : sumOf([...days.values()]);
      return count(round1(best), total, metric);
    },
  },

  weekly_sum: {
    label: 'Reach a weekly total of minutes or miles for N weeks (one missed week allowed)',
    params: { target: 'target', metric: 'metric', total: 'amount', n: 'number' },
    evaluate: ({ target, metric, total, n }, ctx) => {
      const weeks = new Map();
      for (const l of logsFor(ctx, target)) {
        const w = mondayOf(dayNumber(l.logged_on));
        weeks.set(w, (weeks.get(w) || 0) + (l[metric] || 0));
      }
      // For a one-week goal, show progress as the best week's total ("95 / 150 minutes").
      if (n === 1) return count(round1(Math.max(0, ...weeks.values())), total, `${metric} in a week`);
      return count(weekRun([...weeks].filter(([, v]) => v >= total - 1e-9).map(([w]) => w)), n, 'weeks');
    },
  },

  weekly_days: {
    label: 'Log activities (of a kind) on N days a week, for N weeks (one missed week allowed)',
    params: { target: 'target', per_week: 'per_week', n: 'number' },
    evaluate: ({ target, per_week: perWeek, n }, ctx) => {
      const weeks = new Map();
      for (const l of logsFor(ctx, target)) {
        const w = mondayOf(dayNumber(l.logged_on));
        if (!weeks.has(w)) weeks.set(w, new Set());
        weeks.get(w).add(l.logged_on);
      }
      return count(weekRun([...weeks].filter(([, s]) => s.size >= perWeek).map(([w]) => w)), n, 'weeks');
    },
  },

  pillar_variety: {
    label: 'Log activities from N different pillars within a window of days',
    params: { n: 'number', window_days: 'days' },
    evaluate: ({ n, window_days: windowDays }, ctx) => {
      const days = new Map();
      for (const l of ctx.activityLogs || []) {
        const d = dayNumber(l.logged_on);
        if (!days.has(d)) days.set(d, []);
        days.get(d).push(l.pillar);
      }
      const variety = (vals) => new Set(vals.flat()).size;
      return count(windowDays ? bestWindow(days, windowDays, variety) : variety([...days.values()]), n, 'pillars');
    },
  },

  activity_categories: {
    label: 'Log facility activities at N different kinds of facility',
    params: { n: 'number' },
    evaluate: ({ n }, ctx) => count(new Set((ctx.activityLogs || []).filter((l) => l.category).map((l) => l.category)).size, n, 'facilities'),
  },
};

// Logs matching a badge's target.
export function matchesTarget(target, log) {
  if (!target || target === 'any') return true;
  const [kind, value] = String(target).split(':');
  if (kind === 'pillar') return log.pillar === value;
  if (kind === 'edition') return log.edition === value;
  if (kind === 'activity') return log.slug === value;
  return false;
}
const logsFor = (ctx, target) => (ctx.activityLogs || []).filter((l) => matchesTarget(target, l));

const round1 = (x) => Math.round(x * 10) / 10;
const sumOf = (vals) => vals.reduce((s, v) => s + (Array.isArray(v) ? sumOf(v) : v), 0);

// Map<dayNumber, value[]> of the logs.
function byDay(logs, value) {
  const days = new Map();
  for (const l of logs) {
    const d = dayNumber(l.logged_on);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(value(l));
  }
  return days;
}

// The best score over any run of `windowDays` consecutive days. score(values[]) -> number.
function bestWindow(days, windowDays, score) {
  let best = 0;
  for (const start of days.keys()) {
    const vals = [];
    for (const [d, v] of days) if (d >= start && d < start + windowDays) vals.push(...v);
    best = Math.max(best, score(vals));
  }
  return best;
}

// Longest run of qualifying weeks (Monday day numbers). A run survives one missed week, which
// doesn't count toward it (habits survive the odd miss: Lally et al. 2010).
function weekRun(weeks) {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  // A sliding window over the weeks holding at most one two-week gap: a second gap moves the
  // start past the first one; a longer gap starts over.
  let best = 0;
  let start = 0;
  let gapAt = -1;
  for (let i = 0; i < sorted.length; i++) {
    const gap = i > 0 ? sorted[i] - sorted[i - 1] : 0;
    if (gap > 14) { start = i; gapAt = -1; } else if (gap === 14) {
      if (gapAt >= 0) start = gapAt;
      gapAt = i;
    }
    best = Math.max(best, i - start + 1);
  }
  return best;
}

/** The edition a badge belongs to ('core', 'paws' or 'kids'), from its target. */
export function badgeEdition(badge, activityEditions) {
  let target;
  try { target = JSON.parse(badge.rule_params || '{}').target; } catch { return 'core'; }
  const [kind, value] = String(target || '').split(':');
  if (kind === 'edition') return value;
  if (kind === 'activity') return activityEditions.get(value) || 'core';
  return 'core';
}

export const RULE_TYPES = Object.keys(RULES);
