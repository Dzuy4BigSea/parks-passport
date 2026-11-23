// Stops a photo over 10 MB before it's sent (the server would refuse it anyway).
const MAX = 10 * 1024 * 1024;
for (const input of document.querySelectorAll('input[type="file"][name="photo"]')) {
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.setCustomValidity(file && file.size > MAX ? 'That photo is over 10 MB. Choose a smaller one.' : '');
    if (file && file.size > MAX) input.reportValidity();
  });
}
