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

// "Share link" buttons: <button data-share="#input-id">. Shown only where the phone's share sheet
// exists (Copy stays for everyone else).
for (const button of document.querySelectorAll('[data-share]')) {
  const input = document.querySelector(button.dataset.share);
  if (!input || typeof navigator.share !== 'function') continue;
  button.hidden = false;
  button.addEventListener('click', () => {
    navigator.share({ title: 'Parks Passport', text: 'Be my Park Pal on Parks Passport!', url: input.value }).catch(() => { /* closed the sheet */ });
  });
}

// A link to a folded-away section (/pals#add) opens it.
if (window.location.hash.length > 1) {
  const target = document.getElementById(window.location.hash.slice(1));
  if (target?.tagName === 'DETAILS') target.open = true;
}
