// Nearest first (SPEC Flow 2): on the plain park list, parks are sorted by distance from where
// you are. If the site may already use your location, that happens on load; if you've never been
// asked, the browser asks once (remembered on this device); if you say no, the list stays A–Z and
// we don't ask again. "Sort by nearest" still works any time. Without JS the list is A–Z.
const button = document.getElementById('near-me');
const status = document.getElementById('near-me-status');
const form = button?.closest('form');
const ASKED = 'pp-near-asked';

const remember = () => { try { localStorage.setItem(ASKED, '1'); } catch { /* private mode: ask again next time */ } };
const asked = () => { try { return localStorage.getItem(ASKED) === '1'; } catch { return false; } };

function sortByNearest({ auto = false } = {}) {
  status.textContent = auto ? 'Finding the park closest to you…' : 'Finding your location…';
  button.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      remember();
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
      remember();
      button.disabled = false;
      // Saying no on load is fine: the full list, quietly. A tap on the button gets the explanation.
      status.textContent = auto ? '' : "We couldn't get your location, so parks are listed A–Z. "
        + 'To sort by distance, allow location access for this site and try again.';
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
  );
}

// The button is laid out from the first paint when JS runs (.js-only), so it never shifts the page.
if (button && !('geolocation' in navigator)) button.hidden = true;
if (button && form && 'geolocation' in navigator) {
  button.hidden = false;
  button.addEventListener('click', () => sortByNearest());

  // Only the plain list sorts itself: not a search, a filter, or a list that's already sorted.
  const params = new URLSearchParams(location.search);
  // sort=az: "Clear" after a distance sort means A–Z, so the list doesn't re-sort itself.
  const plain = !['lat', 'lng', 'q', 'cat', 'unvisited', 'saved', 'pals', 'sort'].some((k) => params.has(k));
  if (plain) {
    const ask = () => sortByNearest({ auto: true });
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((p) => {
        if (p.state === 'granted') ask(); // allowed before: no prompt
        else if (p.state === 'prompt' && !asked()) ask(); // never asked: ask once
      }).catch(() => { if (!asked()) ask(); });
    } else if (!asked()) {
      ask();
    }
  }
}
