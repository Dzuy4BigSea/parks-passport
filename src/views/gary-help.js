// Gary on every screen (SPEC Flow 21): what you can do on the screen you're on, in his voice. Each
// screen has several tips so it doesn't get stale, and every tip ends with a sign-off. Founding
// explorers can talk back (feedback, Flow 16); his reply is a thank-you that fits what they sent.
// Rules and copy, not AI. All text is plain (escaped by the view).

const CITY = '(?:/[a-z0-9-]+)?'; // an optional city segment: /st-pete/parks or /parks

/** Screens, most specific first. `match` gets the path without its query string. */
export const SCREENS = [
  {
    key: 'park', label: 'a park', match: new RegExp(`^${CITY}/parks/[^/]+$`),
    tips: [
      'This is a park’s page. When you’re there, tap Stamp and I’ll check you in by GPS. No signal? The honor system has your back.',
      'Here you’ll find the address, the map, what’s at the park and what other explorers thought. Add your own photo and stars after your visit.',
      'Saving this park for later? Tap “Want to go” and it waits on your list. When you visit, stamp it and it moves to your passport.',
      'Every park has little things to do while you’re there: a walk, a nature hunt, a stretch. Log them after you stamp for extra points.',
      'Want company? Your Park Pals’ faces show up here when they’ve stamped this park too. Plan a meetup!',
    ],
  },
  {
    key: 'parks', label: 'the park list', match: new RegExp(`^${CITY}/parks$`),
    tips: [
      'Every park in this city is here. Search by name, sort by nearest, or filter by what you’re in the mood for, like dog parks or playgrounds.',
      'Tap Map to see the parks around you. The ones you’ve stamped look different, so the gaps are easy to spot.',
      'Not sure where to go? Sort by nearest and pick one you haven’t stamped. New parks are worth the most points.',
      'Looking for something specific? The Amenities filter finds trails, splash pads, tennis courts and more.',
    ],
  },
  {
    key: 'stamp', label: 'stamping', match: /^\/stamp$/,
    tips: [
      'This is the quickest stamp in town. I’ll find the park you’re standing in and check you in with one tap.',
      'Stand inside the park and tap Stamp. If your phone can’t get a good GPS fix, you can still stamp on the honor system.',
      'One stamp per park per day. Come back another day and it counts toward your streak and your Regular badge.',
      'Your exact location is only used to check you in. Nobody else ever sees it.',
    ],
  },
  {
    key: 'passport', label: 'your passport', match: new RegExp(`^${CITY}/passport$`),
    tips: [
      'This is your passport: every stamp, every badge and your level. Tap a badge to look closer, or flip it over to see how you earned it.',
      'Locked badges show what it takes to earn them. Hidden ones stay a surprise until you find them.',
      'Explored more than one city? Each city gets a tab up top, and your points and level travel with you.',
      'Your passport is private until you share it. Change who can see it in Account whenever you like.',
    ],
  },
  {
    key: 'public', label: 'someone’s passport', match: /^\/u\/[^/]+$/,
    tips: [
      'You’re looking at another explorer’s passport: the parks and badges they chose to share.',
      'Like what you see? Add them as a Park Pal and you can cheer each other on.',
      'Spot a park here you haven’t been to? That’s your next adventure.',
      'Everything here is what they decided to share. Their exact visits stay private.',
    ],
  },
  {
    key: 'pals', label: 'Park Pals', match: /^\/pals(?:\/.*)?$/,
    tips: [
      'Park Pals are your exploring crew. Share your friend code or an invite link, and you’ll see each other’s stamps.',
      'Stamp the same park on the same day as a pal and you’ll unlock Better Together.',
      'Pals see what you share with Park Pals, never your exact location. You can remove a pal any time.',
      'Got a pal request? Answer it here or from your notifications.',
    ],
  },
  {
    key: 'account', label: 'your account', match: /^\/account(?:\/.*)?$/,
    tips: [
      'This is your account: your name, photo, who sees your passport, and the Paws and Kids editions.',
      'Bring a dog or the kids along? Turn on the Paws or Kids edition for activities and badges just for them.',
      'Not a fan of the confetti? You can switch celebrations off for this device right here.',
      'Want a fresh profile photo? A friendly face makes your passport feel like yours.',
    ],
  },
  {
    key: 'notifications', label: 'notifications', match: /^\/notifications$/,
    tips: [
      'Everything that happened while you were out exploring: badges, level-ups, pals and notes from the team.',
      'Pal requests can be answered right here. No need to go looking.',
      'New ones are marked New. Opening this page marks them read.',
      'I keep your last 200 notifications, so nothing important slips by.',
    ],
  },
  {
    key: 'sunshine', label: 'Drops of Sunshine', match: /^\/sunshine$/,
    tips: [
      'Drops of Sunshine are thank-you notes for the crews who keep our parks beautiful. A few kind words go a long way.',
      'Pick the park (or the whole department) and say thanks. The team reads them and shares the good ones.',
      'Saw someone mowing, planting or fixing a swing? This is the place to tell them they made your day.',
      'Short and sweet is perfect. Gratitude doesn’t need many words.',
    ],
  },
  {
    key: 'feedback', label: 'feedback', match: /^\/feedback$/,
    tips: [
      'This is your direct line to the people who make Parks Passport. Ideas, bugs, love notes: it all helps.',
      'Found something broken? Tell us what you were doing and what happened. We’ll take it from there.',
      'Every message here gets read by a real person. Promise.',
      'Got a wild idea for a badge or a feature? This is exactly the place for it.',
    ],
  },
  {
    key: 'ideas', label: 'badge ideas', match: /^\/ideas$/,
    tips: [
      'Dream up a badge: give it a name and say what earns it. The good ones get built.',
      'Think about what makes a park visit special to you. That’s usually a great badge.',
      'Short and specific works best: “Earn Puddle Jumper when you stamp a park on a rainy day.”',
      'Your ideas show up below with their status, so you can see when one gets kept or built.',
    ],
  },
  {
    key: 'admin', label: 'admin', match: /^\/admin(?:\/.*)?$/,
    tips: [
      'Welcome to the back office. Parks, badges, members, messages and feedback all live here.',
      'Want to say thanks or wish everyone a happy holiday? Messages sends a note with a fun effect on each member’s next visit.',
      'Feedback from founding explorers lands in Feedback. Mark items done as you handle them.',
      'Pins to check lists parks without a confirmed location. Placing them makes GPS stamps work there.',
    ],
  },
  {
    key: 'auth', label: 'signing in', match: /^\/(?:login|signup|forgot|reset|join\/[^/]+|auth\/.*)$/,
    tips: [
      'Welcome! Make an account and every park you visit becomes a stamp in your passport.',
      'Hate passwords? Ask for a sign-in link and I’ll email you one.',
      'Your passport is private until you decide to share it. Explore at your own pace.',
      'One account works in every Parks Passport city, so your stamps travel with you.',
    ],
  },
  {
    // A city's home (/st-pete) or /, but not the one-segment pages that aren't cities.
    key: 'home', label: 'home', match: new RegExp(`^(?!/(?:privacy|credits|consent|activities|badges)$)${CITY}$|^/$`),
    tips: [
      'Hi, I’m Gary, your park guide! Find a park, stamp it when you get there, and collect badges along the way.',
      'Start with the closest park you haven’t stamped. Your first stamp is worth extra points.',
      'Every week you stamp a park, your streak grows. Keep it going and watch your level climb.',
      'Tap me any time and I’ll tell you what you can do on that screen.',
      'Bring a friend! Park Pals see each other’s stamps and unlock badges together.',
    ],
  },
];

