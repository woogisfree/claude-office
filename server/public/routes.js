// 이동 경로 계산(순수 함수). 모든 경로는 가로나 세로 한 방향으로만 이어지며, 책상과 리클라이너를 가로지르지 않는다.
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

// 자리나 리클라이너에서 세로 통로로 나가는 경로. 어느 단계에서든 축을 따라서만 움직인다.
function exitRoute(d, s, fromRest, lastX) {
  const lane = laneY(d);
  return fromRest ? [{ x: lastX, y: lane }, { x: L.aisleX, y: lane }] : [{ x: sideX(d), y: s.y }, { x: sideX(d), y: lane }, { x: L.aisleX, y: lane }];
}

// 입장 중에 상태가 바뀌어 목적지(자리 또는 리클라이너)가 달라졌을 때, 자리까지 갔다가 되돌아가지 않고 지금 위치에서 옆길이나 아래 통로를 거쳐 바로 새 목적지로 향한다.
// 어느 위치에서든 책상과 리클라이너를 가로지르지 않고 축을 따라서만 움직인다.
function replanEntry(e) {
  const d = deskPos(e.desk), lane = laneY(d), sx = sideX(d), rx = d.x + 68;
  const tail = entryTail(e); // e.dest 를 현재 상태에 맞게 다시 정하고 옆길 입구 기준의 꼬리 경로를 돌려준다.
  const pts = [];
  if (Math.abs(e.y - lane) > 1) {
    if (Math.abs(e.x - sx) <= 1) pts.push({ x: sx, y: lane }); // 옆길 위: 아래 통로까지 내려간다.
    else if (Math.abs(e.x - rx) <= 1) { pts.push({ x: e.x, y: lane }); if (e.dest === 'seat') pts.push({ x: sx, y: lane }); } // 리클라이너로 들어가던 중: 아래 통로로 되돌아 나온다.
    else pts.push({ x: sx, y: e.y }, { x: sx, y: lane }); // 자리 쪽 가로 구간: 옆길로 나와 아래 통로까지 내려간다.
  } else if (e.dest === 'seat' && Math.abs(e.x - sx) > 1) {
    pts.push({ x: sx, y: lane }); // 아래 통로를 따라 가던 중: 옆길 입구로 되돌아간다.
  }
  e.path = pts.concat(tail);
}
