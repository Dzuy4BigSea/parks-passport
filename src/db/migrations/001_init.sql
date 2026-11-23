-- Baseline. Tables for each flow are added by later migrations.
CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
