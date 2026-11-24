const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Editable email settings and their defaults (used until an admin saves something else).
export const EMAIL_DEFAULTS = {
  mail_from_name: 'Parks Passport',
  mail_reply_to: '',
  subject_magic_link: 'Your Parks Passport sign-in link',
  subject_password_reset: 'Reset your Parks Passport password',
  subject_delete_account: 'Confirm deleting your Parks Passport account',
  subject_invite: "You're invited to Parks Passport",
};

const getRaw = (db, key) => db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(key);
const setRaw = (db, key, value, now) => db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, value, now.toISOString());

/** Email settings: saved values over defaults. mail_from_address falls back to MAIL_FROM. */
export function emailSettings(db, { envFrom = '' } = {}) {
  const out = {};
  for (const [k, def] of Object.entries(EMAIL_DEFAULTS)) out[k] = getRaw(db, k) ?? def;
  out.mail_from_address = getRaw(db, 'mail_from_address') ?? envFrom;
  return out;
}

/** Validates and saves the email settings form. Returns { ok } or { errors }. */
export function saveEmailSettings(db, form, { now = new Date() } = {}) {
  const v = (k) => String(form[k] ?? '').replace(/[\r\n]+/g, ' ').trim();
  const errors = {};
  const values = {
    mail_from_name: v('mail_from_name'), mail_from_address: v('mail_from_address').toLowerCase(),
    mail_reply_to: v('mail_reply_to').toLowerCase(), subject_magic_link: v('subject_magic_link'),
    subject_password_reset: v('subject_password_reset'), subject_delete_account: v('subject_delete_account'),
  };
  if (!values.mail_from_name) errors.mail_from_name = 'Enter a sender name.';
  else if (values.mail_from_name.length > 60) errors.mail_from_name = 'Use 60 characters or fewer.';
  if (!EMAIL_RE.test(values.mail_from_address)) errors.mail_from_address = 'Enter the sender address verified in SendGrid.';
  if (values.mail_reply_to && !EMAIL_RE.test(values.mail_reply_to)) errors.mail_reply_to = 'Enter a valid email address, or leave it empty.';
  for (const k of ['subject_magic_link', 'subject_password_reset', 'subject_delete_account']) {
    if (!(k in form)) { delete values[k]; continue; } // edited in Admin › Email › Messages
    if (!values[k]) errors[k] = 'Enter a subject line.';
    else if (values[k].length > 120) errors[k] = 'Use 120 characters or fewer.';
  }
  if (Object.keys(errors).length) return { errors, values };
  db.transaction(() => { for (const [k, val] of Object.entries(values)) setRaw(db, k, val, now); })();
  return { ok: true };
}

// ---- SendGrid key (encrypted with the secret box; never shown back) ----

const SENDGRID_KEY_RE = /^SG\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;

export function saveSendgridKey(db, box, key, { now = new Date() } = {}) {
  const k = String(key || '').trim();
  if (!SENDGRID_KEY_RE.test(k)) return { error: 'That doesn\'t look like a SendGrid API key (it starts with "SG.").' };
  setRaw(db, 'sendgrid_key', box.seal(k), now);
  setRaw(db, 'sendgrid_key_hint', k.slice(-4), now);
  return { ok: true };
}

export function clearSendgridKey(db) {
  db.prepare("DELETE FROM settings WHERE key IN ('sendgrid_key', 'sendgrid_key_hint')").run();
}

/** { key, source: 'admin' | 'env' | null, hint } — the admin-saved key wins over .env. */
export function sendgridKey(db, box, { envKey = '' } = {}) {
  const sealed = getRaw(db, 'sendgrid_key');
  if (sealed) {
    const key = box.open(sealed);
    if (key) return { key, source: 'admin', hint: getRaw(db, 'sendgrid_key_hint') || key.slice(-4) };
    return { key: null, source: 'unreadable', hint: getRaw(db, 'sendgrid_key_hint') };
  }
  if (envKey) return { key: envKey, source: 'env', hint: envKey.slice(-4) };
  return { key: null, source: null, hint: null };
}
