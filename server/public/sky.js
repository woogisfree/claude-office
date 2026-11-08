// Drawing primitives, the sky outside the window (skyline, sun and moon, weather), the wall clock, and night lighting.
const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
const lerp = (a, b, t) => a + (b - a) * t;
const hex = (c) => { if (c[0] !== '#') { const m = c.match(/\d+/g); return [+m[0], +m[1], +m[2]]; } return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; };
const mix = (a, b, t) => { const x = hex(a), y = hex(b); return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], t))).join(',')})`; };
function disc(g, cx, cy, r, c) { g.fillStyle = c; for (let dy = -r; dy <= r; dy++) { const dx = Math.floor(Math.sqrt(r * r - dy * dy + 0.5)); g.fillRect(Math.round(cx) - dx, Math.round(cy) + dy, dx * 2 + 1, 1); } }

const sunInfo = { sunrise: 6, sunset: 19, manual: false, ok: false, weather: 0, utcOffset: null };
try { Object.assign(sunInfo, JSON.parse(localStorage.getItem('office.sun') || '{}')); } catch {}

function currentHour() {
  if (hourOverride !== null) return hourOverride;
  return cityClock(Date.now(), sunInfo.utcOffset).hour;
}
const curWeather = () => (theme === 'xmas' ? 71 : weatherOverride !== null ? weatherOverride : sunInfo.weather || 0);
// Map a WMO weather code to the categories used on screen.
function weatherKind(code) {
  if (code === 0) return 'clear'; if (code <= 2) return 'partly'; if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog'; if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 51) return 'rain'; return 'clear';
}

const SKY_NIGHT = '#1a2352', SKY_DAWN = '#f7b58c', SKY_DAY = '#74c4ee';
function skyColor(h) {
  const { sunrise: sr, sunset: ss } = sunInfo, edge = 0.8;
  if (h < sr - edge || h > ss + edge) return SKY_NIGHT;
  if (h < sr) return mix(SKY_NIGHT, SKY_DAWN, (h - (sr - edge)) / edge);
  if (h < sr + edge) return mix(SKY_DAWN, SKY_DAY, (h - sr) / edge);
  if (h > ss) return mix(SKY_DAWN, SKY_NIGHT, (h - ss) / edge);
  if (h > ss - edge) return mix(SKY_DAY, SKY_DAWN, (h - (ss - edge)) / edge);
  return SKY_DAY;
}
const isDay = (h) => h >= sunInfo.sunrise && h <= sunInfo.sunset;
function nightLevel(h) { // 0 (day) to 1 (night)
  const { sunrise: sr, sunset: ss } = sunInfo, e = 0.8;
  if (h < sr - e || h > ss + e) return 1;
  if (h < sr) return 1 - (h - (sr - e)) / e;
  if (h > ss) return (h - ss) / e;
  return 0;
}

const CLOUD = ['......wwww............', '....wwwwwwww....ww....', '..wwwwwwwwwwww.wwww...', '.wwwwwwwwwwwwwwwwwwww.', 'wwwwwwwwwwwwwwwwwwwwww', 'ssswwwwwwwwwwwwwwwwsss', '.ssssssssssssssssssss.'];
const CLOUD_PAL = { day: { w: '#fffdf5', s: '#dfe8f4' }, dark: { w: '#9aa3b8', s: '#7a839a' }, night: { w: '#7782b4', s: '#5a6597' }, dusk: { w: '#ffe9d6', s: '#f2bfae' } };
const cloudImg = {};
const cloudSpr = (v) => cloudImg[v] || (cloudImg[v] = compile(CLOUD, CLOUD_PAL[v]));

// How far the sun has travelled (0 to 1) and whether it is day
function sunPos(hour) {
  const day = isDay(hour), span = day ? sunInfo.sunset - sunInfo.sunrise : 24 - (sunInfo.sunset - sunInfo.sunrise);
  const into = day ? hour - sunInfo.sunrise : hour >= sunInfo.sunset ? hour - sunInfo.sunset : hour + 24 - sunInfo.sunset;
  return { day, f: Math.min(1, Math.max(0, into / span)) };
}
const glowAt = (hour) => Math.max(0, 1 - Math.min(Math.abs(hour - sunInfo.sunrise), Math.abs(hour - sunInfo.sunset)) / 1.3);

function drawWindows(x0, w, y0, h, t) {
  ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip(); // The sky, clouds, and hills are visible only inside the window.
  const hour = currentHour(), kind = weatherKind(curWeather());
  const base = skyColor(hour), night = nightLevel(hour), glow = glowAt(hour);
  // Sky: 6px bands, darker at the top and fading to cream at the horizon.
  for (let i = 0, yy = y0; yy < y0 + h; i++, yy += 6) rect(x0, yy, w, Math.min(6, y0 + h - yy), night > 0.5 ? mix(base, '#3a4a8a', i * 0.1) : mix(base, glow > 0.2 ? '#ffd9b0' : '#fff6dc', i * 0.11));
  if (night > 0.4 && theme !== 'mine') for (let i = 0; i < 28; i++) { const sx = x0 + ((i * 53) % w), sy = y0 + ((i * 29) % (h - 16)); if ((Math.floor(t * 1.5) + i) % 7) { rect(sx, sy, 1, 1, '#fff6d0'); if (i % 6 === 0) { rect(sx - 1, sy, 3, 1, 'rgba(255,246,208,.5)'); rect(sx, sy - 1, 1, 3, 'rgba(255,246,208,.5)'); } } }
  // Sun and moon: they cross in an arc, with a soft glow around the sun.
  const { day, f } = sunPos(hour);
  const bx = x0 + 8 + f * (w - 16), by = y0 + h - 14 - Math.sin(f * Math.PI) * (h - 24);
  if (theme !== 'mine' && kind !== 'storm') {
    if (day) { disc(ctx, bx, by, 13, 'rgba(255,240,190,.16)'); disc(ctx, bx, by, 9, 'rgba(255,236,170,.22)'); disc(ctx, bx, by, 6, '#ffeaa0'); disc(ctx, bx, by, 5, '#ffd95a'); }
    else { disc(ctx, bx, by, 9, 'rgba(240,240,255,.12)'); disc(ctx, bx, by, 4, '#f7f3d6'); disc(ctx, bx + 2, by - 1, 3, skyColor(hour)); }
  }
  // Clouds: big puffy ones drifting very slowly (0.05px per second).
  const cv2 = kind === 'storm' || kind === 'rain' ? 'dark' : night > 0.5 ? 'night' : glow > 0.35 ? 'dusk' : 'day';
  const dim = kind === 'clear' ? 2 : kind === 'partly' ? 3 : 5;
  for (let i = 0; i < dim; i++) { const cx = x0 + ((i * 83 + t * 0.05) % (w + 30)) - 22; ctx.drawImage(cloudSpr(cv2), Math.round(cx), y0 + 3 + (i % 3) * 7); }
  // Two layers of hills, trees, and a small house
  const tint = (c, n) => mix(mix(c, n, night * 0.8), '#f2a572', glow * 0.22);
  const farC = tint('#9fd6a8', '#1f4560'), nearC = tint('#62ad6e', '#143347'), treeC = tint('#3f9060', '#0e2638'), treeHi = tint('#5fb078', '#17384c');
  for (let xx = x0; xx < x0 + w; xx++) {
    const hf = y0 + h - 17 - Math.round(Math.sin((xx - x0) * 0.04 + 1) * 4 + Math.sin((xx - x0) * 0.1) * 1.5);
    rect(xx, hf, 1, y0 + h - hf, farC);
  }
  const hx = x0 + Math.round(w * 0.72);
  rect(hx, y0 + h - 25, 9, 6, tint('#fbeed2', '#2a3150')); rect(hx - 1, y0 + h - 28, 11, 3, tint('#e0794a', '#3a2540')); rect(hx + 1, y0 + h - 29, 7, 1, tint('#e0794a', '#3a2540'));
  rect(hx + 3, y0 + h - 23, 3, 3, night > 0.4 ? '#ffd976' : tint('#8fb8d8', '#2a3150'));
  for (let xx = x0; xx < x0 + w; xx++) {
    const hn = y0 + h - 9 - Math.round(Math.sin((xx - x0) * 0.055 + 3) * 3 + Math.sin((xx - x0) * 0.13) * 1.2);
    rect(xx, hn, 1, y0 + h - hn, nearC);
  }
  for (let i = 0, xx = x0 + 12; xx < x0 + w - 8; i++, xx += 26 + (i % 3) * 9) {
    const ty = y0 + h - 12 - Math.round(Math.sin((xx - x0) * 0.055 + 3) * 3 + Math.sin((xx - x0) * 0.13) * 1.2);
    rect(xx, ty - 3, 2, 5, tint('#6a4a34', '#1a1a2a')); disc(ctx, xx + 1, ty - 7, 4, treeC); disc(ctx, xx, ty - 8, 2, treeHi);
  }
  if (night > 0.5 && theme !== 'mine') for (let i = 0; i < 5; i++) { const fx = x0 + 10 + ((i * 61 + Math.floor(t * 6) * (i + 1)) % (w - 20)), fy = y0 + h - 14 - ((i * 17 + Math.floor(t * 4)) % 12); if ((Math.floor(t * 2) + i) % 3) rect(fx, fy, 1, 1, '#d8f58a'); } // fireflies
  rect(x0, y0 + h - 4, w, 4, tint('#4c9a5c', '#0c2332'));
  if (kind === 'fog') { ctx.fillStyle = 'rgba(235,238,240,.55)'; ctx.fillRect(x0, y0, w, h); }
  if (kind === 'rain' || kind === 'storm') { ctx.fillStyle = '#b6d0f4'; for (let i = 0; i < 26; i++) ctx.fillRect(x0 + ((i * 37) % w), y0 + ((i * 53 + Math.floor(t * 60)) % h), 1, 3); }
  if (kind === 'snow') { ctx.fillStyle = '#fff'; for (let i = 0; i < 24; i++) ctx.fillRect(x0 + ((i * 41 + Math.floor(Math.sin(t + i) * 3) + w) % w), y0 + ((i * 29 + Math.floor(t * 14)) % h), 1, 1); }
  if (kind === 'storm' && Math.floor(t * 2) % 11 === 0) { ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(x0, y0, w, h); }
  if (theme === 'xmas') { rect(x0, y0 + h - 7, w, 3, '#eef4fa'); for (let xx = x0 + 4; xx < x0 + w - 8; xx += 20) { rect(xx, y0 + h - 11, 8, 6, '#8a4b3a'); rect(xx - 1, y0 + h - 13, 10, 2, '#f4f8fc'); rect(xx + 3, y0 + h - 9, 2, 2, '#ffd24a'); } }
  ctx.restore();
  // Window frame (warm wood color) and glass reflection
  const n = Math.max(2, Math.round(w / 56)), WD = '#8a5e3c', WL = '#b88458';
  for (let i = 0; i <= n; i++) { const mx = Math.round(x0 + (i * (w - 3)) / n); rect(mx, y0, 3, h, WD); rect(mx, y0, 1, h, WL); }
  rect(x0, y0 + Math.floor(h / 2) - 1, w, 2, WD);
  rect(x0, y0 - 2, w, 3, WD); rect(x0, y0 - 2, w, 1, WL);
  rect(x0 - 2, y0 + h, w + 4, 3, '#a8764c'); rect(x0 - 2, y0 + h, w + 4, 1, '#d6a273');
  ctx.fillStyle = 'rgba(255,255,255,.16)';
  for (let i = 0; i < n; i++) { const gx = Math.round(x0 + (i * (w - 3)) / n) + 8; for (let k = 0; k < 10; k++) ctx.fillRect(gx + k, y0 + 12 - k, 2, 1); }
  // Small plant pots on the windowsill
  for (let i = 0; i < n; i += 2) { const px = Math.round(x0 + (i * (w - 3)) / n) + 10; rect(px, y0 + h - 4, 5, 4, '#d98a5c'); rect(px + 1, y0 + h - 7, 1, 3, '#4f9a4f'); rect(px + 3, y0 + h - 8, 1, 4, '#5fb05f'); rect(px, y0 + h - 8, 2, 1, '#6bc36b'); rect(px + 3, y0 + h - 9, 2, 1, '#6bc36b'); }
}

function drawClock(cx, cy) {
  const c = cityClock(Date.now(), sunInfo.utcOffset), mine = theme === 'mine';
  disc(ctx, cx, cy, 8, OUT); disc(ctx, cx, cy, 7, mine ? '#4a2a22' : '#7a5a3c'); disc(ctx, cx, cy, 6, mine ? '#2a1010' : '#f6f1e4');
  rect(cx - 1, cy - 6, 1, 1, mine ? '#ff6a5a' : '#333'); rect(cx - 1, cy + 5, 1, 1, mine ? '#ff6a5a' : '#333'); rect(cx - 6, cy - 1, 1, 1, mine ? '#ff6a5a' : '#333'); rect(cx + 5, cy - 1, 1, 1, mine ? '#ff6a5a' : '#333');
  const hand = (ang, len, c) => { ctx.fillStyle = c; for (let i = 0; i <= len; i++) ctx.fillRect(Math.round(cx - 1 + Math.sin(ang) * i), Math.round(cy - 1 - Math.cos(ang) * i), 1, 1); };
  const col = mine ? '#ff5a4a' : '#2a2430';
  hand(((c.h % 12) + c.m / 60) / 12 * Math.PI * 2, 3, col);
  hand(c.m / 60 * Math.PI * 2, 5, col);
}

// At night, darken the room and light up only the lamp and monitor surroundings in stages.
let nightCanvas = null;
function drawNight(lights) {
  const lv = nightLevel(currentHour());
  if (lv <= 0 || theme === 'mine') return;
  if (ctx.probe) { ctx.note('night', lv, JSON.stringify(lights), L.win ? [L.win.x, L.win.y, L.win.w, L.win.h] : ''); return; } // the lights are painted on another canvas
  if (!nightCanvas) nightCanvas = document.createElement('canvas');
  if (nightCanvas.width !== L.W || nightCanvas.height !== L.H) { nightCanvas.width = L.W; nightCanvas.height = L.H; }
  const n = nightCanvas.getContext('2d');
  n.globalCompositeOperation = 'source-over';
  n.clearRect(0, 0, L.W, L.H);
  n.fillStyle = `rgba(10,14,48,${0.46 * lv})`;
  n.fillRect(0, 0, L.W, L.H);
  n.globalCompositeOperation = 'destination-out';
  // Clear the darkness over the window so the night sky outside stays vivid.
  if (L.win) { n.fillStyle = 'rgba(0,0,0,.92)'; n.fillRect(L.win.x - 2, L.win.y - 2, L.win.w + 4, L.win.h + 5); }
  for (const p of lights) for (const [r, a] of [[30, 0.2], [22, 0.25], [14, 0.3]]) disc(n, p.x, p.y, r, `rgba(0,0,0,${a})`);
  ctx.drawImage(nightCanvas, 0, 0);
}
