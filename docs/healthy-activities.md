# Healthy activities: a second layer on top of stamps

Status: **built in M12** (SPEC Flow 12). The lists live in `seed/activities.json` and
`seed/activity-badges.json`. Not built yet: a pets-allowed flag (so no Paws water or beach
activities), the Early Bird / Golden Hour and water bonuses, and "Same Time Next Week".

## The idea in one paragraph

A stamp gets someone to the park. An **activity** gives them something to do once they're
there, like a 20-minute walk, five minutes of quiet, or saying hello to a neighbor. Each activity
is a small, quick reward. Repeating activities over days and weeks builds toward badges based on
the health research ("10 miles in 10 days", "120 minutes of nature a week"). Some activities work
at any park. Others need a facility, like a trail, a pickleball court or a dog park, and those
give people a reason to try other parks. **Paws** and **Kids** editions add activities for people
who bring a pet or children.

## What the research says (and how each finding becomes a game mechanic)

| Finding | Source | What we do with it |
|---|---|---|
| Adults need 150 min/week of moderate activity, plus muscle-strengthening 2 days a week. Older adults should add balance training. Activity of any length counts; the old 10-minute minimum was removed. | US Physical Activity Guidelines, 2nd ed. (HHS, 2018) | Count weekly active minutes and work toward a **150 Club** badge. Add strength and balance activities. Any number of minutes counts. |
| About 7,000 steps a day was linked to 47% lower all-cause mortality than 2,000 steps. Most of the benefit appears by 5,000–7,000 steps. | Ding et al., *Lancet Public Health* 2025 | Set realistic walking targets, not 10,000 steps. A 20-minute walk is about 2,000 steps. |
| At least **120 min/week** in nature was linked to better health and wellbeing. It didn't matter whether that was one visit or several. Benefits leveled off at 200–300 min. | White et al., *Scientific Reports* 2019 | A weekly **Nature Dose** ring at 120 minutes, filled by time logged across any parks. |
| The biggest mood and self-esteem gain came from the first **5 minutes** of green exercise. Being near water increased the effect. | Barton & Pretty, *Env. Sci. & Tech.* 2010 | Keep the shortest activities at 5 minutes so the entry bar is low. Give a small bonus at waterfront parks, which St. Pete has plenty of. |
| Weekly 15-minute **awe walks** over 8 weeks increased joy and prosocial emotion in older adults. | Sturm et al., *Emotion* 2020 | An **Awe Walk** activity with an optional "small self" photo, plus an 8-walk badge that mirrors the study. |
| Exercise cut the rate of falls in older adults by 23%. Balance and functional training cut it by 24%, and tai chi by about 19% (low certainty). | Sherrington et al., Cochrane 2019 | Balance activities and a **Steady & Strong** track. Point people to Get Fit St. Pete tai chi. |
| Social isolation raises premature-mortality risk by about 29%. The Surgeon General compares the harm of disconnection to smoking up to 15 cigarettes a day. | US Surgeon General advisory, 2023 | Make Connect a full pillar: pal visits (already verifiable), greeting neighbors, group classes. |
| Brief contact with "weak ties" (acquaintances and regulars) is linked to better daily wellbeing. | Sandstrom & Dunn, *PSPB* 2014 | Small social acts: learn a regular's name, play open pickleball with a stranger. |
| Five Ways to Wellbeing: **Connect, Be active, Take notice, Keep learning, Give.** | New Economics Foundation for UK Foresight, 2008 | These become the five pillars below, with Calm split out from Take notice. |
| Habits took a median of 66 days to become automatic (range 18–254). Missing one day didn't stop the habit forming. | Lally et al., *Eur. J. Social Psych.* 2010 | Use **weekly** streaks with a grace week, not daily streaks that punish one missed day. |
| Dog owners were about 4× as likely to meet activity guidelines. Dog walking added to other exercise rather than replacing it. | Westgarth et al., *Scientific Reports* 2019 | The Paws edition is built on walking. |
| Pets help people get to know their neighbors. | Wood et al., *PLoS ONE* 2015 | Paws social activities ("meet a new dog and learn its name"). |
| Sniffing and scent work make dogs more optimistic. | Duranton & Horowitz, *Appl. Anim. Behav. Sci.* 2019 | A **Sniffari** activity: a slow walk where the dog leads. |
| Kids 6–17 need 60 min/day of activity. Preschoolers should be active throughout the day. | US Physical Activity Guidelines, 2nd ed. | A **60 a Day** activity for Kids. |
| An extra 40 min/day outdoors lowered new myopia in 6-year-olds (30% vs 40%). | He et al., *JAMA* 2015 | Outdoor time counts on its own for Kids, not just exercise. |
| Risky outdoor play (climbing, heights, exploring) has positive effects on children's health. Unstructured play builds skills. | Brussoni et al., *IJERPH* 2015; AAP "The Power of Play", 2018 | Kids activities are play and exploration, not drills. |

