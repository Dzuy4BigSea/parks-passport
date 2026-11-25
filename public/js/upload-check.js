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

// Profile photo (data-crop="circle"): once a photo is chosen, a circle to fit it in. Drag to move,
// the slider (or pinch-free +/- keys) to zoom, Center to reset. On submit the browser sends just
// the square inside the circle. If the browser can't draw the file (HEIC outside Safari), the
// original is sent and the server crops it.
const OUT = 512;
for (const input of document.querySelectorAll('input[type="file"][data-crop="circle"]')) {
  const form = input.form;
  const box = document.createElement('div');
  box.className = 'crop';
  box.hidden = true;
  box.innerHTML = `<p class="crop-help">Drag to position your photo in the circle.</p>
    <div class="crop-frame" tabindex="0" role="group" aria-label="Photo position. Arrow keys move it."><img alt=""></div>
    <div class="crop-tools"><label>Zoom <input type="range" min="1" max="4" step="0.01" value="1"></label>
    <button type="button" class="btn btn-small btn-quiet">Center</button></div>`;
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.before(box); else form.append(box); // the circle, then the button that saves it
  const frame = box.querySelector('.crop-frame');
  const img = box.querySelector('img');
  const zoom = box.querySelector('input[type="range"]');
  const center = box.querySelector('button');
  const s = { w: 0, h: 0, x: 0, y: 0, scale: 1, ready: false, url: null };
  const size = () => frame.clientWidth;
  const base = () => size() / Math.min(s.w, s.h);
  const clamp = () => {
    const S = size();
    s.x = Math.min(0, Math.max(S - s.w * s.scale, s.x));
    s.y = Math.min(0, Math.max(S - s.h * s.scale, s.y));
  };
  const draw = () => {
    clamp();
    img.style.width = `${s.w * s.scale}px`;
    img.style.height = `${s.h * s.scale}px`;
    img.style.transform = `translate(${s.x}px, ${s.y}px)`;
  };
  const recenter = () => {
    s.scale = base() * Number(zoom.value);
    s.x = (size() - s.w * s.scale) / 2;
    s.y = (size() - s.h * s.scale) / 2;
    draw();
  };
  const setZoom = (z) => {
    const S = size();
    const cx = (S / 2 - s.x) / s.scale; // keep the middle of the circle where it is
    const cy = (S / 2 - s.y) / s.scale;
    s.scale = base() * z;
    s.x = S / 2 - cx * s.scale;
    s.y = S / 2 - cy * s.scale;
    draw();
  };

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    s.ready = false;
    delete form.dataset.cropped;
    if (s.url) URL.revokeObjectURL(s.url);
    if (!file) { box.hidden = true; return; }
    s.url = URL.createObjectURL(file);
    img.onload = () => {
      s.w = img.naturalWidth;
      s.h = img.naturalHeight;
      box.hidden = false;
      zoom.value = '1';
      s.ready = true;
      recenter();
    };
    img.onerror = () => { box.hidden = true; }; // can't draw it here: send the original
    img.src = s.url;
  });
  zoom.addEventListener('input', () => setZoom(Number(zoom.value)));
  center.addEventListener('click', () => { zoom.value = '1'; recenter(); });

  let drag = null;
  frame.addEventListener('pointerdown', (e) => {
    drag = { id: e.pointerId, x: e.clientX - s.x, y: e.clientY - s.y };
    frame.setPointerCapture(e.pointerId);
  });
  frame.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    s.x = e.clientX - drag.x;
    s.y = e.clientY - drag.y;
    draw();
  });
  const end = () => { drag = null; };
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', end);
  frame.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 40 : 10;
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) { s.x += moves[e.key][0]; s.y += moves[e.key][1]; draw(); e.preventDefault(); }
    if (e.key === '+' || e.key === '=') { zoom.value = Math.min(4, Number(zoom.value) + 0.1); setZoom(Number(zoom.value)); }
    if (e.key === '-') { zoom.value = Math.max(1, Number(zoom.value) - 0.1); setZoom(Number(zoom.value)); }
  });

  // Before the busy check below: swap the file for the circle's square, then submit again.
  form.addEventListener('submit', (e) => {
    if (!s.ready || form.dataset.cropped) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const canvas = document.createElement('canvas');
    canvas.width = OUT;
    canvas.height = OUT;
    const side = size() / s.scale;
    canvas.getContext('2d').drawImage(img, -s.x / s.scale, -s.y / s.scale, side, side, 0, 0, OUT, OUT);
    canvas.toBlob((blob) => {
      if (blob) {
        const dt = new DataTransfer();
        dt.items.add(new File([blob], 'profile.jpg', { type: 'image/jpeg' }));
        input.files = dt.files;
      }
      form.dataset.cropped = '1';
      form.requestSubmit(e.submitter || undefined);
    }, 'image/jpeg', 0.9);
  });
}

// Photo uploads take a moment: say so, and ignore a second tap until the page changes.
for (const form of new Set([...document.querySelectorAll('input[type="file"][name="photo"]')].map((i) => i.form))) {
  form.addEventListener('submit', (e) => {
    if (form.dataset.busy) { e.preventDefault(); return; }
    form.dataset.busy = '1';
    const btn = e.submitter || form.querySelector('button[type="submit"]');
    if (btn) {
      btn.dataset.label = btn.innerHTML;
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.add('is-busy');
      btn.textContent = form.querySelector('input[type="file"]')?.files?.length ? 'Uploading…' : 'Saving…';
    }
  });
}
// Back from the next page (bfcache): the buttons work again.
window.addEventListener('pageshow', () => {
  for (const form of document.querySelectorAll('form[data-busy]')) {
    delete form.dataset.busy;
    delete form.dataset.cropped;
    const btn = form.querySelector('.is-busy');
    if (btn) { btn.innerHTML = btn.dataset.label; btn.classList.remove('is-busy'); btn.removeAttribute('aria-disabled'); }
  }
});
