// GPS check-in: gets the position once, fills the hidden fields and submits.
// If location is denied or unavailable, opens the honor-system form instead.
const form = document.getElementById('checkin-form');
const status = document.getElementById('checkin-status');
const honor = document.getElementById('honor');

if (form && 'geolocation' in navigator) {
  form.hidden = false;
  const button = form.querySelector('button');
  form.addEventListener('submit', (event) => {
    if (form.dataset.ready === '1') return; // position filled; let it submit
    event.preventDefault();
    button.disabled = true;
    status.textContent = 'Checking your location…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        form.elements.lat.value = pos.coords.latitude;
        form.elements.lng.value = pos.coords.longitude;
        form.elements.accuracy.value = Math.round(pos.coords.accuracy);
        form.dataset.ready = '1';
        status.textContent = 'Stamping…';
        form.submit();
      },
      () => {
        button.disabled = false;
        status.textContent = "We couldn't get your location. You can stamp on the honor system below.";
        if (honor) {
          honor.open = true;
          honor.querySelector('button')?.focus();
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}
