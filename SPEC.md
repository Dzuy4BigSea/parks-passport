# Parks Passport — Spec

## Summary
Parks Passport is a mobile-first web app where anyone can keep a personal "passport" of the
City of St. Petersburg, FL parks they've visited (and, since Flow 14, the parks of other cities,
starting with Westminster, CA). Users find a park, stamp a visit (GPS
check-in preferred, honor system always allowed), add photos and a 1–5 star rating, and
earn points, levels and badges: known ones with visible progress, hidden ones, and lucky
random drops. Everything is private by default. Users can share with friends ("Park Pals")
and then publicly. It's a personal project, not an official City app. v1 succeeds when about
10 friends and family are using it for real.

## Users and roles
- **Visitor (signed out):** sees the home page, the park list, park pages (with public photos,
  reviews and the average rating), public passports, and sign-up/login pages.
- **Member (signed in):** everything a visitor can do, plus stamping visits, uploading photos,
  rating parks, saving parks to "Want to go", earning badges, managing Park Pals, and setting privacy.
- **Admin:** a member with the admin flag. Can edit parks, import the park CSV, manage badges,
  hide photos or reviews, and promote or demote admins. The first admin is set with a CLI
  command (`npm run make-admin -- <email>`).
- **Super admin:** an admin with the super-admin flag, set only by CLI
  (`npm run make-super-admin -- <email>`). Sees every badge idea and triages them (Flow 13).
- **Idea contributor:** a member an admin shared badge ideas with. Can submit badge ideas and
  see their own; nothing else changes.

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
- [ ] **Bot protection:** the sign-up form has a hidden trap field (off-screen, out of the tab
      order, hidden from screen readers); a sign-up that fills it creates no account and lands on
      the home page. One connection can make at most 5 sign-ups and 5 sign-in or reset emails an
      hour (HTTP 429 after that). The limits live in memory only; local and private addresses
      aren't limited. No CAPTCHA.
- [ ] **Profile photo:** on Account I can upload, replace or remove one photo (JPEG, PNG or WebP,
      up to 10 MB, checked by content). It's stored as a 256 px square JPEG with no metadata, and
      the old file is deleted on replace, remove and account deletion. It's seen by whoever can
      see my passport (Flow 8 rules; 404 otherwise) and shows on Account, my passport cover, the
      Pals list, feed and leaderboard, and "your pals were here". Without one, my initials show.
      With the Kids edition on, the form reminds me to use a photo of myself.

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
- [ ] **Reward schedule** (mobile-game practice: early quick wins, variable-ratio surprises,
      rising thresholds). Rewards always come from going out or using the app; nothing is paid for.
  - **Surprise badges** (hidden, `milestone(action)`): Trail Planner (first park page opened),
    Say Cheese (first profile photo), Better With Friends (first pal, both people), Critic's
    Corner (first rating), Shutterbug (first photo, including a photo stamp) and Night Owl
    (looking at parks between 9 pm and 4 am in that city's time). Each first-time action is
    recorded once (action and time only) and the badge shows on that same page.
  - **Lucky drops** (`lucky_drop(order, chance, floor, half_life)`): Golden Acorn, Shooting Star,
    Rainbow Find and Lucky Penny. One roll per stamp, for the next undropped one in order, so at
    most one per stamp. The chance is 45% on a first stamp, halves every 3 stamps and stays at
    3% or more. Never taken back. The original 5% Lucky Clover stays.
  - **The long climb:** levels Trailblazer 1600, Pathfinder 2500, Summit Seeker 3800, Wayfinder
    5600 and Grand Ranger 8000 points after Park Legend; Forty Fields, Seventy-Five Strong and
    Century Club for 40, 75 and 100 parks in any city.
  - New badges ship in `seed/reward-badges.json` and are added by slug to existing databases.
    Admins can create more with the two new rule types.

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
- [ ] A link that no longer works (regenerated, renewed after removing a pal, or cut short when
      pasted) shows "This invite link doesn't work anymore" with what to do next (status 404).
- [ ] **Friend codes:** the Pals page shows my friend code (8 characters shown as `XXXX-XXXX`,
      no look-alike characters such as 0/O or 1/I/L), with Copy and "New code" (the old one stops
      working). Typing a friend's code (any case, spaces or dash optional) under "Add a pal by
      code" sends them a **pal request**. It doesn't make us pals until they accept.
- [ ] **Pal requests:** the Pals page lists requests to me (Accept / Decline) and requests I
      sent (Cancel). Accepting makes us pals both ways and checks badges, like an invite link.
      If they already sent me a request, entering their code makes us pals at once. My own
      code, an existing pal, or a repeat request gets a clear message. Wrong codes are limited
      to 10 per hour and requests sent to 20 per day per person (cancelling doesn't give one
      back), so codes can't be guessed. Something that isn't a code at all doesn't count as a guess.
      Declining tells the sender nothing; their request just disappears.
- [ ] **Pals feed** (`/pals`) shows my pals' recent stamps, photos and badges that are visible
      to me, newest first, 20 per page.
- [ ] **Pals leaderboard** ranks me and my pals by unique parks stamped (points as the
      tie-breaker). Anyone whose passport is private to me is left out.
- [ ] My passport is at `/u/:handle` only if its visibility allows the viewer. Otherwise it
      returns 404 (not 403), so whether the account exists isn't revealed.
- [ ] A permissions test checks, for each content type (passport, visit, photo, review
      comment, badge), owner / pal / stranger / signed-out against each visibility level.
- [ ] **Your pals were here:** signed in, park cards (list and home) show up to three faces and
      "Ana and Ben stamped this" for pals who stamped the park, and a park page lists them with
      their latest date and a link to their passport. Only pals whose passport is shared (pals or
      public) count, as in the feed. With at least one pal, "Stamped by a pal" filters the list.
- [ ] **Notification center:** signed in, a bell in the header shows how many notifications I
      haven't read ("Notifications, 2 unread"). `/notifications` lists mine, newest first, 30 per
      page, unread ones marked New; opening the page marks them read. Notifications are made for a
      badge earned, a badge given to me, a new level, a pal request and a new pal; each links to
      the place it's about. Only I can see mine; signed out, the page sends me to log in. Those
      naming another member are deleted with that member's account. Up to 200 are kept per person.
- [ ] A pal request in the notification center has **Accept** and **Decline** right there, the
      same as on the Pals page, while the request is still open; once answered it says so.

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
      button, small print, with {name}, {inviter} and {city}) and preview or reset it.
