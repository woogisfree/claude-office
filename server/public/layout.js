// Layout constants, employee looks, and desk placement. No modules are used, so top-level variables are shared with the other scripts.
const $ = (s) => document.querySelector(s);
const cv = $('#office');
const ctx = cv.getContext('2d');
const stage = $('#stage');
const tcv = $('#text'); // Text is drawn on a separate high-resolution layer.
const tx = tcv.getContext('2d');

const CELL_W = 92, GUTTER = 12, CELL_H = 60, WALL_H = 70, CORR_H = 16, AISLE = 26, MARGIN = 8, MIN_DESKS = 20, RIGHT_COLS = 2;
const params = new URLSearchParams(location.search);
const ZOOMS = { small: 2, normal: 3, large: 4 };

let theme = params.get('theme') || 'office';
let baseZoom = Number(params.get('zoom')) || 3;
let fireThresholdK = 120; // thousands of weighted tokens per minute (see weightedTokens in server/lib/stats.mjs)
let hourOverride = params.has('hour') ? Number(params.get('hour')) : null;
let weatherOverride = params.has('weather') ? Number(params.get('weather')) : null;

window.setTheme = (t) => { theme = t; fetch('/api/theme', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: t }) }).catch(() => {}); resize(); };
window.setCity = (key) => fetch('/api/location', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ city: key }) }).then(() => window.pollSun && window.pollSun()).catch(() => {});
window.setZoom = (z) => { baseZoom = ZOOMS[z] || Number(z) || 3; resize(); };
window.setFireThreshold = (k) => { fireThresholdK = Number(k) || 120; };

// Local time in the selected city. Uses this computer's time when offsetSec (UTC offset in seconds) is missing.
function cityClock(nowMs, offsetSec) {
  const d = new Date(offsetSec === null || offsetSec === undefined ? nowMs : nowMs + offsetSec * 1000);
  const local = offsetSec === null || offsetSec === undefined;
  const h = local ? d.getHours() : d.getUTCHours(), m = local ? d.getMinutes() : d.getUTCMinutes(), s = local ? d.getSeconds() : d.getUTCSeconds();
  return { h, m, hour: h + m / 60 + s / 3600 };
}

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
  // The GUTTER at the left of each cell is an empty side path with no desk. Employees reach their seats only through it.
  const x = L.offX + MARGIN + GUTTER + (col < L.leftCols ? col * pitchX : L.leftCols * pitchX + AISLE + (col - L.leftCols) * pitchX);
  // Split the extra row spacing between the top and bottom margins so the first and last rows do not touch the wall or floor.
  const y = Math.round(L.top + row * L.rowPitch + (L.rowPitch - CELL_H) / 2);
  return { x, y, row, col };
}
const MAX_LEFT = 6;
function computeLayout(count) {
  const availW = Math.max(240, stage.clientWidth), availH = Math.max(200, stage.clientHeight);
  const widthOf = (lc) => 2 * MARGIN + lc * CELL_W + AISLE + RIGHT_COLS * CELL_W;
  let z = baseZoom;
  // Only reduce the zoom when it still overflows after shrinking the left group to 0 columns, and prefer integer zoom levels.
  if (widthOf(0) * z > availW) { z = Math.floor(availW / widthOf(0)); if (z < 1) z = availW / widthOf(0); }
  L.top = WALL_H + CORR_H;
  const metrics = (zz) => {
    const Wv = Math.floor(availW / zz), Hv = Math.floor(availH / zz); // virtual size that fills the window exactly
    const left = Math.max(0, Math.min(MAX_LEFT, Math.floor((Wv - 2 * MARGIN - AISLE - RIGHT_COLS * CELL_W) / CELL_W)));
    return { Wv, Hv, left };
  };
  let m = metrics(z);
  // If the sessions do not fit the window height, lower the zoom one step at a time to fit one screen. The minimum zoom is 2; scroll if it still overflows.
  while (z > 2 && L.top + Math.max(1, Math.ceil(count / (m.left + RIGHT_COLS))) * CELL_H + 16 > m.Hv) { z -= 1; m = metrics(z); }
  const { Wv, Hv, left } = m;
  L.zoom = z; L.leftCols = left; L.cols = left + RIGHT_COLS;
  // The row count follows the session count and window height. If everything fits, fill one screen without scrolling; scroll only on overflow.
  const fitRows = Math.max(1, Math.floor((Hv - L.top - 16) / CELL_H));
  L.rows = Math.max(Math.ceil(count / L.cols), fitRows);
  L.desks = L.rows * L.cols;
  // Spread leftover space as spacing between columns (up to 28) and rows (up to 1.5x) so the desks fill the screen.
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
