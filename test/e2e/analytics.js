// A stand-in for gtm.js + GA4: it reads Google Consent Mode commands from dataLayer and sets a
// _ga cookie only once analytics_storage is granted, like the real thing.
export const FAKE_GTM = `
(function () {
  var granted = false;
  function apply(args) {
    if (args && args[0] === 'consent' && args[2] && args[2].analytics_storage) granted = args[2].analytics_storage === 'granted';
    if (granted && document.cookie.indexOf('_ga=') === -1) document.cookie = '_ga=GA1.1.test; path=/';
  }
  var dl = window.dataLayer = window.dataLayer || [];
  for (var i = 0; i < dl.length; i++) apply(dl[i]);
  var push = dl.push.bind(dl);
  dl.push = function (x) { apply(x); return push(x); };
  window.__fakeGtmLoaded = true;
})();`;

export async function stubGtm(page) {
  await page.route('https://gtm.test.invalid/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_GTM }));
}
