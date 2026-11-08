// 직원 관리, 이동, 자동문, 그리기 루프. 픽셀은 저해상도 캔버스에, 글자는 고해상도 레이어에 그린다.
const wrap = $('#wrap');
const emps = new Map();
const deskOf = new Map();
let sessionList = [];
let hoverId = null;
let onHover = () => {};
const door = { open: 0, idleFor: 0 };
const PASTELS = ['#f8b4b4', '#b4d8f8', '#b8f0c0', '#f8e0a0', '#d8c0f8', '#f8c8e8', '#a8ecec', '#ffd0a0'];
const parentColors = new Map();
const FONT = 'ui-rounded,"SF Pro Rounded","Apple SD Gothic Neo","Nanum Gothic",sans-serif';

const WAIT_KO = [[/permission/i, '권한 승인 요청'], [/plan/i, '계획 승인 요청'], [/elicit|question/i, '질문 응답 대기'], [/input|idle|prompt/i, '입력 대기']];
const waitingText = (w) => { if (!w) return '승인 대기'; for (const [re, ko] of WAIT_KO) if (re.test(w)) return ko; return w; };

const seatPos = (d) => ({ x: d.x + 11, y: d.y + 34 });
const restPos = (d) => ({ x: d.x + 68, y: d.y + 36 });
// 책상 줄 아래쪽의 빈 바닥을 지나는 가로 통로다. 책상, 모니터, 의자를 가로지르지 않도록 모든 이동은 이 통로와 세로 통로(aisle)로만 한다.
const laneY = (d) => d.y + CELL_H - 4;
const sideX = (d) => d.x - GUTTER / 2; // 책상 왼쪽 옆길의 한가운데
// 자리(책상 뒤)에서 나가려면 왼쪽 옆길로 내려가 아래 통로를 따라 리클라이너로 간다. 책상은 가로지르지 않는다.
const restRoute = (d) => [{ x: sideX(d), y: seatPos(d).y }, { x: sideX(d), y: laneY(d) }, { x: d.x + 68, y: laneY(d) }, restPos(d)];
const doorPos = () => ({ x: L.doorX, y: WALL_H - 2 });

// 입장 경로의 앞부분이다. 책상 줄 아래 통로의 옆길 입구(decide 지점)에 닿았을 때 그 시점의 상태를 보고 자리로 갈지 리클라이너로 갈지 정한다.
function entryPath(e) {
  const d = deskPos(e.desk), lane = laneY(d);
  return [{ x: L.doorX, y: L.corrY }, { x: L.aisleX, y: L.corrY }, { x: L.aisleX, y: lane }, { x: sideX(d), y: lane, decide: true }];
}
function entryTail(e) {
  const d = deskPos(e.desk), s = seatPos(d), lane = laneY(d);
  e.dest = e.data && e.data.status === 'idle' ? 'rest' : 'seat';
  return e.dest === 'rest' ? [{ x: d.x + 68, y: lane }, restPos(d)] : [{ x: sideX(d), y: s.y }, s];
}
function nextDesk() { const used = new Set(deskOf.values()); let i = 0; while (used.has(i)) i++; return i; }

