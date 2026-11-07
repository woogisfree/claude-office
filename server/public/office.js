// 테마별 방, 책상, 모니터, 의자, 서류 더미, 머그잔을 픽셀 단위로 그린다.
const PAL = {
  office: { wall: '#f6e9cb', stripe: '#f0e0bd', rail: '#e9d4a2', wains: '#8fae8b', wainsHi: '#a9c7a2', base: '#6b5a44', fA: '#e2bd88', fB: '#d9b27c', seam: '#bf9560', rug: '#b9604a', rugHi: '#dc8f6b', rugEdge: '#f2dfb0', rugLine: '#9a4a38', desk: '#c68e5c', deskHi: '#e6b684', deskLo: '#93633d', rest: '#d9915a', restHi: '#f0b584', restLo: '#a9683c' },
  mine: { wall: '#4a3a2f', stripe: '#43342a', rail: '#6a5444', wains: '#33281f', wainsHi: '#46372b', base: '#1e1712', fA: '#5e4d3f', fB: '#564638', seam: '#3b2f26', rug: '#2e241d', rugHi: '#4a3b30', rugEdge: '#6a5444', rugLine: '#241b15', desk: '#7d7d86', deskHi: '#a4a4ae', deskLo: '#52525a', rest: '#7a5a3c', restHi: '#9a7650', restLo: '#58402a' },
  xmas: { wall: '#2f6b46', stripe: '#2a5f3e', rail: '#d8c07a', wains: '#8a2b2b', wainsHi: '#a83838', base: '#5a1c1c', fA: '#e2d8c8', fB: '#d9cebd', seam: '#c0b4a0', rug: '#b33a3a', rugHi: '#d95a5a', rugEdge: '#e8d9a8', rugLine: '#8a2b2b', desk: '#2f7a4e', deskHi: '#4ea072', deskLo: '#1f5236', rest: '#c24a4a', restHi: '#e06a6a', restLo: '#8a3030' },
};
const pal = () => PAL[theme] || PAL.office;
const hh = (a, b) => hash(`${a},${b}`);

// 둥근 모서리(모서리 한 칸을 비움)에 외곽선이 있는 상자
function pbox(x, y, w, h, fill, hi, lo) {
  rect(x + 1, y, w - 2, h, OUT); rect(x, y + 1, w, h - 2, OUT);
  rect(x + 1, y + 1, w - 2, h - 2, fill);
  if (hi) rect(x + 2, y + 1, w - 4, 1, hi);
  if (lo) rect(x + 1, y + h - 2, w - 2, 1, lo);
}

const PLANT = [
  '......gg......', '..gg..gGg..gg.', '.gGgg.gGg.gGg.', '.gGGggggggGGg.', '..gGGgggggGg..', '...ggGgGggg...', '....ggGGgg....',
  '.....gGGg.....', '......GG......', '......GG......', '..oooooooooo..', '..opppppppPo..', '...opppppPo...', '...opppppPo...', '...oPPPPPPo...', '....oooooo....',
];
const CLAWD = ['.oooooo.', 'oddddddo', 'odeddedo', 'oddddddo', '.o.oo.o.'];
const spPlant = () => cached('plant', () => compile(PLANT, { g: '#6aa84a', G: '#3f7a35', o: OUT, p: '#c07a4a', P: '#8a5230' }));
const CLAWD_PAL = { d: '#e07a55', e: '#1a0f0a' };
const CLAWD_L = ['..dddddddddddd..', '..dddddddddddd..', '..ddeddddddedd..', '..ddeddddddedd..', 'dddddddddddddddd', 'dddddddddddddddd', '..dddddddddddd..', '..dddddddddddd..', '...d.d....d.d...', '...d.d....d.d...'];
const CLAWD_L_BLINK = CLAWD_L.map((r) => r.replace(/e/g, 'd'));
const CLAWD_S = ['.dddddd.', '.dedded.', 'dddddddd', '.dddddd.', '.d.dd.d.'];
const spClawdL = (blink) => cached(blink ? 'clawdLb' : 'clawdL', () => compile(blink ? CLAWD_L_BLINK : CLAWD_L, CLAWD_PAL));
const spClawdS = () => cached('clawdS', () => compile(CLAWD_S, CLAWD_PAL));

