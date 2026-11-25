import { html } from './html.js';

// A member's face: their profile photo when the viewer may see it, else their initials on a
// color picked from their id. Decorative (alt=""): the name is always next to it or in the
// surrounding text. person = { id, display_name, avatar_key }.
const HUES = [12, 32, 160, 190, 215, 265, 300, 340];

export const initialsOf = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

export function avatar(person, { size = 40, visible = true, cls = '' } = {}) {
  const klass = `avatar${cls ? ` ${cls}` : ''}`;
  if (visible && person.avatar_key) {
    return html`<img class="${klass}" src="/avatars/${person.id}/${person.avatar_key}.jpg" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">`;
  }
  const hue = HUES[Math.abs(Number(person.id) || 0) % HUES.length];
  return html`<span class="${klass} avatar-initials" style="--hue:${hue};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px" aria-hidden="true">${initialsOf(person.display_name)}</span>`;
}

/** Whether a pal's photo shows to their pals: they share their passport (pals or public). */
export const sharesWithPals = (person) => person.default_visibility === 'pals' || person.default_visibility === 'public';