function applySessions(list) {
  sessionList = list;
  const ids = new Set(list.map((s) => s.sessionId));
  for (const s of list) if (!deskOf.has(s.sessionId)) deskOf.set(s.sessionId, nextDesk());
  // 하위 작업을 띄운 세션은 다른 세션이 쓰지 않는 파스텔 색을 하나 받는다.
  const parents = new Set(list.filter((s) => s.parentId).map((s) => s.parentId));
  for (const p of parents) if (!parentColors.has(p)) parentColors.set(p, PASTELS[parentColors.size % PASTELS.length]);
  for (const k of [...parentColors.keys()]) if (!parents.has(k)) parentColors.delete(k);
  const byId = new Map(list.map((s) => [s.sessionId, s]));
  let spawned = 0;
  for (const s of list) {
    let e = emps.get(s.sessionId);
    if (!e) {
      e = { id: s.sessionId, desk: deskOf.get(s.sessionId), look: look(s.sessionId), seed: hash(s.sessionId) % 50, x: -100, y: -100, path: [], visited: [], phase: 'enter', face: 'front', flip: false, surprise: 0, sulk: 0, hot: false, clickTimes: [], delay: spawned++ * 0.9 };
      emps.set(s.sessionId, e);
    }
    e.leaving = false;
    e.data = s;
    e.parent = s.parentId ? byId.get(s.parentId) : null;
    const thr = fireThresholdK * 1000;
    if (s.tokensPerMin > thr) e.hot = true; else if (s.tokensPerMin < thr * 0.75) e.hot = false;
  }
  resize();
  for (const e of emps.values()) if (e.path.length === 0 && e.phase === 'enter' && e.x === -100) { e.path = entryPath(e); }
  for (const e of emps.values()) {
    if (!ids.has(e.id) && !e.leaving) {
      e.leaving = true; e.phase = 'leave';
      const d = deskPos(e.desk), s = seatPos(d);
      // 자리에 닿기 전이면 지나온 길을 거꾸로 밟고, 자리에 있으면 통로로 나간다.
      const trail = e.visited.slice().reverse();
      const out = [{ x: L.aisleX, y: L.corrY }, { x: L.doorX, y: L.corrY }, doorPos()];
      // 자리에 있거나 쉬던 중이면 현재 x에서 아래 통로로 내려간 뒤 세로 통로로 이동한다. 어느 단계에서든 축을 따라서만 움직인다.
      const lane = laneY(d);
      // 지금 걷는 경로의 끝에서 출발한다고 보고, 그곳이 리클라이너면 아래 통로로, 책상 자리면 왼쪽 옆길로 나간다.
      const last = e.path.length ? e.path[e.path.length - 1] : { x: e.x, y: e.y };
      const exitRoute = last.x > d.x + 40 ? [{ x: last.x, y: lane }, { x: L.aisleX, y: lane }] : [{ x: sideX(d), y: s.y }, { x: sideX(d), y: lane }, { x: L.aisleX, y: lane }];
      e.path = (e.visited.length && !e.seated ? trail : e.path.concat(exitRoute)).concat(out);
      if (e.x === -100) { emps.delete(e.id); deskOf.delete(e.id); }
    }
  }
}

function step(e, dt, nowMs) {
  if (e.x === -100) { e.delay -= dt; if (e.delay > 0) return; const dp = doorPos(); e.x = dp.x; e.y = dp.y; e.path = entryPath(e); }
  if (e.path.length) {
    const tg = e.path[0], dx = tg.x - e.x, dy = tg.y - e.y, dist = Math.hypot(dx, dy), mv = 44 * dt;
    if (Math.abs(dx) > Math.abs(dy)) { e.face = 'side'; e.flip = dx < 0; } else e.face = dy < 0 ? 'back' : 'front';
    e.walking = true;
    if (dist <= mv) {
      e.x = tg.x; e.y = tg.y; e.path.shift();
      if (tg.decide && !e.leaving && e.phase === 'enter') e.path = entryTail(e);
      if (!e.leaving && e.phase === 'enter') e.visited.push({ x: tg.x, y: tg.y });
      if (!e.path.length) {
        if (e.leaving) { emps.delete(e.id); deskOf.delete(e.id); return; }
        if (e.phase === 'enter') { e.phase = e.dest === 'rest' ? 'rest' : 'seated'; e.seated = true; }
        e.walking = false; e.face = 'front';
      }
    } else { e.x += (dx / dist) * mv; e.y += (dy / dist) * mv; }
  } else e.walking = false;
  if (e.leaving) return;
  if (!e.walking) {
    const d = deskPos(e.desk), st = e.data.status;
    if (st === 'idle' && e.phase === 'seated') { e.phase = 'rest'; e.path = restRoute(d); }
    else if (st !== 'idle' && e.phase === 'rest') { e.phase = 'seated'; e.path = restRoute(d).reverse().slice(1).concat([seatPos(d)]); }
  }
  e.mugOnDesk = e.data.status === 'idle';
  if (e.surprise > 0) e.surprise -= dt;
  if (e.sulk > 0) e.sulk -= dt;
}

function party(e) { const d = new Date(); return theme === 'office' && d.getDay() === 5 && d.getHours() >= 18 && e.data.status === 'idle'; }

