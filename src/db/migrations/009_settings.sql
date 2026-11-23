-- Admin-editable settings (email sender, subjects, encrypted SendGrid key).
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
