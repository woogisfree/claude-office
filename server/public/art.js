// Pixel sprites: drawn as ASCII maps, compiled to cached canvases. Employees combine a head, torso, and legs.
const OUT = '#4b3430';
const shadeHex = (c, f) => { const [r, g, b] = hex(c); const k = (v) => Math.max(0, Math.min(255, Math.round(v * f))); return `rgb(${k(r)},${k(g)},${k(b)})`; };

function compile(rows, pal) {
  const w = Math.max(...rows.map((r) => r.length));
  const c = document.createElement('canvas'); c.width = w; c.height = rows.length;
  const g = c.getContext('2d');
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) { const col = pal[r[x]]; if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); } } });
  return c;
}

const HEAD = {
  front: [
    '...oooooo...', '..ohhHhhho..', '.ohHHhhhhho.', '.ohhsssshho.', '.osesssseso.',
    '.osssssssso.', '.osssmmssso.', '..osssssso..', '...oooooo...',
  ],
  back: [
    '...oooooo...', '..ohhHhhho..', '.ohHHhhhhho.', '.ohhhhhhhho.', '.ohhhhhhhho.',
    '.ohhhhhhhho.', '.ohhhhhhhho.', '..osssssso..', '...oooooo...',
  ],
  side: [
    '...oooooo...', '..ohhHhhho..', '.ohHHhhhhho.', '.ohhhhhhsso.', '.ohhhhhsseso',
    '.ohhhhhsssso', '.ohhhhhssmso', '..ohhhhsso..', '...oooooo...',
  ],
};
const TORSO = {
  front: ['.occcccccco.', 'occcccccccco', 'occcccccccco', 'osccccccccso', 'ossCCCCCCsso', '.oppppppppo.', '.oppppppppo.'],
  side: ['..occcccco..', '..occcccco..', '..osccccco..', '..osccccco..', '..osCCCCCo..', '..oppppppo..', '..oppppppo..'],
};
TORSO.back = TORSO.front.map((r) => r.replace(/s/g, 'c'));
// While typing, the hands at the torso's sides become flat 2-pixel bars that alternate down one step at a time. typeL is the left hand down.
const TORSO_TYPE = (() => {
  const base = ['.occcccccco.', 'occcccccccco', 'occcccccccco', 'occcccccccco', 'occCCCCCCcco', '.oppppppppo.', '.oppppppppo.'];
  const make = (ly, ry) => { const rows = base.map((r) => r.split('')); [1, 2].forEach((x) => { rows[ly][x] = 's'; }); [9, 10].forEach((x) => { rows[ry][x] = 's'; }); return rows.map((r) => r.join('')); };
  return { typeL: make(4, 3), typeR: make(3, 4) };
})();

const LEGS = {
  front: {
    idle: ['.opppoopppo.', '.opppoopppo.', '.opppoopppo.', '.opppoopppo.', '.okkkookkko.'],
    a: ['.opppoopppo.', '.opppoopppo.', '.opppoopppo.', '.okkkoopppo.', '......okkko.'],
    b: ['.opppoopppo.', '.opppoopppo.', '.opppoopppo.', '.opppookkko.', '.okkko......'],
  },
  side: {
    idle: ['...oppppo...', '...oppppo...', '...oppppo...', '...oppppo...', '...okkkkko..'],
    a: ['...oppppo...', '..opppoppo..', '.oppo..oppo.', '.oppo..oppo.', '.okko..okkko'],
    b: ['...oppppo...', '...oppppo...', '...oppppo...', '...oppppo...', '...okkkkko..'],
  },
};
LEGS.back = LEGS.front;

const HATS = {
  cap: ['...oooooo...', '..obbbbbbo..', '.obbbbbbbbo.', '.oBBBBBBBBoo'],
  beanie: ['....orro....', '..orrrrrro..', '.orrrrrrrro.', '.oRRRRRRRRo.'],
  xmas: ['......rrww..', '...rrrrrrw..', '..orrrrrrro.', '.owwwwwwwwo.'],
  miner: ['....wyy.....', '..oyyyyyyo..', '.oyyyyyyyyo.', '.oYYYYYYYYo.'],
  party: ['......y.....', '.....vvv....', '....vvwvv...', '...vvvvvvv..'],
  phones: ['...gggggg...', '..g......g..', '.gg......gg.', '.gg......gg.'],
  glasses: ['............', '............', '............', '..ggg..ggg..', '..g.g..g.g..', '..ggg..ggg..'],
  shades: ['............', '............', '............', '............', '..gggggggg..', '...gg..gg...'],
};
const ARM_UP = ['oso', 'sss', 'oso', 'oso', 'oso', 'oso', 'oso', 'oso'];

