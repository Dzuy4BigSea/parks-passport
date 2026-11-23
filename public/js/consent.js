// Consent banner with JS: saves the choice without a page reload, updates Google Consent Mode
// right away, and records consent_update. Without JS the same forms post and redirect back.
const banner = document.getElementById('consent-banner');

if (banner) {
  for (const form of banner.querySelectorAll('form')) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const accept = form.elements.choice.value === 'accept';
      try {
        const res = await fetch(form.action, {
          method: 'POST', body: new URLSearchParams(new FormData(form)),
          headers: { Accept: 'application/json' }, credentials: 'same-origin',
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        form.submit(); // fall back to the normal post
        return;
      }
      if (typeof window.gtag === 'function' && accept) window.gtag('consent', 'update', { analytics_storage: 'granted' });
      window.ppTrack?.('consent_update', { analytics: accept, ads: false });
      banner.remove();
      document.getElementById('main')?.focus();
    });
  }
}
