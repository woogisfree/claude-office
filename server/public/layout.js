// 배치 상수, 직원 생김새, 책상 배치. 모듈을 쓰지 않으므로 최상위 변수를 다른 스크립트와 공유한다.
const $ = (s) => document.querySelector(s);
const cv = $('#office');
const ctx = cv.getContext('2d');
const stage = $('#stage');
const tcv = $('#text'); // 글자는 고해상도 레이어에 따로 그린다.
const tx = tcv.getContext('2d');

const CELL_W = 92, GUTTER = 12, CELL_H = 60, WALL_H = 70, CORR_H = 16, AISLE = 26, MARGIN = 8, MIN_DESKS = 20, RIGHT_COLS = 2;
const params = new URLSearchParams(location.search);
const ZOOMS = { small: 2, normal: 3, large: 4 };

let theme = params.get('theme') || 'office';
let baseZoom = Number(params.get('zoom')) || 3;
let fireThresholdK = 200; // 분당 k 토큰
let hourOverride = params.has('hour') ? Number(params.get('hour')) : null;
let weatherOverride = params.has('weather') ? Number(params.get('weather')) : null;

window.setTheme = (t) => { theme = t; fetch('/api/theme', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: t }) }).catch(() => {}); resize(); };
window.setZoom = (z) => { baseZoom = ZOOMS[z] || Number(z) || 3; resize(); };
window.setFireThreshold = (k) => { fireThresholdK = Number(k) || 200; };

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const SKINS = ['#f6d5b4', '#e8b88a', '#cf9768', '#9a6444', '#fbe0c8'];
const HAIRS = ['#3a2a22', '#6a4328', '#b8742f', '#e0bf6a', '#5a5f70', '#b8564f'];
const SHIRTS = ['#7fa6d6', '#e48a8a', '#8cc59a', '#b79ae0', '#efb45f', '#6cc0c4', '#b5ad9c'];
const PROPS = ['none', 'cap', 'beanie', 'phones', 'glasses', 'shades'];
function look(id) {
  const h = hash(id);
  return { skin: SKINS[h % 5], hair: HAIRS[(h >>> 3) % 6], shirt: SHIRTS[(h >>> 6) % 7], prop: PROPS[(h >>> 9) % 6], elf: (h >>> 12) % 360 };
}

const L = { gx: 0, rowPitch: 60, offX: 0, cw: 0, zoom: 2.5, leftCols: 1, cols: 3, rows: 7, desks: 21, W: 0, H: 0, aisleX: 0, doorX: 0, corrY: 0, top: 0 };
function deskPos(i) {
  const row = Math.floor(i / L.cols), col = i % L.cols, pitchX = CELL_W + L.gx;
  // 칸 왼쪽 GUTTER만큼은 책상 없이 비워 둔 옆길이다. 직원은 이 길로만 자리에 드나든다.
  const x = L.offX + MARGIN + GUTTER + (col < L.leftCols ? col * pitchX : L.leftCols * pitchX + AISLE + (col - L.leftCols) * pitchX);
  // 줄 간격이 늘어난 만큼 위아래 여백도 반씩 나눠 첫 줄과 마지막 줄이 벽과 바닥에 붙지 않게 한다.
  const y = Math.round(L.top + row * L.rowPitch + (L.rowPitch - CELL_H) / 2);
  return { x, y, row, col };
}
const MAX_LEFT = 6;
function computeLayout(count) {
  const availW = Math.max(240, stage.clientWidth), availH = Math.max(200, stage.clientHeight);
  const widthOf = (lc) => 2 * MARGIN + lc * CELL_W + AISLE + RIGHT_COLS * CELL_W;
  let z = baseZoom;
  // 왼쪽 묶음을 0열까지 줄여도 넘칠 때만 배율을 줄인다. 줄일 때도 가능하면 정수 배율로 맞춘다.
  if (widthOf(0) * z > availW) { z = Math.floor(availW / widthOf(0)); if (z < 1) z = availW / widthOf(0); }
  L.top = WALL_H + CORR_H;
  const metrics = (zz) => {
    const Wv = Math.floor(availW / zz), Hv = Math.floor(availH / zz); // 창을 빈틈없이 채우는 가상 크기
    const left = Math.max(0, Math.min(MAX_LEFT, Math.floor((Wv - 2 * MARGIN - AISLE - RIGHT_COLS * CELL_W) / CELL_W)));
    return { Wv, Hv, left };
  };
  let m = metrics(z);
  // 세션이 창 높이에 다 들어가지 않으면 배율을 한 단계씩 줄여 한 화면에 담는다. 최소 배율은 2이고, 그래도 넘치면 스크롤한다.
  while (z > 2 && L.top + Math.max(1, Math.ceil(count / (m.left + RIGHT_COLS))) * CELL_H + 16 > m.Hv) { z -= 1; m = metrics(z); }
  const { Wv, Hv, left } = m;
  L.zoom = z; L.leftCols = left; L.cols = left + RIGHT_COLS;
  // 줄 수는 세션 수와 창 높이에 맞춘다. 세션이 창에 다 들어가면 스크롤 없이 한 화면을 채우고, 넘칠 때만 스크롤한다.
  const fitRows = Math.max(1, Math.floor((Hv - L.top - 16) / CELL_H));
  L.rows = Math.max(Math.ceil(count / L.cols), fitRows);
  L.desks = L.rows * L.cols;
  // 남는 공간은 열 사이(최대 28)와 줄 사이(최대 1.5배)의 간격으로 나눠 책상을 화면에 맞게 퍼뜨린다.
  L.W = Math.max(Wv, widthOf(left));
  L.gx = Math.max(0, Math.min(28, Math.floor((L.W - widthOf(left)) / L.cols)));
  L.cw = widthOf(left) + L.gx * L.cols;
  L.offX = Math.floor((L.W - L.cw) / 2);
  const baseH = L.top + L.rows * CELL_H + 16;
  L.rowPitch = baseH < Hv ? Math.floor(Math.min(CELL_H * 1.5, (Hv - L.top - 16) / L.rows)) : CELL_H;
  L.H = Math.max(L.top + L.rows * L.rowPitch + 16, Hv);
  L.aisleX = L.offX + MARGIN + left * (CELL_W + L.gx) + AISLE / 2;
  L.doorX = L.offX + L.cw - MARGIN - 20;
  L.corrY = WALL_H + CORR_H / 2;
}
