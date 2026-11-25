// Editable wording for the member emails (Admin › Email › Messages). Saved values live in the
// settings table as copy_<kind>_<field>; anything not saved uses the default below. Subjects
// stay in their existing settings keys (subject_<kind>) so earlier saves keep working.
// {name} is replaced with the member's display name; the result is always escaped.

export const EMAIL_KINDS = {
  magic_link: {
    label: 'Sign-in link',
    when: 'Sent when someone asks to sign in without a password.',
    subjectKey: 'subject_magic_link',
    danger: false,
    defaults: {
      preheader: 'Your one-tap sign-in link. It expires in 15 minutes.',
      heading: 'Your sign-in link',
      body: 'Hi {name},\n\nTap the button to sign in to your passport. No password needed.',
      button: 'Sign in to Parks Passport',
      note: "This link works once and expires in 15 minutes. If you didn't ask for it, you can ignore this email.",
    },
  },
  password_reset: {
    label: 'Password reset',
    when: 'Sent when someone uses "Forgot password".',
    subjectKey: 'subject_password_reset',
    danger: false,
    defaults: {
      preheader: 'Choose a new password. The link expires in 15 minutes.',
      heading: 'Reset your password',
      body: 'Hi {name},\n\nTap the button to choose a new password for your passport.',
      button: 'Choose a new password',
      note: "This link works once and expires in 15 minutes. If you didn't ask for it, ignore this email; your password hasn't changed.",
    },
  },
  invite: {
    label: 'Invitation',
    when: 'Sent when an admin invites someone from Admin › Members.',
    subjectKey: 'subject_invite',
    danger: false,
    defaults: {
      preheader: 'Collect a stamp for every {city} park you visit.',
      heading: "You're invited to Parks Passport",
      body: "Hi {name},\n\n{inviter} invited you to Parks Passport: a free passport for {city} parks. Stamp each park you visit, earn badges, and explore with friends.",
      button: 'Create my passport',
      note: "This invite link works for 30 days. If you weren't expecting it, you can ignore this email.",
    },
  },
  idea_share: {
    label: 'Badge ideas',
    when: 'Sent when an admin shares badge ideas with someone from Admin › Badge ideas.',
    subjectKey: 'subject_idea_share',
    danger: false,
    defaults: {
      preheader: 'Got an idea for a badge? It takes one line.',
      heading: 'Help us dream up badges',
      body: "Hi {name},\n\n{inviter} would love your ideas for new Parks Passport badges. Fill in one line, \"Earn it when you…\", as many times as you like. The best ones become real badges.",
      button: 'Share a badge idea',
      note: "If you don't have a passport yet, the link sets one up first (it works for 30 days). If you weren't expecting this, you can ignore this email.",
    },
  },
  delete_account: {
    label: 'Confirm account deletion',
    when: 'Sent when a member asks to delete their account.',
    subjectKey: 'subject_delete_account',
    danger: true,
    defaults: {
      preheader: 'Confirm deleting your Parks Passport account.',
      heading: 'Confirm deleting your account',
      body: "Hi {name},\n\nThis permanently deletes your account and everything in it: stamps, photos, ratings, badges and Park Pals. It can't be undone.",
      button: 'Yes, delete my account',
      note: "This link works once and expires in 15 minutes. If you didn't ask for this, ignore this email and your account stays as it is.",
    },
  },
};

export const COPY_FIELDS = {
  subject: { label: 'Subject line', max: 120, required: true, oneLine: true },
  preheader: { label: 'Preview text', max: 140, required: false, oneLine: true, hint: 'The grey line most inboxes show after the subject.' },
  heading: { label: 'Heading', max: 80, required: true, oneLine: true },
  body: { label: 'Message', max: 1200, required: true, oneLine: false, hint: 'Leave a blank line between paragraphs. {name} becomes the person\'s name; in the invitation, {inviter} becomes yours and {city} the city you’re viewing.' },
  button: { label: 'Button label', max: 40, required: true, oneLine: true },
  note: { label: 'Small print', max: 400, required: false, oneLine: false, hint: 'Shown in the yellow box under the button. Keep the expiry and "ignore this" advice.' },
};

const key = (kind, field) => `copy_${kind}_${field}`;
const getRaw = (db, k) => db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(k);

/** The wording for one email: saved values over defaults (subject from its settings key). */
export function emailCopy(db, kind, { subjectDefault = '' } = {}) {
  const def = EMAIL_KINDS[kind];
  if (!def) throw new Error(`unknown email ${kind}`);
  const out = {};
  const subject = getRaw(db, def.subjectKey) ?? (subjectDefault || null);
  if (subject != null) out.subject = subject;
  for (const f of Object.keys(def.defaults)) out[f] = getRaw(db, key(kind, f)) ?? def.defaults[f];
  return out;
}

/** True when any field differs from the shipped wording. */
export const isCustomized = (db, kind) => Object.keys(COPY_FIELDS).some((f) => f !== 'subject'
  && getRaw(db, key(kind, f)) != null);

function clean(field, raw) {
  const spec = COPY_FIELDS[field];
  let v = String(raw ?? '').replace(/\r\n?/g, '\n');
  v = spec.oneLine ? v.replace(/\s+/g, ' ').trim() : v.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return v;
}

/** Validates and saves one email's wording. Returns { ok } or { errors, values }. */
export function saveEmailCopy(db, kind, form, { now = new Date() } = {}) {
  const def = EMAIL_KINDS[kind];
  if (!def) return { errors: { form: 'Unknown email.' }, values: {} };
  const values = {};
  const errors = {};
  for (const [field, spec] of Object.entries(COPY_FIELDS)) {
    values[field] = clean(field, form[field]);
    if (spec.required && !values[field]) errors[field] = `Enter the ${spec.label.toLowerCase()}.`;
    else if (values[field].length > spec.max) errors[field] = `Use ${spec.max} characters or fewer.`;
  }
  if (Object.keys(errors).length) return { errors, values };
  const set = db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
  const del = db.prepare('DELETE FROM settings WHERE key = ?');
  db.transaction(() => {
    set.run(def.subjectKey, values.subject, now.toISOString());
    for (const f of Object.keys(def.defaults)) {
      // Saving the default wording stores nothing, so later improvements to defaults still apply.
      if (values[f] === def.defaults[f]) del.run(key(kind, f));
      else set.run(key(kind, f), values[f], now.toISOString());
    }
  })();
  return { ok: true };
}

/** Puts one email's wording (not its subject) back to the defaults. */
export function resetEmailCopy(db, kind) {
  const def = EMAIL_KINDS[kind];
  if (!def) return false;
  const del = db.prepare('DELETE FROM settings WHERE key = ?');
  db.transaction(() => { for (const f of Object.keys(def.defaults)) del.run(key(kind, f)); })();
  return true;
}