- [ ] **Admin › Stats** shows counts only (no names, emails or locations): check-ins in 7 and 30
      days and in all, members who stamped in 7 and 30 days, new members, pal links, photos,
      ratings, activities and badges; check-ins per day (14 days) and per week (12 weeks, with
      new members); by city, by method, and the top 10 parks of the last 30 days. Check-ins count
      when they were made. Members and signed-out visitors get 404.
- [ ] **Give a badge:** from Admin › Members › Give a badge, I can give a member any badge they
      don't have (including disabled ones and "given only" badges, rule type `manual`, which the
      rules never award), with an optional note of up to 140 characters. It pops up on their next
      page as "A gift for you!" with "From <my name>: “note”", and goes in their notifications.
      The rules never take a given badge back; I can take it back on the same page.
- [ ] **Give to several at once:** in Admin › Members I tick members, choose a badge (the list
      shows how many copies of a limited edition are left), add an optional note and give it to all
      of them. Anyone who already has it is skipped; the result says how many got it, already had
      it, or missed out because the copies ran out.
- [ ] **Limited editions:** a badge can have a number of copies (1 to 1000) and the "Given by an
      admin only" rule. Each copy given gets the lowest free number (#1 of 100, #2 of 100…), so
      numbers are unique; a taken-back number is given again, and nothing is given past the last
      copy. Giving to several at once numbers them by join date. The edition can't be made smaller
      than the copies already given. The member's copy shows its number in the announcement, the
      notification, the passport and the close-up, with a holographic foil that shimmers and
      follows the pointer or the phone's tilt (still with reduced motion). **Early Bird Edition**
      (🐦, 100 copies) ships in `seed/limited-badges.json`. (The 🌅 Early Bird badge for checking
      in before 7:30 am is a different badge.)

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
      `check_in {park_slug, method}`, `photo_upload {park_slug}`, `activity_log {activity_slug, pillar}`,
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

