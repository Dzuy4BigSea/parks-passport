// "Want to go" hearts: toggles in place instead of reloading. Without JS (or if the request
// fails) the form posts normally and the server redirects back.
for (const form of document.querySelectorAll('form.save-form')) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    // Busy flag instead of disabling the button: disabling a focused button drops keyboard focus.
    if (form.dataset.busy) return;
    form.dataset.busy = '1';
    const button = form.querySelector('button');
    const state = form.querySelector('input[name="saved"]');
    button.setAttribute('aria-disabled', 'true');
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(form)),
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(String(res.status));
      const { saved } = await res.json();
      button.setAttribute('aria-pressed', String(saved));
      state.value = saved ? '0' : '1';
      button.removeAttribute('aria-disabled');
      delete form.dataset.busy;
    } catch {
      form.submit(); // let the server handle it (and show any error page)
    }
  });
}
