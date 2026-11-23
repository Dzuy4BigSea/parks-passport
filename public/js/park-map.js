// Small map with the park's pin. Leaflet is loaded only on pages that need it.

const el = document.getElementById('park-map');

async function init() {
  const L = await import('/vendor/leaflet/leaflet-src.esm.js');
  const lat = Number(el.dataset.lat);
  const lng = Number(el.dataset.lng);
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', `Map showing ${el.dataset.name}`);
  const map = L.map(el, { scrollWheelZoom: false }).setView([lat, lng], 16);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  L.circleMarker([lat, lng], { radius: 10, color: '#1d4a35', weight: 3, fillColor: '#f2c14e', fillOpacity: 1 })
    .addTo(map)
    .bindTooltip(el.dataset.name);
}

if (el) init().catch(() => { el.textContent = 'Map unavailable.'; });
