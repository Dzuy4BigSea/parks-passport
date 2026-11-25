// St. Pete's zone: the default for anything not tied to a park. A park's own city sets the zone for
// its stamps (city.time_zone), so "today" at a Westminster park is today in California.
export const DEFAULT_TIME_ZONE = 'America/New_York';
export const TIME_ZONE = DEFAULT_TIME_ZONE;

const dateFmts = new Map();
const dateFmt = (timeZone) => {
  if (!dateFmts.has(timeZone)) dateFmts.set(timeZone, new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }));
  return dateFmts.get(timeZone);
};

// Local calendar date in a time zone (default St. Pete's), as YYYY-MM-DD.
export const localDate = (d, timeZone = DEFAULT_TIME_ZONE) => dateFmt(timeZone).format(d);

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// True for a real calendar date string YYYY-MM-DD.
export function isValidDate(s) {
  const m = DATE_RE.exec(String(s));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// "June 1, 2026"
export function formatDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
}
