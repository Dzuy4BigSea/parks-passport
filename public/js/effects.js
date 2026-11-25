// Effects for messages from the team (SPEC Flow 20): confetti, rising hearts, falling leaves,
// snow, a gift that pops open, or calm. Decorative only (aria-hidden), silent, and skipped with
// reduced motion or when this device turned celebrations off.
import { celebrationsOn, reducedMotion, burst, buzz } from './fx.js';

const PARTICLES = {
  thanks: { glyphs: ['💛', '💖', '💚', '🧡'], dir: 'up', count: 18 },
  autumn: { glyphs: ['🍂', '🍁', '🍃', '🍂'], dir: 'down', count: 22 },
  winter: { glyphs: ['❄️', '❅', '❆', '❄️'], dir: 'down', count: 30 },
};

/** Emoji that drift across the screen (up or down), then go away. */
function drift({ glyphs, dir, count }) {
  const layer = document.createElement('div');
  layer.className = `fx-drift is-${dir}`;
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.textContent = glyphs[i % glyphs.length];
    p.style.setProperty('--x', `${Math.round(Math.random() * 100)}vw`);
    p.style.setProperty('--sway', `${Math.round(Math.random() * 120 - 60)}px`);
    p.style.setProperty('--delay', `${(Math.random() * 2.2).toFixed(2)}s`);
    p.style.setProperty('--dur', `${(3.2 + Math.random() * 2.4).toFixed(2)}s`);
    p.style.setProperty('--size', `${(1 + Math.random() * 1.1).toFixed(2)}rem`);
    p.style.setProperty('--spin', `${Math.round(Math.random() * 540 - 270)}deg`);
    layer.append(p);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 8000);
}

const center = (node) => {
  const r = node.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 3];
};

/** Plays an effect around `stage` (the message card). Returns nothing; safe to call any time. */
export function playEffect(effect, stage) {
  if (!celebrationsOn() || reducedMotion()) return;
  if (effect === 'celebrate') {
    buzz([20, 50, 35]);
    const [x, y] = center(stage);
    burst(x, y, { count: 48 });
    setTimeout(() => burst(x - 90, y + 40, { count: 28, spread: 160 }), 350);
    setTimeout(() => burst(x + 90, y + 40, { count: 28, spread: 160 }), 600);
  } else if (effect === 'gift') {
    stage.classList.add('is-gift-shaking');
    setTimeout(() => {
      stage.classList.remove('is-gift-shaking');
      stage.classList.add('is-gift-open');
      buzz([30, 60, 30, 60, 60]);
      const box = stage.querySelector('.message-gift') || stage;
      const [x, y] = center(box);
      burst(x, y, { count: 56 });
    }, 1100);
  } else if (PARTICLES[effect]) {
    drift(PARTICLES[effect]);
  }
  // notice: calm on purpose
}
