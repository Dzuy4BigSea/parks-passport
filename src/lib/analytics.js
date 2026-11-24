// Analytics events (SPEC Flow 10): exact names and parameter keys, and no personal data.

export const EVENTS = {
  sign_up: ['method'],
  login: ['method'],
  park_view: ['park_slug'],
  park_search: ['has_query', 'filter_count'],
  check_in: ['park_slug', 'method'],
  photo_upload: ['park_slug'],
  activity_log: ['activity_slug', 'pillar'],
  rating_submit: ['park_slug', 'stars'],
  badge_earned: ['badge_slug', 'kind'],
  level_up: ['level'],
  pal_invite_created: [],
  pal_accepted: [],
  share_prompt_action: ['action'],
  consent_update: ['analytics', 'ads'],
};

/**
 * Returns the event as { event, ...params } or throws if the name, keys or values are not allowed:
 * values must be booleans, finite numbers, or strings of at most 100 characters without "@".
 */
export function buildEvent(name, params = {}) {
  const keys = EVENTS[name];
  if (!keys) throw new Error(`Unknown analytics event "${name}"`);
  const given = Object.keys(params).sort();
  if (JSON.stringify(given) !== JSON.stringify([...keys].sort())) {
    throw new Error(`Analytics event "${name}" needs exactly [${keys.join(', ')}], got [${given.join(', ')}]`);
  }
  for (const [k, v] of Object.entries(params)) {
    const ok = typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
      || (typeof v === 'string' && v.length <= 100 && !v.includes('@'));
    if (!ok) throw new Error(`Analytics event "${name}": value of "${k}" is not allowed`);
  }
  return { event: name, ...params };
}

// Queues an event for the user's next page (for actions that redirect). Invalid events are
// dropped and logged rather than breaking the request.
export function queueEvent(db, userId, name, params = {}, { now = new Date(), log = console } = {}) {
  let ev;
  try {
    ev = buildEvent(name, params);
  } catch (err) {
    log.warn?.(err.message);
    return;
  }
  db.prepare('INSERT INTO analytics_events (user_id, payload, created_at) VALUES (?, ?, ?)')
    .run(userId, JSON.stringify(ev), now.toISOString());
}

export function takeEvents(db, userId) {
  const rows = db.prepare('SELECT id, payload FROM analytics_events WHERE user_id = ? ORDER BY id').all(userId);
  if (rows.length) db.prepare('DELETE FROM analytics_events WHERE user_id = ?').run(userId);
  return rows.map((r) => JSON.parse(r.payload));
}

// ---- Consent cookie: "v1.a1.d0" = analytics granted, ads denied. Absent = no choice yet. ----
export const CONSENT_COOKIE = 'pp_consent';
export const CONSENT_MAX_AGE = 182 * 86400; // ~6 months

export function parseConsent(value) {
  const m = /^v1\.a([01])\.d([01])$/.exec(String(value || ''));
  return m ? { chosen: true, analytics: m[1] === '1', ads: m[2] === '1' } : { chosen: false, analytics: false, ads: false };
}

export const serializeConsent = ({ analytics, ads }) => `v1.a${analytics ? 1 : 0}.d${ads ? 1 : 0}`;

// JSON for an inline <script>: "<" escaped so no string can close the script element.
export const inlineJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
