# Parks Passport — Spec

## Summary
Parks Passport is a mobile-first web app where anyone can keep a personal "passport" of the
City of St. Petersburg, FL parks they've visited. Users find a park, stamp a visit (GPS
check-in preferred, honor system always allowed), add photos and a 1–5 star rating, and
earn points, levels and badges: known ones with visible progress, hidden ones, and lucky
random drops. Everything is private by default. Users can share with friends ("Park Pals")
and then publicly. It's a personal project, not an official City app. v1 succeeds when about
10 friends and family are using it for real.

## Users and roles
- **Visitor (signed out):** sees the home page, the park list, park pages (with public photos,
  reviews and the average rating), public passports, and sign-up/login pages.
- **Member (signed in):** everything a visitor can do, plus stamping visits, uploading photos,
  rating parks, earning badges, managing Park Pals, and setting privacy.
- **Admin:** a member with the admin flag. Can edit parks, import the park CSV, manage badges,
  hide photos or reviews, and promote or demote admins. The first admin is set with a CLI
  command (`npm run make-admin -- <email>`).

## Core flows and acceptance criteria

### Flow 1: Account
As a visitor, I can create an account and sign in with a password or an emailed magic link
so that my passport is saved.
Done when:
- [ ] Signing up with display name, a valid email and a password of at least 10 characters
      creates the account, signs me in, and lands me on `/passport`.
- [ ] Signing up with an email that's already registered shows "An account with this email
      already exists" inline, and no second user row is created.
- [ ] An invalid email or a short password shows an inline error on that field, and nothing is
      saved.
- [ ] Logging in with the right password signs me in. A wrong password shows one generic error
      ("Email or password is incorrect") that doesn't reveal whether the email exists.
- [ ] After 10 failed logins for one email within 15 minutes, further attempts get HTTP 429
      for 15 minutes.
- [ ] "Email me a sign-in link" sends an email (written to the dev/test outbox) with a link
      that signs me in once. Reusing it, or using it after 15 minutes, shows "This link has
      expired" and doesn't sign me in. Requesting a link for an unknown email shows the same
      "Check your email" message, and no email is sent.
- [ ] "Forgot password" sends a reset link with the same single-use, 15-minute rules. Setting
      a new password through it signs out every other session for that user.
- [ ] Log out ends the session, and `/passport` then redirects to `/login`.
- [ ] "Delete my account" with password (or magic-link) confirmation removes the user and all
      their visits, photos (files too), ratings, badges and pal links. Afterwards their old
      public passport URL returns 404.
- [ ] Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Every
      state-changing form rejects a request without a valid CSRF token (HTTP 403).

### Flow 2: Browse and search parks
As anyone, I can find a park and see what it offers so that I can choose where to go.
Done when:
- [ ] `/parks` lists every active park from the database, alphabetically by default.
- [ ] Typing in search filters the list by park name, case-insensitively (e.g. "lake" matches
      "Crescent Lake Park"), and works without JavaScript through a GET query string.
- [ ] Filtering by an amenity or category (e.g. dog park, playground, waterfront) shows only
      parks that have it, and filters combine with search.
- [ ] "Near me" (when I allow location) sorts by distance and shows each park's distance in
      miles to one decimal place. If I deny location, the list stays alphabetical and a
      message explains why.
- [ ] Signed in, each park shows a stamped/not-stamped mark, and a "Not visited yet" filter
      works.
- [ ] `/parks/:slug` shows name, address, a small map pin, amenities, a link to the City's
      page if one is known, the average rating and number of ratings, and the photos and
      reviews the viewer is allowed to see (Flow 8 rules). An unknown slug returns 404.

### Flow 3: Stamp a visit
As a member, I can stamp a park I'm at, preferably by GPS, so that it counts in my passport.
Done when:
- [ ] On a park page, "Check in here" asks for location. If the reported position is within
      the park's check-in radius (default 150 m, can be set per park) plus the reported
      accuracy, capped at 100 m, the visit is saved with method `gps` and a "GPS verified"
      stamp.
- [ ] If I'm outside the radius, I see how far away I am and can still choose "Stamp anyway
      (honor system)", which saves method `honor`.
- [ ] If location is denied or unavailable, I can stamp with method `honor`, optionally adding
      a photo, which saves method `photo`.
- [ ] I can backdate an honor or photo stamp to any date up to today, but never a future date.
      A GPS stamp always uses the current time.
