// Messages from the team (SPEC Flow 20): an admin's short note (a thank-you, a holiday greeting, a
// maintenance heads-up, a giveaway) that opens with an animation on a member's next page, once,
// optionally bringing badges. Text is plain (escaped when rendered).
import { grantBadge, NOTE_MAX } from './badges/index.js';
import { notify } from './notifications.js';

export const EFFECTS = {
  celebrate: { label: 'Celebration', emoji: '🎉', hint: 'Confetti. Thank-yous, milestones, launches.' },
  thanks: { label: 'Thank you', emoji: '💛', hint: 'Rising hearts. Gratitude.' },
  autumn: { label: 'Autumn', emoji: '🍂', hint: 'Falling leaves. Thanksgiving and fall.' },
  winter: { label: 'Winter', emoji: '❄️', hint: 'Snowfall. Winter holidays.' },
  gift: { label: 'Giveaway', emoji: '🎁', hint: 'A gift box pops open. Freebies and giveaways.' },
  notice: { label: 'Heads-up', emoji: '🛠️', hint: 'Calm, no particles. Maintenance and notices.' },
};

export const AUDIENCES = {
  everyone: 'Everyone',
  city: 'Members of one city (anyone with a stamp there)',
  badge: 'Holders of a badge',
  picked: 'Picked members',
};

export const TITLE_MAX = 80;
export const BODY_MAX = 500;
export const PER_PAGE = 3; // at most this many messages open on one page; the rest wait for the next

// ---------- Time zones: the form's local date-times <-> UTC ----------

const partsIn = (date, timeZone) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
};

/** "2026-11-26T09:00" in a time zone -> a UTC ISO string, or null if it isn't a date-time. */
export function zonedToUtc(local, timeZone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local || '').trim());
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (Number.isNaN(guess) || new Date(guess).getUTCDate() !== +m[3]) return null;
  let utc = guess - (partsIn(new Date(guess), timeZone) - guess);
  utc = guess - (partsIn(new Date(utc), timeZone) - utc); // again, in case the offset changed (DST)
  return new Date(utc).toISOString();
}

/** A UTC ISO string -> "2026-11-26T09:00" in a time zone (for the form), or ''. */
export function utcToZoned(iso, timeZone) {
  if (!iso) return '';
  return new Date(partsIn(new Date(iso), timeZone)).toISOString().slice(0, 16);
}

// ---------- Compose ----------

const clean = (s) => String(s ?? '').replace(/\r\n?/g, '\n').trim();

/**
 * Validates the compose form. `timeZone` reads the window's local date-times. Returns
 * { message } (columns to save) or { errors: { field: text }, values }.
 */
export function validateMessage(db, form, { timeZone }) {
  const values = {
    title: clean(form.title).replace(/\s+/g, ' '),
    body: clean(form.body).replace(/\n{3,}/g, '\n\n'),
    effect: Object.hasOwn(EFFECTS, form.effect) ? form.effect : 'celebrate',
    audience: Object.hasOwn(AUDIENCES, form.audience) ? form.audience : 'everyone',
    city: String(form.city || ''),
    badge: String(form.badge || ''),
    existing_only: form.existing_only === '1' || form.existing_only === 'on' ? 1 : 0,
    badge_ids: [...new Set([].concat(form.badge_ids || []).filter((v) => /^\d+$/.test(String(v))).map(Number))],
    user_ids: [...new Set([].concat(form.user_ids || form.user_id || []).filter((v) => /^\d+$/.test(String(v))).map(Number))],
    starts_local: String(form.starts_at || '').trim(),
    ends_local: String(form.ends_at || '').trim(),
  };
  const errors = {};
  if (!values.title) errors.title = 'Give it a title.';
  else if (values.title.length > TITLE_MAX) errors.title = `Keep the title to ${TITLE_MAX} characters.`;
  if (values.body.length > BODY_MAX) errors.body = `Keep the message to ${BODY_MAX} characters.`;
  let audienceRef = '';
  if (values.audience === 'city') {
    if (!db.prepare('SELECT 1 FROM city_themes WHERE key = ?').get(values.city)) errors.city = 'Choose a city.';
    audienceRef = values.city;
  } else if (values.audience === 'badge') {
    if (!db.prepare('SELECT 1 FROM badges WHERE slug = ?').get(values.badge)) errors.badge = 'Choose a badge.';
    audienceRef = values.badge;
  } else if (values.audience === 'picked') {
    const known = values.user_ids.length
      ? db.prepare(`SELECT COUNT(*) FROM users WHERE id IN (${values.user_ids.map(() => '?').join(',')})`).pluck().get(...values.user_ids) : 0;
    if (!known) errors.audience = 'Pick at least one member (tick them in Admin › Members, then “Message ticked members”).';
  }
  const found = values.badge_ids.length
    ? db.prepare(`SELECT id FROM badges WHERE id IN (${values.badge_ids.map(() => '?').join(',')})`).pluck().all(...values.badge_ids) : [];
  values.badge_ids = values.badge_ids.filter((id) => found.includes(id));
  if (values.badge_ids.length > 5) errors.badge_ids = 'Give at most 5 badges with one message.';
  const starts = values.starts_local ? zonedToUtc(values.starts_local, timeZone) : null;
  const ends = values.ends_local ? zonedToUtc(values.ends_local, timeZone) : null;
  if (values.starts_local && !starts) errors.starts_at = 'Use a date and time.';
  if (values.ends_local && !ends) errors.ends_at = 'Use a date and time.';
  if (starts && ends && ends <= starts) errors.ends_at = 'End it after it starts.';
  if (Object.keys(errors).length) return { errors, values };
  return {
    message: {
      title: values.title, body: values.body, effect: values.effect, audience: values.audience, audience_ref: audienceRef,
      existing_only: values.existing_only, badge_ids: JSON.stringify(values.badge_ids), starts_at: starts, ends_at: ends,
    },
    userIds: values.audience === 'picked' ? values.user_ids : [],
  };
}

