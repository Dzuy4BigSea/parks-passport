// Nonprofit ads and activity tips (SPEC Flow 25): a 300×250 card, a slider when there are several
// images, and a tip's pop-up content. public/js/ads.js runs the slider and opens tips.
import { html } from './html.js';

// Where a click came from, for the count: a park id, or "passport".
const goHref = (ad, where) => `/go/ad/${ad.id}?from=${where}`;

function slide(s, href) {
  const img = html`<picture>
    ${s.animated ? html`<source srcset="/ad-art/${s.image_key}.still.webp" media="(prefers-reduced-motion: reduce)">` : ''}
    <img src="/ad-art/${s.image_key}.webp" alt="${s.alt}" width="300" height="250" loading="lazy" decoding="async"${s.animated ? html` data-still="/ad-art/${s.image_key}.still.webp"` : ''}>
  </picture>`;
  return href ? html`<a href="${href}" rel="noopener sponsored">${img}</a>` : img;
}

/**
 * The images: one, or a slider (Previous, Pause and Next appear with JS; without it, swipe). Pause
 * also stills animated images, so a lone animated image gets a Pause button too.
 */
export function adSlides(ad, href = null) {
  const many = ad.slides.length > 1;
  const moving = many || ad.slides.some((s) => s.animated);
  return html`<div class="ad-slider"${moving ? html` data-slider` : ''}>
  <ul class="ad-slides"${many ? html` aria-label="${ad.slides.length} images"` : ''}>${ad.slides.map((s, i) => html`<li${many ? html` aria-label="${i + 1} of ${ad.slides.length}"` : ''}>${slide(s, href)}</li>`)}</ul>
  ${moving ? html`<div class="ad-controls" hidden>
    ${many ? html`<button type="button" class="ad-prev" aria-label="Previous image">‹</button>` : ''}
    <button type="button" class="ad-pause" aria-label="Pause" aria-pressed="false">❚❚</button>
    ${many ? html`<button type="button" class="ad-next" aria-label="Next image">›</button>` : ''}
  </div>` : ''}
</div>`;
}

/** The ad at the bottom of a park page (where = park id) or the passport (where = "passport"). */
export function adCard(ad, where) {
  return html`<aside class="np-ad" aria-label="Local nonprofit: ${ad.nonprofit_name}">
  <p class="np-ad-label">Local nonprofit · ${ad.nonprofit_name}</p>
  ${adSlides(ad, goHref(ad, where))}
</aside>`;
}

/** "Tips from …" on an activity: a pop-up with JS, a page without. */
export const tipLink = (ad, park) => html`<a class="act-tip" href="/tips/${ad.id}?park=${park.id}" data-tip>
  <span aria-hidden="true">💡</span> Tips from ${ad.nonprofit_name}</a>`;

/** A tip: its images, heading, text (paragraphs kept) and a link to the nonprofit. */
export function tipContent(ad, park, { page = false } = {}) {
  const paras = ad.body.split(/\n{2,}/).map((p) => p.split('\n'));
  return html`<div class="tip-card">
  <p class="np-ad-label">Tips from ${ad.nonprofit_name}</p>
  ${adSlides(ad)}
  ${page ? html`<h1 id="tip-h">${ad.title}</h1>` : html`<h2 id="tip-h">${ad.title}</h2>`}
  ${paras.map((lines) => html`<p>${lines.map((l, i) => html`${i ? html`<br>` : ''}${l}`)}</p>`)}
  <p><a class="btn btn-primary" href="${goHref(ad, park.id)}" rel="noopener sponsored">Visit ${ad.nonprofit_name}</a></p>
</div>`;
}