const OTHER = {
  key: 'other', label: 'this page',
  tips: [
    'Hi, I’m Gary, your park guide. Tap Parks to find your next adventure, or Passport to see how far you’ve come.',
    'Every park you stamp fills in your passport. Let’s find one you haven’t been to yet.',
    'Lost? The tabs at the bottom (or the menu up top) take you anywhere you need to go.',
    'I’m always down here if you need me. Just tap!',
  ],
};

export const SIGN_OFFS = ['Let’s go!', 'Happy exploring!', 'See you out there!', 'You’ve got this!', 'Onward!', 'Go get ’em!'];

/** Gary's reply after a founding explorer talks back, by feedback kind (Flow 16's kinds). */
export const REPLIES = {
  idea: [
    'Ooh, I like where your head’s at! I’ve passed it to the crew. Thanks for dreaming big with us. Let’s go!',
    'Great idea! It’s on its way to the team, and they read every one. Thank you!',
    'You just made Parks Passport a little better. I’ve logged it for the crew. Happy exploring!',
    'Love it. Noted and sent to the people who build things around here. Keep ’em coming!',
  ],
  bug: [
    'Thanks for the heads-up! I’ll get this to the crew so they can fix it. Sorry for the bump in the trail. Let’s go!',
    'Good catch, explorer! It’s logged for the team. Thank you for helping us smooth things out.',
    'Oof, sorry about that. I’ve passed it straight to the fixers. Thanks for telling us!',
    'Bug spotted, bug reported. The crew’s on it. Thank you, and onward!',
  ],
  love: [
    'Aw, that made my day! I’ll share it with the whole crew. Thank you! Let’s go!',
    'You’re the best. I’m passing this along so the team can smile too. Happy exploring!',
    'That’s so kind. The crew is going to love reading this. Thank you!',
    'Right back at you, explorer! Message delivered with a big grin. Onward!',
  ],
};

const pickFrom = (list, random) => list[Math.floor(random() * list.length) % list.length];

/** The screen for a path (query string ignored). */
export function screenFor(path) {
  const p = String(path || '/').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return SCREENS.find((s) => s.match.test(p)) || OTHER;
}

/** A tip for the screen, with a sign-off: { screen, tip, signOff }. */
export function garyTipFor(path, random = Math.random) {
  const screen = screenFor(path);
  return { screen: screen.key, tip: pickFrom(screen.tips, random), signOff: pickFrom(SIGN_OFFS, random) };
}

export const garyReply = (kind, random = Math.random) => pickFrom(REPLIES[kind] || REPLIES.idea, random);

export const ALL_SCREENS = [...SCREENS, OTHER];
