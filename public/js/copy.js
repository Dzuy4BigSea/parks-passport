// "Copy link" buttons: <button data-copy="#input-id">. Hidden without JS (the field is selectable).
for (const button of document.querySelectorAll('[data-copy]')) {
  const input = document.querySelector(button.dataset.copy);
  if (!input || !navigator.clipboard) continue;
  button.hidden = false;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(input.value);
      button.textContent = 'Copied';
    } catch {
      input.select();
    }
  });
}
