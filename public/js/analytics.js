// Sends the page's analytics events (window.__ppEvents, already pushed to dataLayer inline) to
// Umami once its script has loaded, and exposes ppTrack() for events raised in the browser.
const forUmami = (e) => {
  const { event, ...params } = e;
  return [event, params];
};

function whenUmami(fn, tries = 50) {
  if (window.umami?.track) fn(window.umami);
  else if (tries > 0) setTimeout(() => whenUmami(fn, tries - 1), 100);
}

const pending = Array.isArray(window.__ppEvents) ? window.__ppEvents : [];
if (pending.length) whenUmami((u) => pending.forEach((e) => u.track(...forUmami(e))));

window.ppTrack = (event, params = {}) => {
  const e = { event, ...params };
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(e);
  whenUmami((u) => u.track(...forUmami(e)));
};
