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

### M17 — More cities: city packs, Westminster and Asheville (Flow 14)
Outcome: SPEC Flow 14. Westminster, CA and Asheville, NC as proofs of concept beside St. Pete.
- Migration 016 (city time zone, bounds, copy, listed, sort, seeded_at; `parks` rebuilt with
  `city_id` and per-city slugs; `badges.city_id`). The runner runs a migration marked
  `-- migrate:foreign-keys-off` with foreign keys off and checks them before committing.
- City packs in `seed/cities/<key>/` (St. Pete moved there), loaded on every start by
  `seedCities` in `src/db/seed.js`; `seed/travel-badges.json`. `scripts/seed-westminster.js`
  builds Westminster's `parks.csv` from the City's saved page (OSM, then Census/OSM address);
  `scripts/seed-asheville.js` builds Asheville's from the City's locations directory.
- `src/domain/city.js` (many cities, copy, nearest city, park time zone), `src/lib/city-context.js`
  (`req.city`, `pp_city`), `src/lib/geoip.js` (`GEOIP_DB`, `maxmind`), `src/views/urls.js`,
  `src/routes/city-params.js`; city URLs and redirects in the park, visit, photo, activity and
  passport routes; city tabs; the admin city bar; the `cities_count` rule. The gamification core
  gains two generic hooks (`scopeContext`, board options) so city badges stay in the adapter.

Checks: `test/unit/cities.test.js` (packs valid, seeding idempotent, migration keeps every visit,
photo and rating, city URLs and redirects, remembered city, park-local "today" and Early Bird,
city and travel badges, the IP suggestion with a fake database, the admin city bar),
`test/e2e/cities.spec.js` (Westminster pages axe clean at 375 px, GPS stamp at Sigler Park, city
tabs), and the existing suite on `/st-pete/...` URLs. `npm run lighthouse` and
`npm run check:memory` still pass.

### M18 — Pals were here, profile photos, Admin › Stats, bot protection (Flows 1, 8, 9)
- Migration 017 (`users.avatar_key`). `storeAvatar` in `src/lib/images.js`, `/account/avatar`
  and `/avatars/:id/:key.jpg` in `src/routes/auth.js`, `src/views/avatar.js` (photo or initials).
- `palsWhoStamped` in `src/domain/pals.js`, `src/views/pals-here.js`, the park card and park page,
  the "Stamped by a pal" filter.
- `src/domain/stats.js`, `/admin/stats`.
- `src/lib/rate-limit.js` (in-memory, per connection), the sign-up trap field.

Checks: `test/unit/social.test.js` (trap field, sign-up and email limits, photo re-encoding and
EXIF strip, photo visibility for owner / pal / stranger / signed-out with 404, files removed on
replace, remove and deletion, pal faces only for sharing pals, the filter, stats counts and 404s),
`test/e2e/cities.spec.js` (upload and pal faces at 375 px, axe clean), `/admin/stats` in the
`pages.spec.js` sweep, and the existing suite.

### M19 — Reward schedule: surprise badges, lucky drops, the long climb (Flow 7)
- Migration 018 (`user_milestones`), `src/domain/milestones.js` (record, mark, Night Owl hours),
  hooks on the park page and list, profile photo, new pals, ratings, photos and photo stamps.
- `milestone` and `lucky_drop` rule types (`luckyChance`), the next drop and one roll per stamp in
  the badge context, admin form support (`chance` and `milestone` settings).
- `seed/reward-badges.json` (6 surprises, 4 lucky drops, 3 park milestones), 5 more levels.

Checks: `test/unit/rewards.test.js` (odds schedule, each surprise once and announced on the same
page, Night Owl by city time, one lucky drop per stamp in order, kept after deletes, admin
validation), updated rule and level tests, and the existing suite.

### M20 — Game feel: badge reveal, inspect, passport opening (Flow 11)
- `public/js/fx.js` (on/off per device, reduced motion, confetti, buzz, dialog focus trap),
  `reveal.js` (from the announcements, which now carry `data-kind`), `inspect.js` (passport badge
  grid), `welcome.js` (`/passport?welcome=1` after sign-up), `prefs.js` (Account › On this device).
- CSS under "Celebrations" in `public/css/app.css` (`fx-reveal`, `fx-inspect`, `fx-welcome`).
- The e2e suite runs with celebrations off (`playwright.config.js` storage state);
  `test/e2e/celebrations.spec.js` turns them on.

Checks: `test/e2e/celebrations.spec.js` (passport opening, surprise reveal tapped open, inspect and
flip, Escape returns focus, axe clean and no sideways scroll at 375 px, off switch, reduced motion),
the sign-up redirect in `test/unit/auth.test.js`, the existing suite, and `npm run lighthouse`.

