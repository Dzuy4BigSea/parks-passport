import { raw } from './html.js';

// Inline UI icons (24×24, stroked in currentColor). Decorative: the label is always next to them.
const wrap = (body) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`);

export const ICONS = {
  stamp: wrap('<path d="M9 3h6l-1 6h4a2 2 0 0 1 2 2v3H4v-3a2 2 0 0 1 2-2h4z"/><path d="M5 18h14"/><path d="M7 21h10"/>'),
  parks: wrap('<path d="M12 3 6 13h4l-3 5h10l-3-5h4z"/><path d="M12 18v3"/>'),
  passport: wrap('<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M9 16h6"/>'),
  pals: wrap('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.8.4 5 2.8 5 5.8"/>'),
  account: wrap('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>'),
  flame: wrap('<path d="M12 22c4 0 7-2.8 7-6.8 0-3.6-2.5-6-4-8.2-.4 2-1.5 3.2-3 3.7.6-3-1-6.4-4-8.7.3 3.4-3 5.9-3 10.7C5 19 8 22 12 22z"/>'),
  pin: wrap('<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
  medal: wrap('<circle cx="12" cy="15" r="6"/><path d="M8.5 9.5 6 3h4l2 4 2-4h4l-2.5 6.5"/><path d="m12 12.5.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z"/>'),
  sparkle: wrap('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>'),
  search: wrap('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  bell: wrap('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  arrow: wrap('<path d="M5 12h14M13 6l6 6-6 6"/>'),
};

// The Parks Passport mark: an aqua passport stamp with a pink sun, independent of any city.
export const BRAND_MARK = raw(`<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
<rect x="2" y="2" width="36" height="36" rx="11" fill="#00756C"/>
<circle cx="20" cy="20" r="11.5" fill="none" stroke="#F6F1E7" stroke-width="2.2" stroke-dasharray="3 2.4"/>
<circle cx="20" cy="17.5" r="4.6" fill="#FF4D88"/>
<path d="M11.5 25.5c2.8-1.6 5.6-1.6 8.5 0s5.7 1.6 8.5 0" fill="none" stroke="#FFC83D" stroke-width="2.2" stroke-linecap="round"/>
</svg>`);
