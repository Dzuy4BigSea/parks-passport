// Small map with the park's pin. Leaflet is loaded only on pages that need it.

const el = document.getElementById('park-map');

async function init() {
  const L = await import('/vendor/leaflet/leaflet-src.esm.js');
  const lat = Number(el.dataset.lat);
  const lng = Number(el.dataset.lng);
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', `Map showing ${el.dataset.name}`);
  const map = L.map(el, { scrollWheelZoom: false }).setView([lat, lng], 16);
  // Tiles are drawn on <canvas> rather than <img>: a background map tile isn't the page's main
  // content, and as an <img> it became the Largest Contentful Paint on phones (canvas isn't an
  // LCP candidate, as with WebGL maps). They look the same.
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
  new CanvasTiles({
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  L.circleMarker([lat, lng], { radius: 10, color: '#0e2a33', weight: 3, fillColor: '#ff4d88', fillOpacity: 1 })
    .addTo(map)
    .bindTooltip(document.createTextNode(el.dataset.name)); // text, never HTML
}

// Start the map only when it scrolls into view: map tiles are large third-party images, and
// loading them up front made one the page's Largest Contentful Paint on phones.
const start = () => init().catch(() => { el.textContent = 'Map unavailable.'; });
// Wait for the page to finish loading first, so Leaflet never competes with the page's own content.
const whenLoaded = (fn) => (document.readyState === 'complete' ? fn() : window.addEventListener('load', fn, { once: true }));
if (el) whenLoaded(() => {
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
    }, { rootMargin: '200px' });
    io.observe(el);
  } else start();
});

// "Open in Maps": the phone's own map app. Android hands a geo: link to whichever map app is the
// default; iPhones and iPads open Apple Maps. Elsewhere (and without JS) it stays OpenStreetMap.
export function mapsLink({ lat, lng, name }, ua = navigator.userAgent, touch = navigator.maxTouchPoints) {
  if (/Android/i.test(ua)) return `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(name)})`;
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && touch > 1)) { // iPadOS says "Macintosh"
    return `https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(name)}`;
  }
  return null;
}
const open = document.querySelector('a.open-maps');
const pin = document.getElementById('park-map');
if (open && pin) {
  const href = mapsLink({ lat: pin.dataset.lat, lng: pin.dataset.lng, name: pin.dataset.name });
  if (href) open.href = href;
}