function drawRoom(t) {
  const p = pal();
  // 벽: 세로 줄무늬 벽지, 허리 몰딩, 걸레받이
  rect(0, 0, L.W, WALL_H, p.wall);
  for (let x = 0; x < L.W; x += 8) rect(x, 0, 2, WALL_H - 16, p.stripe);
  rect(0, WALL_H - 18, L.W, 2, p.rail);
  rect(0, WALL_H - 16, L.W, 16, p.wains); rect(0, WALL_H - 16, L.W, 1, p.wainsHi);
  for (let x = 4; x < L.W; x += 20) { rect(x, WALL_H - 13, 14, 9, p.wainsHi); rect(x + 1, WALL_H - 12, 12, 7, p.wains); }
  rect(0, WALL_H - 3, L.W, 3, p.base);
  if (theme === 'mine') for (let i = 0; i < 40; i++) { const rx = hh(i, 1) % L.W, ry = hh(i, 2) % (WALL_H - 20); rect(rx, ry, 3 + (i % 3), 2, p.wains); rect(rx, ry, 3 + (i % 3), 1, p.rail); }
  // 바닥: 널마루, 같은 줄에서 판자 길이는 어긋나게 둔다.
  rect(0, WALL_H, L.W, L.H - WALL_H, p.fA);
  for (let r = 0, y = WALL_H; y < L.H; y += 6, r++) {
    rect(0, y, L.W, 1, p.seam);
    for (let x = ((r * 23) % 40) - 40; x < L.W; x += 40) { rect(x, y, 1, 6, p.seam); if (hh(r, x) % 3 === 0) rect(x + 8 + (hh(r, x) % 20), y + 2, 4, 2, p.fB); }
    for (let k = 0; k < 3; k++) rect(hh(r, k) % L.W, y + 2 + (k % 3), 2, 1, p.fB);
  }
  // 복도(첫 줄 뒤)와 통로에는 러그를 깐다.
  // 복도와 세로 통로를 하나로 이어진 T자 러너 카펫으로 깐다. 바깥 외곽선, 크림색 테두리, 안쪽 바탕 순서로 겹쳐 그려서 이음매 없이 이어진다.
  const rugs = [[L.offX, WALL_H, L.cw, CORR_H], [L.aisleX - AISLE / 2 + 2, WALL_H, AISLE - 4, L.H - WALL_H]];
  for (const [rx, ry, rw, rh] of rugs) rect(rx - 1, ry - 1, rw + 2, rh + 2, OUT);
  for (const [rx, ry, rw, rh] of rugs) rect(rx, ry, rw, rh, p.rugEdge);
  for (const [rx, ry, rw, rh] of rugs) rect(rx + 2, ry + 2, rw - 4, rh - 4, p.rug);
  // 안쪽 바탕에는 마름모 무늬를 전체 좌표 기준으로 그려서 두 카펫이 만나는 곳에서도 무늬가 끊기지 않는다.
  for (const [rx, ry, rw, rh] of rugs) {
    for (let xx = rx + 3; xx < rx + rw - 3; xx++) for (let yy = ry + 3; yy < ry + rh - 3; yy++) {
      const mx = ((xx % 8) + 8) % 8, my = ((yy % 8) + 8) % 8;
      if ((mx === 4 && my === 4) || (mx === 3 && my === 4) || (mx === 5 && my === 4) || (mx === 4 && my === 3) || (mx === 4 && my === 5)) rect(xx, yy, 1, 1, p.rugHi);
      else if (mx === 0 && my === 0) rect(xx, yy, 1, 1, p.rugHi);
    }
  }
  // 테두리 안쪽에 얇은 줄을 한 번 더 둘러 카펫다운 마감을 준다.
  for (const [rx, ry, rw, rh] of rugs) { rect(rx + 2, ry + 2, rw - 4, 1, p.rugLine); rect(rx + 2, ry + rh - 3, rw - 4, 1, p.rugLine); }
  // 통창과 벽 장식은 문 왼쪽 기준으로 시계, 화분, 창 순서로 놓는다. 열 수가 바뀌어도 함께 따라온다.
  const doorL = L.doorX - 14;
  if (theme === 'office') drawShafts();
  L.win = { x: MARGIN + 2, y: 10, w: doorL - 58 - (MARGIN + 2), h: 36 };
  drawWindows(L.win.x, L.win.w, L.win.y, L.win.h, t);
  drawClock(doorL - 14, 22);
  if (theme !== 'xmas') ctx.drawImage(spPlant(), doorL - 52, WALL_H - 15);
  if (theme === 'office' && L.leftCols >= 1) drawPets(t); // 왼쪽 묶음이 없으면 고양이 자리가 통로와 겹쳐 생략한다.
  if (theme === 'mine') for (let x = L.offX + MARGIN + 30; x < L.offX + L.cw - 90; x += 70) { rect(x, 18, 4, 14, '#5a3e28'); rect(x - 1, 14, 6, 5, OUT); const f = Math.floor(t * 6 + x) % 3; rect(x, 9 - (f === 0 ? 1 : 0), 4, 6, '#ff9a2a'); rect(x + 1, 8 - (f === 1 ? 2 : 0), 2, 5, '#ffd24a'); }
  if (theme === 'xmas') {
    for (let x = 2, i = 0; x < L.W - 2; x += 5, i++) { rect(x, 3 + (i % 2), 1, 1, '#2a2a2a'); rect(x, 5 + (i % 2), 2, 2, ['#ffd24a', '#7ad07a', '#ff6a6a', '#6aaaff'][(i + Math.floor(t * 2)) % 4]); }
    const tx0 = doorL - 44;
    rect(tx0 + 4, 44, 4, 6, '#6e4f35');
    for (let i = 0; i < 4; i++) rect(tx0 - i * 2 + 4, 24 + i * 6, 8 + i * 4, 6, i % 2 ? '#2f8a4e' : '#3fa05e');
    rect(tx0 + 4, 20, 4, 4, '#ffd24a');
  }
}

