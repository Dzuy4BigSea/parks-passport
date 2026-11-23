// Moves focus to a server-rendered announcement (new badge, level-up, stamp result) so screen
// readers read it: live regions that exist at page load usually aren't announced.
const el = document.querySelector('[data-announce]');
if (el) el.focus({ preventScroll: false });
