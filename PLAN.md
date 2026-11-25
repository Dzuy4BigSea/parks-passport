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
  gamification/  badge engine, points ledger, levels (domain-free; M14)
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

## How each milestone is finished
1. Build it until its listed checks pass (`npm test`).
2. Run the **qa-reviewer** agent (`.claude/agents/qa-reviewer.md`) on the milestone's diff. It
   checks the SPEC acceptance criteria, looks for correctness and security bugs, runs the tests,
   and walks the flows in a browser at 375 px and 1440 px.
3. Fix what it reports (or record why not), re-run `npm test`, commit, push, and check CI.

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
Checks: `test/unit/badges.test.js` (one test per rule type with fixture visits, seeded RNG,
levels, award once / revoke / lucky kept, announcements once), `test/unit/visits.test.js`
(points rules), `test/e2e/passport.spec.js`.

### M6 — Privacy and Park Pals (Flow 8)
Outcome: every Flow 8 criterion. Visibility levels, account default, share nudge, invite
links, pals feed, leaderboard, `/u/:handle`, 404 rules, the `pal_same_day` badge wired in.
Checks: `test/unit/pals.test.js` (`canSee` for every visibility × owner/pal/stranger/signed-out;
the same matrix over HTTP for passport, visits and badges; invites, regenerate, remove,
Better Together in either order, leaderboard, 20-item feed pages, nudge, account deletion),
`test/e2e/pals.spec.js`. Photo and review-comment rows of the matrix are added over HTTP in M7.

### M7 — Photos and ratings (Flows 4 and 5)
Outcome: every Flow 4 and Flow 5 criterion except admin hiding (M8). Upload validation by file
content, re-encoding, EXIF stripping, thumbnails, visibility-checked serving, ratings and the
anonymous aggregate.
Checks: `test/unit/photos-ratings.test.js` (re-encode and EXIF/GPS strip on a phone-style
fixture, content-based validation, upload/edit/delete with files, photo stamp bonus, ratings
and the anonymous average, the photo and review-comment rows of the permissions matrix over
HTTP, hidden items, feed, account deletion removes files), `test/e2e/photos-ratings.spec.js`.

### M8 — Admin (Flow 9)
Outcome: every Flow 9 criterion, plus the hide criteria from Flows 4 and 5.
Checks: `test/unit/admin.test.js` (404 for members and signed-out on every page and POST,
park edit/create/validation/deactivate, CSV upload twice is idempotent with invalid rows listed,
badge CRUD and validation, disable stops awards but keeps earned, SVG art rasterized,
moderation hide/unhide, promote/demote, can't demote self), `test/e2e/admin.spec.js` (pin
picker map click, rule settings show/hide, axe and 375 px on every admin page).

### M9 — Analytics and consent (Flow 10)
Outcome: every Flow 10 criterion. Consent banner (in the page flow, no JS needed), Consent Mode v2
defaults before GTM, configurable GTM loader (`GTM_SCRIPT_ORIGIN` for sGTM later), events through
one allowlisted builder with a PII guard (queued server-side across redirects), Umami client,
`/privacy` updated, Umami containers in the compose file's `analytics` profile, and
`docs/umami-setup-prompt.md` for the server steps.
Checks: `test/unit/analytics.test.js` (event list and PII guard, inline JSON safety, consent cookie,
config gating, head order, banner, every event over HTTP), `test/e2e/consent.spec.js` (a fake GTM
that sets `_ga` only after Accept: none before, one after; Reject; no-JS forms; footer settings;
375 px; dataLayer events and no PII). Lighthouse with consent denied is checked in M10.

### M10 — Ops and end-to-end verification
Outcome: SPEC "End-to-end verification" and the Ops NFRs.
- `scripts/backup.sh` + `scripts/db-backup.js`: SQLite online backup (integrity-checked) and a
  tar of `uploads/` + `settings.key`, 14-day rotation, to `/root/backups/parks-passport/`.
  Install and restore steps in `docs/backup-restore.md` (a local session with `ssh aster` adds
  the cron line).
- `npm run lighthouse` (`scripts/lighthouse.js`): Lighthouse's default mobile audit of `/`,
  `/parks`, `/parks/:slug` and `/passport` (signed in), with GTM on and consent denied; fails
  under 90 or if a page redirects.
- `npm run lighthouse` judges the median of 3 runs per page. Limits: GTM is a tiny stand-in
  (re-run Lighthouse against production once the real GTM container is set), and the park page's
  map tiles are drawn on canvas, so they aren't the LCP; the map still appears a moment later.
- `npm run check:memory` (`scripts/load-check.js`): 10 users at once doing page views, stamps and
  12 MP / ~9 MB photo uploads, with MALLOC_ARENA_MAX=2 as in the Dockerfile; fails if the server's
  peak memory is over 400 MB (container limit 512 MB). At most 3 uploads are in progress at once;
  more get a "busy, try again" page (503).
- `test/e2e/pages.spec.js`: axe and no sideways scroll at 375 px on every page.
- `test/e2e/flows.spec.js`: login/photo_upload/level_up events to dataLayer and Umami, keyboard-only
  stamp and rate, passport and Pals at 375/768/1440 px.

Checks: `npm test`, `npm run lighthouse` and `npm run check:memory` pass in CI (the `budgets`
job). A reviewer finds no SPEC gaps. After merge to `main`,
`curl -fsS https://parkspassport.dzuynguyen.com/healthz` returns `ok`, and Dzuy's phone test passes.

### M11 — UI/UX pass: Gulf Pop, one-tap stamp, next up, city theme (Flow 11)
Outcome: SPEC Flow 11.
- Design system in `public/css/app.css` (tokens, contrast notes, motion, reduced motion), the
  self-hosted display font in `public/fonts/`, UI icons in `src/views/icons.js`, new app icons.