function drawDoor(open) {
  const x = L.doorX - 11, y = WALL_H - 38;
  rect(x - 3, y - 6, 28, 44, OUT); rect(x - 2, y - 5, 26, 42, '#55596a');
  rect(x, y, 22, 36, '#1c1d26');
  const half = Math.round((1 - open) * 11);
  for (const [dx, w] of [[0, half], [22 - half, half]]) {
    if (w > 0) { rect(x + dx, y, w, 36, '#9aa6bd'); rect(x + dx, y, w, 1, '#cfd8ea'); rect(x + dx + (dx ? 0 : w - 1), y, 1, 36, '#6f7a92'); }
  }
  rect(x + 7, y - 4, 8, 3, OUT); rect(x + 8, y - 3, 6, 1, open > 0.2 ? '#4ade80' : '#ef4444');
}

function ctxLimit(model, tokens) {
  const small = /claude-(3-|haiku-4-5|sonnet-4(?!-[6-9])|opus-4(?!-[6-9]))/.test(model || '');
  return small && tokens <= 200000 ? 200000 : 1000000;
}

function drawMonitor(x, y, mode, t, seed) {
  rect(x + 8, y + 18, 8, 4, '#3b3f4b'); rect(x + 5, y + 21, 14, 2, OUT); rect(x + 6, y + 21, 12, 1, '#555a68');
  pbox(x, y, 24, 19, '#4a4f5e', '#6b7186', '#363a46');
  rect(x + 2, y + 2, 20, 13, mode === 'off' ? '#15161c' : '#0b1b28');
  if (mode === 'code') {
    // 클로드 코드 시작 화면처럼 위쪽에 로고, 아래쪽에 흘러가는 코드 세 줄을 보여 준다.
    ctx.drawImage(spClawdS(), x + 3, y + 3);
    const sc = Math.floor(t * 3);
    for (let i = 0; i < 3; i++) {
      const ln = sc + i, w = 3 + (hh(seed, ln) % 11), ind = (hh(seed, ln + 99) % 3) * 2;
      rect(x + 3 + ind, y + 9 + i * 2, Math.min(w, 17 - ind), 1, ['#7ee787', '#79c0ff', '#ffa657', '#d2a8ff', '#e8e8f0'][hh(seed, ln + 7) % 5]);
    }
    if (Math.floor(t * 2) % 2) rect(x + 18, y + 13, 2, 1, '#fff');
  } else if (mode === 'saver') {
    // 쉬는 중에는 큰 로고가 화면 가운데에서 가끔 눈을 깜빡인다.
    const blink = (Math.floor(t * 10) + seed * 7) % 34 === 0;
    ctx.drawImage(spClawdL(blink), x + 4, y + 3);
  } else if (mode === 'desktop') {
    // 승인을 기다리는 중에는 작은 로고 옆에서 물음표가 깜빡인다.
    ctx.drawImage(spClawdS(), x + 3, y + 3);
    if (Math.floor(t * 2) % 2) { rect(x + 14, y + 3, 4, 1, '#f4c24c'); rect(x + 17, y + 4, 1, 2, '#f4c24c'); rect(x + 15, y + 6, 2, 1, '#f4c24c'); rect(x + 15, y + 8, 2, 1, '#f4c24c'); }
    for (let i = 0; i < 2; i++) rect(x + 3, y + 10 + i * 2, 8 + i * 4, 1, '#6f7a90');
  }
  if (mode !== 'off') { ctx.fillStyle = 'rgba(255,255,255,.12)'; for (let k = 0; k < 5; k++) ctx.fillRect(x + 3 + k, y + 9 - k, 2, 1); }
}

