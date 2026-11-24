// Gary's briefing on the signed-in home page: the one most useful thing to do next, in his
// voice. Rules, not AI: the first that applies wins, so the advice is predictable and honest.
// Returns { text, action: { label, href } | null }. Text is plain (escaped by the view).

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function garyTip({ stamped, stampedToday, streak, nextBadge, nearest, almost, lore }) {
  if (stampedToday) {
    return {
      text: `Nice work at ${stampedToday.name} today! While you're there, there are activities to log for extra points.`,
      action: { label: `Things to do at ${stampedToday.name}`, href: `/parks/${stampedToday.slug}#act-h` },
    };
  }
  if (!stamped) {
    return {
      text: nearest
        ? `Let's get your first stamp. ${nearest.name} is ${nearest.where}, and your first stamp anywhere is worth 10 points.`
        : 'Let\'s get your first stamp. Pick any park, tap Stamp when you get there, and the first one is worth 10 points.',
      action: nearest ? { label: `Go to ${nearest.name}`, href: `/parks/${nearest.slug}` } : { label: 'Find a park', href: '/parks' },
    };
  }
  if (streak.atRisk) {
    return {
      text: `You've got a ${plural(streak.weeks, 'week')} streak going. Stamp any park by Sunday and it keeps growing.`,
      action: nearest ? { label: `Closest new park: ${nearest.name}`, href: `/parks/${nearest.slug}` } : { label: 'Find a park', href: '/parks' },
    };
  }
  if (almost && almost.total - almost.stamped <= 3) {
    const left = almost.total - almost.stamped;
    return {
      text: `Only ${plural(left, 'park')} left to finish ${almost.name}. Finish a neighborhood and its ring fills in on your passport.`,
      action: { label: `See ${almost.name}`, href: '/passport#stamps-h' },
    };
  }
  if (nextBadge && nextBadge.remaining <= 2) {
    return {
      text: `${nextBadge.remaining === 1 ? 'One more' : 'Two more'} and ${nextBadge.name} is yours. ${nearest ? `${nearest.name} is close by.` : ''}`.trim(),
      action: nearest ? { label: `Go to ${nearest.name}`, href: `/parks/${nearest.slug}` } : { label: 'See your badges', href: '/passport#badges' },
    };
  }
  if (lore) {
    return { text: `Here's one I love: ${lore.blurb}`, action: nearest ? { label: `Next up: ${nearest.name}`, href: `/parks/${nearest.slug}` } : null, lore };
  }
  return { text: 'Every park has something new in it. Pick one and go see what it is.', action: { label: 'Find a park', href: '/parks' } };
}
