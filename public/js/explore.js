// Explore page enhancements: the parks map beside the list (phones: a Map/List toggle with a
// swipeable card strip), list <-> map highlighting, and filters that apply as soon as they change.
// Without JS the page is a plain list with a GET search form.

const root = document.querySelector('.explore');
const mapEl = document.getElementById('explore-map');
const list = document.querySelector('.explore-list .park-list');
const form = document.querySelector('.explore-bar');
const toggle = document.getElementById('map-toggle');
const wide = window.matchMedia('(min-width: 1024px)');

// Filters apply shortly after a change, so several can be ticked in a row (the Search button stays
// for typing and for no-JS; submitting by hand cancels the pending one).
let pending = null;
form?.addEventListener('change', (e) => {
  if (!e.target.matches('input[type=checkbox]')) return;
  clearTimeout(pending);
  pending = setTimeout(() => (form.requestSubmit ? form.requestSubmit() : form.submit()), 700);
});
form?.addEventListener('submit', () => clearTimeout(pending));

const parks = mapEl ? JSON.parse(mapEl.dataset.parks || '[]') : [];
const near = mapEl?.dataset.near ? JSON.parse(mapEl.dataset.near) : null;
const cards = new Map([...(list?.querySelectorAll('.park-card') || [])].map((c) => [c.dataset.slug, c]));
let map = null;
let L = null;
const markers = new Map();
let active = null;

function setActive(slug, { from } = {}) {
  if (active === slug) return;
  if (active) { markers.get(active)?.getElement()?.classList.remove('is-active'); cards.get(active)?.classList.remove('is-active'); }
  active = slug;
  const m = markers.get(slug);
  const card = cards.get(slug);
  m?.getElement()?.classList.add('is-active');
  m?.setZIndexOffset(1000);
  card?.classList.add('is-active');
  if (from === 'pin' && card) card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
  if (from === 'strip' && m && map) map.panTo(m.getLatLng(), { animate: true });
}

async function initMap() {
  if (map || !mapEl || !parks.length) return;
  L = await import('/vendor/leaflet/leaflet-src.esm.js');
  mapEl.setAttribute('role', 'region');
  mapEl.setAttribute('aria-label', 'Map of the parks in this list');
  map = L.map(mapEl, { scrollWheelZoom: wide.matches, zoomControl: true, attributionControl: true });
  // Tiles drawn on <canvas> so a map tile is never the page's Largest Contentful Paint (see park-map.js).
  const CanvasTiles = L.GridLayer.extend({
    createTile(coords, done) {
      const size = this.getTileSize();
      const tile = document.createElement('canvas');
      tile.width = size.x;
      tile.height = size.y;
      const img = new Image();
      img.onload = () => { tile.getContext('2d').drawImage(img, 0, 0, size.x, size.y); done(null, tile); };
      img.onerror = (err) => done(err, tile);
      img.src = `https://tile.openstreetmap.org/${coords.z}/${coords.x}/${coords.y}.png`;
      return tile;
    },
  });
  new CanvasTiles({ maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);

  for (const p of parks) {
    const icon = L.divIcon({
      className: `pin xpin ${p.stamped ? 'pin-stamped' : 'pin-unstamped'}`,
      // Small dots for parks still to find, checked stamps for the ones you have. Every pin keeps a
      // 24 px target (WCAG 2.2); the dot is drawn inside it.
      html: p.stamped ? '✓' : '<span class="xpin-dot"></span>', iconSize: [24, 24], iconAnchor: [12, 12],
    });
    // Pins are a pointer shortcut: every park is also a card link in the list beside the map (the
    // equivalent control WCAG 2.5.8 allows), so they stay out of the tab order where 102 pins would
    // be a keyboard trap and too crowded at city zoom.
    const m = L.marker([p.lat, p.lng], { icon, title: `${p.name}: ${p.stamped ? 'stamped' : 'not yet'}`, alt: p.name, riseOnHover: true, keyboard: false }).addTo(map);
    // Popup built from text nodes only: park names are never treated as HTML.
    const box = document.createElement('div');
    box.className = 'map-pop';
    if (p.area) { const a = document.createElement('p'); a.className = 'map-pop-area'; a.textContent = p.area; box.append(a); }
    const link = document.createElement('a');
    link.href = `/parks/${p.slug}`;
    link.textContent = p.name;
    box.append(link);
    const meta = document.createElement('p');
    meta.textContent = [p.stamped ? '✓ Stamped' : 'Not stamped yet', p.travel].filter(Boolean).join(' · ');
    box.append(meta);
    m.bindPopup(box, { closeButton: false, offset: [0, -6] });
    m.on('click', () => setActive(p.slug, { from: 'pin' }));
    markers.set(p.slug, m);
  }

  if (near) {
    L.circleMarker([near.lat, near.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#5b4bd6', fillOpacity: 1, className: 'you-are-here' })
      .addTo(map).bindTooltip('You are here');
    const closest = parks.slice(0, 6).map((p) => [p.lat, p.lng]);
    map.fitBounds(L.latLngBounds([[near.lat, near.lng], ...closest]), { padding: [40, 40], maxZoom: 15 });
  } else {
    map.fitBounds(L.latLngBounds(parks.map((p) => [p.lat, p.lng])), { padding: [24, 24], maxZoom: 15 });
  }
}

// Card hover/focus lights up its pin (desktop list beside the map).
for (const [slug, card] of cards) {
  card.addEventListener('mouseenter', () => map && setActive(slug));
  card.addEventListener('focusin', () => map && setActive(slug));
}

// Phones: Map/List toggle. In map view the list becomes a swipeable strip over the map, and the
// card centred in the strip lights up its pin.
let stripObserver = null;
function setMapView(on) {
  root.classList.toggle('show-map', on);
  toggle.setAttribute('aria-pressed', String(on));
  toggle.querySelector('span').textContent = on ? 'List' : 'Map';
  if (on) {
    initMap().then(() => {
      map?.invalidateSize();
      if (!stripObserver && 'IntersectionObserver' in window) {
        stripObserver = new IntersectionObserver((entries) => {
          const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
          if (hit && root.classList.contains('show-map')) setActive(hit.target.dataset.slug, { from: 'strip' });
        }, { root: list, threshold: [0.6] });
        for (const card of cards.values()) stripObserver.observe(card);
      }
    }).catch(() => { mapEl.textContent = 'Map unavailable.'; });
  }
}
if (toggle && mapEl && parks.length) {
  toggle.hidden = false;
  toggle.addEventListener('click', () => setMapView(!root.classList.contains('show-map')));
}

// Desktop: start the map once the page has loaded, so it never competes with the list.
const whenLoaded = (fn) => (document.readyState === 'complete' ? fn() : window.addEventListener('load', fn, { once: true }));
whenLoaded(() => {
  const go = () => { if (wide.matches) initMap().catch(() => { mapEl.textContent = 'Map unavailable.'; }); };
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1500 }); else setTimeout(go, 200);
});
wide.addEventListener?.('change', () => { if (wide.matches) { root.classList.remove('show-map'); initMap().then(() => map?.invalidateSize()); } });