**Local tie-in: Healthy St. Pete**, the Parks & Rec division behind the City's wellness programs:
- **Get Fit St. Pete** runs free classes in parks: pickleball, yoga, tai chi, and Neighborhood
  Walks on the 4th Saturday of each month.
- It offers free Exercise Zone workouts in 11 parks.
- It also runs Fit City (an annual 5K and 1-mile walk), Fresh Rec Stop (produce) and the
  Healthier Together certification.

Activities like "Join a Get Fit St. Pete class" link out to the City's schedule and don't
store times, which change.

**Florida rule:** heat, sun and lightning are real risks. Every timed activity shows a one-line
hydrate/shade tip. **Early Bird** (before 9 am) and **Golden Hour** (after 5 pm) bonuses push
people toward cooler times instead of rewarding effort at midday.

## The six pillars

| Pillar | Icon | Covers |
|---|---|---|
| **Move** | 🚶 | Walking, strength, balance, sport |
| **Nature** | 🌿 | Time outdoors, water, sky, awe |
| **Calm** | 🧘 | Breathing, meditation, gratitude, phone-down |
| **Connect** | 🤝 | Pals, neighbors, classes, shared meals |
| **Learn** | 🔎 | Spotting wildlife, history, trying something new |
| **Give** | 💚 | Litter, helpful ratings, volunteering |

A **Five Ways Week** badge is earned by completing an activity from 5 of the 6 pillars within
7 days. It rewards a range of activities, not just a lot of one.

---

## Core list: works at any park

Each activity has a pillar, a measure (✓ done, minutes, miles or count) and points. Points stay
below a stamp's 10 so the stamp remains the main action.

### Move
| Activity | Measure | Pts | Notes |
|---|---|---|---|
| Brisk Ten: walk briskly for 10 min | minutes | 2 | Any length of activity counts (PAG 2018). |
| Park Walk: walk 20+ min | minutes | 3 | About 2,000 steps. |
| Walk a mile | miles | 3 | See "Distance" below. |
| Walk or bike to the park | ✓ | 3 | Active transport. Honor system. |
| Bench Five: 10 squats, 10 bench push-ups, 10 calf raises | ✓ | 2 | Counts toward the strength days. |
| Balance Break: 30 s on each foot, plus 10 heel-to-toe steps | ✓ | 2 | Fall prevention. |
| Stretch for 5 min | ✓ | 1 | |
| Play catch or frisbee | minutes | 2 | |
| Join a Get Fit St. Pete class or Neighborhood Walk | ✓ | 5 | Links to the City schedule. Also counts as Connect. |

