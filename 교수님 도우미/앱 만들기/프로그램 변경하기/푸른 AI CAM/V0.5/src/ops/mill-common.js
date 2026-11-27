/* =====================================================================
 * 푸른 AI CAM - [가공 모듈 공통: 밀링 경로] ops/mill-common.js  (V0.5)
 * 역할: 엔드밀·페이스밀·모따기 공구의 절삭 조건과 경로 조각(헬리컬·램프 진입, 루프, 연결)을
 *       포켓(자유 형상)·외곽 윤곽·평면·모따기 모듈이 함께 쓴다.
 * 안전 원칙 (결정적 계산, AI 미사용)
 *   - 깎이지 않은 소재로 수직 하강하지 않는다: 진입은 헬리컬(공간이 있을 때) 또는
 *     윤곽을 따라 3° 경사로 내려가는 램프. 수직 하강은 이미 깎인 곳(위 단)이나 소재 밖에서만.
 *   - 단과 단 사이·윤곽 사이 연결은 허용 영역 안의 짧은 직선만 절삭 높이에서 이동하고,
 *     그 밖에는 R점 높이로 올라가 다시 진입한다.
 * 의존: engine/*, engine/geom.js
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM, G = P.GEOM;
  const { MATERIALS, toNum, r3 } = P;
  const RAMP_DEG = 3, TAN = Math.tan(RAMP_DEG * Math.PI / 180);

  /* ---------- 절삭 조건 ---------- */
  const mat = k => MATERIALS[k] || MATERIALS.S45C;
  // kind: 'rough' | 'finish' | 'face' | 'chamfer'
  function ref(tool, matKey, kind) {
    const m = mat(matKey), carb = tool.mat === 'CARBIDE', D = toNum(tool.dia, 1);
    let vc = carb ? m.emCarb : m.emHss, fz;
    if (kind === 'face') { vc *= carb ? 1.2 : 1; fz = 0.1 * m.fFactor; }
    else if (kind === 'chamfer') fz = Math.min(0.04, Math.max(0.01, 0.003 * D)) * m.fFactor;
    else fz = Math.min(0.08, Math.max(0.01, 0.005 * D)) * m.fFactor * (kind === 'finish' ? 0.7 : 1);
    return { vc, fpr: fz * Math.max(1, toNum(tool.z, kind === 'face' ? 5 : 3)), fz };
  }
  function recommend(kind) {
    return function (tool, matKey, machine) {
      const rf = ref(tool, matKey, kind);
      let rpm = Math.max(10, Math.round(rf.vc * 1000 / (Math.PI * tool.dia) / 10) * 10), limited = false;
      if (rpm > machine.maxRpm) { rpm = Math.floor(machine.maxRpm / 10) * 10; limited = true; }
      let feed = Math.max(1, Math.round(rpm * rf.fpr));
      if (feed > machine.maxFeed) { feed = machine.maxFeed; limited = true; }
      return { rpm, feed, limited };
    };
  }
  // 깊이 단: 황삭은 (깊이 − 바닥 여유)를 절입 이하로 균등 분할, 정삭은 최종 깊이 1단
  function levels(depth, af, sd, finish) {
    if (finish) return [-depth];
    const total = depth - af, n = Math.max(1, Math.ceil(total / Math.max(0.05, sd) - 1e-9)), out = [];
    for (let i = 1; i <= n; i++) out.push(-total * i / n);
    return out;
  }

  /* ---------- 경로 조립 ---------- */
  function builder() {
    const M = [];
    let cur = null;
    const api = {
      M,
      get cur() { return cur; },
      push(g, x, y, z, f, ij) { const mv = Object.assign({ g, x: r3(x), y: r3(y), z: r3(z), f }, ij || {}); if (cur && g === 1 && mv.x === cur.x && mv.y === cur.y && mv.z === cur.z) return; M.push(mv); cur = mv; },
      // 헬리컬: 중심 (cx, cy), 반경 rh, zFrom → zTo, 마지막에 바닥 1회전 (G03, 반시계)
      helix(cx, cy, rh, zFrom, zTo, Fr, F, maxPitch) {
        const per = Math.max(0.05, Math.min(maxPitch || 1, 2 * Math.PI * rh * TAN));
        const turns = Math.max(1, Math.ceil((zFrom - zTo) / per - 1e-9));
        for (let k = 1; k <= turns; k++) api.push(3, cx + rh, cy, zFrom - (zFrom - zTo) * k / turns, Fr, { i: r3(-rh), j: 0 });
        api.push(3, cx + rh, cy, zTo, F, { i: r3(-rh), j: 0 });
      },
      // 램프: 닫힌 윤곽 pts 를 따라 경사 3° 로 zFrom → zTo, 도달 후 시작점까지 한 바퀴 마저 이동
      ramp(pts, zFrom, zTo, Fr) {
        let z = zFrom, i = 0, guard = 0;
        const n = pts.length;
        while (z > zTo + 1e-9 && guard++ < 200000) {
          const a = pts[i % n], b = pts[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const zn = Math.max(zTo, z - L * TAN);
          if (zn <= zTo && L > 1e-9) { // 이 선분 중간에서 바닥 도달
            const t = (z - zTo) / (L * TAN);
            api.push(1, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, zTo, Fr);
          }
          api.push(1, b[0], b[1], zn, Fr); z = zn; i++;
        }
        // 시작점(인덱스 0)까지 돌아감
        while (i % n !== 0) { i++; const b = pts[i % n]; api.push(1, b[0], b[1], zTo, Fr); }
      },
      loop(pts, z, F) { for (let k = 1; k <= pts.length; k++) { const b = pts[k % pts.length]; api.push(1, b[0], b[1], z, F); } }
    };
    return api;
  }
  // 닫힌 윤곽을 (x, y) 에 가장 가까운 점에서 시작하도록 회전 (그 점을 새 꼭짓점으로 넣음)
  function rotateAt(pts, x, y) {
    let best = 0, bd = Infinity, bp = null;
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
      let t = L2 > 0 ? ((x - a[0]) * vx + (y - a[1]) * vy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const px = a[0] + t * vx, py = a[1] + t * vy, d = Math.hypot(px - x, py - y);
      if (d < bd) { bd = d; best = i; bp = [px, py, t]; }
    }
    const n = pts.length, out = [];
    const start = bp[2] >= 1 - 1e-9 ? (best + 1) % n : best;
    if (bp[2] > 1e-9 && bp[2] < 1 - 1e-9) { out.push([bp[0], bp[1]]); for (let k = 1; k <= n; k++) out.push(pts[(best + k) % n]); }
    else for (let k = 0; k < n; k++) out.push(pts[(start + k) % n]);
    return { pts: out, dist: bd };
  }
  // 선분이 허용 영역(Clipper 경로) 안에 있는지 0.3mm 간격 검사
  function segInside(paths, x0, y0, x1, y1) {
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L / 0.3));
    for (let k = 0; k <= n; k++) { const t = k / n; if (!G.inPaths(paths, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false; }
    return true;
  }
  // 영역(ExPolygon) 안에서 가장 넓게 비어 있는 점 근사 (헬리컬 중심용): 격자 탐색
  function bestCenter(ex) {
    const paths = G.exPaths(ex), pl = paths.map(G.fromPath), bb = G.bbox([pl[0]]);
    let best = null, bd = -1;
    const N = 24;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = bb.x0 + (bb.x1 - bb.x0) * i / N, y = bb.y0 + (bb.y1 - bb.y0) * j / N;
      if (!G.inPaths(paths, x, y)) continue;
      const d = G.distToPts(pl, x, y);
      if (d > bd) { bd = d; best = [x, y]; }
    }
    if (!best) { const p = pl[0][0]; return { x: p[0], y: p[1], fit: 0 }; }
    return { x: best[0], y: best[1], fit: bd };
  }

  /* ---------- 영역 비우기 (자유 형상 포켓) ----------
   * region: 공구 중심 기준이 아닌 실제 포켓 영역 경로(절대 좌표, Clipper 경로)
   * 첫 경로 L1 = 영역을 (rt + aw) 안쪽 오프셋, 이후 step 씩 안쪽으로 → 트리
   * 절삭 순서: 가장 안쪽(잎)부터 바깥으로 (후위 순회). step ≤ 0.95·rt 이면 남는 살이 없음:
   *   L_k 의 경계에서 rt 보다 먼 점은 반드시 L_{k+1} 안에 들어가므로 (증명: 문서 모듈구조.md)
   */
  function clearRegion(regPaths, o) {
    const { rt, aw, step, zs, zEntry, zClear, F, Fr, helical, stepdown } = o;
    const L1 = G.offsetEx(regPaths, -(rt + aw));
    if (!L1.length) return { error: '공구(+측벽 여유)가 포켓보다 커서 가공할 수 없습니다.' };
    const allowed = [].concat(...L1.map(G.exPaths));
    const build = ex => ({ ex, kids: G.offsetEx(G.exPaths(ex), -step).map(build) });
    const roots = L1.map(build);
    const B = builder(), warn = [];
    let leafErr = null;
    zs.forEach((z, li) => {
      const zPrev = li === 0 ? zEntry : zs[li - 1];
      let atDepth = false;
      const visit = node => {
        node.kids.forEach(visit);
        const contours = G.exPaths(node.ex).map(G.fromPath);
        contours.forEach((pts0, ci) => {
          const isLeafOuter = !node.kids.length && ci === 0;
          const cur = B.cur;
          const rot = cur ? rotateAt(pts0, cur.x, cur.y) : rotateAt(pts0, pts0[0][0], pts0[0][1]);
          let pts = rot.pts;
          const direct = atDepth && cur && rot.dist <= 1.2 * step + 0.05 && segInside(allowed, cur.x, cur.y, pts[0][0], pts[0][1]);
          if (direct) B.push(1, pts[0][0], pts[0][1], z, F);
          else {
            // 진입: (깎인) 위 단 높이에서 헬리컬 또는 윤곽 램프
            if (cur) B.push(0, cur.x, cur.y, zClear, 0);
            if (isLeafOuter) {
              // 잎 영역(공구 중심이 갈 수 있는 곳) 안에서 헬리컬 원이 들어갈 자리
              const bc = bestCenter(node.ex), rh = Math.min(0.5 * rt, bc.fit - 0.01);
              if (helical && rh >= 0.1) {
                if (cur) B.push(0, bc.x + rh, bc.y, zClear, 0);
                B.push(1, bc.x + rh, bc.y, zPrev, Fr);
                B.helix(bc.x, bc.y, rh, zPrev, z, Fr, F, stepdown);
                // 헬리컬 끝점에서 가장 가까운 윤곽 점으로 (영역 안 점 → 가장 가까운 경계점 직선은 영역 밖으로 나가지 않음)
                pts = rotateAt(pts0, bc.x + rh, bc.y).pts;
                B.push(1, pts[0][0], pts[0][1], z, F);
              } else {
                if (G.perimeter(pts) < 0.5) leafErr = '진입할 공간이 너무 좁습니다 (헬리컬·램프 불가). 더 작은 엔드밀을 쓰세요.';
                if (cur) B.push(0, pts[0][0], pts[0][1], zClear, 0);
                B.push(1, pts[0][0], pts[0][1], zPrev, Fr);
                B.ramp(pts, zPrev, z, Fr);
              }
            } else {
              if (cur) B.push(0, pts[0][0], pts[0][1], zClear, 0);
              B.push(1, pts[0][0], pts[0][1], zPrev, Fr);
              B.ramp(pts, zPrev, z, Fr);
            }
          }
          B.loop(pts, z, F);
          atDepth = true;
        });
      };
      roots.forEach(r => { atDepth = false; visit(r); });
    });
    if (leafErr) return { error: leafErr };
    const first = B.M[0];
    return { moves: B.M, sx: first.x, sy: first.y, warn, allowed };
  }

  P.MILL = Object.freeze({ RAMP_DEG, ref, recommend, levels, builder, rotateAt, segInside, bestCenter, clearRegion });
})(typeof globalThis !== 'undefined' ? globalThis : this);
