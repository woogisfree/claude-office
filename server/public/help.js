// 화면 설명: 화면을 어둡게 덮고 각 부분에 번호를 붙인 뒤 설명을 아래쪽에 적는다.
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
}
$('#help').addEventListener('click', () => { $('#help').hidden = true; });
window.addEventListener('resize', () => { if (!$('#help').hidden) showHelp(); });