function renderEmployee(e, t) {
  const st = e.data.status;
  const atDesk = e.phase === 'seated' && !e.walking, resting = e.phase === 'rest' && !e.walking;
  const idleMin = (Date.now() - (e.data.statusUpdatedAt || Date.now())) / 60000;
  const surprised = e.surprise > 0;
  const o = {
    facing: e.walking ? e.face : e.sulk > 0 ? 'back' : 'front', flip: e.flip, walking: e.walking, sit: resting,
    typing: atDesk && st === 'busy', fast: e.hot, seed: e.seed, hand: atDesk && st === 'waiting', jitter: e.hot && atDesk,
    wide: e.hot || surprised, sleepy: resting && idleMin > 15, sweat: atDesk && st === 'busy' && e.data.failStreak >= 3,
    fire: theme === 'mine' && e.hot && atDesk,
    hat: theme === 'xmas' ? 'xmas' : theme === 'mine' ? 'miner' : party(e) ? 'party' : null,
    shirt: theme === 'xmas' ? '#c43030' : theme === 'mine' ? '#b08a3a' : null,
  };
  const y = e.y - (surprised ? 3 : 0);
  e.headY = drawChar(e.x, y, e.look, o, t);
  if (resting) drawMug(Math.round(e.x) + 5, Math.round(e.y) - 7, idleMin > 15 ? 0 : 1, t);
}

// 카페인 폭주 중인 직원의 서류 더미에서 종이가 솟구쳤다가 흩날리며 떨어진다. 위치는 시간의 함수라서 따로 상태를 저장하지 않는다.
const PAPER_N = 8, PAPER_PERIOD = 1.5;
const PAPER_BASE = ['ooooooo', 'owwwwwo', 'owllllo', 'owwwwwo', 'owlllwo', 'owwwwwo', 'owllllo', 'owwwwwo', 'ooooooo'];
const PAPER_PAL = { o: 'rgba(75,52,48,.6)', w: '#fbf8ee', l: '#b9b29c' };
// 종이를 15도씩 돌린 열두 가지 모양을 미리 만든다. 종이는 180도 대칭이라 이 정도면 한 바퀴를 모두 표현한다.
const paperSpr = (k) => cached('paperRot' + k, () => {
  const c = document.createElement('canvas'); c.width = 13; c.height = 13;
  const g = c.getContext('2d'), a = k * 15 * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) {
    const vx = x + 0.5 - 6.5, vy = y + 0.5 - 6.5;
    const sx = Math.floor(vx * cs + vy * sn + 3.5), sy = Math.floor(-vx * sn + vy * cs + 4.5);
    const col = sx >= 0 && sx < 7 && sy >= 0 && sy < 9 ? PAPER_PAL[PAPER_BASE[sy][sx]] : null;
    if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
  }
  return c;
});
function drawPapers(d, e, t) {
  const sx = d.x + 51, sy = d.y + 25; // 서류 더미 윗면
  for (let i = 0; i < PAPER_N; i++) {
    const ph = (t + e.seed * 0.37) / PAPER_PERIOD + i / PAPER_N;
    const u = ((ph % 1) + 1) % 1, k = Math.floor(ph);                    // u: 한 장의 비행 진행도, k: 몇 번째 비행인지
    const dir = (((k * 7 + i * 5 + e.seed) % 7) - 3) / 3;                  // -1 ~ 1: 비행마다 날아가는 방향이 달라진다
    const peak = 26 + ((k + i) % 3) * 5;
    const x = sx + dir * 30 * u + Math.sin(u * 7 + i * 1.7) * 4;           // 좌우로 흔들리며 퍼진다
    const y = sy - peak * 4 * u * (1 - u) * (1 - 0.3 * u) + 14 * u * u;    // 포물선으로 솟았다가 천천히 내려앉는다
    const deg = t * 160 + i * 50 + u * 260;                                // 빙글빙글 돌면서 난다
    ctx.globalAlpha = Math.max(0, Math.min(1, u / 0.08, (1 - u) / 0.2));
    ctx.drawImage(paperSpr(Math.floor((((deg % 180) + 180) % 180) / 15) % 12), Math.round(x - 6.5), Math.round(y - 6.5));
  }
  ctx.globalAlpha = 1;
}
function frame(t) {
  ctx.imageSmoothingEnabled = false;
  const lights = [];
  drawRoom(t);
  drawDoor(door.open);
  const byDesk = new Map();
  for (const e of emps.values()) if (!e.leaving) byDesk.set(e.desk, e);
  const items = [];
  for (let i = 0; i < L.desks; i++) {
    const d = deskPos(i), owner = byDesk.get(i) || null;
    drawReclinerBack(d);
    items.push({ key: d.y + 30, fn: () => drawChairBack(d) });
    items.push({ key: d.y + 40, fn: () => drawDeskBlock(d, owner, t) });
    items.push({ key: d.y + 36.5, fn: () => drawReclinerFront(d) });
    if (owner && owner.data.status !== 'idle') lights.push({ x: d.x + 36, y: d.y + 18 });
  }
  for (const e of emps.values()) {
    if (e.x === -100) continue;
    const d = deskPos(e.desk);
    if (e.hot && e.phase === 'seated' && !e.walking && !e.leaving) items.push({ key: d.y + 41, fn: () => drawPapers(d, e, t) }); // 책상, 모니터, 리클라이너보다 앞
    items.push({ key: e.walking || e.leaving ? e.y + 2 : e.phase === 'rest' ? d.y + 36 : d.y + 34.5, fn: () => renderEmployee(e, t) });
  }
  items.sort((a, b) => a.key - b.key).forEach((i) => i.fn());
  drawMotes(t);
  drawNight(lights);
  drawText(t);
}

