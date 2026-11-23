export const TIME_ZONE = 'America/New_York';

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

// Local calendar date in St. Pete, as YYYY-MM-DD.
export const localDate = (d) => dateFmt.format(d);

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
