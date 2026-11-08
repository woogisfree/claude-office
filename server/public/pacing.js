// Frame pacing: how often the office is drawn. The frame rate follows what is moving, and the loop sleeps between frames.
// Every frame costs the app and the GPU process about the same, so a calm office should not be drawn at 30 frames per second.
// This file has no dependency on the page, so the tests can run it with a simulated clock.
const FPS_FAST = 30, FPS_MID = 15, FPS_CALM = 10;

// Walking, the door, and caffeine-rush shaking need 30 to look smooth. Typing, falling rain, and flames look fine at 15.
// When everyone is resting, the room changes only in small steps (a blinking cursor, a bouncing logo), so 10 is enough.
// `lively` is true for a scene with constant motion of its own (rain, snow, or the mine and Christmas themes).
function chooseFps({ doorOpen, lively, employees }) {
  if (doorOpen > 0) return FPS_FAST;
  let mid = lively;
  for (const e of employees) {
    if (e.phase === 'enter' || e.leaving || e.walking || e.path.length || e.surprise > 0 || e.sulk > 0 || e.hot) return FPS_FAST;
    if (e.data && e.data.status === 'busy') mid = true;
  }
  return mid ? FPS_MID : FPS_CALM;
}

// Calls draw(ms) at the rate fps() asks for. raf, setTimer, clearTimer, and hidden are passed in so a test can replace them.
function createPacer({ fps, draw, raf, setTimer, clearTimer, hidden }) {
  let lastDraw = 0, rafQueued = false, timer = 0;
  // A frame is due a little before the exact interval, so a display refresh that falls just short does not cost a whole extra display frame.
  const gap = () => 1000 / fps() - 3;
  // At most one animation frame or timer is queued at a time, so starting the loop again never doubles it.
  function queue(wait = 0) {
    if (rafQueued) return;
    // A long wait uses a timer, so the page is not woken at the display rate only to find that nothing is due.
    if (wait > 24) { if (!timer) timer = setTimer(() => { timer = 0; queue(); }, wait - 12); return; }
    rafQueued = true;
    raf((ms) => { rafQueued = false; tick(ms); });
  }
  function tick(ms) {
    if (hidden()) return; // the loop is started again by wake() when the page is shown
    const g = gap();
    if (ms - lastDraw < g) { queue(g - (ms - lastDraw)); return; }
    lastDraw = ms;
    draw(ms);
    queue(gap());
  }
  // Draws the next frame as soon as possible, for changes the user should see at once (hover, a click, the time slider).
  function wake() {
    lastDraw = 0;
    if (timer) { clearTimer(timer); timer = 0; }
    queue();
  }
  return { queue, wake };
}
