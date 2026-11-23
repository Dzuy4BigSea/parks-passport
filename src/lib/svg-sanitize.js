// Strict allowlist sanitizer for motif line icons (seeded, admin-edited or AI-generated).
// Nothing is passed through: the icon is parsed into known shape elements with validated
// attribute values and rebuilt. Anything unexpected (scripts, styles, links, hrefs, event
// handlers, entities, CDATA, text, foreign elements) makes the whole icon invalid (null).

const SHAPES = new Set(['path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect', 'g']);
const NUM = /^-?(\d+(\.\d+)?|\.\d+)$/;
const NUM_LIST = /^[-\d.,\s]+$/;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz\d\s.,eE+-]+$/;
const TRANSFORM = /^(\s*(translate|rotate|scale)\(\s*-?[\d.]+([\s,]+-?[\d.]+){0,2}\s*\)\s*)+$/;
const PAINT = /^(none|currentColor)$/;

const ATTRS = {
  d: PATH_DATA, points: NUM_LIST, transform: TRANSFORM,
  cx: NUM, cy: NUM, r: NUM, rx: NUM, ry: NUM, x: NUM, y: NUM, x1: NUM, y1: NUM, x2: NUM, y2: NUM,
  width: NUM, height: NUM, 'stroke-width': NUM, opacity: NUM, 'fill-opacity': NUM,
  'stroke-linecap': /^(round|butt|square)$/, 'stroke-linejoin': /^(round|miter|bevel)$/,
  'fill-rule': /^(nonzero|evenodd)$/, fill: PAINT, stroke: PAINT,
};

const MAX_LENGTH = 8000;
const MAX_ELEMENTS = 60;
const TAG = /<\s*(\/?)\s*([a-zA-Z][\w:-]*)((?:\s+[a-zA-Z][\w:-]*\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))*)\s*(\/?)\s*>/g;
const ATTR = /([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/g;

function parseAttrs(src) {
  const out = [];
  for (const m of src.matchAll(ATTR)) {
    const name = m[1];
    const value = (m[2] ?? m[3]).trim();
    out.push([name, value]);
  }
  return out;
}

/**
 * Returns a safe, normalized <svg> string (48×48 grid by default, stroked in currentColor), or
 * null if the input isn't a clean line icon.
 */
export function sanitizeSvg(input) {
  if (typeof input !== 'string') return null;
  const src = input.trim();
  if (!src || src.length > MAX_LENGTH) return null;
  let viewBox = '0 0 48 48';
  const parts = [];
  const stack = [];
  let last = 0;
  let count = 0;
  let sawRoot = false;
  let closedRoot = false;
  for (const m of src.matchAll(TAG)) {
    // Only whitespace may sit between tags (no text, comments, entities or CDATA).
    if (src.slice(last, m.index).trim()) return null;
    last = m.index + m[0].length;
    if (closedRoot) return null;
    const [, closing, rawName, attrSrc, selfClose] = m;
    const name = rawName.toLowerCase();
    if (name === 'svg') {
      if (closing) {
        if (!sawRoot || stack.length) return null;
        closedRoot = true;
        continue;
      }
      if (sawRoot || selfClose) return null;
      sawRoot = true;
      for (const [k, v] of parseAttrs(attrSrc)) {
        if (k === 'viewBox' && /^0 0 \d{1,3} \d{1,3}$/.test(v.replace(/\s+/g, ' '))) viewBox = v.replace(/\s+/g, ' ');
      }
      continue;
    }
    if (!sawRoot && parts.length === 0 && !stack.length) sawRoot = 'implicit';
    if (!SHAPES.has(name)) return null;
    if (closing) {
      if (stack.pop() !== name) return null;
      parts.push(`</${name}>`);
      continue;
    }
    if (++count > MAX_ELEMENTS) return null;
    const attrs = [];
    for (const [k, v] of parseAttrs(attrSrc)) {
      const rule = ATTRS[k];
      if (!rule || !rule.test(v)) return null;
      attrs.push(` ${k}="${v}"`);
    }
    if (selfClose || name !== 'g') {
      // Shapes never contain children; accept <path ...></path> by tracking it like a group.
      parts.push(`<${name}${attrs.join('')}${selfClose ? '/>' : '>'}`);
      if (!selfClose) stack.push(name);
    } else {
      parts.push(`<g${attrs.join('')}>`);
      stack.push('g');
    }
  }
  if (src.slice(last).trim()) return null;
  if (stack.length || count === 0) return null;
  if (sawRoot === true && !closedRoot) return null;
  return `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${parts.join('')}</svg>`;
}