- [ ] One stamp per park per calendar day (America/New_York). A second attempt that day shows
      "Already stamped today", and no new visit is saved.
- [ ] The stamp response shows points earned and any new badges or level-up in the same page
      load (Flow 7).
- [ ] My raw GPS coordinates are stored for my own visit history but never appear in any page,
      API response or export seen by another user. Only the method label is shown.
- [ ] I can delete one of my visits. Its points are removed and badges are recalculated. A
      badge whose criteria are no longer met is removed, except lucky drops.

### Flow 4: Photos
As a member, I can add photos of a park so that I can remember the visit and show friends.
Done when:
- [ ] I can upload JPEG, PNG or WebP up to 10 MB (iPhone browsers convert HEIC photos to JPEG
      on upload; a raw HEIC file gets a clear message, since the server can't decode HEVC), from a park page or while stamping,
      with an optional caption of up to 200 characters. Other types or larger files show an
      inline error, and nothing is saved.
- [ ] Stored images are re-encoded at a 2000 px maximum on the long edge, plus a 400 px
      thumbnail, with **all EXIF metadata (including GPS) stripped**. A test reads the stored
      file and finds no EXIF.
- [ ] Each photo has a visibility setting (private / pals / public) that defaults to my account
      default (Flow 8), and I can change or delete it later. Deleting removes the files.
- [ ] Photos are served only to viewers allowed to see them. A private photo's URL returns 404
      to anyone but its owner and admins.
- [ ] An admin can hide any photo. A hidden photo is shown to no one except its owner, who
      sees a "Hidden by moderator" label.

### Flow 5: Rate a park
As a member, I can give a park 1–5 stars and an optional comment so that others know what
it's like.
Done when:
- [ ] I can rate any park, whether or not I've stamped it, with 1–5 stars and an optional
      comment of up to 500 characters. There's one rating per user per park, and submitting
      again updates it.
- [ ] A park's average rating (to one decimal place) and count include **all** ratings,
      including private ones (the aggregate is anonymous). The comment text is shown only to
      allowed viewers.
- [ ] I can delete my rating, and the average updates on the next page load.
- [ ] An admin can hide a review comment. The star value still counts.

### Flow 6: My passport and progress
As a member, I can see my passport so that I can tell how far I've come.
Done when:
- [ ] `/passport` shows "X of N parks stamped" (N = active parks), a grid of stamps (stamped
      parks in color with their first-visit date, the rest as outlines), my level, points
      and a progress bar to the next level.
- [ ] A map shows stamped and unstamped parks with different markers (each with a text label,
      not color alone).
- [ ] My visit history lists every visit, newest first, with date, park and method.
- [ ] Earned badges show with name, art and date. Known unearned badges show progress
      (e.g. "7 / 10 parks"). Hidden unearned badges show as "?" with a hint only.

### Flow 7: Gamification engine
As a member, I'm rewarded as I explore so that I keep visiting new parks.
Done when:
- [ ] **Points:** first stamp at a park 10, repeat stamp (another day) 2, GPS verified +5,
      photo with a stamp +3, first rating of a park +2. Unit tests cover each rule, and
      deleting the item reverses its points.
- [ ] **Levels:** thresholds and names live in one config (e.g. Day Tripper 0, Trail Finder 50,
      Explorer 150, Ranger 400, Park Legend 1000). The current level is derived from points.
      Reaching a threshold shows a level-up message once.
- [ ] **Badge rule types** (admins create badges from these with parameters): `parks_count(n)`,
      `category_count(category, n)`, `same_park_count(n)`, `time_of_day(start, end)`,
      `weekend_parks(n)` (n different parks in one Sat–Sun), `weekly_streak(n)` (a stamp in n
      consecutive weeks), `pal_same_day` (a pal stamps the same park on the same day),
      `all_parks`, and `lucky(probability)`.
- [ ] Each badge is **known** (criteria and progress shown) or **hidden** (shown as "?" with
      a hint until earned). **Lucky** badges are awarded at random on a stamp, with the
      configured probability. The random source is injectable so tests are deterministic.
- [ ] Badges are evaluated on every stamp, photo, rating and pal acceptance, and each badge is
      awarded at most once per user. A unit test runs each rule type against fixture visits.
- [ ] Seed badges ship with v1: at least 6 known, 3 hidden, 1 lucky and 1 social.
- [ ] A new badge or level-up appears in an accessible announcement (`role="status"`) on the
      page after the action, and when shareable it offers "Share with Park Pals".

### Flow 8: Privacy, Park Pals and sharing
As a member, I control who sees my activity and can connect with friends so that exploring
is social.
Done when:
- [ ] There are three visibility levels: **private** (only me), **pals** (me and accepted
      Park Pals), **public** (anyone, including signed-out visitors). New accounts default to
      private.
- [ ] My account default visibility applies to new photos, reviews and my passport page, and I
      can override it per photo or review.
- [ ] After stamping or earning a badge while my default is private, a dismissible nudge offers
      to share with Park Pals. Dismissing it 3 times stops it.
- [ ] I get a personal invite link (`/pals/invite/:token`). Someone who opens it and accepts
      becomes my pal (in both directions). I can regenerate the link, which invalidates the old
      one, and remove a pal. There is no user search.
- [ ] **Pals feed** (`/pals`) shows my pals' recent stamps, photos and badges that are visible
      to me, newest first, 20 per page.
- [ ] **Pals leaderboard** ranks me and my pals by unique parks stamped (points as the
      tie-breaker). Anyone whose passport is private to me is left out.
- [ ] My passport is at `/u/:handle` only if its visibility allows the viewer. Otherwise it
      returns 404 (not 403), so whether the account exists isn't revealed.
- [ ] A permissions test checks, for each content type (passport, visit, photo, review
      comment, badge), owner / pal / stranger / signed-out against each visibility level.

### Flow 9: Admin
As an admin, I can keep the park list and badges right and remove bad content.
Done when:
- [ ] `/admin` and its sub-pages return 404 to non-admins.
- [ ] I can create, edit and deactivate parks: name, slug, address, lat/lng, check-in radius,
      categories/amenities, City URL and active flag. Deactivated parks disappear from lists
      and from N but keep existing stamps.
- [ ] I can import `seed/parks.csv`, or an uploaded CSV with the same columns. Rows match on
      slug (update, otherwise insert). The result shows counts of added, updated and invalid
      rows, and the invalid rows are listed with reasons. Running the same import twice changes
      nothing.
- [ ] I can create, edit and disable badges: name, description, hint, art (emoji or uploaded
      SVG/PNG), rule type with parameters, and known/hidden. Disabling a badge stops new
      awards and keeps the existing ones.
- [ ] A moderation queue lists the newest public and pals photos and reviews, with hide and
      unhide actions.
- [ ] I can promote or demote another member to admin, but I can't demote myself.
- [ ] I can invite someone by email from Admin › Members. They get the branded invitation (wording
      editable in Admin › Email › Messages) with a one-time `/join/<token>` link that fills in the
      sign-up form and works for 30 days. Sign-up stays open to everyone. Existing members and
      addresses invited in the last 24 hours are refused. The list shows each invite as Pending or
      Joined. Only the token's hash is stored, and the join page loads no analytics.
- [ ] I can change the wording of every member email (subject, preview text, heading, message,
      button, small print, with {name} and {inviter}) and preview or reset it.

### Flow 10: Analytics and consent
As the owner, I can see how the app is used without tracking anyone who hasn't agreed, and
the setup is ready for first-party server-side GTM later.
Done when:
- [ ] **Umami (cookieless)** loads on every page for everyone, sets no cookies, and records
      page views plus the custom events below. It is served first-party under
      `parkspassport.dzuynguyen.com` (script and collect endpoint), so blockers that target
      third-party hosts don't drop it.
- [ ] **Consent banner** (first-party, no vendor) shows on first visit with equally prominent
      "Accept" and "Reject", plus "Settings" for analytics/ads toggles. The choice is stored in
      a first-party `pp_consent` cookie for 6 months. A "Cookie settings" link in the footer
      reopens it. The banner passes axe, can be operated by keyboard, and doesn't cover the
      page's main action at 375 px.
- [ ] **Google Consent Mode v2:** before GTM loads, `gtag('consent','default',…)` sets
      `analytics_storage`, `ad_storage`, `ad_user_data` and `ad_personalization` to `denied`.
      Accepting sends `consent update` with `analytics_storage: granted`, and ads stay denied
      unless toggled on. A Playwright test checks that no `_ga*` cookie exists before Accept
      and that one exists after.
- [ ] **GTM** loads only when `GTM_ID` is set in `.env`. Its loader URL comes from
      `GTM_SCRIPT_ORIGIN` (default `https://www.googletagmanager.com`), so pointing it at a
      first-party sGTM host later is a config change with no code edits. GA4 is configured
      inside GTM, not hard-coded.
- [ ] **dataLayer events** are pushed with these exact names and parameters, with no email,
      name, handle, free text or coordinates in any event: `sign_up {method}`,
      `login {method}`, `park_view {park_slug}`, `park_search {has_query, filter_count}`,
      `check_in {park_slug, method}`, `photo_upload {park_slug}`,
      `rating_submit {park_slug, stars}`, `badge_earned {badge_slug, kind}`,
      `level_up {level}`, `pal_invite_created`, `pal_accepted`, `share_prompt_action {action}`,
      `consent_update {analytics, ads}`. The same events go to Umami. A Playwright test checks
      each event's name and keys, and a unit test fails if a payload contains an `@` or a
      value longer than 100 characters.
- [ ] `/privacy` lists Umami, GA4 (via GTM) and the consent cookie, and says what each
      collects.
- [ ] With consent denied, Lighthouse mobile Performance on the four key pages stays at 90
      or above.

### Flow 11: Engagement and city theme
As a member, the app pulls me back with a one-tap stamp, a reason to go next and a look that
feels like my city, so stamping becomes a habit.
Done when:
- [ ] **Look:** the "Gulf Pop" palette (sand, deep-sea ink, aqua, hot pink, sun, violet) with
      every text color at WCAG AA. Bright aqua and city accent colors are decorative only.
      Headings use a self-hosted display font (Bricolage Grotesque, OFL). Entrance animations move
      only (never fade text), and `prefers-reduced-motion` turns every animation off.
- [ ] **One-tap stamp:** signed in on a phone, a bottom tab bar (Parks, Passport, Stamp, Pals,
      Account) replaces the header links. Its center Stamp button (and a Stamp button in the
      desktop header) opens `/stamp`, which asks for the position and stamps the nearest active
      park by GPS under the Flow 3 rules. Too far, it stamps nothing and lists the three closest
      parks with distances. The position is never echoed back. The manifest offers a "Stamp a park"
      home-screen shortcut.
- [ ] **Celebration:** a stamp shows an animated stamp with the park's city motif, a points
      count-up (decorative; the announced text is static), a confetti burst, and the next badge
      to earn and the closest unstamped park.
- [ ] **Next up:** the signed-in home page is a dashboard (Stamp button, parks stamped, level,
      percent explored) with cards for the closest unstamped park (distance from the park of my
      latest stamp, never from a GPS position), the known badge I'm closest to, and my weekly
      streak. The passport shows the same cards. Public passports don't.
- [ ] **Streak:** consecutive Monday-start weeks with a stamp, counted back from this week, or
      from last week when this week has none yet ("stamp by Sunday to keep your streak"). Shown
      as a flame pill in the phone header and on the dashboard and passport.
- [ ] **Collections:** the passport groups all N parks by neighborhood (nearest area centroid,
      parks without a pin last), each with a progress ring. Stamped parks show a seal with their
      motif. Every park still appears (Flow 6).
- [ ] **City theme:** the active city has a name, nickname, two accent colors, areas and
      landmark motifs (name, blurb, line-icon SVG). St. Pete ships with 9 hand-drawn motifs.
      Motifs appear on the landing page ("lore"), park cards and pages, stamps, the passport
      cover, a daily story on the dashboard and the footer.
- [ ] **Admin › City theme:** an admin edits the name, nickname and colors, adds, edits,
      approves, unpublishes and deletes motifs. "Generate landmark drafts" runs a background job
      that asks Claude (with web search) for 8–12 landmarks, facts and line icons. Results are
      drafts that appear nowhere until approved. Every SVG, whether seeded, hand-entered or from AI, passes a strict
      allowlist sanitizer (shapes only; no scripts, styles, links, text or event handlers) or is
      rejected. Without `ANTHROPIC_API_KEY` the button is off. API errors show a fixed message.

## Data model
SQLite file at `/data/app.db` (the `parks-passport-data` volume). Uploads go in `/data/uploads/`.
- **users**: id, email (unique, lower-cased), password_hash (scrypt, nullable for magic-link-only
  accounts), display_name, handle (unique), default_visibility, is_admin, share_nudge_dismissals,
  created_at
- **sessions**: id (random token hash), user_id, expires_at, created_at
- **auth_tokens**: id, user_id or email, purpose (magic_link | password_reset), token_hash,
  expires_at, used_at
- **parks**: id, slug (unique), name, address, lat, lng, checkin_radius_m, city_url, active,
  created_at, updated_at
- **park_categories**: park_id, category (e.g. `dog-park`, `playground`, `waterfront`)
- **visits**: id, user_id, park_id, visited_on (local date), visited_at, method (gps|photo|honor),
  lat, lng, accuracy_m, distance_m (private fields), points, unique(user_id, park_id, visited_on)
- **photos**: id, user_id, park_id, visit_id (nullable), file_key, caption, visibility, hidden,
  created_at
- **ratings**: id, user_id, park_id, stars, comment, visibility, comment_hidden, unique(user_id,
  park_id)
- **badges**: id, slug, name, description, hint, art, rule_type, rule_params (JSON), kind
  (known|hidden|lucky), enabled
- **user_badges**: user_id, badge_id, awarded_at, source_visit_id, unique(user_id, badge_id)
- **point_events**: id, user_id, source_type, source_id, points, created_at (the ledger; total
  and level are derived from it)
- **pal_links**: user_a, user_b (a < b), created_at. **pal_invites**: user_id, token_hash,
  created_at, revoked_at
- **feed** is a query over visits, photos and user_badges filtered by visibility, not a table.
- **city_themes**: id, key (unique), name, tagline, accent, accent_2, areas (JSON centroids),
  active, updated_at. **city_motifs**: id, theme_id, slug, name, blurb, svg (sanitized), status
  (draft|approved), source (seed|ai|admin), sort, created_at. The AI job's state is the
  `theme_ai_job` row in **settings**.

## Integrations
| Service | Direction | Auth | Failure behavior |
|---|---|---|---|
| SendGrid (magic links, password resets) | write | API key `SENDGRID_API_KEY` in `.env`. Sender on `dzuynguyen.com`, domain-authenticated with CNAME records Dzuy adds. | The sign-up still succeeds. Signed-out link requests (magic link, password reset) always show the same "Check your email" page and send in the background, so the response never reveals whether an account exists; failures are logged. Signed-in sends (delete confirmation) show "Couldn't send email, try again". At most 3 links per user and purpose per 15 minutes. When `MAIL_TRANSPORT=outbox` (dev/test), mail goes to `/data/outbox/*.eml` instead. |
| Umami (self-hosted on aster) | write (client + server events) | Website ID in `.env`, no cookies | If Umami is down, the page still works and events are dropped silently. |
| Google Tag Manager / GA4 | write (client) | `GTM_ID` and `GTM_SCRIPT_ORIGIN` in `.env` | Not loaded when `GTM_ID` is empty. Gated by Consent Mode v2. |
| Browser Geolocation API | read (client) | user permission | Falls back to the honor system with an explanation. |
| Map tiles (OpenStreetMap tiles via Leaflet) | read (client) | none (attribution shown) | The map area shows "Map unavailable" and the list still works. |
| Anthropic Claude API (Admin › City theme) | read (admin-triggered) | `ANTHROPIC_API_KEY` in `.env` | Optional. Without a key the Generate button is off. A failed run shows a fixed message (key rejected, rate limited, try again) and adds nothing. Output is validated and sanitized, and only becomes drafts. |
| Geocoder (US Census Geocoder, falling back to OSM Nominatim at 1 request/s) | one-time read | none | Used only by the seed script. Parks it can't place are flagged `needs_pin` for an admin to place on a map. |
| St. Pete Parks & Rec website | one-time import | none | Used only by `npm run seed:scrape` to build `seed/parks.csv`, never called at runtime. |

## Non-functional requirements
- **Accessibility:** WCAG 2.2 AA. The automated axe check (`@axe-core/playwright`) reports zero
  violations on every page. All flows work by keyboard only. Stamps and map markers don't rely
  on color alone. Touch targets are at least 24×24 px.
- **Performance:** Lighthouse mobile Performance ≥ 90 on `/`, `/parks`, `/parks/:slug` and
  `/passport`. Pages are usable without client JS, except GPS check-in and the map. JS
  shipped per page is 50 KB gzipped or less, excluding Leaflet.
- **Responsive:** no horizontal scroll and no overlapping elements at 375 px, 768 px and
  1440 px. Playwright screenshots of key pages at each width are reviewed.
- **PWA:** it has a web app manifest and icons, so it can be added to a phone's home screen.
  Offline support is out of scope.
- **Security/privacy:** passwords hashed with scrypt. Tokens are stored only as hashes. CSRF
  protection on all POSTs. Uploads are validated by file content, not just the extension.
  EXIF is stripped. Visit coordinates are never shown to others. Secrets live only in `.env`
  and GitHub secrets. A `/privacy` page says what's collected (email, visits incl. GPS,
  photos, ratings), who can see it, and how to delete it. Without consent, the only cookies are
  the essential `pp_session` (sign-in), `pp_csrf` (form protection) and `pp_consent`. GA4 cookies are set only after Accept
  (Flow 10).