/** Saves a new draft, or changes a draft (only drafts can change). Returns the id, or null. */
export function saveDraft(db, { admin, id = null, message, userIds = [] }, { now = new Date() } = {}) {
  const at = now.toISOString();
  return db.transaction(() => {
    let messageId = id;
    if (id) {
      const r = db.prepare(`UPDATE team_messages SET title = @title, body = @body, effect = @effect, audience = @audience,
        audience_ref = @audience_ref, existing_only = @existing_only, badge_ids = @badge_ids, starts_at = @starts_at, ends_at = @ends_at,
        updated_at = @at WHERE id = @id AND status = 'draft'`).run({ ...message, at, id });
      if (!r.changes) return null;
    } else {
      messageId = Number(db.prepare(`INSERT INTO team_messages (title, body, effect, audience, audience_ref, existing_only, badge_ids,
        starts_at, ends_at, status, created_by, created_at, updated_at) VALUES (@title, @body, @effect, @audience, @audience_ref,
        @existing_only, @badge_ids, @starts_at, @ends_at, 'draft', @by, @at, @at)`).run({ ...message, by: admin.id, at }).lastInsertRowid);
    }
    db.prepare('DELETE FROM team_message_recipients WHERE message_id = ?').run(messageId);
    const add = db.prepare('INSERT OR IGNORE INTO team_message_recipients (message_id, user_id) SELECT ?, id FROM users WHERE id = ?');
    for (const userId of userIds) add.run(messageId, userId);
    return messageId;
  })();
}

export const messageById = (db, id) => db.prepare('SELECT * FROM team_messages WHERE id = ?').get(id) || null;
export const recipientIds = (db, id) => db.prepare('SELECT user_id FROM team_message_recipients WHERE message_id = ? ORDER BY user_id').pluck().all(id);
export const badgeIdsOf = (m) => { try { const v = JSON.parse(m.badge_ids); return Array.isArray(v) ? v : []; } catch { return []; } };

// ---------- Audience ----------

/**
 * SQL (and its parameters) for the members a message reaches, as `users u` rows. `since` is the
 * moment it starts showing (see liveSince), for "only members who joined before it goes live".
 */
function audienceSql(m, since) {
  const where = [];
  const params = [];
  if (m.audience === 'city') {
    where.push(`EXISTS (SELECT 1 FROM visits v JOIN parks p ON p.id = v.park_id JOIN city_themes c ON c.id = p.city_id
      WHERE v.user_id = u.id AND c.key = ?)`);
    params.push(m.audience_ref);
  } else if (m.audience === 'badge') {
    where.push('EXISTS (SELECT 1 FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = u.id AND b.slug = ?)');
    params.push(m.audience_ref);
  } else if (m.audience === 'picked') {
    where.push('EXISTS (SELECT 1 FROM team_message_recipients r WHERE r.message_id = ? AND r.user_id = u.id)');
    params.push(m.id);
  }
  if (m.existing_only) { where.push('u.created_at <= ?'); params.push(since); }
  return { sql: where.length ? where.join(' AND ') : '1', params };
}

