// Background photos per city theme, with the credits their licenses need. Files are pre-treated
// (grayscale, blurred, small WebP) in public/city/<key>/; color comes from CSS blend modes, so
// they read as atmosphere, never as content. Another city adds its own entry and files.
//
// Roles: hero (landing page), cover (passport cover), card (dashboard card and park headers),
// texture (stamp finder and the stamp celebration).

const CHANGES = 'Converted to grayscale, blurred, resized and color-blended as a background.';

export const CITY_PHOTOS = {
  'st-pete': {
    hero: {
      file: '/city/st-pete/pier-sunrise.webp',
      title: 'Saint Petersburg Pier at sunrise',
      author: 'Andrew Heneen',
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      source: 'https://commons.wikimedia.org/wiki/File:Saint_Petersburg_Pier_at_sunrise.jpg',
    },
    card: {
      file: '/city/st-pete/pier-point.webp',
      title: 'Pier Point, St. Pete Pier, St. Petersburg, FL',
      author: 'Myotus',
      license: 'CC0 1.0 (public domain)',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      source: 'https://commons.wikimedia.org/wiki/File:Pier_Point,_St._Pete_Pier,_St._Petersburg,_FL.jpg',
    },
    texture: {
      file: '/city/st-pete/mangroves.webp',
      title: 'Weedon Island 2025 (14)',
      author: 'Evans125',
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      source: 'https://commons.wikimedia.org/wiki/File:Weedon_Island_2025_(14).jpg',
    },
  },
};
CITY_PHOTOS['st-pete'].cover = CITY_PHOTOS['st-pete'].hero;

/** The photo set for a theme key, or null. */
export const photosFor = (key) => CITY_PHOTOS[key] || null;

/** Unique photos for the credits page, with the note on how they were changed. */
export function photoCredits(key) {
  const set = photosFor(key);
  if (!set) return [];
  const seen = new Set();
  return Object.values(set).filter((p) => !seen.has(p.file) && seen.add(p.file)).map((p) => ({ ...p, changes: CHANGES }));
}
