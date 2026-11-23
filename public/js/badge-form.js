// Admin badge form: show only the settings the chosen rule uses. Without JS all are shown.
const select = document.getElementById('rule_type');
const update = () => {
  const used = (select.selectedOptions[0]?.dataset.params || '').split(' ').filter(Boolean);
  for (const el of document.querySelectorAll('.rule-params [data-param]')) el.hidden = !used.includes(el.dataset.param);
};
if (select) {
  select.addEventListener('change', update);
  update();
}
