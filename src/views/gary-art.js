// Gary in an outfit (SPEC Flow 22), as inline SVG. Built from public/brand/gary.svg: the outfit's
// shirt colors replace his camp shirt's, `body` is drawn over his body (scarves, bandanas, pins),
// `face` over his face (sunglasses, cold cheeks), and `hat` replaces his rope hat. Outfit art comes
// from seed/gary-outfits.json (ours, never member input).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { raw } from './html.js';

const SOURCE = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'brand', 'gary.svg'), 'utf8');
const cut = (from, to) => {
  const a = SOURCE.indexOf(from);
  const b = SOURCE.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`gary.svg changed: can't find "${from}"`);
  return SOURCE.slice(a, b);
};
// His animations, scoped to his own SVG (inline SVG styles apply to the whole page).
const STYLE = (cut('<style>', '</style>') + '</style>')
  .replace(/^(\s*)\.(gary|eyes|brows|forearm|hat) \{/gm, '$1.gary-svg .$2 {')
  .replace('* { animation: none !important; }', '.gary-svg * { animation: none !important; }');
const BODY = cut('<!-- Body:', '<!-- Neck and head -->');
const HEAD = cut('<!-- Neck and head -->', '<!-- Rope hat');
const HAT = SOURCE.slice(SOURCE.indexOf('<g class="hat">'), SOURCE.lastIndexOf('</g>', SOURCE.lastIndexOf('</g>') - 1)).trim();
const SHIRT = { main: '#00b3a4', dark: '#00756c', sleeve: '#00a396' };
const COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Gary wearing `art` ({} = Classic). `id` keeps the SVG's internal ids unique on the page; `label`
 * names the picture for screen readers ('' = decorative).
 */
export function garySvg(art = {}, { id = 'g', label = '', className = '', width = 280, height = 280, still = false } = {}) {
  let body = BODY;
  for (const [key, from] of Object.entries(SHIRT)) {
    const to = art.shirt?.[key];
    if (COLOR.test(to || '')) body = body.split(from).join(to);
  }
  const mouth = `gary-mouth-${id}`;
  const head = HEAD.replace('url(#gary-mouth)', `url(#${mouth})`);
  const hat = art.hat ? `<g class="hat">${art.hat}</g>` : HAT;
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true" focusable="false"';
  return raw(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 0 280 280" width="${width}" height="${height}" class="gary-svg${className ? ` ${className}` : ''}${still ? ' is-still' : ''}" ${a11y}>
${STYLE}<defs><clipPath id="${mouth}"><path d="M103 141 Q120 163 137 141 Q120 147 103 141 Z"/></clipPath></defs>
<g class="gary">${body}${art.body || ''}${head}${art.face || ''}${hat}</g></svg>`);
}
