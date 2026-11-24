// Home "Use my location": reloads the page with your position so "Closest new parks" is measured
// from where you are. The position is used for that page only and never stored.
const button = document.getElementById('home-locate');
const status = document.getElementById('home-locate-status');
if (button && !('geolocation' in navigator)) button.hidden = true;
button?.addEventListener('click', () => {
  status.textContent = 'Finding parks near you…';
  button.disabled = true;
  navigator.geolocation.getCurrentPosition((pos) => {
    const url = new URL(window.location.href);
    url.searchParams.set('lat', pos.coords.latitude.toFixed(5));
    url.searchParams.set('lng', pos.coords.longitude.toFixed(5));
    url.hash = 'near-h';
    window.location.assign(url);
  }, () => {
    button.disabled = false;
    status.textContent = "We couldn't get your location. Allow location for this site and try again.";
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
});
