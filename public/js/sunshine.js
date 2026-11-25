// Drops of Sunshine (SPEC Flow 17): keeps "To:" in step with the picker, and picks the closest park
// (within 2 km) from the phone's location. The position stays in the browser: only the chosen
// park's slug is sent with the note. It asks for location only when the member taps the button,
// unless they already allowed it.
const form = document.querySelector('.sunshine-form');
if (form) {
  const select = form.querySelector('#sunshine-park');
  const to = form.querySelector('[data-sunshine-to]');
  const locate = form.querySelector('[data-sunshine-locate]');
  const status = form.querySelector('[data-sunshine-status]');
  let pins = [];
  try { pins = JSON.parse(form.dataset.pins || '[]'); } catch { pins = []; }
  const sync = () => {
    const opt = select.selectedOptions[0];
    to.textContent = opt.value === 'department' ? `the parks department` : opt.textContent;
  };
  // A park the member picked (or posted, on an error page) is never replaced by the GPS guess.
  let touched = form.hasAttribute('data-chosen');
  select.addEventListener('change', () => { touched = true; sync(); });

  const MAX_M = 2000;
  const meters = (a, b) => {
    const rad = Math.PI / 180;
    const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
    const y = (b.lat - a.lat) * rad;
    return Math.sqrt(x * x + y * y) * 6371000;
  };
  const useNearest = (pos, { quiet = false } = {}) => {
    if (quiet && touched) return;
    const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    let best = null;
    for (const p of pins) {
      const d = meters(here, p);
      if (!best || d < best.d) best = { slug: p.slug, d };
    }
    if (best && best.d <= MAX_M) {
      select.value = best.slug;
      sync();
      if (status) status.textContent = `Set to ${select.selectedOptions[0].textContent}, the closest park.`;
    } else if (!quiet && status) {
      status.textContent = 'No park within 2 km. Pick one from the list, or send it to the whole department.';
    }
  };
  const ask = (opts) => navigator.geolocation.getCurrentPosition((pos) => useNearest(pos, opts), () => {
    if (!opts?.quiet && status) status.textContent = "Couldn't get your location. Pick a park from the list.";
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });

  if (pins.length && 'geolocation' in navigator && select) {
    if (locate) {
      locate.hidden = false;
      locate.addEventListener('click', () => { touched = true; ask(); });
    }
    // Already allowed: choose the closest park right away, without asking.
    navigator.permissions?.query({ name: 'geolocation' }).then((p) => { if (p.state === 'granted') ask({ quiet: true }); }).catch(() => {});
  }
}
