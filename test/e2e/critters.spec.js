import { test, expect } from '@playwright/test';

// Critters (public/js/critters.js): rare, random visitors in a corner. They never start on their own
// under test automation, so these tests send them across by hand.
const KINDS = ['butterfly', 'bee', 'ladybug', 'caterpillar', 'bird', 'dragonfly', 'snail', 'firefly'];
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

test('each critter crosses its corner without getting in the way, then leaves', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  const seen = await page.evaluate(async ({ kinds, corners }) => {
    const { release } = await import('/js/critters.js');
    const out = [];
    for (const [i, kind] of kinds.entries()) {
      const corner = corners[i % 4];
      const el = release(kind, corner);
      const anims = el.getAnimations({ subtree: true }).filter((a) => a.effect.target === el);
      anims.forEach((a) => { a.pause(); a.currentTime = a.effect.getTiming().duration * 0.45; });
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      out.push({
        kind, corner, hidden: el.getAttribute('aria-hidden'), events: getComputedStyle(el).pointerEvents,
        // Mid-way it's on screen, in its own quarter of the screen.
        onScreen: cx > 0 && cx < innerWidth && cy > 0 && cy < innerHeight,
        rightHalf: cx > innerWidth / 2, bottomHalf: cy > innerHeight / 2,
      });
      anims.forEach((a) => a.finish());
    }
    return out;
  }, { kinds: KINDS, corners: CORNERS });
  for (const s of seen) {
    expect(s, s.kind).toMatchObject({ hidden: 'true', events: 'none', onScreen: true, rightHalf: s.corner.endsWith('right') });
    // Crawlers keep to the bottom edge; fliers use the corner they were given.
    const walker = ['ladybug', 'caterpillar', 'snail'].includes(s.kind);
    expect(s.bottomHalf, s.kind).toBe(walker || s.corner.startsWith('bottom'));
  }
  await expect(page.locator('.critter')).toHaveCount(0);
});