const spriteCache = new Map();
function cached(key, make) { let v = spriteCache.get(key); if (!v) { v = make(); spriteCache.set(key, v); } return v; }
function lookPal(lk) {
  return {
    o: OUT, h: lk.hair, H: shadeHex(lk.hair, 1.35), s: lk.skin, S: shadeHex(lk.skin, 0.85), e: '#3a2a2a', m: '#b4635a',
    c: lk.shirt, C: shadeHex(lk.shirt, 0.78), p: '#5a5f82', P: '#474c6c', k: '#3a2a2a', w: '#ffffff', g: '#3a3f4d',
    b: '#2f6ad0', B: '#2456a8', r: '#d03a3a', R: '#a82e2e', y: '#f2c94c', Y: '#c9a23a', v: '#e86ac8',
  };
}
const spr = (kind, dir, name, lk, pal) => cached(`${kind}|${dir}|${name}|${lk.hair}|${lk.skin}|${lk.shirt}`, () => {
  const src = kind === 'head' ? HEAD[dir] : kind === 'torso' ? (TORSO_TYPE[name] || TORSO[dir]) : LEGS[dir][name];
  return compile(src, pal);
});
const hatSpr = (name, pal) => cached('hat|' + name, () => compile(HATS[name], pal));

// Typing rhythm: true means the left hand is down. The hands (art.js) and the key flash (office.js) share this function, so they always match.
// Alternates 5 times per second normally and 9 times per second in a caffeine rush, with a slowly drifting beat so it looks like a person typing, not a machine.
// The seed offsets each employee's start so they do not all type in unison.
function typingLeft(t, fast, seed = 0) {
  const tt = t + seed * 0.31, hz = fast ? 9 : 5;
  const ph = Math.floor(tt * hz + 0.45 * Math.sin(tt * 2.3) + 0.3 * Math.sin(tt * 5.1));
  return ((ph % 2) + 2) % 2 === 0;
}

// Draw one employee. (x, y) is the bottom center of the feet. Returns the y coordinate above the head.
function drawChar(x, y, lk, o, t) {
  const dir = o.facing || 'front';
  const pal = lookPal(lk);
  if (o.shirt) { pal.c = o.shirt; pal.C = shadeHex(o.shirt, 0.78); }
  const step = o.walking ? Math.floor(t * 6) % 4 : -1;
  const legName = step < 0 ? 'idle' : step === 0 ? 'a' : step === 2 ? 'b' : 'idle';
  const bob = o.walking && step % 2 === 1 ? 1 : 0;
  const jx = o.jitter && Math.floor(t * 7) % 2 ? 1 : 0; // Even in a rush, shake only 1px about 3.5 times per second.
  const px = Math.round(x) - 6 + jx, py = Math.round(y) - 21 + bob + (o.sit ? 6 : 0); // When sitting, the body sinks into the chair.
  const flip = o.flip && dir === 'side';
  const put = (img, dx, dy) => {
    if (flip) { ctx.save(); ctx.translate(Math.round(x) * 2 + jx * 2, 0); ctx.scale(-1, 1); ctx.drawImage(img, px + dx, py + dy); ctx.restore(); }
    else ctx.drawImage(img, px + dx, py + dy);
  };
  const lSpr = spr('legs', dir, legName, lk, pal);
  if (!o.sit) put(lSpr, 0, 16); // When sitting, the legs are hidden behind the cushion.
  const typeFrame = o.typing && dir === 'front' ? (typingLeft(t, o.fast, o.seed) ? 'typeL' : 'typeR') : '';
  put(spr('torso', dir, typeFrame, lk, pal), 0, 9);
  put(spr('head', dir, '', lk, pal), 0, 0);
  // Props and hats
  const hat = o.hat || (lk.prop === 'cap' || lk.prop === 'beanie' ? lk.prop : null);
  if (hat) put(hatSpr(hat, pal), 0, 0);
  if (!o.hat) {
    if (lk.prop === 'phones') put(hatSpr('phones', pal), 0, 0);
    if (dir === 'front' && lk.prop === 'glasses') put(hatSpr('glasses', pal), 0, 0);
    if (dir === 'front' && lk.prop === 'shades') put(hatSpr('shades', pal), 0, 0);
  }
  if (o.wide && dir === 'front') { ctx.fillStyle = '#fff'; ctx.fillRect(px + 3, py + 4, 1, 1); ctx.fillRect(px + 8, py + 4, 1, 1); }
  if (o.sleepy && dir === 'front') { ctx.fillStyle = lk.skin; ctx.fillRect(px + 3, py + 4, 1, 1); ctx.fillRect(px + 8, py + 4, 1, 1); ctx.fillStyle = '#20202a'; ctx.fillRect(px + 3, py + 5, 1, 1); ctx.fillRect(px + 8, py + 5, 1, 1); }
  if (o.hand) put(cached('armup|' + lk.shirt, () => compile(ARM_UP, pal)), 11, 3 - 1);
  if (o.sweat) { const d = Math.floor(t * 4) % 5; ctx.fillStyle = '#7fd0ff'; ctx.fillRect(px + 10, py + 3 + d, 1, 2); }
  if (o.fire) { for (let i = 0; i < 3; i++) { ctx.fillStyle = ['#ff5a2a', '#ff9a2a', '#ffd24a'][i]; ctx.fillRect(px + 1 + i * 4, py - 2 - ((Math.floor(t * 10) + i) % 3), 2, 3 - (i % 2)); } }
  return py; // top of the head
}
