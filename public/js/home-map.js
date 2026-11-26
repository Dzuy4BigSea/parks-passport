// "Your St. Pete" on the signed-in home: swaps the dot drawing for a real street map with every
// park on it. Leaflet and its tiles load only when the card nears the screen, so the page stays fast.
// If anything fails, the dot drawing (a link to the parks list) simply stays.
const box = document.querySelector('.home-map');

async function init() {
  const parks = JSON.parse(box.dataset.parks || '[]');
  if (!parks.length) return;
  if (!document.querySelector('link[href="/vendor/leaflet/leaflet.css"]')) {
    const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/vendor/leaflet/leaflet.css' });
    document.head.append(css);
    await new Promise((done) => { css.onload = done; css.onerror = done; });
  }
  const L = await import('/vendor/leaflet/leaflet-src.esm.js');
  const el = document.createElement('div');
  el.className = 'park-map home-street-map';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', box.querySelector('.constellation .visually-hidden')?.textContent || 'Map of parks');
  const fallback = box.querySelector('.constellation');
  box.append(el);
  const map = L.map(el, { scrollWheelZoom: false });
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  // Stamped on top, then the closest new ones, then the rest.
  const order = (p) => (p.stamped ? 2 : p.next ? 1 : 0);
  const markers = [...parks].sort((a, b) => order(a) - order(b)).map((p) => {
    const state = p.stamped ? 'stamped' : p.next ? 'next' : 'todo';
    const label = `${p.name}: ${p.stamped ? 'stamped' : p.next ? 'closest new park' : 'not yet'}`;
    const size = state === 'todo' ? 12 : 20;
    const icon = L.divIcon({ className: `hpin hpin-${state}`, html: p.stamped ? '✓' : '', iconSize: [size, size] });
    // keyboard: false: the parks list is a Tab away; markers aren't extra Tab stops.
    return L.marker([p.lat, p.lng], { icon, title: label, alt: label, keyboard: false, zIndexOffset: order(p) * 500 })
      .bindTooltip(document.createTextNode(label))
      .on('click', () => { window.location.href = p.url; })
      .addTo(map);
  });
  map.fitBounds(L.featureGroup(markers).getBounds().pad(0.04));
  // Keep the drawing until the first tiles arrive, so the card never shows an empty box.
  // It sits invisibly over the drawing at the same size, so the swap doesn't move the page.
  tiles.once('load', () => {
    el.style.height = `${el.offsetHeight}px`;
    fallback?.remove();
    box.classList.add('is-live');
  });
}

if (box) {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    init().catch(() => box.querySelector('.home-street-map')?.remove());
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
    }, { rootMargin: '200px' });
    io.observe(box);
  } else start();
}
