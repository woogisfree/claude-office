// 화면 설명: 화면을 어둡게 덮고 각 부분에 번호를 붙인 뒤 설명을 아래쪽에 적는다.
const HELP_ITEMS = [
  ['#office', '사무실: 실행 중인 Claude Code 세션이 직원으로 나타납니다. 책상마다 세션이 하나씩 앉습니다.'],
  ['#usage', '사용량: 5시간 한도와 주간 한도의 사용률입니다. statusline이 캐시 파일을 써야 표시됩니다.'],
  ['#timebox', '시간 막대: 창밖 시각을 미리 봅니다. 끌지 않으면 실제 시각을 따라갑니다.'],
  ['#filters', '필터: 상태와 프로젝트로 카드를 걸러 냅니다. 고른 값은 기억됩니다.'],
  ['#cards', '세션 카드: 클릭하면 해당 터미널이 앞으로 옵니다. 노란색은 승인 대기, 초록색은 작업 중입니다.'],
];
function showHelp() {
  const box = $('#help');
  box.innerHTML = '';
  const ul = document.createElement('ul');
  HELP_ITEMS.forEach(([sel, text], i) => {
    const el = $(sel);
    if (el && el.offsetParent !== null) {
      const r = el.getBoundingClientRect(), tag = document.createElement('div');
      tag.className = 'tag'; tag.textContent = i + 1;
      tag.style.left = Math.max(4, r.left + 4) + 'px'; tag.style.top = Math.max(4, r.top + 4) + 'px';
      box.appendChild(tag);
    }
    const li = document.createElement('li'); li.textContent = `${i + 1}. ${text}`; ul.appendChild(li);
  });
  const desc = document.createElement('div'); desc.className = 'desc'; desc.appendChild(ul);
  box.appendChild(desc);
  box.hidden = false;
}
$('#help').addEventListener('click', () => { $('#help').hidden = true; });
window.addEventListener('resize', () => { if (!$('#help').hidden) showHelp(); });
