// Stops a photo over 10 MB before it's sent (the server would refuse it anyway).
const MAX = 10 * 1024 * 1024;
for (const input of document.querySelectorAll('input[type="file"][name="photo"]')) {
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.setCustomValidity(file && file.size > MAX ? 'That photo is over 10 MB. Choose a smaller one.' : '');
    if (file && file.size > MAX) input.reportValidity();
  });
}

// On phones, a camera button next to the photo picker. `capture` on the picker itself would
// drop the photo library, so a second, hidden input opens the camera and hands its shot to
// the real one. data-camera="user" opens the front camera (selfies), "environment" the back one.
if (window.matchMedia('(pointer: coarse)').matches && typeof DataTransfer === 'function') {
  for (const input of document.querySelectorAll('input[type="file"][data-camera]')) {
    const cam = document.createElement('input');
    cam.type = 'file';
    cam.accept = input.accept || 'image/*';
    cam.setAttribute('capture', input.dataset.camera);
    cam.hidden = true;
    cam.tabIndex = -1;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-small camera-btn';
    btn.textContent = input.dataset.camera === 'user' ? 'Take a selfie' : 'Take a photo';
    btn.addEventListener('click', () => cam.click());
    cam.addEventListener('change', () => {
      const file = cam.files?.[0];
      if (!file) return;
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      cam.value = '';
    });
    input.after(btn, cam);
  }
}
