// Passport map: every park, stamped (✓, filled) vs not yet (○, outline). Each marker has a
// text symbol and a name label, so it doesn't rely on color alone.
const el = document.getElementById('passport-map');

async function init() {
  const L = await import('/vendor/leaflet/leaflet-src.esm.js');
  const parks = JSON.parse(el.dataset.parks || '[]');
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Map of stamped and unstamped parks');
  const map = L.map(el, { scrollWheelZoom: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  const markers = parks.map((p) => {
    const label = `${p.name}: ${p.stamped ? 'stamped' : 'not yet'}`;
    const icon = L.divIcon({
      className: `pin ${p.stamped ? 'pin-stamped' : 'pin-unstamped'}`,
      html: p.stamped ? '✓' : '○',
      iconSize: [26, 26],
    });
    // keyboard: false: every park is already a link in the stamp grid, so markers aren't extra Tab stops.
    // Tooltip gets a text node: Leaflet would treat a string as HTML.
    return L.marker([p.lat, p.lng], { icon, title: label, alt: label, keyboard: false })
      .bindTooltip(document.createTextNode(label))
      .on('click', () => { window.location.href = `/parks/${p.slug}`; })
      .addTo(map);
  });
  if (markers.length) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.05));
  else map.setView([27.7731, -82.64], 12);
}

if (el) init().catch(() => { el.textContent = 'Map unavailable.'; });