- [ ] **Game feel: celebrations** (silent: never any sound). Built on the server-rendered news, so
      without JS, or with celebrations off, the page still says the same thing.
  - **Badge reveal:** a new badge or level-up opens a full-screen, face-down card ("Badge
    unlocked!", "Surprise badge!", "Lucky find!", "Level up!"). Tapping it flips it over with a
    shine, rays, confetti and a short buzz on phones; several queue up ("1 of 3", Next). The card
    is hidden until the tap.
  - **Inspect a badge:** on a passport, every badge opens a big card that tilts toward the
    finger or mouse, with a glare, and flips over to its story, how to earn it, or its clue.
  - **Getting a passport:** right after sign-up, the passport cover swings open, the member's name
    is stamped in with the city and date, confetti and Gary; the `?welcome=1` flag is then dropped
    from the address.
  - **Accessible:** each is a dialog with focus moved in and back, Tab kept inside, Escape to close,
    and axe clean. Reduced motion shows the same cards without movement.
  - **Account › On this device:** "Show celebrations" turns them off in this browser.

### Flow 12: Healthy activities (Paws and Kids editions)
As a member, once I've stamped a park I can log healthy things I do there, so that each visit
has more to it and I have reasons to come back. Background and sources:
`docs/healthy-activities.md`.
Done when:
- [ ] **Activities** come from `seed/activities.json`, which is loaded on every start: new ones
      are added and existing ones reworded, but an admin's on/off switch is kept. Each has a
      pillar (move, nature, calm, connect, learn, give), an edition (core, paws, kids), an optional
      park category it needs, a measure (check, minutes, miles or count) and points (1–5, so a
      stamp stays worth more).
- [ ] On a park page, a signed-in member who **stamped that park today** sees "Things to do here":
      activities for that park's categories first, then any-park ones grouped by pillar, then
      Paws and Kids. Before stamping, the section only says how many activities the stamp unlocks.
      Signed-out visitors don't see it. Backdated stamps don't unlock activities.
- [ ] Logging works without JavaScript. Each activity counts once per visit (park and day) and
      earns its points through the ledger. Minutes are 1–180 a log, miles 0.1–15 a log and 15 a
      day (more is refused), and at most 180 minutes a day count toward weekly goals. Errors show
      next to the activity. Undo removes the log and its points. Deleting the visit removes its
      logs and their points, and badges no longer met are taken back.
- [ ] **Privacy:** activity logs are visible only to their owner (never in the Pals feed or a
      public passport). Analytics get `activity_log {activity_slug, pillar}` only. No GPS is
      recorded beyond the stamp.
- [ ] **Editions** are switched on in Account: Paws ("I bring a pet") and Kids ("I bring kids").
      They add their activities, and their badges show on the badge board only when the edition
      is on (or the badge is already earned). Kids stores nothing about children, and while it's
      on, new photos (including stamp photos) default to "Only me".
- [ ] **Badge rule types:** `activity_count(target, n)`, `activity_parks(target, n)`,
      `activity_sum(target, metric, total, window_days)` (0 = all time), `weekly_sum(target,
      metric, total, n)`, `weekly_days(target, per_week, n)`, `pillar_variety(n, window_days)` and
      `activity_categories(n)`. `target` is `any`, `pillar:<p>`, `edition:<e>` or
      `activity:<slug>`. Weekly runs survive one missed week. Seed badges ship in
      `seed/activity-badges.json` and are added by slug to existing databases.
- [ ] **My passport** shows this week's movement minutes (goal 150), park minutes (goal 120),
      miles and pillars.
- [ ] **Admin:** Admin › Activities switches each activity on or off. The badge form offers the new
      rule types with a target picker. The park form has an optional walking-loop length
      (`loop_mi`), shown next to "Walk a mile".

### Flow 13: Badge ideas
As an admin, I can collect badge ideas from myself and people I trust, so that the super admin
can keep, kill or combine them and hand the keepers to Claude Code to build.
Done when:
- [ ] `/ideas` is open to admins and idea contributors and returns 404 to everyone else
      (signed out included). It shows a fill-in-the-blank form, "Earn **[badge name]** when you
      **[do what]**", with an optional emoji, and my own ideas newest first with their status.
      The name is optional (60 characters); "when you" is required, one line, 160 characters.
      At most 30 ideas per person per day.
- [ ] **Share:** Admin › Badge ideas lists contributors and lets any admin add one by email. A
      member gets the "Badge ideas" email with a link to `/ideas`. Someone without an account
      gets the same email with a `/join/<token>?next=/ideas` link (an invite, Flow 9) and has
      access as soon as they sign up with that address. Removing a contributor stops their access;
      their ideas stay. The email's wording is editable in Admin › Email › Messages.
- [ ] **Triage (super admin only):** Admin › Badge ideas lists every idea with its author's
      display name, filtered by New, Kept, Combined, Killed and Built. For each idea I can keep
      it, kill it, or combine it into another open idea, with an optional note and the rule type
      it fits (an existing rule type or "needs a new rule"). Plain admins see only the share
      section, and the triage routes 404 for them.
- [ ] **Suggest with Claude** (off without `ANTHROPIC_API_KEY`): a background job reads up to
      100 New ideas plus the existing badges and rule types, and proposes keep/kill/combine, a
      reason, and a rule type with parameters or a description of the new rule needed. Output is
      validated (unknown ideas, verdicts and rule types are dropped) and only stored as
      suggestions; I apply each one with a button. Idea text is treated as data, not instructions.
- [ ] **Build:** a Kept idea that fits an existing rule type has "Create badge", which opens
      the badge form filled in from the idea (disabled until I enable it). Saving it links the
      badge and marks the idea Built.
- [ ] **Export for Claude Code:** `/admin/ideas/export.md` downloads a Markdown brief of the
      Kept ideas that aren't built yet, combined ideas folded into their keeper, split into "fits
      an existing rule" and "needs a new rule", with the file pointers and checks Claude Code
      needs. It contains no names, emails or other personal details.
- [ ] Deleting an account deletes its ideas.

### Flow 14: More cities (city packs)
As anyone, I can explore the parks of every Parks Passport city with one account, so the app can
grow beyond St. Pete (Westminster, CA and Asheville, NC as proofs of concept).
Done when:
- [ ] **City packs:** each city ships as `seed/cities/<key>/`: `city.json` (name, tagline, accent
      colors, areas, motifs, time zone, map bounds, page copy, sort, listed), `parks.csv` and an
      optional `badges.json`. On every start, a new pack adds its city, its parks (when the city has
      none) and its badges (by slug). A city's theme is loaded once, then admins own it; its time
      zone, bounds and copy always follow the pack. A key can't be a path the app already uses.
- [ ] **URLs:** a city's pages live under its key: `/<city>` (landing or dashboard),
      `/<city>/parks`, `/<city>/parks/:slug` (and its stamp, photo, rating and activity forms) and
      `/<city>/passport`. Park slugs are unique per city. An unknown city, or a slug that isn't in
      that city, is a 404. Old links keep working: `/parks` and `/passport` redirect (302) to the
      current city's; `/parks/:slug` redirects (301) to the park with that slug in the current
      city, else the first city that has it.
- [ ] **Current city:** the first path segment when it names a city (remembered in an essential
      `pp_city` cookie holding only the key), else the remembered city, else St. Pete. Nav, the tab
      bar, maps and copy (headings, eyebrow, Gary's hello, meta description, search placeholder,
      the footer's "Made for …" and "Not affiliated with …") follow it. The footer and the landing
      page list every listed city.
- [ ] **Nearest-city suggestion:** on `/`, before a visitor has picked a city, the home page
      suggests the listed city nearest their IP address ("Looks like you're near Westminster")
      when it's within 160 km and isn't the city shown. It never switches by itself. The IP is
      looked up in a MaxMind GeoLite2-City file on our server (`GEOIP_DB`); the lookup never sends
      it out, stores or logs it (the server's ordinary request log is unchanged). Private
      addresses have no location. Without the file, there is no suggestion.
- [ ] **One passport, many cities:** points, levels, the streak, Park Pals and most badges count
      every city. `/<city>/passport` shows that city's stamps, collections and map, with a tab per
      city ("Westminster 3/25"); history lists every city's visits and names the city once there
      are two. Public passports (`/u/:handle?city=`) work the same way, read-only.
- [ ] **Time zones:** "today" for a stamp, a same-day photo or an activity is today where the park
      is, and `time_of_day` badges read the park's local clock (6 am at a Westminster park is
      Early Bird; the same moment in St. Pete is 9 am).
- [ ] **City badges:** a badge with a city counts only that city's visits and parks ("Every Park"
      is every St. Pete park; "Every Westminster Park" is Westminster's). City badges show on their
      city's board, and everywhere once earned. A new rule type, `cities_count(n)`, counts cities
      with a stamp: Two-City Explorer (known, 2) and Globetrotter (hidden, 3) ship for everyone.
- [ ] **One-tap stamp** (`/stamp`) finds the nearest park in any city.
- [ ] **Admin:** a city bar on Parks, Import and City theme picks the city they work on. New parks
      go in it and must be inside its bounds; edited parks stay in their own city. Import loads
      that city's CSV or seed file. "Generate landmark drafts" works on that city.
- [ ] **St. Pete is unchanged** apart from its URLs gaining `/st-pete`: same parks, badges,
      points and copy, and every existing visit, photo and rating kept (migration 016 rebuilds
      `parks` with foreign keys off and checks them before committing).

### Flow 15: Want to go (saved parks)
As a member, I can save parks I want to visit so that I have a shortlist of where to go next.
Done when:
- [ ] Signed in, each park card on a city's park list and the park page show a heart toggle
      ("Want to go"). It is a POST form (`/:city/parks/:slug/save`) with a CSRF token that works
      without JavaScript and returns me to the same page (search and filters kept). With
      JavaScript it toggles in place without a reload. The button keeps one accessible name and
      exposes its state with `aria-pressed`.
- [ ] Saving sets the state sent rather than toggling, so a repeated submit doesn't flip it back.
      One saved row per member per park. Saving an unknown or inactive park returns 404; without
      a valid CSRF token, 403; signed out, the login redirect.
- [ ] A "Want to go" filter on the park list (signed in only, GET `saved=1`) shows only my saved
      parks and combines with search, amenities, "Not visited yet" and "Stamped by a pal".
- [ ] My passport for a city has a "Want to go" section listing my saved active parks in that
      city that I haven't stamped yet, A–Z, each with its heart. Stamping a saved park removes it.
- [ ] The "Up next" closest-new-park card (passport, stamp celebration) prefers my closest saved
      unstamped park, labelled "Want to go", and otherwise falls back to the closest unstamped park.
- [ ] Saved parks are private to me: they never appear on public or pals-visible passports
      (`/u/:handle`), the Pals page or feed, or another member's pages, and signed-out visitors
      see no hearts.
- [ ] Deleting my account deletes my saved parks (`ON DELETE CASCADE`).

### Flow 16: Founding Members and feedback
As one of the first members, I'm thanked with a Founding Member badge and a direct line to the
people who make the app.
Done when:
- [ ] The first 75 accounts get the **Founding Member** badge automatically at sign-up, numbered
      #1 to #75 in sign-up order (members who joined before this shipped get theirs at the next
      start, oldest first). Deleting an account never hands its number to someone else. After 75,
      only an admin gives it (Admin › Members › Give a badge), without a number. The rules never
      take it back.
- [ ] Members with Founding Member or Early Bird Edition see a **Feedback** button fixed in the
      lower right (above the phone tab bar). It opens a small, special-feeling panel: "You're one of
      our first explorers. Tell us anything." with Idea / Something's broken / Love it, one text box
      (1,000 characters) and Send. It works without JavaScript (a `/feedback` page). The page
      I was on is saved with it. After sending: "Thank you. We read every one." At most 20 a day.
- [ ] Everyone else gets 404 for `/feedback`.
- [ ] **Admin › Feedback** lists every message newest first (name, kind, page, date) with "Mark
      done"; done ones are hidden behind a filter. Deleting an account deletes its feedback.

### Flow 17: Drops of Sunshine
As a member, I can send a quick thank-you to the people who look after my parks, so that park
staff hear how much their work matters.
Done when:
- [ ] A **Drops of Sunshine** button sits on every park page and in the header menu (`/sunshine`).
      The form is one text box (500 characters) and a Send button. The park is already chosen: the
      park page's park; otherwise the closest park to my GPS position if I allow it (within 2 km),
      else the park of my latest stamp in this city. "Change" lets me pick another park in the
      city, or "The whole parks department" for a general note. Nothing else is required.
- [ ] Sending shows a happy animation (sun rays and drops of light) and "Your drop of sunshine is
      on its way." With reduced motion it's a still sun. Without JavaScript the form still works and
      the thank-you page shows the still sun.
- [ ] Notes wait for admin review in **Admin › Drops of Sunshine** (park or "Parks department",
      city, member, date, text), with Approve and Hide, filtered by status and city. Nothing is
      sent to the city yet. My GPS position is used only to choose the park in my browser and is
      never sent or stored. At most 10 a day per member. Deleting an account deletes its notes.

### Flow 18: Nonprofit spotlights
As a member, I see a local nonprofit that cares for this park or its waterways, so that the most
visited parks send people to the groups doing the most good.
Done when:
- [ ] A nonprofit or member can **suggest a nonprofit** (`/nonprofits/suggest`, signed in): name,
      website, one-sentence mission (160 characters), the parks or city it serves, and why it
      qualifies (cares for this park or waterway, 1% for the Planet nonprofit partner, or other
      local nonprofit). Suggestions wait for an admin. At most 5 a day.
- [ ] **Admin › Nonprofits** approves, edits, pauses and removes spotlights: name, website (https),
      mission line, an optional logo (PNG or SVG, sanitized), the qualifying reason, and where it
      shows: chosen parks, or every park in a city.
- [ ] A park page shows at most one spotlight as a small card near the bottom, labelled "Local
      nonprofit" with the reason ("Cares for this park" / "1% for the Planet partner"): logo,
      name, mission line and a "Learn more" link (`rel="noopener sponsored"`). Park-specific
      spotlights win over city-wide ones; ties rotate by day.
- [ ] Views and clicks are counted per spotlight and park (a click goes through
      `/go/nonprofit/:id`, which redirects to the site). No personal data is stored or sent with
      them. Admin › Nonprofits shows views, clicks and the top parks for each.

### Flow 19: Our mission (admin)
- [ ] **Admin › Mission** shows the Parks Passport mission: healthy people, healthy communities,
      healthy public governance and meaningful giving, as a cycle of shared stewardship, with
      doughnut economics as the frame. It is static copy, ready to become a public page later.

## Data model
SQLite file at `/data/app.db` (the `parks-passport-data` volume). Uploads go in `/data/uploads/`.
- **users**: id, email (unique, lower-cased), password_hash (scrypt, nullable for magic-link-only
  accounts), display_name, handle (unique), default_visibility, is_admin, share_nudge_dismissals,
  is_super_admin, paws, kids (editions), created_at
- **sessions**: id (random token hash), user_id, expires_at, created_at
- **auth_tokens**: id, user_id or email, purpose (magic_link | password_reset), token_hash,
  expires_at, used_at
- **parks**: id, city_id, slug (unique per city), name, address, lat, lng, checkin_radius_m, loop_mi, city_url, active,
  created_at, updated_at
- **park_categories**: park_id, category (e.g. `dog-park`, `playground`, `waterfront`)
- **visits**: id, user_id, park_id, visited_on (local date), visited_at, method (gps|photo|honor),
  lat, lng, accuracy_m, distance_m (private fields), points, unique(user_id, park_id, visited_on)
- **photos**: id, user_id, park_id, visit_id (nullable), file_key, caption, visibility, hidden,
  created_at
- **ratings**: id, user_id, park_id, stars, comment, visibility, comment_hidden, unique(user_id,
  park_id)
- **badges**: id, slug, name, description, hint, art, rule_type, rule_params (JSON), kind
  (known|hidden|lucky), enabled, city_id (null = every city)
- **user_badges**: user_id, badge_id, awarded_at, source_visit_id, unique(user_id, badge_id)
- **saved_parks**: user_id, park_id, created_at, unique(user_id, park_id); both foreign keys
  `ON DELETE CASCADE`. Private to the member (Flow 15).
- **point_events**: id, user_id, source_type, source_id, points, created_at (the ledger; total
  and level are derived from it)
- **activities**: id, slug (unique), name, description, pillar, edition, category (nullable),
  measure, minutes (credited for a check), points, sort, active
- **activity_logs**: id, user_id, visit_id, activity_id, amount, minutes, miles, logged_on,
  created_at, unique(visit_id, activity_id). Private to the owner.
- **founding**: the `founding_awarded` counter in **settings**; the badge is a `manual` badge
  (`founding-member`) given with `source_type = 'founding'` and a serial.
- **feedback**: id, user_id, kind (idea|bug|love), text, page, created_at, done_at.
- **sunshine_notes**: id, user_id, city_id, park_id (null = the whole department), text, status
  (new|approved|hidden), created_at, reviewed_at.
- **nonprofits**: id, name, url, mission, logo, reason (steward|one_percent|local), status
  (suggested|active|paused), city_id, suggested_by, created_at. **nonprofit_parks**: nonprofit_id,
  park_id. **nonprofit_stats**: nonprofit_id, park_id, day, views, clicks.
- **pal_codes**: user_id, code (unique), created_at. **pal_requests**: from_user, to_user,
  created_at, unique(from_user, to_user). **pal_request_sends** and **pal_code_failures**: user_id, at.
- **pal_links**: user_a, user_b (a < b), created_at. **pal_invites**: user_id, token_hash,
  created_at, revoked_at
- **feed** is a query over visits, photos and user_badges filtered by visibility, not a table.
- **city_themes** (one row per city): id, key (unique; the URL segment), name, tagline, accent,
  accent_2, areas (JSON centroids), active, time_zone, bounds (JSON), copy (JSON), listed, sort,
  seeded_at, updated_at. **city_motifs**: id, theme_id, slug, name, blurb, svg (sanitized), status
  (draft|approved), source (seed|ai|admin), sort, created_at. The AI job's state is the
  `theme_ai_job` row in **settings**.
- **idea_contributors**: id, email (unique), added_by, created_at. **badge_ideas**: id, user_id,
  name, pitch, art, status (new|keep|kill|combined|built), merged_into, rule_type, note,
  ai_suggestion (JSON), badge_id, created_at, updated_at. The AI job's state is the
  `idea_ai_job` row in **settings**.

## Integrations
| Service | Direction | Auth | Failure behavior |
|---|---|---|---|
| SendGrid (magic links, password resets) | write | API key `SENDGRID_API_KEY` in `.env`. Sender on `dzuynguyen.com`, domain-authenticated with CNAME records Dzuy adds. | The sign-up still succeeds. Signed-out link requests (magic link, password reset) always show the same "Check your email" page and send in the background, so the response never reveals whether an account exists; failures are logged. Signed-in sends (delete confirmation) show "Couldn't send email, try again". At most 3 links per user and purpose per 15 minutes. When `MAIL_TRANSPORT=outbox` (dev/test), mail goes to `/data/outbox/*.eml` instead. |
| Umami (self-hosted on aster) | write (client + server events) | Website ID in `.env`, no cookies | If Umami is down, the page still works and events are dropped silently. |
| Google Tag Manager / GA4 | write (client) | `GTM_ID` and `GTM_SCRIPT_ORIGIN` in `.env` | Not loaded when `GTM_ID` is empty. Gated by Consent Mode v2. |
| Browser Geolocation API | read (client) | user permission | Falls back to the honor system with an explanation. |
| Map tiles (OpenStreetMap tiles via Leaflet) | read (client) | none (attribution shown) | The map area shows "Map unavailable" and the list still works. |
| Anthropic Claude API (Admin › City theme, Admin › Badge ideas) | read (admin-triggered) | `ANTHROPIC_API_KEY` in `.env` | Optional. Without a key the Generate button is off. A failed run shows a fixed message (key rejected, rate limited, try again) and adds nothing. Output is validated and sanitized, and only becomes drafts. |
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
- Cities beyond the shipped packs without a code change by an admin (a new city is a new
  `seed/cities/<key>/` pack and a deploy; Flow 14)
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
- **Westminster data (Flow 14):** parks come from the City's "Parks and Facilities" page (saved
  from a browser: the site blocks automated fetches) via `scripts/seed-westminster.js`. Pins
  are OpenStreetMap park centers (16 parks), or the street address where OSM has none (7) or a
  different park (Tony Lam Park, Westminster Village Park). Amenities are only those the page
  names (splash pad, ball fields, skate park, tennis, pickleball); the City's amenity table isn't
  in the saved page. Dzuy reviews pins and amenities before the demo.
- **Asheville data (Flow 14):** 68 parks from the City's Parks & Recreation locations directory
  (`scripts/seed-asheville.js`), with the City's own pins, addresses and features. Community
  centers, the golf course and venues are left out unless they're also a park. Greenways get a
  300 m check-in radius. Several riverfront parks (Carrier Park and others) are partly closed
  after Tropical Storm Helene: Dzuy decides whether to deactivate any before the demo.
- **Nearest-city suggestion:** needs a free MaxMind account and the GeoLite2-City file on the
  server (`docs/geoip.md`). Until then the landing page's city list is the way to switch.
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
