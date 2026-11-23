import { hashPassword, randomToken, sha256 } from '../lib/crypto.js';

export const SESSION_DAYS = 30;
export const TOKEN_MINUTES = 15;
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MINUTES = 15;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const addMinutes = (d, m) => new Date(d.getTime() + m * 60000);

export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

// Returns { errors } keyed by field, empty when valid.
export function validateSignup({ display_name, email, password }) {
  const errors = {};
  const name = String(display_name || '').trim();
  if (!name) errors.display_name = 'Enter a display name.';
  else if (name.length > 40) errors.display_name = 'Use 40 characters or fewer.';
  const e = normalizeEmail(email);
  if (!e) errors.email = 'Enter your email address.';
  else if (e.length > 254 || !EMAIL_RE.test(e)) errors.email = 'Enter a valid email address, like name@example.com.';
  const pw = String(password || '');
  const pwError = validatePassword(pw);
  if (pwError) errors.password = pwError;
  return errors;
}

export function validatePassword(pw) {
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'Use 200 characters or fewer.';
  return null;
}

const handleBase = (name) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'explorer';

export function findUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email));
}

export function findUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// Creates a user. Returns { user } or { errors } (e.g. duplicate email).
export async function createUser(db, { display_name, email, password }, { now = new Date() } = {}) {
  const errors = validateSignup({ display_name, email, password });
  if (Object.keys(errors).length) return { errors };
  const e = normalizeEmail(email);
  if (findUserByEmail(db, e)) return { errors: { email: 'An account with this email already exists.' } };
  const name = String(display_name).trim();
  const passwordHash = await hashPassword(String(password));

  const insert = db.prepare(`INSERT INTO users (email, password_hash, display_name, handle, created_at)
    VALUES (?, ?, ?, ?, ?)`);
  const base = handleBase(name);
  for (let attempt = 0; attempt < 20; attempt++) {
    const handle = attempt === 0 ? base : `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    try {
      const { lastInsertRowid } = insert.run(e, passwordHash, name, handle, now.toISOString());
      return { user: findUserById(db, lastInsertRowid) };
    } catch (err) {
      if (!String(err.message).includes('UNIQUE')) throw err;
      if (findUserByEmail(db, e)) return { errors: { email: 'An account with this email already exists.' } };
    }
  }
  throw new Error('could not allocate a handle');
}

export async function setPassword(db, userId, password) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), userId);
}

// Sessions: the cookie holds a random token; the DB holds only its hash.
export function createSession(db, userId, { now = new Date() } = {}) {
  const token = randomToken();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), userId, now.toISOString(), addMinutes(now, SESSION_DAYS * 1440).toISOString());
  return token;
}

export function userForSession(db, token, { now = new Date() } = {}) {
  if (!token) return null;
  return db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ?`).get(sha256(token), now.toISOString()) || null;
}

export const deleteSession = (db, token) => db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(String(token)));
export const deleteAllSessions = (db, userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

// Single-use emailed tokens (magic link, password reset, delete account).
export function createAuthToken(db, userId, purpose, { now = new Date() } = {}) {
  const token = randomToken();
  db.prepare(`INSERT INTO auth_tokens (user_id, purpose, token_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)`).run(userId, purpose, sha256(token), now.toISOString(),
    addMinutes(now, TOKEN_MINUTES).toISOString());
  return token;
}

// Looks a token up without using it. Returns the row or null if unknown, used, expired or wrong purpose.
export function peekAuthToken(db, token, purpose, { now = new Date() } = {}) {
  if (!token || typeof token !== 'string') return null;
  const row = db.prepare('SELECT * FROM auth_tokens WHERE token_hash = ? AND purpose = ?').get(sha256(token), purpose);
  if (!row || row.used_at || row.expires_at <= now.toISOString()) return null;
  return row;
}

// Marks a token used. Returns the row, or null if it was not valid (so it can only succeed once).
export function consumeAuthToken(db, token, purpose, { now = new Date() } = {}) {
  const row = peekAuthToken(db, token, purpose, { now });
  if (!row) return null;
  const { changes } = db.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL')
    .run(now.toISOString(), row.id);
  return changes === 1 ? row : null;
}

// Login rate limit: 10 failures for one email within 15 minutes locks it until they age out.
export function isLoginLocked(db, email, { now = new Date() } = {}) {
  const since = addMinutes(now, -LOGIN_WINDOW_MINUTES).toISOString();
  const n = db.prepare('SELECT COUNT(*) FROM login_failures WHERE email = ? AND at > ?').pluck()
    .get(normalizeEmail(email), since);
  return n >= LOGIN_MAX_FAILURES;
}

export function recordLoginFailure(db, email, { now = new Date() } = {}) {
  db.prepare('INSERT INTO login_failures (email, at) VALUES (?, ?)').run(normalizeEmail(email), now.toISOString());
  db.prepare('DELETE FROM login_failures WHERE at < ?').run(addMinutes(now, -1440).toISOString());
}

export const clearLoginFailures = (db, email) =>
  db.prepare('DELETE FROM login_failures WHERE email = ?').run(normalizeEmail(email));

// Deletes the user; every user-owned table cascades. Callers remove stored files first.
export function deleteUser(db, userId) {
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

export function setAdmin(db, email, isAdmin) {
  return db.prepare('UPDATE users SET is_admin = ? WHERE email = ?').run(isAdmin ? 1 : 0, normalizeEmail(email)).changes;
}