### M21 — Five more city packs (Flow 14)
Outcome: Cookeville, TN; Marple Township (Broomall), PA; Bend, OR; Indianapolis, IN and Trinidad, CO
as city packs. No app code changes: each is `seed/cities/<key>/` (`city.json`, `parks.csv`,
`badges.json`) plus `public/og/<key>.jpg`.
- Seed scripts (dev only, shared helpers in `scripts/lib/seed-fetch.js`): `seed-civicplus.js`
  (Cookeville and Marple, the CivicPlus Facilities directory), `seed-bend.js` (the BPRD park
  locator), `seed-indy.js` (Indy Parks' WordPress API, pins from each park's directions link,
  else OSM, else Census) and `seed-trinidad.js` (the City's directory; pins from OSM or Census).
- Trinidad ships 4 of its 10 places (the Riverwalk, two loop trails and Los Ninos Soccer Complex)
  without a pin, flagged "Pin to check" for an admin to place.

Checks: `test/unit/cities.test.js` (every pack valid with parks inside its bounds; city order and
park counts), the existing suite, and the new cities' pages at 375 px.

### M22 — Want to go (Flow 15)
Outcome: SPEC Flow 15 (from PR #14, rebuilt on the city URLs). Migration `019_saved_parks.sql`,
`src/domain/saved.js`, `POST /:city/parks/:slug/save` (redirect without JS, JSON for
`public/js/want-to-go.js`), the heart partial `src/views/save-button.js` on postcards and the
park page, the passport's "Want to go" section (per city), the `saved=1` filter, and `nextParks`
preferring saved parks.

Checks: `test/unit/saved.test.js` (save/unsave, idempotent, JSON, CSRF 403, signed-out redirect,
404, safe `back`, filter, passport section, inactive parks, privacy on `/u/:handle` and Pals,
next up, account deletion cascade), `test/e2e/saved.spec.js` (JS toggle, no-JS form, filter,
park page, passport, privacy, axe on each changed page), and the existing suite.

### M23 — Give a badge and the notification center (Flows 8 and 9)
- Migration 020 (`notifications`, `user_badges.note`), `src/domain/notifications.js` (notify,
  unread count, list, mark read, keep 200), notifications for badges earned and given, level-ups,
  pal requests and new pals.
- `manual` rule type; given badges (`source_type = 'grant'`) are skipped when the rules take
  badges back. `grantBadge` and `takeBackGrant` in `src/domain/badges/index.js`.
- Admin › Members › Give a badge (`/admin/users/:id/badges`); the bell in the header and
  `/notifications`; the reveal shows a gift as "A gift for you!" with the note.

Checks: `test/unit/notifications.test.js` (admin only, note limit, already has it, pops up with the
note, bell count and marked read, never taken back by the rules, take back, earned badge and pal
notifications, private, signed out, deleted with the other member), `test/e2e/notifications.spec.js`
(give in admin, gift reveal with the note, bell, list, axe at 375 px), and the existing suite.

### M24 — Limited editions, Early Bird Edition, give to several at once (Flow 9)
- Migration 021 (`badges.limited_count`, `user_badges.serial` unique per badge),
  `seed/limited-badges.json` (Early Bird Edition, 100 copies) loaded by `seedCities`.
- `grantBadge` numbers limited copies (lowest free number; `sold_out` past the last one),
  `grantBadgeToMany` (by join date), the board carries the member's number.
- Admin › Badges: "Limited edition: number of copies" (given-only rule; can't shrink below copies
  given). Admin › Members: ticks and "Give to ticked members".
- Holographic foil (`.holo-foil`, `holoTilt` in `public/js/fx.js`) on the reveal, the passport
  tile and the close-up.

Checks: `test/unit/limited.test.js` (seeded, numbering, reuse, sold out, display, give to several
by join date, members get 404, form rules), `test/e2e/limited.spec.js` (tick and give, holographic
reveal with the number and note, passport tile, close-up, axe at 375 px), and the existing suite.

### M25 — Founding Members and feedback (Flow 16)
- Migration 022 (`feedback`), `seed/limited-badges.json` gains `founding-member` (manual, not
  limited), `src/domain/founding.js` (award at sign-up and at start, counter in settings, serial),
  `src/domain/feedback.js`, `/feedback` and Admin › Feedback, the layout's button and
  `public/js/feedback.js` (dialog).

Checks: `test/unit/founding.test.js` (first 75 numbered, 76th not, backfill oldest first, deleted
numbers never reused, admin gives after 75, never revoked, button only for holders, 404 for others,
send, limits, admin list and done), `test/e2e/feedback.spec.js` (send from the dialog at 375 px,
axe), and the existing suite.

### M26 — Drops of Sunshine (Flow 17)
- Migration 023 (`sunshine_notes`), `src/domain/sunshine.js`, `/sunshine` and the park-page
  button, `public/js/sunshine.js` (nearest park in the browser, the animation), Admin › Drops of
  Sunshine.

Checks: `test/unit/sunshine.test.js` (default park choice, department note, other city's park
refused, length, limit, admin review, privacy), `test/e2e/sunshine.spec.js` (one-tap send with
geolocation, animation and reduced motion, axe at 375 px), and the existing suite.

### M27 — Answer pal requests from notifications (Flow 8)
Checks: `test/unit/notifications.test.js` (Accept / Decline shown while open, answered state,
someone else's request 404) and the existing suite.

### M28 — Nonprofit spotlights (Flow 18)
- Migration 024 (`nonprofits`, `nonprofit_parks`, `nonprofit_stats`), `src/domain/nonprofits.js`,
  `/nonprofits/suggest`, `/go/nonprofit/:id`, the park-page card, Admin › Nonprofits.

Checks: `test/unit/nonprofits.test.js` (suggest and limit, approve, park beats city, rotation,
paused hidden, counts, redirect only to the saved URL, logo sanitizing), the park page in the axe
sweep, and the existing suite.

### M29 — Our mission in admin (Flow 19)
Checks: Admin › Mission in the admin axe sweep; 404 for members.

### M30 — Join from an invite and you're Park Pals; choose your display name (Flows 1, 8 and 9)
- Signing up from a pal's invite link (`/signup?next=/pals/invite/<token>`) makes the two Park Pals
  straight away and lands on the passport; the sign-up page says so. A dead token in `next` just
  signs up. Existing members still log in and tap Accept.
- Signing up from an admin's emailed `/join/<token>` link (Admin › Members; the token rides in a hidden
  field and is re-checked, so it proves the mailbox and the 30 days) makes the new member and that
  admin Park Pals. The address alone doesn't. Sign-up and log-in pages whose `next` is an invite link
  load no analytics.
- Display names: "doesn't have to be your real name" at sign-up and in Account, where it can be
  changed (`POST /account/name`, `setDisplayName`; the handle follows; migration 025
  `retired_handles` keeps old handles from being reused by anyone else). Notifications store
  `{actor}` and show the other member's current name. The admin invite no longer fills in the name.

Checks: `test/unit/auth.test.js` (change name, handle follows, retired handles, limits, CSRF),
`test/unit/pals.test.js` (pal link sign-up pals both ways, made-up and regenerated links, admin
invite only via its link), `test/unit/analytics.test.js` (no analytics with an invite in `next`),
`test/e2e/pals.spec.js` (sign up from the link, see the inviter's feed), and the existing suite.

### M31 — Messages from the team (Flow 20)
- Migration 026 (`team_messages`, `team_message_recipients`, `team_message_views`),
  `src/domain/messages.js` (validate, audience count, publish, end, take the member's next live
  messages and give their badges), Admin › Messages (`/admin/messages`), "Message ticked members"
  in Admin › Members.
- The layout renders delivered messages above the announcements; `public/js/message.js` plays the
  effect (`public/js/effects.js`: confetti, hearts, leaves, snow, gift, calm) before the badge
  reveals; the admin form previews them.

Checks: `test/unit/messages.test.js` (admin only and 404, validation, each audience and
"joined before", window, once per member, badges given once and never taken back, notification,
no-JS card, ended and drafts never shown), `test/e2e/messages.spec.js` (compose and preview,
member sees it with the effect then the badge reveal, axe at 375 px), and the existing suite.

### M32 — Gary on every screen (Flow 21)
- `src/views/gary-help.js` (screens, 4+ tips each, sign-offs, replies), the Gary button and
  bubble in the layout (a `<details>`, enhanced by `public/js/gary.js`), the talk-back form for
  founding explorers using `POST /feedback`; the old Feedback button and dialog go.

Checks: `test/unit/gary-help.test.js` (every screen has 4+ tips with a sign-off, screen matching,
talk-back only for founding explorers, reply per kind, feedback saved with the page),
`test/e2e/gary.spec.js` (open, close with Escape, talk back shows three messages, no sideways
scroll and axe clean at 375 px), and the existing suite.

### M33 — Gary's outfits and the weather (Flow 22)
- Migration 027 (`gary_outfits`, `users.gary_outfit`), `seed/gary-outfits.json` (14 outfits; Classic approved, the rest drafts),
  `src/views/gary-art.js` (Gary with an outfit), `src/domain/outfits.js` (wardrobe, unlocks,
  weather choice), `src/lib/weather.js` (Open-Meteo, 1 h cache, 2 s timeout), Admin › Gary,
  Account › Gary's wardrobe.

Checks: `test/unit/outfits.test.js` (seeded as drafts, approve and hide, starters, Early Bird,
badge unlocks, choose only what you have, weather mapping and fallback with a fake fetch),
`test/e2e/outfits.spec.js` (admin approves, member picks, Gary changes, axe at 375 px), and the
existing suite.

### M34 — Home city and the away nudge (Flow 14)
- Migration 028 (`users.home_city_id`, backfilled from the city each member stamped most). Set at
  sign-up; Account › Home city (`POST /account/home-city`). `/` signed in opens the home city
  and remembers it; other pages keep the city being browsed (the admin city bar unchanged).
- The away nudge on `/` (IP or `?lat&lng`), "Not now" (`POST /city/away/dismiss`, a day's `pp_away`
  cookie). No footer city list for members. Privacy page wording.

Checks: `test/unit/cities.test.js` (home set at sign-up, `/` goes home, browsing stays, footer,
Account change and limits, CSRF, nudge by IP and by location, Not now, migration backfill; sign-in
opens home, the logo, bogus `?city=`, unlisted cities), request logs without query strings, the
Account page in the axe sweep, and the existing suite.