/** When a message starts showing: its start time, or when it was published (now, for a draft), whichever is later. */
const liveSince = (m, now) => {
  const published = m.published_at || now.toISOString();
  return m.starts_at && m.starts_at > published ? m.starts_at : published;
};

/** How many members a message reaches right now. */
export function reachCount(db, m, { now = new Date() } = {}) {
  const { sql, params } = audienceSql(m, liveSince(m, now));
  return db.prepare(`SELECT COUNT(*) FROM users u WHERE ${sql}`).pluck().get(...params);
}

// ---------- Lifecycle ----------

export function publishMessage(db, id, { now = new Date() } = {}) {
  return db.prepare(`UPDATE team_messages SET status = 'live', published_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'`)
    .run(now.toISOString(), now.toISOString(), id).changes > 0;
}

export function endMessage(db, id, { now = new Date() } = {}) {
  return db.prepare(`UPDATE team_messages SET status = 'ended', updated_at = ? WHERE id = ? AND status = 'live'`)
    .run(now.toISOString(), id).changes > 0;
}

export const deleteDraft = (db, id) => db.prepare("DELETE FROM team_messages WHERE id = ? AND status = 'draft'").run(id).changes > 0;

/** Draft, Scheduled (live, not started), Live, Ended (ended, or past its window). */
export function stateOf(m, now = new Date()) {
  const at = now.toISOString();
  if (m.status === 'draft') return 'draft';
  if (m.status === 'ended' || (m.ends_at && m.ends_at <= at)) return 'ended';
  if (m.starts_at && m.starts_at > at) return 'scheduled';
  return 'live';
}

/** Every message for Admin › Messages, newest first, with its views. */
export function messagesForAdmin(db) {
  return db.prepare(`SELECT m.*, u.display_name AS author,
      (SELECT COUNT(*) FROM team_message_views v WHERE v.message_id = m.id) AS seen
    FROM team_messages m LEFT JOIN users u ON u.id = m.created_by ORDER BY m.id DESC LIMIT 200`).all();
}

// ---------- Delivery ----------

/**
 * The member's live messages they haven't seen (oldest first, at most PER_PAGE), marked seen now.
 * Their badges are given now, by the message's author ("Given by an admin"), with the title as
 * the note; a badge they already have is skipped. Each also goes in their notifications.
 * Returns [{ id, title, body, effect, badges: [{ name, art, ... }] }].
 */
export function takeMessages(db, user, { now = new Date() } = {}) {
  const at = now.toISOString();
  const live = db.prepare(`SELECT m.*, a.display_name AS author_name FROM team_messages m LEFT JOIN users a ON a.id = m.created_by
    WHERE m.status = 'live' AND (m.starts_at IS NULL OR m.starts_at <= ?) AND (m.ends_at IS NULL OR m.ends_at > ?)
      AND NOT EXISTS (SELECT 1 FROM team_message_views v WHERE v.message_id = m.id AND v.user_id = ?)
    ORDER BY COALESCE(m.starts_at, m.published_at), m.id`).all(at, at, user.id);
  const out = [];
  for (const m of live) {
    if (out.length >= PER_PAGE) break;
    const { sql, params } = audienceSql(m, liveSince(m, now));
    if (!db.prepare(`SELECT 1 FROM users u WHERE u.id = ? AND ${sql}`).get(user.id, ...params)) continue;
    const taken = db.transaction(() => {
      if (!db.prepare('INSERT OR IGNORE INTO team_message_views (message_id, user_id, seen_at) VALUES (?, ?, ?)').run(m.id, user.id, at).changes) return null;
      const admin = { id: m.created_by, display_name: m.author_name || 'The Parks Passport team' };
      const badges = [];
      for (const badgeId of badgeIdsOf(m)) {
        const r = grantBadge(db, { admin, userId: user.id, badgeId, note: m.title.slice(0, NOTE_MAX) }, { now });
        if (r.ok) badges.push({ name: r.badge.name, art: r.badge.art });
      }
      notify(db, user.id, { kind: 'message', text: m.title, link: '' }, { now });
      return { id: m.id, title: m.title, body: m.body, effect: Object.hasOwn(EFFECTS, m.effect) ? m.effect : 'celebrate', badges };
    })();
    if (taken) out.push(taken);
  }
  return out;
}