// ───────── 글자 레이어: 이름표와 말풍선 ─────────
const F = (w, px) => `${w} ${px}px ${FONT}`;
function fitText(text, maxW) {
  if (tx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && tx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
function rr(x, y, w, h, r) { tx.beginPath(); tx.roundRect(x, y, w, h, r); }
// 그림자가 있는 둥근 카드. 픽셀 외곽선과 어울리도록 얇은 어두운 테두리를 두른다.
function card(x, y, w, h, fill, r = 2.2) {
  tx.fillStyle = 'rgba(60,40,30,.28)'; rr(x, y + 0.9, w, h, r); tx.fill();
  tx.fillStyle = fill; rr(x, y, w, h, r); tx.fill();
  tx.strokeStyle = 'rgba(75,52,48,.85)'; tx.lineWidth = 0.55; rr(x + 0.27, y + 0.27, w - 0.54, h - 0.54, r); tx.stroke();
}
function bubble(x, topY, text, kind, blink) {
  const wait = kind === 'wait';
  // 도구 이름(Bash, Write 등)은 강조색으로 따로 그린다.
  const m = !wait && text.match(/^([A-Z][A-Za-z_]+)(?:\s+(.*))?$/);
  const tool = m ? m[1] : '', rest = m ? (m[2] || '') : text;
  tx.textBaseline = 'middle';
  tx.font = F(700, 4.9); const tw = tool ? tx.measureText(tool).width + 2.4 : 0;
  tx.font = F(600, 5.4); const body = fitText(rest, 74 - tw), bw = tx.measureText(body).width;
  const dot = 6, w = Math.ceil(dot + tw + bw + 5), h = 10.5;
  const bx = Math.round(Math.min(Math.max(2, x - w / 2), L.W - w - 2)), by = Math.round(topY - h - 4);
  card(bx, by, w, h, wait ? '#ffeaa8' : '#ffffff');
  // 꼬리
  const tx0 = Math.round(x);
  tx.fillStyle = wait ? '#ffeaa8' : '#ffffff'; tx.beginPath(); tx.moveTo(tx0 - 2, by + h - 0.3); tx.lineTo(tx0 + 2, by + h - 0.3); tx.lineTo(tx0, by + h + 2.2); tx.closePath(); tx.fill();
  tx.strokeStyle = 'rgba(75,52,48,.85)'; tx.lineWidth = 0.55; tx.beginPath(); tx.moveTo(tx0 - 2, by + h); tx.lineTo(tx0, by + h + 2.2); tx.lineTo(tx0 + 2, by + h); tx.stroke();
  tx.fillStyle = wait ? '#e08a00' : '#2fb36b'; tx.beginPath(); tx.arc(bx + 3.6, by + h / 2, 1.3, 0, Math.PI * 2); tx.fill();
  let cx = bx + dot;
  tx.textAlign = 'left';
  if (tool) { tx.font = F(700, 4.9); tx.fillStyle = '#2f8f83'; tx.fillText(tool, cx, by + h / 2 + 0.3); cx += tw; }
  tx.font = F(600, 5.4); tx.fillStyle = '#4b3430'; tx.fillText(body, cx, by + h / 2 + 0.3);
  if (blink) { tx.fillStyle = '#e5534b'; tx.beginPath(); tx.arc(bx + w, by, 2.6, 0, Math.PI * 2); tx.fill(); tx.fillStyle = '#fff'; tx.font = F(800, 4.2); tx.textAlign = 'center'; tx.fillText('!', bx + w, by + 0.3); tx.textAlign = 'left'; }
}
function tagLines(e) { return e.parent ? [e.parent.name, e.data.name] : [e.data.name]; }
function drawNameTag(d, e) {
  const lines = tagLines(e), W = 48, lh = 7.2, H = lines.length * lh + 1.4, x = d.x + 5, y = d.y + 35.6;
  const mine = parentColors.get(e.id), pc = e.parent ? parentColors.get(e.parent.sessionId) : null;
  card(x, y, W, H, mine || '#fff6e0', 2);
  tx.textBaseline = 'middle'; tx.textAlign = 'center';
  lines.forEach((ln, i) => {
    if (i === 0 && pc) { tx.fillStyle = pc; tx.save(); rr(x + 0.6, y + 0.6, W - 1.2, lh, 1.6); tx.clip(); tx.fillRect(x, y, W, lh + 0.6); tx.restore(); }
    const sub = e.parent && i === 0;
    tx.font = F(sub ? 600 : 700, sub ? 4.7 : 5.3); tx.fillStyle = sub ? '#7a6258' : '#4b3430';
    tx.fillText(fitText(ln, W - 5), x + W / 2, y + 0.7 + lh * (i + 0.5) + 0.2);
  });
  tx.textAlign = 'left';
}
function drawFullTag(e, d) {
  const lines = tagLines(e);
  tx.font = F(700, 5.3); tx.textBaseline = 'middle';
  const w = Math.max(...lines.map((s) => tx.measureText(s).width)) + 8, lh = 7.2, h = lines.length * lh + 2;
  const x = Math.min(Math.max(2, d.x + 29 - w / 2), L.W - w - 2), y = d.y + 35.6;
  card(x, y, w, h, '#4b3430', 2.2);
  tx.fillStyle = '#ffffff'; tx.textAlign = 'center';
  lines.forEach((s, i) => tx.fillText(s, x + w / 2, y + 1 + lh * (i + 0.5) + 0.2));
  tx.textAlign = 'left';
}
function drawText(t) {
  tx.setTransform(L.zoom * devicePixelRatio, 0, 0, L.zoom * devicePixelRatio, 0, 0);
  tx.clearRect(0, 0, L.W, L.H);
  for (const e of emps.values()) if (!e.leaving && e.x !== -100) drawNameTag(deskPos(e.desk), e);
  for (const e of emps.values()) {
    if (e.leaving || e.walking || e.headY === undefined || e.x === -100) continue;
    const st = e.data.status;
    if (e.surprise > 0) bubble(e.x, e.headY, '!', 'work', false);
    else if (st === 'busy' && e.data.activity) bubble(e.x, e.headY, e.data.activity, 'work', false);
    else if (st === 'waiting') {
      const long = Date.now() - (e.data.statusUpdatedAt || Date.now()) > 30000 && Math.floor(t) % 2 === 0;
      bubble(e.x, e.headY, waitingText(e.data.waitingFor), 'wait', long);
    }
  }
  if (hoverId && emps.has(hoverId)) { const e = emps.get(hoverId); drawFullTag(e, deskPos(e.desk)); }
}

// ───────── 루프와 크기 ─────────
let last = 0, lastDraw = 0;
function loop(ms) {
  requestAnimationFrame(loop);
  if (ms - lastDraw < 31) return; // 초당 30번까지만 그린다.
  const dt = Math.min(0.1, (ms - (last || ms)) / 1000); last = ms; lastDraw = ms;
  let near = false;
  for (const e of [...emps.values()]) { step(e, dt, ms); if (e.x !== -100 && (e.phase === 'enter' || e.leaving) && Math.hypot(e.x - L.doorX, e.y - L.corrY) < 40) near = true; }
  if (near) { door.idleFor = 0; door.open = Math.min(1, door.open + dt / 0.25); }
  else { door.idleFor += dt; if (door.idleFor > 0.6) door.open = Math.max(0, door.open - dt / 0.4); }
  frame(ms / 1000);
}

let layoutSig = '';
function resize() {
  computeLayout(Math.max(0, ...[...deskOf.values()].map((v) => v + 1)));
  const cw = Math.round(L.W * L.zoom), ch = Math.round(L.H * L.zoom);
  wrap.style.width = cw + 'px'; wrap.style.height = ch + 'px';
  cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
  // 크기가 실제로 바뀔 때만 캔버스를 다시 지정한다. 지정하면 내용이 지워져 깜빡인다.
  if (cv.width !== L.W || cv.height !== L.H) { cv.width = L.W; cv.height = L.H; }
  const dw = Math.round(cw * devicePixelRatio), dh = Math.round(ch * devicePixelRatio);
  if (tcv.width !== dw || tcv.height !== dh) { tcv.width = dw; tcv.height = dh; tcv.style.width = cw + 'px'; tcv.style.height = ch + 'px'; }
  const sig = `${L.leftCols}|${L.desks}|${L.zoom}|${L.offX}|${L.gx}|${L.rowPitch}`;
  if (sig !== layoutSig) {
    layoutSig = sig;
    // 배치가 바뀌면 이동 중이던 경로의 좌표도 낡으므로, 걷던 직원은 도착지로 옮기고 퇴근하던 직원은 내보낸다. 낡은 좌표로 걸으면 대각선으로 가로지르게 된다.
    for (const e of [...emps.values()]) {
      if (e.x === -100) continue;
      if (e.leaving) { emps.delete(e.id); deskOf.delete(e.id); continue; }
      if (e.path.length) { e.path = []; e.walking = false; if (e.phase === 'enter') { e.phase = e.data && e.data.status === 'idle' ? 'rest' : 'seated'; e.seated = true; } }
      const d = deskPos(e.desk), p = e.phase === 'rest' ? restPos(d) : seatPos(d); e.x = p.x; e.y = p.y;
    }
  }
  frame(performance.now() / 1000);
}
window.addEventListener('resize', resize);
// 전체화면 전환처럼 창 크기가 단계적으로 바뀔 때도 최종 크기에 맞추도록 화면 영역을 직접 감시한다.
new ResizeObserver(() => resize()).observe(stage);

function empAt(ev) {
  const r = cv.getBoundingClientRect(), x = (ev.clientX - r.left) / L.zoom, y = (ev.clientY - r.top) / L.zoom;
  let best = null;
  for (const e of emps.values()) {
    if (e.leaving || e.x === -100) continue;
    // 직원 본인과, 그 직원의 책상 구역(모니터, 책상, 리클라이너, 이름표 포함) 어디든 같은 대상으로 취급한다.
    const onBody = Math.abs(x - e.x) < 8 && y > e.y - 23 && y < e.y + 2;
    const d = deskPos(e.desk);
    const onDesk = x >= d.x - GUTTER && x < d.x - GUTTER + CELL_W && y >= d.y && y < d.y + CELL_H;
    if (onBody || onDesk) best = e;
  }
  return best;
}
tcv.addEventListener('mousemove', (ev) => { const e = empAt(ev), id = e ? e.id : null; if (id !== hoverId) { hoverId = id; onHover(id); } tcv.style.cursor = e ? 'pointer' : 'default'; });
tcv.addEventListener('mouseleave', () => { hoverId = null; onHover(null); });
tcv.addEventListener('click', (ev) => {
  const e = empAt(ev); if (!e) return;
  e.surprise = 1.2;
  const now = performance.now(); e.clickTimes = e.clickTimes.filter((x) => now - x < 1000); e.clickTimes.push(now);
  if (e.clickTimes.length >= 10) { e.sulk = 5; e.clickTimes = []; e.surprise = 0; } // 이스터에그: 1초 안에 10번 누르면 5초 동안 토라진다.
});
