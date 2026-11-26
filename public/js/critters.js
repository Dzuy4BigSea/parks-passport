// Little moments of delight: now and then, a critter wanders across one corner of the screen. When,
// which critter, which corner, how big and how bold are all random, and sightings are rare, so they
// stay a surprise. Decorative only: aria-hidden, never clickable, gone when done. Off with reduced
// motion or when this device turned celebrations off (Account › On this device).
import { celebrationsOn, reducedMotion } from './fx.js';

const LAST = 'pp-critter-last';
const MIN_GAP_MS = 4 * 60 * 1000; // at most one sighting every 4 minutes on this device
const CHANCE = 0.35; // on each page view (once the gap has passed)

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const BUTTERFLY_COLORS = [['#ff4d88', '#ffc83d'], ['#ffc83d', '#ff7a59'], ['#00b3a4', '#5b4bd6'], ['#5b4bd6', '#ff4d88']];

// Each critter faces right. Parts with a c-* class are animated in app.css.
const ART = {
  butterfly: () => {
    const [a, b] = pick(BUTTERFLY_COLORS);
    return `<svg viewBox="0 0 40 40" width="40" height="40"><g class="c-flap">
      <path d="M20 20 C10 4 2 8 4 16 C6 22 14 22 20 20Z" fill="${a}"/><path d="M20 20 C12 24 6 32 11 35 C16 37 19 28 20 20Z" fill="${b}"/>
      <path d="M20 20 C30 4 38 8 36 16 C34 22 26 22 20 20Z" fill="${a}"/><path d="M20 20 C28 24 34 32 29 35 C24 37 21 28 20 20Z" fill="${b}"/>
      <circle cx="9" cy="14" r="2" fill="#fff" opacity=".7"/><circle cx="31" cy="14" r="2" fill="#fff" opacity=".7"/></g>
      <rect x="19" y="11" width="2" height="19" rx="1" fill="#0e2a33"/><path d="M20 12 L16 5 M20 12 L24 5" stroke="#0e2a33" stroke-width="1" fill="none" stroke-linecap="round"/></svg>`;
  },
  bee: () => `<svg viewBox="0 0 40 32" width="34" height="28">
    <g class="c-buzz"><ellipse cx="17" cy="9" rx="6" ry="8" fill="#e9f8f6" stroke="#00b3a4" stroke-width="1" opacity=".85"/>
    <ellipse cx="24" cy="10" rx="5" ry="7" fill="#e9f8f6" stroke="#00b3a4" stroke-width="1" opacity=".85"/></g>
    <ellipse cx="20" cy="20" rx="13" ry="8.5" fill="#ffc83d" stroke="#0e2a33" stroke-width="1.5"/>
    <path d="M15 12.5 V27.5 M21 11.5 V28.5" stroke="#0e2a33" stroke-width="3"/>
    <circle cx="31" cy="18" r="1.4" fill="#0e2a33"/><path d="M7 20 L3 20" stroke="#0e2a33" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  ladybug: () => `<svg viewBox="0 0 36 28" width="30" height="24">
    <path d="M8 22 L4 26 M14 23 L13 27 M22 23 L23 27 M28 22 L32 26" stroke="#0e2a33" stroke-width="1.5" stroke-linecap="round" class="c-legs"/>
    <ellipse cx="17" cy="15" rx="12" ry="9" fill="#ff4d88" stroke="#0e2a33" stroke-width="1.5"/>
    <path d="M17 6 V24" stroke="#0e2a33" stroke-width="1.2"/><circle cx="29" cy="15" r="5" fill="#0e2a33"/>
    <circle cx="12" cy="12" r="2" fill="#0e2a33"/><circle cx="22" cy="12" r="2" fill="#0e2a33"/><circle cx="11" cy="19" r="1.7" fill="#0e2a33"/><circle cx="23" cy="19" r="1.7" fill="#0e2a33"/>
    <circle cx="30.5" cy="13.5" r="1" fill="#fff"/></svg>`,
  caterpillar: () => `<svg viewBox="0 0 56 24" width="50" height="22">${[6, 14, 22, 30, 38].map((x, i) =>
    `<circle class="c-seg" style="--d:${i * -0.09}s" cx="${x}" cy="15" r="5.5" fill="${i % 2 ? '#00b3a4' : '#3fcf8e'}" stroke="#00756c" stroke-width="1"/>`).join('')}
    <g class="c-seg" style="--d:-0.45s"><circle cx="47" cy="13" r="6.5" fill="#3fcf8e" stroke="#00756c" stroke-width="1"/>
    <circle cx="49.5" cy="11.5" r="1.3" fill="#0e2a33"/><path d="M45 7 L43 2 M49 7 L51 2" stroke="#00756c" stroke-width="1.2" stroke-linecap="round"/></g></svg>`,
  bird: () => `<svg viewBox="0 0 44 30" width="40" height="28">
    <path d="M6 18 C10 12 20 11 28 13 L36 10 L33 15 C33 20 26 23 18 22 C12 22 8 21 6 18Z" fill="#00756c"/>
    <path d="M3 17 L9 15 L8 20Z" fill="#00756c"/><circle cx="31" cy="13" r="1.3" fill="#fff"/><path d="M36 10 L41 11 L35 13Z" fill="#ffc83d"/>
    <path class="c-wing" d="M15 16 C17 6 22 2 26 3 C24 9 22 14 19 17Z" fill="#00b3a4"/></svg>`,
  dragonfly: () => `<svg viewBox="0 0 48 30" width="44" height="28"><g class="c-buzz" opacity=".8">
    <ellipse cx="30" cy="8" rx="4" ry="9" fill="#efedff" stroke="#5b4bd6" stroke-width="1" transform="rotate(-25 30 15)"/>
    <ellipse cx="30" cy="22" rx="4" ry="9" fill="#efedff" stroke="#5b4bd6" stroke-width="1" transform="rotate(25 30 15)"/>
    <ellipse cx="24" cy="9" rx="3.5" ry="8" fill="#e9f8f6" stroke="#00b3a4" stroke-width="1" transform="rotate(-35 24 15)"/>
    <ellipse cx="24" cy="21" rx="3.5" ry="8" fill="#e9f8f6" stroke="#00b3a4" stroke-width="1" transform="rotate(35 24 15)"/></g>
    <rect x="3" y="13.5" width="26" height="3" rx="1.5" fill="#5b4bd6"/><ellipse cx="32" cy="15" rx="5" ry="3.5" fill="#00b3a4"/><circle cx="38.5" cy="15" r="3.5" fill="#00756c"/></svg>`,
  snail: () => `<svg viewBox="0 0 44 28" width="38" height="24">
    <path d="M4 25 C10 25 30 25 38 22 C41 21 41 17 38 16 L34 16 L30 24" fill="#ffc83d" stroke="#c98a00" stroke-width="1"/>
    <path d="M37 16 L39 9 M35 16 L35 10" stroke="#c98a00" stroke-width="1.3" stroke-linecap="round"/><circle cx="39" cy="9" r="1.3" fill="#0e2a33"/><circle cx="35" cy="10" r="1.3" fill="#0e2a33"/>
    <circle cx="18" cy="15" r="10" fill="#ff7a59" stroke="#c8155a" stroke-width="1.2"/><path d="M18 15 m0 -6 a6 6 0 1 1 -6 6 a4 4 0 1 1 4 -4 a2 2 0 1 1 -2 2" fill="none" stroke="#c8155a" stroke-width="1.2"/></svg>`,
  firefly: () => `<svg viewBox="0 0 30 30" width="26" height="26"><circle class="c-glow" cx="12" cy="17" r="9" fill="#ffc83d" opacity=".45"/>
    <ellipse cx="13" cy="16" rx="7" ry="4" fill="#5b4bd6"/><circle cx="8" cy="17" r="3.5" fill="#ffe680"/><circle cx="20" cy="15" r="3" fill="#0e2a33"/>
    <g class="c-buzz"><ellipse cx="14" cy="10" rx="3" ry="5" fill="#efedff" opacity=".8"/></g></svg>`,
};

// How each kind moves. Points are in a "corner frame": x = px in from the side edge, y = px in from the
// top/bottom edge; negative means off screen. `walk` critters stay on the bottom or top edge.
const KINDS = {
  butterfly: { art: ART.butterfly, fly: 'flutter', dur: [5200, 8000] },
  bee: { art: ART.bee, fly: 'zigzag', dur: [2600, 4200] },
  ladybug: { art: ART.ladybug, walk: true, dur: [7000, 10000] },
  caterpillar: { art: ART.caterpillar, walk: true, dur: [11000, 15000] },
  bird: { art: ART.bird, fly: 'swoop', dur: [1800, 2800] },
  dragonfly: { art: ART.dragonfly, fly: 'dart', dur: [3200, 4800] },
  snail: { art: ART.snail, walk: true, dur: [14000, 19000] },
  firefly: { art: ART.firefly, fly: 'flutter', dur: [6000, 9000] },
};

function flightPath(style, depth) {
  const reach = 180 * depth;
  const start = { x: -70, y: rand(0.4, 1) * reach };
  const end = { x: rand(0.4, 1) * reach, y: -70 };
  const steps = style === 'zigzag' ? 6 : style === 'swoop' ? 1 : 3;
  const mid = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / (steps + 1);
    // Bow out from the corner along the way, with a wobble that suits the critter.
    const bow = Math.sin(Math.PI * t) * reach * (style === 'swoop' ? 0.55 : 0.4);
    const wob = style === 'zigzag' ? rand(-30, 30) : style === 'flutter' ? rand(-18, 18) : 0;
    mid.push({ x: start.x + (end.x - start.x) * t + bow * 0.6 + wob, y: start.y + (end.y - start.y) * t + bow * 0.6 - wob });
  }
  const pts = [start, ...mid, end];
  return Math.random() < 0.5 ? pts : pts.reverse(); // in from the side or from the bottom/top
}

function frames(points, style) {
  if (style !== 'dart') return points.map((p) => ({ p }));
  // A dragonfly darts and hovers: hold at every middle point.
  const out = [];
  const n = points.length - 1;
  points.forEach((p, i) => {
    const at = i / n;
    out.push({ p, offset: at });
    if (i > 0 && i < n) out.push({ p, offset: Math.min(at + 0.6 / n, (i + 1) / n - 0.01) });
  });
  return out;
}

/** Sends one critter across a corner. Exported for tests: release('bee', 'bottom-right'). */
export function release(name = pick(Object.keys(KINDS)), corner = pick(['top-left', 'top-right', 'bottom-left', 'bottom-right'])) {
  const kind = KINDS[name];
  if (!kind) return null;
  const top = corner.startsWith('top');
  const left = corner.endsWith('left');
  // Walkers keep to the bottom edge (they'd be upside down on top), just above any tab bar.
  const bottomEdge = kind.walk || !top;
  const el = document.createElement('div');
  el.className = `critter critter-${name}`;
  el.setAttribute('aria-hidden', 'true');
  el.style[left ? 'left' : 'right'] = '0';
  el.style[bottomEdge ? 'bottom' : 'top'] = bottomEdge ? 'var(--tabbar-h, 0px)' : '0';
  el.style.opacity = String(rand(0.5, 0.95)); // sometimes barely there, sometimes bold
  const art = document.createElement('div');
  art.className = 'critter-art';
  art.innerHTML = kind.art();
  el.append(art);
  document.body.append(el);

  const scale = rand(0.7, 1.25);
  const sx = left ? 1 : -1; // corner frame → screen
  const sy = bottomEdge ? -1 : 1;
  const duration = rand(...kind.dur);
  const at = ({ x, y }) => `translate(${sx * x}px, ${sy * y}px)`;
  let move;
  if (kind.walk) {
    // Wander in along the edge, pause, turn round and wander back out.
    const inward = rand(70, 160);
    move = el.animate([
      { transform: at({ x: -70, y: 2 }) }, { transform: at({ x: inward, y: 2 }), offset: 0.45 },
      { transform: at({ x: inward, y: 2 }), offset: 0.55 }, { transform: at({ x: -70, y: 2 }) },
    ], { duration, easing: 'linear' });
    const face = left ? 1 : -1; // inward first
    art.animate([
      { transform: `scale(${face * scale}, ${scale})` }, { transform: `scale(${face * scale}, ${scale})`, offset: 0.5 },
      { transform: `scale(${-face * scale}, ${scale})`, offset: 0.5 }, { transform: `scale(${-face * scale}, ${scale})` },
    ], { duration });
  } else {
    const pts = flightPath(kind.fly, rand(0.55, 1.3)); // depth: hugging the corner, or venturing out
    const goingRight = sx * (pts[pts.length - 1].x - pts[0].x) > 0;
    art.style.transform = `scale(${goingRight ? scale : -scale}, ${scale})`;
    move = el.animate(frames(pts, kind.fly).map(({ p, offset }) => ({ transform: at(p), ...(offset != null ? { offset } : {}) })),
      { duration, easing: kind.fly === 'swoop' ? 'ease-in-out' : 'linear' });
  }
  move.onfinish = () => el.remove();
  move.oncancel = () => el.remove();
  return el;
}

function maybeSchedule() {
  if (reducedMotion() || !celebrationsOn()) return;
  let last = 0;
  try { last = Number(localStorage.getItem(LAST)) || 0; } catch { /* private mode: no memory, still rare */ }
  if (Date.now() - last < MIN_GAP_MS || Math.random() > CHANCE) return;
  setTimeout(() => {
    if (document.hidden) return;
    try { localStorage.setItem(LAST, String(Date.now())); } catch { /* fine */ }
    release();
  }, rand(6000, 75000));
}

// Not under test automation, so a stray critter never lands in a test screenshot.
if (!navigator.webdriver) maybeSchedule();