### Nature
| Activity | Measure | Pts | Notes |
|---|---|---|---|
| Green Five: sit or stand outside for 5 min, no phone | ✓ | 1 | Barton & Pretty. |
| Awe Walk: 15 min, look for something vast or new, optional "small self" photo | ✓ | 3 | Sturm 2020. |
| Sunrise or sunset at the park | ✓ | 3 | Gives Early Bird or Golden Hour. |
| Find the biggest tree | ✓ + photo | 2 | |
| Shade Seeker: rest 5 min under a tree canopy on a hot day | ✓ | 1 | Heat tip and nature time in one. |

### Calm
| Activity | Measure | Pts | Notes |
|---|---|---|---|
| Breathe: 5 min of box breathing (guided timer in the app) | ✓ | 2 | |
| Meditate for 10 min | minutes | 2 | |
| Three Good Things: note 3 things you're grateful for | ✓ | 2 | The text is always private and never shown in the feed. |
| Read outside for 15 min | minutes | 2 | |
| Sound Map: sit still and count 5 different sounds | ✓ | 1 | |
| Phone Down: 20 min with the phone in a pocket | ✓ | 2 | Self-reported. |

### Connect
| Activity | Measure | Pts | Notes |
|---|---|---|---|
| Park with a Pal | auto | 3 | Already verifiable (`pal_same_day`). |
| Say hello: learn a regular's or neighbor's name | ✓ | 2 | Weak ties. Never store the name. |
| Bring someone new: someone visiting this park for the first time | ✓ | 3 | |
| Picnic: share a meal outside with someone | ✓ | 3 | |
| Across generations: visit with someone from another generation | ✓ | 3 | Aging and community. |

### Learn
| Activity | Measure | Pts | Notes |
|---|---|---|---|
| Who's this park named for? Read the City page or a marker | ✓ | 1 | Links to `city_url`. Once per park. |
| Wildlife spotter: see 3 birds, or an anole, squirrel or heron | count | 2 | |
| Name a plant or tree | ✓ | 2 | |
| Try something new here | ✓ | 2 | Free text, private. |

### Give
| Activity | Measure | Pts | Notes |
|---|---|---|---|
| Pick 5: pick up 5 pieces of litter | ✓ + optional photo | 3 | |
| Join a park cleanup | ✓ | 5 | |
| Leave a helpful tip with a rating | auto | (exists) | Already earns points through ratings. |

---

## Facility-specific lists

These appear only at parks with the matching category from `seed/parks.csv`. The number in
brackets is how many of the 102 parks have that category today.

| Category | Activities |
|---|---|
| `trails` (16) | Walk, run or bike the trail for 20+ min. Complete the full loop. Trail Sampler: trails at 5 different parks. |
| `fitness` (7) | Exercise Zone Circuit: one set at every station. Join the free Healthy St. Pete Exercise Zone workout. Climb the boulders (where they exist). |
| `pickleball` (8) | Play a game. Open-play rotation with someone new (Connect). Get Fit pickleball class. |
| `tennis` (9) | Hit for 30 min. Play a set with a pal. |
| `basketball` (11) | 50 free throws. Pickup game. HORSE with a pal. |
| `ball-fields` (15) | Play catch or run the bases. Cheer on a local game (Connect). |
| `water-access` (8) | Paddle (kayak, canoe or SUP) for 30 min. Fish from the pier or shore. Blue Ways paddle. |
| `beach` (2) | Barefoot beach walk for 20 min. Swim. Shell count (leave live shells). |
| `lake` (6) | Lap the lake. Spot a turtle, heron or fish. |
| `scenic-view` (11) | Water or sky photo (gets the water bonus). Awe pause. |
| `pool` (5, incl. splash pad) | Swim 20 min of laps. Water aerobics class (easy on the joints for older adults). |
| `recreation-center` (7) | Take a class. Try the fitness room. |
| `skatepark` (2) | 20-min skate or scooter session. Land a new trick. |
| `history-nature` (8) | Find the sundial, midden, arboretum or estuary. Read the marker. |
| `picnic-shelter` (29) | Host a picnic for 3+ people (Connect). Fresh-food picnic, "eat a color" (ties to Healthy St. Pete nutrition). |
| `playground` (42) | Mostly Kids. For adults: Play Again, use the equipment with a grandkid or kid. |
| `dog-park` (5) | See Paws. |