function drawKeyboard(x, y) {
  rect(x, y, 16, 4, OUT); rect(x + 1, y + 1, 14, 2, '#d5d9e2');
  for (let i = 0; i < 6; i++) rect(x + 2 + i * 2, y + 1, 1, 1, '#9ba2b4');
  rect(x + 17, y + 1, 3, 3, OUT); rect(x + 18, y + 2, 1, 1, '#d5d9e2');
}

function drawDocs(x, y, n) {
  n = Math.max(0, Math.min(16, Math.round(n)));
  if (n === 0) { rect(x, y, 9, 1, 'rgba(0,0,0,.2)'); return; }
  rect(x - 1, y - n, 1, n + 1, OUT); rect(x + 9, y - n, 1, n + 1, OUT); rect(x, y, 9, 1, OUT);
  for (let i = 0; i < n; i++) rect(x + (i % 3 === 1 ? 1 : 0), y - 1 - i, 8 + (i % 2), 1, i % 2 ? '#fbf8ee' : '#e4dec9');
  rect(x, y - n - 1, 9, 1, OUT);
}
// frac은 0~1 비율이다. 테마에 맞게 서류, 광석, 선물로 보여 준다.
function drawMeter(x, y, frac) {
  if (theme === 'mine') {
    pbox(x - 2, y - 7, 14, 8, '#5a5a66', '#7a7a88', '#3e3e48'); rect(x, y, 3, 2, OUT); rect(x + 7, y, 3, 2, OUT);
    const n = Math.round(frac * 16);
    for (let i = 0; i < n; i++) rect(x - 1 + (i % 6) * 2, y - 8 - Math.floor(i / 6) * 2, 2, 2, ['#8a8a96', '#c9a24a', '#6a8ac0', '#a0a0ac'][i % 4]);
  } else if (theme === 'xmas') {
    const n = Math.round(frac * 8), cols = ['#d93a3a', '#3a8ad9', '#e0b23a', '#3ab070'];
    for (let i = 0; i < n; i++) { const w = 10 - (i % 2) * 2, bx = x + (i % 2), by = y - (i + 1) * 4 + 3; rect(bx - 1, by - 1, w + 2, 5, OUT); rect(bx, by, w, 3, cols[i % 4]); rect(bx + Math.floor(w / 2) - 1, by, 2, 3, '#fff6c8'); }
    if (n === 0) rect(x, y, 9, 1, 'rgba(0,0,0,.2)');
  } else drawDocs(x, y, frac * 16);
}

function drawMug(x, y, steam, t) {
  rect(x, y, 6, 6, OUT); rect(x + 1, y + 1, 4, 4, '#f6f4ee'); rect(x + 1, y + 1, 4, 1, '#6a3d22'); rect(x + 6, y + 2, 2, 3, OUT); rect(x + 6, y + 3, 1, 1, '#f6f4ee');
  if (steam) for (let i = 0; i < steam; i++) rect(x + 1 + (i % 2) * 2, y - 3 - ((Math.floor(t * 3) + i * 2) % 4), 1, 2, 'rgba(255,255,255,.7)');
}

