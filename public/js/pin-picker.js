// Admin park form: click the map or drag the pin to set latitude/longitude; typing in the
// fields moves the pin. Without JS the fields still work on their own.
const el = document.getElementById('pin-map');
const latInput = document.getElementById('lat');
const lngInput = document.getElementById('lng');
// The city the park is in (data-center), else St. Pete.
const CENTER = (el.dataset.center || '27.7731,-82.64').split(',').map(Number);

async function init() {
  const L = await import('/vendor/leaflet/leaflet-src.esm.js');
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Map for placing the park pin');
  const start = latInput.value && lngInput.value ? [Number(latInput.value), Number(lngInput.value)] : null;
  const map = L.map(el).setView(start || CENTER, start ? 17 : 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  let marker = null;
  const place = (latlng, { pan = false } = {}) => {
    if (!marker) {
      marker = L.marker(latlng, { draggable: true, keyboard: false, title: 'Park pin' }).addTo(map);
      marker.on('dragend', () => write(marker.getLatLng()));
    } else marker.setLatLng(latlng);
    if (pan) map.panTo(latlng);
  };
  const write = ({ lat, lng }) => {
    latInput.value = lat.toFixed(6);
    lngInput.value = lng.toFixed(6);
  };
  if (start) place(start);
  map.on('click', (e) => { place(e.latlng); write(e.latlng); });
  for (const input of [latInput, lngInput]) {
    input.addEventListener('change', () => {
      const lat = Number(latInput.value);
      const lng = Number(lngInput.value);
      if (latInput.value && lngInput.value && Number.isFinite(lat) && Number.isFinite(lng)) place([lat, lng], { pan: true });
    });
  }
}

if (el && latInput && lngInput) init().catch(() => { el.textContent = 'Map unavailable. Type the coordinates instead.'; });
