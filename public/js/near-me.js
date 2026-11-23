// "Sort by nearest": asks for location, then resubmits the search with lat/lng.
// Without JS the button stays hidden and the list is alphabetical.
const button = document.getElementById('near-me');
const status = document.getElementById('near-me-status');
const form = button?.closest('form');

if (button && form && 'geolocation' in navigator) {
  button.hidden = false;
  button.addEventListener('click', () => {
    status.textContent = 'Finding your location…';
    button.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        for (const name of ['lat', 'lng']) form.querySelector(`input[type=hidden][name=${name}]`)?.remove();
        const add = (name, value) => {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = name;
          input.value = value.toFixed(5);
          form.append(input);
        };
        add('lat', pos.coords.latitude);
        add('lng', pos.coords.longitude);
        form.submit();
      },
      () => {
        button.disabled = false;
        status.textContent = "We couldn't get your location, so parks are listed A–Z. "
          + 'To sort by distance, allow location access for this site and try again.';
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  });
}
