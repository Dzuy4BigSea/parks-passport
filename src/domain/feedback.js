// Feedback from Founding Members and Early Bird Edition holders (SPEC Flow 16). Read in Admin › Feedback.

export const KINDS = { idea: 'Idea', bug: "Something's broken", love: 'Love it' };
export const MAX_LENGTH = 1000;
export const DAILY_LIMIT = 20;

/** Saves one message. Returns { ok } or { error, values }. */
export function sendFeedback(db, userId, form, { now = new Date() } = {}) {
  const values = {
    kind: Object.hasOwn(KINDS, form.kind) ? form.kind : 'idea',
    text: String(form.text ?? '').replace(/\r\n?/g, '\n').trim(),
  };
  // Only the path: never a query string (it could carry tokens or a position).
  const path = typeof form.page === 'string' ? form.page.split(/[?#]/)[0] : '';
  const page = /^\/(?!\/)[\w\-/.%~]{0,200}$/.test(path) ? path : ''; // a path in this app, never //host
  if (!values.text) return { error: 'Write a few words first.', values };
  if (values.text.length > MAX_LENGTH) return { error: `Keep it to ${MAX_LENGTH.toLocaleString('en-US')} characters or fewer.`, values };
  const since = new Date(now.getTime() - 86400e3).toISOString();
  if (db.prepare('SELECT COUNT(*) FROM feedback WHERE user_id = ? AND created_at > ?').pluck().get(userId, since) >= DAILY_LIMIT) {
    return { error: "That's a lot of feedback for one day. Thank you! Send more tomorrow.", values };
  }
  db.prepare('INSERT INTO feedback (user_id, kind, text, page, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, values.kind, values.text, page, now.toISOString());
  return { ok: true };
}

/** Admin list, newest first; done ones only when asked. */
export const allFeedback = (db, { done = false } = {}) => db.prepare(`SELECT f.*, u.display_name, u.handle FROM feedback f
  JOIN users u ON u.id = f.user_id WHERE ${done ? 'f.done_at IS NOT NULL' : 'f.done_at IS NULL'}
  ORDER BY f.created_at DESC, f.id DESC LIMIT 200`).all();

export const openFeedbackCount = (db) => db.prepare('SELECT COUNT(*) FROM feedback WHERE done_at IS NULL').pluck().get();

export const setFeedbackDone = (db, id, done, { now = new Date() } = {}) =>
  db.prepare('UPDATE feedback SET done_at = ? WHERE id = ?').run(done ? now.toISOString() : null, id).changes > 0;
