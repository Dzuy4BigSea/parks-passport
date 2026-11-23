// One-tap stamp: ask for the position right away (the member just tapped Stamp), then submit.
const form = document.getElementById('stamp-finder');
const status = document.getElementById('finder-status');

function locate() {
  if (!('geolocation' in navigator)) {
    status.textContent = "This browser can't share your location. Pick your park from the list instead.";
    form.hidden = true;
    return;
  }
  status.textContent = 'Finding your park…';
  const button = form.querySelector('button');
  button.disabled = true;
  navigator.geolocation.getCurrentPosition((pos) => {
    form.lat.value = pos.coords.latitude;
    form.lng.value = pos.coords.longitude;
    form.accuracy.value = Math.round(pos.coords.accuracy || 0);
    status.textContent = 'Got it. Stamping…';
    form.submit();
  }, () => {
    button.disabled = false;
    form.hidden = false;
    status.textContent = "We couldn't get your location. Allow location and try again, or pick your park from the list.";
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
}

if (form) {
  form.hidden = false;
  form.addEventListener('submit', (e) => {
    if (!form.lat.value) { e.preventDefault(); locate(); }
  });
  if ('auto' in form.dataset) locate();
}