function drawDeskBlock(d, emp, t) {
  const p = pal(), x = d.x, y = d.y;
  rect(x + 4, y + 46, 52, 3, 'rgba(0,0,0,.18)');
  const st = emp ? emp.data.status : null;
  if (theme === 'office') {
    drawMonitor(x + 24, y + 8, !emp ? 'off' : st === 'busy' ? 'code' : st === 'idle' ? 'saver' : 'desktop', t, emp ? emp.seed : 0);
  } else if (theme === 'mine') {
    pbox(x + 26, y + 14, 24, 14, '#6a6a74', '#9a9aa6', '#46464e');
    rect(x + 31, y + 18, 3, 3, '#c9a24a'); rect(x + 40, y + 20, 3, 3, '#6a8ac0'); rect(x + 36, y + 16, 2, 2, '#e0c060');
    if (emp && st === 'busy') { const sw = Math.floor(t * (emp.hot ? 14 : 6)) % 4; rect(x + 50 - sw * 2, y + 6 + sw * 3, 2, 8, '#8a6a42'); rect(x + 46 - sw * 2, y + 4 + sw * 3, 8, 2, '#b0b0bc'); }
    else { rect(x + 52, y + 8, 2, 20, '#8a6a42'); rect(x + 47, y + 6, 10, 2, '#b0b0bc'); }
  } else {
    const k = emp && st === 'busy' ? Math.floor(t / 8) % 3 : 0;
    pbox(x + 28, y + 16, 14, 12, ['#d93a3a', '#3a8ad9', '#3ab070'][k], null, null); rect(x + 34, y + 16, 3, 12, '#fff6c8'); rect(x + 28, y + 21, 14, 2, '#fff6c8');
    rect(x + 45, y + 18, 8, 10, OUT); rect(x + 46, y + 19, 6, 8, '#e0b23a');
  }
  // 책상 윗면, 앞면, 다리
  rect(x + 2, y + 28, 54, 7, OUT); rect(x + 3, y + 29, 52, 5, p.desk); rect(x + 3, y + 29, 52, 1, p.deskHi); rect(x + 3, y + 33, 52, 1, p.deskLo);
  rect(x + 3, y + 35, 52, 10, OUT); rect(x + 4, y + 35, 50, 9, p.desk); rect(x + 4, y + 43, 50, 1, p.deskLo);
  rect(x + 4, y + 45, 4, 3, OUT); rect(x + 50, y + 45, 4, 3, OUT);
  if (theme === 'office') drawKeyboard(x + 3, y + 29); // 직원(x+11) 바로 앞
  if (emp) {
    drawMeter(x + 46, y + 28, emp.data.ctxTokens / ctxLimit(emp.data.model, emp.data.ctxTokens));
    if (emp.mugOnDesk) drawMug(x + 5, y + 22, 0, t);
  }
}

function drawChairBack(d) { pbox(d.x + 4, d.y + 15, 15, 17, '#4b5a86', '#6a7bb0', '#35416a'); }
function drawReclinerBack(d) {
  const p = pal(), x = d.x + 56, y = d.y + 6;
  rect(x + 2, y + 32, 22, 3, 'rgba(0,0,0,.18)');
  if (theme === 'mine') { pbox(x + 2, y + 10, 20, 24, p.rest, p.restHi, p.restLo); for (let k = 0; k < 3; k++) rect(x + 4, y + 16 + k * 6, 16, 1, p.restLo); return; }
  if (theme === 'xmas') { pbox(x + 2, y + 4, 20, 30, '#8a5a3c', '#b07a52', '#5e3c28'); pbox(x + 5, y, 14, 8, '#fff', '#fff', '#dde'); return; }
  pbox(x + 2, y + 2, 20, 32, p.rest, p.restHi, p.restLo); pbox(x + 6, y - 2, 12, 8, p.restHi, '#a3b4dc', p.rest);
}
function drawReclinerFront(d) {
  const p = pal(), x = d.x + 56, y = d.y + 6;
  if (theme === 'mine') { pbox(x, y + 24, 24, 12, p.restHi, '#b8926a', p.rest); return; }
  if (theme === 'xmas') { pbox(x, y + 30, 24, 4, '#6a4026', '#8a5a3c', '#4a2c1a'); return; }
  pbox(x - 1, y + 20, 6, 18, p.rest, p.restHi, p.restLo); pbox(x + 19, y + 20, 6, 18, p.rest, p.restHi, p.restLo);
  pbox(x + 3, y + 26, 18, 12, p.restHi, '#a3b4dc', p.rest); pbox(x + 3, y + 38, 18, 4, p.rest, p.restHi, p.restLo);
}

