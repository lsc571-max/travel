/* =====================================================================
 * 푸른 AI CAM - [가공 모듈: 윤곽] ops/contour.js  (V0.5)
 * 역할: 부품 외곽(바깥) 또는 안쪽 윤곽을 따라 깎는 윤곽 황삭(contourRough)·정삭(contourFinish).
 *   - 형상: 사각(코너 R)·원형·자유 형상(DXF). 공구 중심 = 윤곽을 (공구 반경 + 측벽 여유)만큼 오프셋
 *   - 방향: 바깥 윤곽 시계(G02 방향, 하향 절삭) / 안쪽 윤곽 반시계 (주축 정회전 기준)
 *   - 측면 제거 폭: 부품 밖으로 남은 소재 폭만큼 여러 바퀴(바깥 → 부품 쪽)
 *   - 진입: 윤곽 밖(바깥 윤곽) / 안(안쪽 윤곽) 진입점에서 헬리컬 → 윤곽으로 직선 접근.
 *     헬리컬 공간이 없으면 첫 바퀴를 따라 3° 램프. 각 단이 끝나면 진입점으로 돌아와 다음 단.
 *   - 깊이: 단 나누기, 관통(소재 두께 + 관통 여유, 하부 여유 안에서) 가능
 * 의존: engine/*, engine/geom.js, ops/hole-common.js, ops/mill-common.js, ops/pocket.js(pocketDepth·normPoly)
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM, H = P.HOLE, G = P.GEOM, MC = P.MILL;
  const { toNum, r3, EPS } = P;
  const PARAMS = { shape: 'rect', w: 60, h: 40, cr: 0, dia: 40, poly: null, side: 'out', stepover: 50, stepdown: 2, allowWall: 0.2, sideWidth: 0 };
  const SHAPES = ['rect', 'circle', 'poly'];
  const HELIX_MAX = 2; // 진입 헬리컬 반경 상한 (mm)

  function normalizeParams(n, o) {
    n.shape = SHAPES.includes(o && o.shape) ? o.shape : 'rect';
    n.poly = n.shape === 'poly' ? P.normPoly(o && o.poly) : null; if (n.shape === 'poly' && !n.poly) n.shape = 'rect';
    n.side = o && o.side === 'in' ? 'in' : 'out';
  }
  const outerPts = (pk, c) => G.ccw(G.shapeRegion(pk).outer).map(p => [p[0] + c.x, p[1] + c.y]);

  // 공구 중심 경로 (바깥 → 부품 쪽 순서), 진입점
  function plan(pk, tool, c, finish) {
    const rt = tool.dia / 2, aw = finish ? 0 : toNum(pk.allowWall, 0);
    const out = pk.side !== 'in', sgn = out ? 1 : -1;
    const so = Math.max(0.05, Math.min(75, toNum(pk.stepover, 50)) / 100) * tool.dia;
    const sw = finish ? 0 : Math.max(0, toNum(pk.sideWidth, 0));
    const nP = sw > 1e-6 ? Math.ceil(sw / Math.min(so, 0.95 * rt) - 1e-9) : 0;
    const part = outerPts(pk, c);
    if (part.length < 3) return { error: '윤곽 형상이 없습니다.' };
    const passes = [];
    for (let i = nP; i >= 0; i--) {
      const d = rt + aw + (nP ? sw * i / nP : 0);
      const ex = G.offsetEx([G.toPath(part)], sgn * d);
      if (!ex.length) return { error: out ? '윤곽을 오프셋할 수 없습니다.' : '공구(+여유)가 안쪽 윤곽보다 커서 들어가지 않습니다.' };
      // 바깥 윤곽: 오프셋의 바깥 경계만 (시계 방향) / 안쪽: 각 조각의 바깥 경계 (반시계)
      ex.forEach(e => { let pts = G.fromPath(e.outer); pts = out ? G.cw(pts) : G.ccw(pts); passes.push({ d, pts }); });
    }
    const dMax = rt + aw + sw;
    const rh = Math.min(0.5 * rt, HELIX_MAX);
    // 진입점: 가장 바깥 경로에서 (헬리컬 반경 + 0.5) 더 떨어진 윤곽 위, 오른쪽 끝점
    const sEx = G.offsetEx([G.toPath(part)], sgn * (dMax + rh + 0.5));
    let S = null;
    if (sEx.length) {
      const sp = G.fromPath(sEx[0].outer); let b = sp[0];
      sp.forEach(p => { if (p[0] > b[0] + 1e-9 || (Math.abs(p[0] - b[0]) < 1e-9 && p[1] < b[1])) b = p; });
      S = { x: b[0], y: b[1] };
    }
    return { passes, S, rh, dMax, part, out };
  }

  const cache = new Map();
  function contourMoves(s, tool, c, machine) {
    const pk = s.pk, finish = s.type === 'contourFinish';
    const key = JSON.stringify([pk, s.type, s.z, s.r, s.feed, tool.dia, c.x, c.y, machine.helical !== false]);
    if (cache.has(key)) return cache.get(key);
    const pl = plan(pk, tool, c, finish);
    let res;
    if (pl.error) res = { sx: c.x, sy: c.y, moves: [], error: pl.error };
    else {
      const F = s.feed, Fr = Math.max(1, Math.round(F * 0.5)), zClear = Math.max(1, toNum(s.r, 3));
      const zs = MC.levels(-s.z, 0, toNum(pk.stepdown, 1), finish);
      const helix = machine.helical !== false && pl.S && pl.rh >= 0.1;
      const B = MC.builder(), rt = tool.dia / 2, aw = finish ? 0 : toNum(pk.allowWall, 0);
      // 허용 영역(공구 중심): 바깥 윤곽이면 부품에서 (rt+aw) 이상 떨어진 곳
      const okPaths = pl.out ? null : [].concat(...G.offsetEx([G.toPath(pl.part)], -(rt + aw) + 0.001).map(G.exPaths));
      const keepOff = (x0, y0, x1, y1) => {
        if (!pl.out) return MC.segInside(okPaths, x0, y0, x1, y1);
        const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L / 0.3));
        for (let k = 0; k <= n; k++) { const t = k / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t; if (G.inPaths([G.toPath(pl.part)], x, y) || G.distToPts([pl.part], x, y) < rt + aw - 0.001) return false; }
        return true;
      };
      let atS = false;
      zs.forEach((z, li) => {
        const zPrev = li === 0 ? 0.5 : zs[li - 1];
        let first = pl.passes[0];
        if (helix) {
          const hx = pl.S.x + pl.rh, hy = pl.S.y;
          if (!atS) { if (B.cur) { B.push(0, B.cur.x, B.cur.y, zClear, 0); B.push(0, hx, hy, zClear, 0); } B.push(1, hx, hy, zPrev, Fr); }
          else B.push(1, hx, hy, zPrev, F);
          B.helix(pl.S.x, pl.S.y, pl.rh, zPrev, z, Fr, F, toNum(pk.stepdown, 1));
          const rot = MC.rotateAt(first.pts, pl.S.x, pl.S.y); first = { pts: rot.pts };
          B.push(1, first.pts[0][0], first.pts[0][1], z, F);
        } else {
          // 헬리컬 불가: 첫 바퀴를 따라 램프 (같은 시작점이므로 위 단은 이미 깎여 있음)
          if (B.cur) B.push(0, B.cur.x, B.cur.y, zClear, 0);
          if (B.cur) B.push(0, first.pts[0][0], first.pts[0][1], zClear, 0);
          B.push(1, first.pts[0][0], first.pts[0][1], zPrev, Fr);
          B.ramp(first.pts, zPrev, z, Fr);
        }
        B.loop(first.pts, z, F);
        for (let k = 1; k < pl.passes.length; k++) {
          const cur = B.cur, rot = MC.rotateAt(pl.passes[k].pts, cur.x, cur.y);
          B.push(1, rot.pts[0][0], rot.pts[0][1], z, F); // 다음 바퀴로 (부품 쪽으로 한 간격)
          B.loop(rot.pts, z, F);
        }
        // 단 끝: 진입점으로 돌아감 (부품을 건드리지 않는 직선일 때만), 아니면 R점으로 상승
        atS = false;
        if (helix) {
          const cur = B.cur, hx = pl.S.x + pl.rh, hy = pl.S.y;
          if (keepOff(cur.x, cur.y, hx, hy)) { B.push(1, hx, hy, z, F); atS = true; }
        }
      });
      const f0 = B.M[0];
      res = { sx: f0.x, sy: f0.y, moves: B.M };
    }
    if (cache.size > 60) cache.clear();
    cache.set(key, res);
    return res;
  }

  function region(o, h, st, tool) {
    const rt = tool ? tool.dia / 2 : 0, finish = o.type === 'contourFinish';
    const dMax = (tool ? rt : 0) + (finish ? 0 : toNum(o.allowWall, 0) + toNum(o.sideWidth, 0)) + Math.min(0.5 * rt, HELIX_MAX) * 2 + 0.6;
    return { kind: o.side === 'in' ? 'inside' : 'outside', part: outerPts(o, h), floorZ: -P.pocketDepth(o, st), dMax };
  }

  function validate(ctx, finish) {
    const { op, oi, ops, tool, d, st, on, add, machine } = ctx;
    H.validateConditions(ctx);
    if (!SHAPES.includes(op.shape)) add('error', 5, on + ': 윤곽 모양이 올바르지 않습니다.');
    if (op.shape === 'circle' && !(op.dia > 0)) add('error', 5, on + ': 원형 윤곽 지름이 0 이하입니다.');
    if (op.shape === 'rect' && !(op.w > 0 && op.h > 0)) add('error', 5, on + ': 사각 윤곽 가로·세로가 0 이하입니다.');
    if (op.shape === 'poly' && (!op.poly || Math.abs(G.area(op.poly.outer)) < 1)) add('error', 5, on + ': 자유 형상 윤곽이 없거나 너무 작습니다.');
    if (op.shape === 'rect' && op.cr > Math.min(op.w, op.h) / 2 + EPS) add('error', 5, on + ': 코너 R 이 폭의 절반보다 큽니다.');
    if (!(d.depth > 0)) add('error', 8, on + ': 윤곽 깊이가 0 이하입니다.');
    if (tool.flute > 0 && d.depth > tool.flute + EPS) add('error', 8, on + ': 깊이 ' + d.depth + ' 가 공구 날 길이 ' + tool.flute + ' 를 넘습니다.');
    if (!finish) {
      const aw = toNum(op.allowWall, NaN), sd = toNum(op.stepdown, NaN), sw = toNum(op.sideWidth, NaN);
      if (!(aw >= 0 && aw <= 2)) add('error', 9, on + ': 측벽 여유는 0~2mm 범위여야 합니다.');
      if (!(sd >= 0.05)) add('error', 9, on + ': 절입 깊이(1회)는 0.05mm 이상이어야 합니다.');
      else if (sd > tool.dia + EPS) add('error', 9, on + ': 절입 깊이가 공구 직경을 넘습니다.');
      if (!(sw >= 0 && sw <= 100)) add('error', 9, on + ': 측면 제거 폭은 0~100mm 범위여야 합니다.');
    }
    const so = toNum(op.stepover, NaN);
    if (!(so >= 10 && so <= 75)) add('error', 9, on + ': 경로 간격은 공구 직경의 10~75% 여야 합니다.');
    if (op.thru) {
      const under = toNum(st.under, 0), brk = toNum(op.brk, 0);
      if (!(brk >= 0.3)) add('error', 8, on + ': 관통 여유는 0.3mm 이상이어야 합니다.');
      else if (brk > under + EPS) add('error', 8, on + ': 관통 윤곽 여유 ' + brk + 'mm 가 하부 여유 ' + under + 'mm 보다 큽니다 → 테이블·바이스 절삭 위험. 받침(패럴렐) 높이를 하부 여유에 입력하세요.');
      else add('warn', 8, on + ': 관통 윤곽 — 마지막 바퀴에서 부품(또는 안쪽 조각)이 떨어집니다. 탭(브리지) 기능이 없으므로 고정 상태를 꼭 확인하세요.');
    } else if (d.depth >= st.sz - EPS) add('error', 8, on + ': 깊이가 소재 두께 이상입니다. 끝까지 자르려면 [관통]을 체크하세요.');
    const pl = tool.dia > 0 ? plan(op, tool, { x: 0, y: 0 }, finish) : { error: '공구 직경 오류' };
    if (pl.error) add('error', 5, on + ': ' + pl.error);
    else if (!pl.S && machine.helical !== false) add('info', 9, on + ': 진입 헬리컬 공간이 없어 첫 바퀴를 따라 경사(3°)로 진입합니다.');
    if (finish) {
      const same = o => o.type === 'contourRough' && o.shape === op.shape && o.side === op.side && !!o.thru === !!op.thru && JSON.stringify(o.poly || null) === JSON.stringify(op.poly || null) && ['w', 'h', 'cr', 'dia', 'depth', 'brk'].every(k => Math.abs(toNum(o[k], 0) - toNum(op[k], 0)) < 1e-6);
      if (!ops.slice(0, oi).some(same)) add('error', 5, on + ': 정삭 앞에 같은 윤곽(모양·크기·방향·깊이)의 황삭 공정이 없습니다.');
    }
    H.validateRPlane(ctx);
    if (toNum(op.r, 0) < 1 - EPS) add('error', 10, on + ': 윤곽 R점은 소재 상면 위 1mm 이상이어야 합니다.');
  }

  function define(id, label, ncName, finish) {
    return {
      id, label, code: 'G01·G02·G03', ncName, ncUnit: 'CONTOURS', stage: finish ? 0.7 : 0.6, role: 'mill', family: 'mill', toolTypes: ['endmill'],
      defaults: Object.assign({ depth: 5, r: 3 }, PARAMS, finish ? { stepover: 40, sideWidth: 0 } : {}),
      params: PARAMS, normalize: normalizeParams, moves: contourMoves, mill: 'contour',
      regions: (op, h, st, tool) => [region(op, h, st, tool)],
      ui: { q: false, dwell: false, thru: false, depthMode: false, pocket: true, contour: true },
      depth(op, tool, st) { const dd = P.pocketDepth(op, st); return { depth: r3(dd), full: r3(dd), tip: 0, z: r3(-dd) }; },
      ref: (tool, matKey) => MC.ref(tool, matKey, finish ? 'finish' : 'rough'),
      recommend: MC.recommend(finish ? 'finish' : 'rough'),
      conditions: H.conditionsWith({ tap: false }),
      validate: ctx => validate(ctx, finish),
      toolpath: () => ({ kind: 'path', spindle: 'cw' })
    };
  }
  P.OPS.register(define('contourRough', '윤곽 황삭', 'CONTOUR ROUGH', false));
  P.OPS.register(define('contourFinish', '윤곽 정삭', 'CONTOUR FINISH', true));
  Object.assign(P, { contourMoves, contourPlan: plan, CONTOUR_PARAMS: PARAMS });
})(typeof globalThis !== 'undefined' ? globalThis : this);
