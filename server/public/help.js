// Screen guide: dim the screen, number each part, and list the explanations at the bottom.
const HELP_ITEMS = [
  ['#office', 'helpOffice'],
  ['#usage', 'helpUsage'],
  ['#timebox', 'helpTime'],
  ['#filters', 'helpFilters'],
  ['#cards', 'helpCards'],
];
function showHelp() {
  const box = $('#help');
  box.innerHTML = '';
  const ul = document.createElement('ul');
  HELP_ITEMS.forEach(([sel, key], i) => {
    const el = $(sel);
    if (el && el.offsetParent !== null) {
      const r = el.getBoundingClientRect(), tag = document.createElement('div');
      tag.className = 'tag'; tag.textContent = i + 1;
      tag.style.left = Math.max(4, r.left + 4) + 'px'; tag.style.top = Math.max(4, r.top + 4) + 'px';
      box.appendChild(tag);
    }
    const li = document.createElement('li'); li.textContent = `${i + 1}. ${tr(key)}`; ul.appendChild(li);
  });
  const desc = document.createElement('div'); desc.className = 'desc'; desc.appendChild(ul);
  box.appendChild(desc);
  box.hidden = false;
  box.focus();
}
// Closing returns the focus to the button that opened the guide.
function hideHelp() { $('#help').hidden = true; $('#helpBtn').focus(); }
$('#help').addEventListener('click', hideHelp);
window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#help').hidden) hideHelp(); });
window.addEventListener('resize', () => { if (!$('#help').hidden) showHelp(); });
