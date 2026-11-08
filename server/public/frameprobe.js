// A stand-in for the 2D drawing context that draws nothing and only remembers what it was asked to draw, as a short signature.
// The scene is drawn once into it first. When the signature equals the previous frame's, the real drawing is skipped, because the picture would be identical,
// and an unchanged canvas costs the app and the GPU process almost nothing. Nothing here depends on the page, so the tests can run it directly.
//
// Anything the scene does that the signature cannot see must be reported with note(), or must make the signature differ:
// a call or a property this recorder does not know throws, and the caller then falls back to drawing every frame.
// The numbers given to images are shared by every recorder, so the same sprite has the same number in every frame.
const probeImageIds = new WeakMap();
let probeNextImageId = 1;
// Strings (colors and call names) are replaced by small numbers, so the signature does not have to read them one character at a time every frame.
const probeStringIds = new Map();
const probeStringId = (s) => { let id = probeStringIds.get(s); if (id === undefined) { id = probeStringIds.size + 1; probeStringIds.set(s, id); } return id; };
function createRecorder() {
  let h1 = 0x9e3779b9, h2 = 0x85ebca6b;
  // Every value is mixed in as a whole number. Numbers keep three decimals, which is more than any drawing call can show.
  const mix = (n) => {
    h1 = Math.imul(h1 ^ n, 2654435761); h1 ^= h1 >>> 15;
    h2 = Math.imul(h2 ^ n, 1597334677); h2 ^= h2 >>> 13;
  };
  const feed = (v) => {
    if (typeof v === 'number') mix(Number.isInteger(v) && v > -1e6 && v < 1e6 ? v * 8 + 1 : Math.round(v * 1000) * 8 + 2);
    else if (typeof v === 'string') mix(probeStringId(v) * 8 + 3);
    else if (v !== null && typeof v === 'object') mix(idOfImage(v) * 8 + 4);
    else mix(probeStringId(String(v)) * 8 + 5);
  };
  // Images (sprites and cached canvases) are told apart by identity, because their pixels never change once they are made.
  const idOfImage = (o) => { let id = probeImageIds.get(o); if (!id) { id = probeNextImageId++; probeImageIds.set(o, id); } return id; };
  const call = (name) => { const id = probeStringId(name) * 8 + 6; return (...args) => { mix(id); for (let i = 0; i < args.length; i++) feed(args[i]); mix(7); }; };
  const target = {
    probe: true, // the scene code uses this to avoid work that has no meaning for a recorder
    fillRect: call('fillRect'), drawImage: call('drawImage'), save: call('save'), restore: call('restore'), rect: call('rect'),
    clip: call('clip'), beginPath: call('beginPath'), translate: call('translate'), scale: call('scale'),
    set fillStyle(v) { mix(11); feed(v); },
    set globalAlpha(v) { mix(12); feed(v); },
    set imageSmoothingEnabled(v) { mix(13); feed(v); },
    // For things that change the picture without a call on this context, such as another canvas painted behind the scenes.
    note: (...args) => { mix(14); for (const a of args) feed(a); },
    signature: () => h1.toString(36) + '.' + h2.toString(36),
  };
  return new Proxy(target, {
    get(t, p) { if (!(p in t)) throw new Error(`frame probe: unknown member ${String(p)}`); return t[p]; },
    set(t, p, v) { if (!(p in t)) throw new Error(`frame probe: unknown property ${String(p)}`); t[p] = v; return true; },
  });
}
