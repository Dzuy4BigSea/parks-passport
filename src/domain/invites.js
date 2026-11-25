import { randomToken, sha256 } from '../lib/crypto.js';
import { normalizeEmail, findUserByEmail } from './users.js';

// Admin invites by email (Admin › Members). Sign-up stays open to everyone; an invite is a
// friendly nudge with a link that fills in the sign-up form. Links last 30 days.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const INVITE_DAYS = 30;
const RESEND_HOURS = 24;

/**
 * Validates and records an invite. Returns { token, invite } or { error, values }.
 * Admin-only, so saying an address already has an account reveals nothing new.
 */
// allowRecent: skip the once-a-day check (sharing badge ideas needs a link even if the person was
// just invited from Admin › Members).
export function createInvite(db, { email, name, inviter }, { now = new Date(), allowRecent = false } = {}) {
  const values = { email: normalizeEmail(email), name: String(name ?? '').replace(/\s+/g, ' ').trim() };
  if (!EMAIL_RE.test(values.email) || values.email.length > 254) return { error: 'Enter a valid email address, like name@example.com.', values };
  if (values.name.length > 40) return { error: 'Keep the name to 40 characters or fewer.', values };
  if (findUserByEmail(db, values.email)) return { error: `${values.email} already has an account.`, values };
  const since = new Date(now.getTime() - RESEND_HOURS * 3600e3).toISOString();
  if (!allowRecent && db.prepare('SELECT 1 FROM invites WHERE email = ? AND created_at > ?').get(values.email, since)) {
    return { error: `${values.email} was invited in the last day. Give them a little time.`, values };
  }
  const token = randomToken();
  const { lastInsertRowid } = db.prepare(`INSERT INTO invites (email, name, token_hash, invited_by, created_at)
    VALUES (?, ?, ?, ?, ?)`).run(values.email, values.name, sha256(token), inviter.id, now.toISOString());
  return { token, invite: { id: Number(lastInsertRowid), ...values } };
}

/** An unused, unexpired invite for a link token, or null. */
export function inviteForToken(db, token, { now = new Date() } = {}) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const row = db.prepare(`SELECT i.*, u.display_name AS inviter_name FROM invites i
    LEFT JOIN users u ON u.id = i.invited_by WHERE i.token_hash = ?`).get(sha256(token));
  if (!row || row.accepted_at) return null;
  if (now - new Date(row.created_at) > INVITE_DAYS * 86400e3) return null;
  return row;
}

/** Marks every open invite to this address as accepted by the new account. */
export function acceptInvites(db, email, userId, { now = new Date() } = {}) {
  return db.prepare('UPDATE invites SET accepted_at = ?, accepted_user_id = ? WHERE email = ? AND accepted_at IS NULL')
    .run(now.toISOString(), userId, normalizeEmail(email)).changes;
}

/** Recent invites for the admin list, newest first. */
export function recentInvites(db, { limit = 50 } = {}) {
  return db.prepare(`SELECT i.id, i.email, i.name, i.created_at, i.accepted_at, u.display_name AS inviter_name
    FROM invites i LEFT JOIN users u ON u.id = i.invited_by ORDER BY i.created_at DESC, i.id DESC LIMIT ?`).all(limit);
}