- **Not official:** the footer says it's an independent project, not affiliated with the City
  of St. Petersburg. No City logo.
- **Ops:** `/healthz` returns 200 once the DB is reachable. The app runs within `mem_limit:
  512m`. A nightly SQLite backup (`.backup`) plus an uploads tar go to a folder outside the
  code tree, keeping 14 days.

## Stack and hosting
Node 22 + Fastify, server-rendered HTML templates with small progressive-enhancement JS,
SQLite (`better-sqlite3`), `sharp` for images, Leaflet for maps. Tests use `node --test`
(unit) and Playwright + axe (browser). It runs as the single `parks-passport` container on
aster behind the shared nginx at `https://parkspassport.dzuynguyen.com`, with data in the
`parks-passport-data` volume. Why: one small container fits the shared 8 GB box and the
512 MB limit, there's no separate DB to run, and backups are simple.

## Out of scope (v1)
- Native iOS/Android apps (the web/PWA only)
- Real-world prizes, coupons or redemption
- Park systems other than St. Pete (the schema shouldn't prevent adding them later; the city
  theme is data-driven so another city is a new theme row, not a redesign)
- Offline stamping
- User search and public user directory
- Comments/likes on other people's photos or stamps
- A live server-side GTM container (v1 only prepares for it)
- Ads and remarketing tags (Consent Mode ad signals stay denied unless the user opts in)

