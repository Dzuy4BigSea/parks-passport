// Feedback button (SPEC Flow 16): opens the dialog instead of the /feedback page, sends with fetch,
// and says thank you in place. Without JS (or without <dialog>) the link and form still work.
const dialog = document.getElementById('feedback-dialog');
const opener = document.querySelector('[data-feedback-open]');
if (dialog && opener && typeof dialog.showModal === 'function') {
  const form = dialog.querySelector('.feedback-form');
  const thanks = dialog.querySelector('.feedback-thanks');
  const error = dialog.querySelector('.feedback-error');
  const reset = () => { form.hidden = false; thanks.hidden = true; error.hidden = true; };
  opener.addEventListener('click', (e) => {
    e.preventDefault();
    reset();
    dialog.showModal();
    dialog.querySelector('textarea').focus();
  });
  for (const b of dialog.querySelectorAll('[data-feedback-close]')) b.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // backdrop
  dialog.addEventListener('close', () => opener.focus());
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error.hidden = true;
    try {
      const res = await fetch(form.action, {
        method: 'POST', body: new URLSearchParams(new FormData(form)),
        headers: { Accept: 'application/json' }, credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'That didn’t send. Try again in a moment.');
      form.reset();
      form.hidden = true;
      thanks.hidden = false;
      thanks.querySelector('h2').focus();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      busy = false;
    }
  });
}
