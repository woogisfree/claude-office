// Route calculation (pure functions). Every route follows horizontal or vertical segments only and never crosses a desk or recliner.
const seatPos = (d) => ({ x: d.x + 11, y: d.y + 34 });
const restPos = (d) => ({ x: d.x + 68, y: d.y + 36 });
// The horizontal lane across the empty floor below a desk row. All movement uses this lane and the vertical aisle so nobody crosses a desk, monitor, or chair.
const laneY = (d) => d.y + CELL_H - 4;
const sideX = (d) => d.x - GUTTER / 2; // middle of the side path left of the desk
// To leave the seat (behind the desk), go down the left side path and follow the lower lane to the recliner. The desk is never crossed.
const restRoute = (d) => [{ x: sideX(d), y: seatPos(d).y }, { x: sideX(d), y: laneY(d) }, { x: d.x + 68, y: laneY(d) }, restPos(d)];
const doorPos = () => ({ x: L.doorX, y: WALL_H - 2 });

// The first part of the entry route. On reaching the side path entrance on the lower lane (the decide point), the current status decides whether to go to the seat or the recliner.
function entryPath(e) {
  const d = deskPos(e.desk), lane = laneY(d);
  return [{ x: L.doorX, y: L.corrY }, { x: L.aisleX, y: L.corrY }, { x: L.aisleX, y: lane }, { x: sideX(d), y: lane, decide: true }];
}
function entryTail(e) {
  const d = deskPos(e.desk), s = seatPos(d), lane = laneY(d);
  e.dest = e.data && e.data.status === 'idle' ? 'rest' : 'seat';
  return e.dest === 'rest' ? [{ x: d.x + 68, y: lane }, restPos(d)] : [{ x: sideX(d), y: s.y }, s];
}

// The route from the seat or recliner out to the vertical aisle. Movement always follows an axis.
function exitRoute(d, s, fromRest, lastX) {
  const lane = laneY(d);
  return fromRest ? [{ x: lastX, y: lane }, { x: L.aisleX, y: lane }] : [{ x: sideX(d), y: s.y }, { x: sideX(d), y: lane }, { x: L.aisleX, y: lane }];
}

// When the status changes during entry and the destination (seat or recliner) changes, head straight to the new destination from the current position via the side path or lower lane instead of walking to the seat and back.
// From any position, move along axes only and never cross the desk or recliner.
function replanEntry(e) {
  const d = deskPos(e.desk), lane = laneY(d), sx = sideX(d), rx = d.x + 68;
  const tail = entryTail(e); // Re-decides e.dest from the current status and returns the tail route starting at the side path entrance.
  const pts = [];
  if (Math.abs(e.y - lane) > 1) {
    if (Math.abs(e.x - sx) <= 1) pts.push({ x: sx, y: lane }); // On the side path: go down to the lower lane.
    else if (Math.abs(e.x - rx) <= 1) { pts.push({ x: e.x, y: lane }); if (e.dest === 'seat') pts.push({ x: sx, y: lane }); } // On the way into the recliner: come back out to the lower lane.
    else pts.push({ x: sx, y: e.y }, { x: sx, y: lane }); // On the horizontal leg to the seat: step out to the side path and down to the lower lane.
  } else if (e.dest === 'seat' && Math.abs(e.x - sx) > 1) {
    pts.push({ x: sx, y: lane }); // Walking along the lower lane: return to the side path entrance.
  }
  e.path = pts.concat(tail);
}