- Layout: sticky header with a Stamp button, a phone tab bar for members, the motif footer, the
  city accent variables.
- `src/domain/engagement.js` (streak, closest unstamped park, closest badge), `/stamp` in
  `src/routes/visits.js`, the dashboard home, the park page celebration, passport collections.
- City theme: migration 011, `seed/city-st-pete.json`, `src/domain/city.js`,
  `src/lib/svg-sanitize.js`. Admin › City theme with `src/lib/theme-ai.js` (Claude, web search,
  strict `save_city_theme` tool) and the background job in `src/domain/theme-job.js`.

Checks: `test/unit/city.test.js` (sanitizer, areas, streak, closest badge, `/stamp`, dashboard,
admin drafts and approval, safe error messages, generator turn handling with a fake client),
`test/e2e/engage.spec.js` (one-tap stamp on a phone, finder when far away, reduced motion), axe
on `/`, `/stamp` and `/admin/city` signed in, and the existing suite. `npm run lighthouse` stays
at 90+.

### M12 — Healthy activities, Paws and Kids editions (Flow 12)
Outcome: SPEC Flow 12. Research and activity lists: `docs/healthy-activities.md`.
- Migration 013 (activities, activity_logs, users.paws/kids, parks.loop_mi), `seed/activities.json`,
  `seed/activity-badges.json`, `seedActivityData` in `src/db/seed.js` run at every start.
- `src/domain/activities.js` (list per park and edition, log with caps, undo, week summary),
  the seven activity rule types in `src/domain/badges/rules.js`, edition-aware badge board.
- `src/routes/activities.js` (log, undo, editions), `src/views/activities.js` (park panel, week card),
  Admin › Activities, the badge form's target picker, `loop_mi` on the park form, a
  `shuffleboard` category.

Checks: `test/unit/activities.test.js` (seed files valid, every new rule type, caps, undo and visit
deletion reverse points, editions, Kids photo default, admin), `test/e2e/activities.spec.js`
(stamp, then log at 375 px with axe clean and no sideways scroll), and the existing suite.

### M13 — Badge ideas (Flow 13)
Outcome: SPEC Flow 13.
- Migration 014 (`users.is_super_admin`, `idea_contributors`, `badge_ideas`),
  `scripts/make-super-admin.js` (`npm run make-super-admin -- <email> [--remove]`).
- `src/domain/ideas.js` (access, submit with a daily cap, contributors, triage, combine,
  build link, export brief), `src/domain/idea-job.js` + `src/lib/idea-ai.js` (Claude
  suggestions as a background job, strict `save_triage` tool, validated output).
- `src/routes/ideas.js` (`/ideas` and `/admin/ideas/*`), `src/views/pages/ideas.js`, the
  `idea_share` email kind, `/join/<token>?next=` support, a "Badge ideas" link on Account and
  the admin home, and "Create badge" prefilling `/admin/badges/new?from_idea=<id>`.

Checks: `test/unit/ideas.test.js` (404 matrix for signed out / member / admin / super admin,
submit and validation and cap, share to a member and a non-member with the join flow, remove,
triage verdicts and combine, create badge links the idea, export has the right groups and no
names or emails, AI job with a fake client drops bad output, account deletion removes ideas),
`test/e2e/ideas.spec.js` (submit at 375 px and triage at 1440 px, axe clean, no sideways
scroll), and the existing suite.

### M14 — Gamification engine as a module
Outcome: the engine works without knowing about parks, so it can be reused (M15).
Behavior-preserving: no SPEC change.
- `src/gamification/` holds the domain-free core: the rule registry (`defineRules`), award,
  revoke with rule snapshots, the badge board, points ledger helpers and levels.
- The parks-specific parts (the context loader, the 16 rule types, point values, level names,
  edition filtering) live in `src/domain/badges/` and `src/domain/points.js` / `levels.js` as
  an adapter the core is configured with.

Checks: the existing suite passes unchanged (`badges.test.js`, `activities.test.js`,
`visits.test.js`), plus `test/unit/gamification.test.js`, which runs the core against a toy
adapter with no parks tables.

### M15 — Gamification template repo
Outcome: a private repo (`gamification-engine`) that starts a new app's gamification.
- The M14 core, a README (concepts, adapter contract, how to add a rule type, the badge-ideas
  workflow), an example adapter with its own SQL schema, and `node --test` tests with CI.
- Parks Passport keeps its own copy of the core; the template is the starting point, not a
  shared dependency (no publish step to maintain).

Checks: the template's CI passes; its README's quick start runs as written.

### M16 — Friend codes and pal requests (Flow 8)
Outcome: the friend-code and pal-request bullets of SPEC Flow 8, and a clear page for dead invite links.
- Migration 015 (`pal_codes`, `pal_requests`, `pal_request_sends`, `pal_code_failures`).
- `src/domain/pals.js`: `friendCodeFor`, `regenerateFriendCode`, `normalizeCode`,
  `requestByCode` (rate limits, mutual request accepts), `answerRequest`, `cancelRequest`,
  `palRequests`; accepting reuses the invite's link-and-badges step.
- `src/routes/pals.js` (`/pals/code`, `/pals/code/regenerate`, `/pals/requests/:id/accept|decline|cancel`),
  the Pals page sections, and the "link doesn't work anymore" page.

Checks: `test/unit/pals.test.js` (code format and normalizing, request then accept or decline,
mutual request, cancel, self / already pals / repeat, wrong-code and daily limits, new code kills
the old one, dead link page is a 404 with help, account deletion removes codes and requests),
`test/e2e/pals.spec.js` (add by code at 375 px, accept, axe clean), and the existing suite.
