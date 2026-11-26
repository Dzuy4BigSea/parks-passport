// Gary's briefing on the signed-in home page: the one most useful thing to do next, in his
// voice. Rules, not AI: the first that applies wins, so the advice is predictable and honest.
// Returns { text, action: { label, href } | null }. Text is html (escaped), with park names in the
// park-name style, as on the park cards.
import { html } from './html.js';

const pn = (name) => html`<span class="park-name">${name}</span>`;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function garyTip({ stamped, stampedToday, streak, nextBadge, nearest, almost, lore, cityKey = null }) {
  const base = cityKey ? `/${cityKey}` : '';
  // A park in any city (its city_key); old-style /parks/:slug links still redirect if one is missing.
  const parkHref = (p, hash = '') => `${p.city_key || cityKey ? `/${p.city_key || cityKey}` : ''}/parks/${p.slug}${hash}`;
  if (stampedToday) {
    return {
      text: html`Nice work at ${pn(stampedToday.name)} today! While you're there, there are activities to log for extra points.`,
      action: { label: `Things to do at ${stampedToday.name}`, href: parkHref(stampedToday, '#act-h') },
    };
  }
  if (!stamped) {
    return {
      text: nearest
        ? html`Let's get your first stamp. ${pn(nearest.name)} is ${nearest.where}, and your first stamp anywhere is worth 10 points.`
        : 'Let\'s get your first stamp. Pick any park, tap Stamp when you get there, and the first one is worth 10 points.',
      action: nearest ? { label: `Go to ${nearest.name}`, href: parkHref(nearest) } : { label: 'Find a park', href: `${base}/parks` },
    };
  }
  if (streak.atRisk) {
    return {
      text: `You've got a ${plural(streak.weeks, 'week')} streak going. Stamp any park by Sunday and it keeps growing.`,
      action: nearest ? { label: `Closest new park: ${nearest.name}`, href: parkHref(nearest) } : { label: 'Find a park', href: `${base}/parks` },
    };
  }
  if (almost && almost.total - almost.stamped <= 3) {
    const left = almost.total - almost.stamped;
    return {
      text: `Only ${plural(left, 'park')} left to finish ${almost.name}. Finish a neighborhood and its ring fills in on your passport.`,
      action: { label: `See ${almost.name}`, href: `${base}/passport#stamps-h` },
    };
  }
  if (nextBadge && nextBadge.remaining <= 2) {
    return {
      text: html`${nextBadge.remaining === 1 ? 'One more' : 'Two more'} and ${nextBadge.name} is yours.${nearest ? html` ${pn(nearest.name)} is close by.` : ''}`,
      action: nearest ? { label: `Go to ${nearest.name}`, href: parkHref(nearest) } : { label: 'See your badges', href: `${base}/passport#badges` },
    };
  }
  if (lore) {
    return { text: `Here's one I love: ${lore.blurb}`, action: nearest ? { label: `Next up: ${nearest.name}`, href: parkHref(nearest) } : null, lore };
  }
  return { text: 'Every park has something new in it. Pick one and go see what it is.', action: { label: 'Find a park', href: `${base}/parks` } };
}