// 창으로 들어오는 햇살 줄기: 해의 위치에 따라 기울기가 바뀌고, 날씨가 흐리면 옅어진다.
function drawShafts() {
  const hour = currentHour(), { day, f } = sunPos(hour), kind = weatherKind(curWeather());
  if (!day) return;
  const k = kind === 'clear' ? 1 : kind === 'partly' ? 0.6 : kind === 'cloudy' ? 0.25 : 0;
  if (!k) return;
  const doorL = L.doorX - 14, x0 = MARGIN + 2, w = doorL - 58 - x0, n = Math.max(2, Math.round(w / 56));
  const edge = Math.min(1, Math.min(f, 1 - f) * 5);
  for (let i = 0; i < n; i++) {
    const px = Math.round(x0 + (i * (w - 3)) / n) + 5, pw = Math.round((w - 3) / n) - 8;
    for (let yy = WALL_H; yy < Math.min(L.H, WALL_H + 150); yy++) {
      const d = yy - WALL_H, shift = Math.round(d * (0.95 - 1.9 * f)), a = 0.16 * k * edge * (1 - d / 150);
      if (a < 0.01) break;
      ctx.fillStyle = `rgba(255,236,170,${a.toFixed(3)})`; ctx.fillRect(px + shift, yy, pw, 1);
    }
  }
}

const CAT = ['.oo.........', 'obbooooooo..', 'obyybbbbbbbo', 'obbbbbbbbbbo', '.obbbbbbbbbo', '..oooooooooo'];
const SOOT = ['.kkkk.', 'kkkkkk', 'kwkkwk', 'kkkkkk', '.kkkk.'];
const spCat = () => cached('cat', () => compile(CAT, { o: '#1d1a24', b: '#3d3848', y: '#f4e08a' }));
const spSoot = (blink) => cached('soot' + blink, () => compile(blink ? ['.kkkk.', 'kkkkkk', 'kkkkkk', 'kkkkkk', '.kkkk.'] : SOOT, { k: '#2a2630', w: '#ffffff' }));
// 방석 위에서 자는 검은 고양이와 어슬렁거리는 먼지 정령
function drawPets(t) {
  const px = L.offX + MARGIN + 4, py = WALL_H + 3;
  pbox(px, py + 5, 17, 7, '#e48a8a', '#f2a8a8', '#b86464');
  ctx.drawImage(spCat(), px + 2, py - 1 + Math.round(Math.sin(t * 1.6) * 0.5));
  const z = Math.floor(t * 0.8) % 3;
  ctx.fillStyle = '#7d6a8a'; for (let i = 0; i <= z; i++) { const zx = px + 12 + i * 3, zy = py - 4 - i * 3; ctx.fillRect(zx, zy, 3, 1); ctx.fillRect(zx + 1, zy + 1, 1, 1); ctx.fillRect(zx, zy + 2, 3, 1); }
  for (let i = 0; i < 3; i++) {
    const sx = px + 30 + i * 13 + Math.round(Math.sin(t * 0.5 + i * 2) * 4), sy = WALL_H + 6 - Math.abs(Math.round(Math.sin(t * 3 + i * 1.7) * 2));
    ctx.drawImage(spSoot(Math.floor(t * 0.7 + i * 3) % 6 === 0), sx, sy);
  }
}
// 햇살 속에 떠다니는 먼지
function drawMotes(t) {
  if (theme !== 'office') return;
  const hour = currentHour(), { day } = sunPos(hour), kind = weatherKind(curWeather());
  if (!day || (kind !== 'clear' && kind !== 'partly')) return;
  ctx.fillStyle = 'rgba(255,248,210,.75)';
  for (let i = 0; i < 16; i++) {
    const x = L.offX + 12 + ((i * 53 + t * 2.5 + Math.sin(t * 0.7 + i) * 5) % (L.cw - 90)), y = WALL_H + 6 + ((i * 37 + t * 4) % 120);
    if ((Math.floor(t * 2) + i) % 4) ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
}
