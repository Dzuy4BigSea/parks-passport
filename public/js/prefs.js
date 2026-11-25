// Account › On this device: turn celebrations (badge reveals, the passport opening, card tilt) on
// or off. Stored in this browser only.
import { celebrationsOn, setCelebrations } from './fx.js';

const box = document.getElementById('celebrations');
if (box) {
  box.checked = celebrationsOn();
  const status = document.getElementById('celebrations-status');
  box.addEventListener('change', () => {
    setCelebrations(box.checked);
    if (status) status.textContent = box.checked ? 'Celebrations are on for this device.' : 'Celebrations are off for this device.';
  });
}
