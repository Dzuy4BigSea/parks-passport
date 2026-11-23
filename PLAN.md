# Parks Passport — Plan

Builds SPEC.md. Each milestone is done only when its checks pass in CI (`npm test`) and,
where noted, by hand.

## Architecture
- **One Node 22 process** (Fastify). `src/app.js` exports `buildApp({ db, mail, now, random })`,
  so tests inject a temp DB, an outbox mailer, a fixed clock and a seeded RNG. `src/server.js`
  is the entry point and keeps `/healthz`.
- **Server-rendered HTML** through a small auto-escaping `html` tagged template (`src/views/`),
  with no template engine dependency. Forms work without JS. Small ES modules in `public/js/`
  add GPS check-in, the map (Leaflet), the consent banner and dataLayer pushes.
- **SQLite** through `better-sqlite3` at `$DATA_DIR/app.db` (default `/data`). Plain SQL
  migrations in `src/db/migrations/NNN_*.sql` run at startup.
- **Domain logic** lives in pure modules in `src/domain/` (points, levels, badge rules,
  visibility, geo distance, CSV import), unit-tested without HTTP.
- **Mail:** `MAIL_TRANSPORT=sendgrid|outbox`. The outbox writes `.eml` files that the e2e
  tests read.
- **Images:** `sharp` re-encodes uploads and strips metadata into `$DATA_DIR/uploads/`.
  Photos are served through a route that checks visibility, never as static files.
- **Analytics:** Umami (first-party path `/stats/`) plus GTM/GA4 behind Consent Mode v2. One
  `track(event, params)` helper feeds both, and its payload is validated.

```
src/
  app.js  server.js  config.js
  db/        index.js  migrations/
  domain/    points.js levels.js badges/ visibility.js geo.js csv-import.js
  routes/    parks.js auth.js visits.js photos.js ratings.js passport.js pals.js admin.js
  views/     html.js layout.js pages/…
  lib/       mail.js csrf.js session.js images.js analytics.js
public/      css/ js/ icons/ manifest.webmanifest
scripts/     seed-scrape.js make-admin.js backup.sh
seed/        parks.csv badges.json
test/unit/   *.test.js          (node --test)
test/e2e/    *.spec.js          (Playwright + @axe-core/playwright)
```

## Milestones

### M0 — Scaffold and test harness
Outcome: the project runs locally and in CI. No SPEC flows yet.
- Fastify app with `/healthz` (200 once the DB opens), a home page, layout, and the migration
  runner. Env loading, with `.env.example` covering every variable.
- `node --test` unit setup, Playwright with an app `webServer` on a temp `DATA_DIR`, an axe
  helper, and ESLint.
- `npm test` runs lint, then unit, then e2e. The GitHub Actions workflow `ci.yml` runs
  `npm test` on PRs and on pushes to non-main branches.
- Dockerfile builds with native deps (`better-sqlite3`, `sharp`) and runs `src/server.js`.

Checks: `npm test` exits 0 locally and in CI. `test/unit/health.test.js`,
`test/e2e/smoke.spec.js` (home loads, axe clean, `/healthz` = ok). `docker build .` succeeds.

### M1 — Park seed data
Outcome: SPEC "Open questions: park coordinates and categories" resolved, and the parks are in
the DB.
- `scripts/seed-scrape.js`: fetches the City directory and info pages, then writes
  `seed/parks.csv` (slug, name, address, phone, lat, lng, categories, city_url, needs_pin).
  Geocodes through the Census geocoder, falling back to Nominatim. Normalizes features into
  categories.
- `src/domain/csv-import.js`: validates and upserts rows on slug, and returns added, updated
  and invalid counts. Runs at startup when the parks table is empty.

Checks: `test/unit/csv-import.test.js` (valid, invalid and idempotent re-import);
`seed/parks.csv` has 102 rows, all inside the St. Pete bounding box or flagged `needs_pin`.
Dzuy reviews the category list and the flagged rows.

### M2 — Browse and search parks (Flow 2) + visual foundation
Outcome: every Flow 2 criterion except the two signed-in ones (stamped marks and the
"Not visited yet" filter), which move to M4 because they need stamps. Passport look, design tokens, footer disclaimer, `/privacy`
stub, PWA manifest.
Checks: `test/e2e/parks.spec.js` (list, search with and without JS, filters, near-me with
mocked geolocation, denied geolocation, 404 slug, axe on each page),
`test/unit/geo.test.js`, and screenshots at 375/768/1440.