**Data gaps:**
- Healthy St. Pete says it runs Exercise Zones in 11 parks, but only 7 of our parks are tagged
  `fitness`.
- Shuffleboard, the golf putting green and "next to the library" currently map to no category.
  A `shuffleboard` category would suit St. Pete well.
- "Walk a mile" needs each park's loop length, which we don't have.

---

## 🐾 Paws edition

Paws is turned on in settings ("I bring a pet"). It adds activities. It doesn't replace
any. It's mostly about dogs, but cats on a harness count too.

**Safety, shown on every Paws activity:** do the 7-second pavement check (back of your hand on
the pavement; if it's too hot to hold, it's too hot for paws). Bring water and a bowl. Avoid
midday heat. Follow posted leash rules.

### Any park
| Activity | Pillar | Measure | Pts |
|---|---|---|---|
| Paw-trait: a photo with your pet at this park | Learn | photo | 2 |
| Pet walk: 20+ min | Move | minutes | 3 |
| Sniffari: 15 min where the dog sets the pace and gets to sniff | Calm | ✓ | 2 |
| Training five: sit, stay or recall practice | Learn | ✓ | 2 |
| Meet a new dog (and learn its name) | Connect | ✓ | 2 |
| Scoop + 1: pick up after your pet and one more piece of litter | Give | ✓ | 2 |
| Hydration stop: offer water in the shade | Nature | ✓ | 1 |
| Early Bird or Golden Hour pet walk | Move | auto from time | +1 |

### Facility-specific
| Category | Activities |
|---|---|
| `dog-park` (5) | Off-leash play for 20 min. Make a dog-park friend (Connect). Dog Park Circuit: all 5 dog parks. |
| `trails` | Trail walk with your pet. |
| `scenic-view` / `lake` | Paw-trait with a view. |
| `picnic-shelter` | Pet picnic with pet-safe treats. |
| `water-access` / `beach` | **Only where pets are allowed.** We'd need a per-park flag, so these are off until that exists. |

### Paws badges
Pack Walker (10 pet walks) · Sniffari Scholar (10 sniffaris) · Paw-trait Gallery (pet photos at
10 parks) · Dog Park Circuit (all dog parks) · Good Neighbor (meet 10 new dogs) · Cool Paws
(10 early or late walks).

---

## 🧒 Kids edition

Kids is turned on by a parent ("I bring kids"). It runs on the parent's account. **There are no
child accounts and no child names or ages stored**, which keeps us clear of COPPA. Activities
are play, not drills. A kid can pick the next activity from a big-button card.

### Any park
| Activity | Pillar | Measure | Pts |
|---|---|---|---|
| Nature Bingo: find something red, round, rough, a feather and a seed (the card rotates weekly) | Learn | ✓ | 3 |
| Animal Moves: 10 bear crawls, 10 frog jumps, 10 crab walks | Move | ✓ | 2 |
| Tag or a race | Move | ✓ | 2 |
| 60 a Day: an hour of active outdoor play | Move | minutes | 4 |
| Kid Leads: the kid picks where to go for 10 min | Learn | ✓ | 2 |
| Bug Safari: look, don't touch | Nature | ✓ | 2 |
| Cloud shapes | Calm | ✓ | 1 |
| Quiet Spot: 2 min of listening, then count the sounds | Calm | ✓ | 1 |
| Tree Hug: how many arms around the biggest tree? | Nature | count | 2 |
| Eat a color: fruit or veg picnic snack | Connect | ✓ | 2 |
| Litter Patrol (gloves, with an adult) | Give | ✓ | 3 |
| Teach a grown-up a game | Connect | ✓ | 2 |
| Park Detective: who is this park named for? | Learn | ✓ | 1 |