## Open questions
- **Park coordinates:** the City directory
  (https://www.stpeteparksrec.org/parks___facilities/_parks.php) lists **102 parks** with name,
  address (often an intersection such as "Park St. and 38th Ave. N."), phone, and a link to an
  info page. The info page has "Park Features" (e.g. Scenic View, Picnic Tables), hours and a
  description. **It has no coordinates.** `npm run seed:scrape` builds `seed/parks.csv`
  (slug, name, address, phone, lat, lng, categories, city_url, needs_pin) and geocodes each
  address. Dzuy reviews any flagged pins in the admin before launch. The CSV is committed, and
  the scrape is never run in production.
- **Categories:** filters come from the "Park Features" values, normalized (e.g. "Dog Park",
  "Off-Leash Dog Area" → `dog-park`). The final list is fixed once the scrape shows every
  distinct value.
- **SendGrid:** Dzuy sets up the account, the sender address on `dzuynguyen.com`, and domain
  authentication (DNS CNAMEs).
- **Umami hosting (decided):** `parks-passport-umami` + `parks-passport-umami-db` in this app's
  compose file under the `analytics` profile (off until enabled in `.env`), no host ports, the DB
  on a private network, 256 MB each. nginx serves only `/stats/script.js` and `/stats/api/send`;
  the dashboard is reached through an SSH tunnel. Setup steps: `docs/umami-setup-prompt.md`.
- **sGTM (later):** the first-party host name (e.g. `sgtm.parkspassport.dzuynguyen.com`) and
  where it runs. v1 only makes this a config switch (Flow 10).
- **Check-in radius:** the 150 m default may be too small for large parks such as Boyd Hill
  or Weedon Island. Per-park overrides exist, but the right values need a walk-test.
- **Assumption:** account deletion is in v1 because we store GPS and photos. Say if not.

## End-to-end verification
`npm test` passes in CI (GitHub Actions on every PR). It runs lint, unit tests (`node --test`,
covering auth tokens, points, levels, every badge rule type, the visibility matrix, and the
CSV import) and the Playwright suite against a fresh SQLite DB with the seed parks. The
Playwright suite covers every flow above, mocks geolocation for inside, outside and denied
check-ins, checks consent gating and every dataLayer event, runs axe on every page with zero
violations, and takes 375/768/1440 screenshots.
Lighthouse (`npm run lighthouse`, in CI) on the four key pages meets the Performance ≥ 90 budget,
and `npm run check:memory` keeps the server's peak memory under load below 400 MB. After a deploy,
`curl -fsS https://parkspassport.dzuynguyen.com/healthz` returns `ok`, and a manual phone test
(sign up, GPS check-in at a real park, photo, rating, badge, invite a pal) succeeds.