### M3 — Accounts (Flow 1)
Outcome: every Flow 1 criterion. Sessions, CSRF, scrypt, magic links, reset, rate limit,
delete account, `make-admin` CLI, SendGrid and outbox transports.
Checks: `test/unit/auth.test.js` (tokens: single use and expiry; lockout incl. spread-out
and parallel attempts; email throttle; CSRF on every POST route; cookie flags and `__Host-`
names; enumeration-safe link requests; redirect safety), `test/e2e/auth.spec.js` (sign up,
duplicate, validation, login, generic error, magic link single use, reset, logout, delete).
Account deletion of visits, photos, ratings, badges and pal links is re-checked as each of those
tables lands (M4–M7), and the `/u/:handle` 404 in M6.

### M4 — Stamp a visit (Flow 3)
Outcome: every Flow 3 criterion, plus Flow 2's stamped marks and "Not visited yet" filter. GPS, honor and photo-method plumbing (photo upload itself in
M7), one stamp per day, backdating rules, delete visit. Writes to the points ledger.
Checks: `test/unit/checkin.test.js` (radius plus accuracy cap, America/New_York day boundary),
`test/e2e/stamp.spec.js` (inside, outside then honor, denied, duplicate day, future date
rejected, no coordinates in other users' HTML or JSON).

### M5 — Gamification engine + My passport (Flows 7 and 6)
Outcome: every Flow 7 and Flow 6 criterion. Points rules, levels config, badge rule types,
known/hidden/lucky, seed badges, recalculation on delete, passport page, map, history,
`role="status"` announcements.
Checks: `test/unit/points.test.js`, `test/unit/levels.test.js`,
`test/unit/badges/*.test.js` (one per rule type, fixture visits, seeded RNG),
`test/e2e/passport.spec.js`.

### M6 — Privacy and Park Pals (Flow 8)
Outcome: every Flow 8 criterion. Visibility levels, account default, share nudge, invite
links, pals feed, leaderboard, `/u/:handle`, 404 rules, the `pal_same_day` badge wired in.
Checks: `test/unit/visibility.test.js` (the full owner/pal/stranger/anonymous ×
private/pals/public matrix per content type), `test/e2e/pals.spec.js`.

### M7 — Photos and ratings (Flows 4 and 5)
Outcome: every Flow 4 and Flow 5 criterion except admin hiding (M8). Upload validation by file
content, re-encoding, EXIF stripping, thumbnails, visibility-checked serving, ratings and the
anonymous aggregate.
Checks: `test/unit/images.test.js` (fixture with GPS EXIF → stored file has none),
`test/unit/ratings.test.js`, `test/e2e/photos.spec.js`, `test/e2e/ratings.spec.js`.

### M8 — Admin (Flow 9)
Outcome: every Flow 9 criterion, plus the hide criteria from Flows 4 and 5.
Checks: `test/e2e/admin.spec.js` (404 for non-admins, park CRUD and deactivate, CSV upload
twice is idempotent, badge CRUD and disable, moderation hide/unhide, promote/demote, can't
demote self).

### M9 — Analytics and consent (Flow 10)
Outcome: every Flow 10 criterion. Consent banner, Consent Mode v2, configurable GTM loader,
`track()` with PII guard, Umami events, `/privacy` updated. Umami containers and nginx
`/stats/` only after Dzuy's go-ahead on aster.
Checks: `test/unit/analytics.test.js` (PII guard), `test/e2e/consent.spec.js` (no `_ga`
cookie before Accept, cookie after, Reject keeps it absent, footer reopens), and
`test/e2e/datalayer.spec.js` (every event name and its keys).

### M10 — Ops and end-to-end verification
Outcome: SPEC "End-to-end verification" and the Ops NFRs.
- `scripts/backup.sh` (SQLite `.backup` plus uploads tar, 14-day rotation) and the cron line
  for Dzuy to approve. Lighthouse CI (`lighthouserc.json`, mobile Performance ≥ 90 on `/`,
  `/parks`, `/parks/:slug`, `/passport`). Container memory checked under load at 512 MB or
  less.

Checks: `npm test` and `npx lhci autorun` pass in CI. A reviewer subagent finds no SPEC gaps.
After merge to `main`, `curl -fsS https://parkspassport.dzuynguyen.com/healthz` returns `ok`,
and Dzuy's phone test passes.