### Facility-specific
| Category | Activities |
|---|---|
| `playground` (42) | Climb to the top. Try every piece of equipment. Cross the monkey bars. (The existing *Playground Pro* badge fits here.) |
| `pool` / splash pad (5) | Splash play. Swim lesson at a City pool. Florida has one of the highest child drowning rates in the US, so swim lessons are worth a big reward. |
| `ball-fields` | Run the bases. 10 catches in a row. |
| `basketball` | Make 5 baskets. |
| `skatepark` / `trails` | Bike, scooter or skate ride. Requires a helmet ✓ to log. |
| `lake` / `water-access` | Spot a turtle, heron or fish. Fishing with an adult (Florida residents under 16 don't need a license). |
| `beach` | Sandcastle. Shell count. |
| `history-nature` | Find the sundial or the marker. |
| `recreation-center` | Join a youth or teen program (e.g. TASCO Teen Center). |

### Kids badges
Junior Explorer (10 Kids activities) · Nature Detective (5 completed bingo cards) · Splash Squad
(5 pool or splash visits) · Bike Buddy (5 helmet rides) · 60 a Day (60 active minutes on 5
different days) · Playground Pro (existing).

**Privacy:** Kids-edition photos default to **private** and never appear in the Pals feed
unless the parent shares each one individually. We already strip EXIF.

---

## Repeat badges (core)

These are the "come back" mechanics. All streaks are weekly and allow one grace week (Lally 2010).

| Badge | Rule | Evidence |
|---|---|---|
| **10 in 10** | 10 miles logged within any 10-day window | Your example; steps research |
| **Marathon, Slowly** | 26.2 lifetime miles (then 100, 250) | |
| **150 Club** | 150 active minutes in one week (Mon–Sun). Gold at 4 weeks in a row. | PAG 2018 |
| **Nature Dose** | 120 park minutes in a week, 4 weeks running | White 2019 |
| **Strong Days** | A strength activity on 2 days a week for 4 weeks | PAG 2018 |
| **Steady & Strong** | 10 balance activities, then 25 | Cochrane 2019 |
| **Awe Walker** | 8 awe walks | Sturm 2020 (8 weeks) |
| **Calm Corners** | Calm activities at 5 different parks | |
| **Sunrise Club / Golden Hour** | 5 sunrises / 5 sunsets | Also heat safety |
| **Good Neighbor** | 10 Connect activities | Surgeon General 2023 |
| **Litter Legend** | 25 Pick-5s | |
| **Five Ways Week** | 5 of the 6 pillars within 7 days | NEF 2008 |
| **Same Time Next Week** | An activity at the same park 4 weeks in a row | Habit formation |
| **Facility Sampler** (hidden) | Activities in 8 different facility categories | Gets people to new parks |

---

## How it would work (minimal design)

- **Logging:** after a stamp, the stamp page shows "Things to do here", with core activities
  plus any that match the park's categories and the user's editions. An activity can only be
  logged on the same day as a stamp at that park, so the GPS check-in we already do is the
  proof of presence.
- **Honor system with caps.** The same activity counts once per park per day. Minutes are
  capped at 180 and miles at 15 per day. The points are small on purpose, so cheating isn't
  worth much.
- **Known edge:** minutes are credited toward weekly goals when logged. If the 180-minute daily
  cap left a later log with 0 minutes and an earlier log is undone, the later one stays at 0.
- **No GPS tracking of walks.** Our rule is that coordinates never leave the stamp. Distance is
  entered by the user, or estimated from minutes (about 20 min per mile at a brisk walk), or
  calculated from a park's `loop_mi` once an admin sets it.
- **Visibility:** activity logs follow their visit's visibility. Gratitude and "try something
  new" text is always private. Analytics events carry only the `activity_slug`, never free text.
- **Data (sketch):** `activities` (seeded: slug, name, pillar, edition, required_category,
  measure, points, active), `activity_logs` (user_id, visit_id, activity_id, amount,
  logged_at), and optional `parks.loop_mi`. Editions are two booleans on the user.
- **New badge rule types:**
  - `activity_count(activity|pillar, n)`
  - `activity_sum(metric, total, window_days?)` (10 in 10, lifetime miles)
  - `weekly_sum(metric, total, weeks)` (150 Club, Nature Dose)
  - `pillar_variety(n, window_days)`
  - `activity_parks(pillar, n)`
  - `activity_categories(n)`

  These fit the existing engine, which already evaluates on every action.
- **Admin:** activities can be edited the same way badges are, so seasonal items (summer heat,
  Fit City week) are data, not code.

## Questions for Dzuy before this goes into SPEC/PLAN

1. **Timing:** a v1.1 milestone after launch, or part of v1? (I'd suggest v1.1. v1 is already
   big, and stamps should prove themselves first.)
2. **Honor system:** is self-reporting with caps OK, or should some activities (Paw-trait,
   Pick 5) require a photo?
3. **Kids privacy:** is "Kids photos are private by default and never in the feed unless shared
   one by one" right?
4. **Data:** should we add `loop_mi` per park, a `shuffleboard` category, and a pets-allowed flag
   for water and beach parks? And fix the Exercise Zone count (7 tagged vs 11 by the City)?

## Sources

- US Physical Activity Guidelines for Americans, 2nd ed., HHS 2018.
- Ding D. et al. Daily steps and health outcomes in adults. *Lancet Public Health* 2025;10(8):e668–81. https://pubmed.ncbi.nlm.nih.gov/40713949/
- White M.P. et al. Spending at least 120 minutes a week in nature… *Sci Rep* 2019;9:7730. https://www.sciencedaily.com/releases/2019/06/190613095227.htm
- Barton J., Pretty J. What is the best dose of nature and green exercise… *Environ Sci Technol* 2010;44(10):3947–55. https://repository.essex.ac.uk/683/
- Sturm V.E. et al. Big smile, small self: awe walks… *Emotion* 2020. https://pubmed.ncbi.nlm.nih.gov/32955293/
- Sherrington C. et al. Exercise for preventing falls in older people living in the community. Cochrane 2019, CD012424. https://pubmed.ncbi.nlm.nih.gov/30703272/
- US Surgeon General. *Our Epidemic of Loneliness and Isolation*, 2023. https://www.hhs.gov/sites/default/files/surgeon-general-social-connection-advisory.pdf
- Sandstrom G.M., Dunn E.W. Social interactions and well-being: the surprising power of weak ties. *PSPB* 2014.
- New Economics Foundation. *Five Ways to Wellbeing*, 2008.
- Lally P. et al. How are habits formed. *Eur J Soc Psychol* 2010.
- Westgarth C. et al. Dog owners are more likely to meet physical activity guidelines… *Sci Rep* 2019. https://pmc.ncbi.nlm.nih.gov/articles/PMC6473089/
- Wood L. et al. The pet factor… *PLoS ONE* 2015.
- Duranton C., Horowitz A. Let me sniff! Nosework induces positive judgment bias in pet dogs. *Appl Anim Behav Sci* 2019.
- He M. et al. Effect of time spent outdoors at school on the development of myopia… *JAMA* 2015;314(11):1142–8. https://jamanetwork.com/journals/jama/article-abstract/2441261
- Brussoni M. et al. What is the relationship between risky outdoor play and health in children? *IJERPH* 2015.
- Yogman M. et al. The Power of Play. *Pediatrics* (AAP) 2018.
- Healthy St. Pete / Get Fit St. Pete: https://www.stpeteparksrec.org/programs___events/healthy-stpete/index.php ; https://www.acefitness.org/about-ace/our-efforts/blog/7962/this-city-initiative-gets-all-its-community-members-moving-together-outside/
