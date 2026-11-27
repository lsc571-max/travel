/* =====================================================================
 * 푸른 AI CAM - [가공 모듈: 모따기] ops/chamfer.js  (V0.5)
 * 역할: 모따기 공구(V 형상, 끝 평면 지름 있음)로 윤곽 모서리를 C 모따기 (chamferMill).
 *   - 형상: 사각·원형·자유 형상, 바깥 모서리(out) / 안쪽 모서리(in: 포켓·구멍 입구)
 *   - 깊이 = 모따기 폭 / tan(공구각/2) + 끝 여유  (공구 끝이 모따기 면보다 아래로 내려가 끝 마모 방지)
 *   - 공구 중심 오프셋 = 끝 반경 + 끝 여유 × tan(공구각/2)  (모서리 기준, 깎인 쪽으로)
 *     → 소재 윗면에서 모서리 안쪽으로 정확히 '모따기 폭' 만큼 깎임
 *   - 진입: 모서리에서 (공구 최대 반경 + 1mm) 떨어진 깎인 쪽 점에서 하강 → 직선 접근 → 한 바퀴 → 복귀
 *     구멍(안쪽 원)이 작으면 구멍 중심에서 하강
 *   - 방향: 바깥 시계 / 안쪽 반시계 (하향 절삭)
 * 의존: engine/*, engine/geom.js, ops/hole-common.js, ops/mill-common.js, ops/pocket.js(normPoly)
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM, H = P.HOLE, G = P.GEOM, MC = P.MILL;
  const { toNum, r3, EPS } = P;
  const PARAMS = { shape: 'rect', w: 60, h: 40, cr: 0, dia: 10, poly: null, side: 'out', cw: 0.5, extra: 0.3 };
  const SHAPES = ['rect', 'circle', 'poly'];
  function normalizeParams(n, o) {
    n.shape = SHAPES.includes(o && o.shape) ? o.shape : 'rect';
    n.poly = n.shape === 'poly' ? P.normPoly(o && o.poly) : null; if (n.shape === 'poly' && !n.poly) n.shape = 'rect';
    n.side = o && o.side === 'in' ? 'in' : 'out';
  }
  const tanH = tool => Math.tan(toNum(tool.angle, 90) / 2 * Math.PI / 180);
  const tipR = tool => Math.max(0, toNum(tool.tip, 0)) / 2;
  // 모따기 기하: 깊이·중심 오프셋·필요 최대 반경
  function geom(op, tool) {
    const t = tanH(tool), cw = toNum(op.cw, 0.5), e = Math.max(0, toNum(op.extra, 0.3));
    const depth = cw / t + e, off = tipR(tool) + e * t, need = tipR(tool) + cw + e * t;
    return { depth, off, need, R: tool.dia / 2 };
  }
  const outerPts = (pk, c) => G.ccw(G.shapeRegion(pk).outer).map(p => [p[0] + c.x, p[1] + c.y]);

  const cache = new Map();
  function chamferMoves(s, tool, c, machine) {
    const pk = s.pk, key = JSON.stringify([pk, s.z, s.r, s.feed, tool.dia, tool.angle, tool.tip, c.x, c.y]);
    if (cache.has(key)) return cache.get(key);
    const g = geom(pk, tool), out = pk.side !== 'in', sgn = out ? 1 : -1, part = outerPts(pk, c);
    let res;
    const path = G.offsetEx([G.toPath(part)], sgn * g.off);
    if (!path.length) res = { sx: c.x, sy: c.y, moves: [], error: '모따기 경로를 만들 수 없습니다 (형상이 너무 작음).' };
    else {
      const z = s.z, F = s.feed, B = MC.builder();
      let pts = G.fromPath(path[0].outer); pts = out ? G.cw(pts) : G.ccw(pts);
      // 진입점: 공구 전체가 모서리에서 떨어지는 곳 (깎인 쪽). 안쪽이 좁으면 형상 중심
      const ent = G.offsetEx([G.toPath(part)], sgn * (g.R + 1));
      let S;
      if (ent.length) { const sp = G.fromPath(ent[0].outer); S = sp.reduce((b, p) => (p[0] > b[0] + 1e-9 || (Math.abs(p[0] - b[0]) < 1e-9 && p[1] < b[1]) ? p : b), sp[0]); }
      else { const bc = MC.bestCenter({ outer: G.toPath(part), holes: [] }); S = [bc.x, bc.y]; }
      const rot = MC.rotateAt(pts, S[0], S[1]); pts = rot.pts;
      B.push(1, S[0], S[1], z, Math.max(1, Math.round(F * 0.5))); // 깎인 쪽에서 하강
      B.push(1, pts[0][0], pts[0][1], z, F);                     // 모서리로 접근
      B.loop(pts, z, F);
      B.push(1, S[0], S[1], z, F);                               // 모서리에서 떨어짐
      res = { sx: S[0], sy: S[1], moves: B.M, entry: S };
    }
    if (cache.size > 60) cache.clear();
    cache.set(key, res);
    return res;
  }
  function region(o, h, st, tool) {
    const g = tool ? geom(o, tool) : { off: 0, R: 0 };
    return { kind: o.side === 'in' ? 'inside' : 'outside', part: outerPts(o, h), floorZ: tool ? -r3(g.depth) : 0, chamfer: toNum(o.cw, 0.5), dMax: g.R + 1.2, centerOk: o.side === 'in' };
  }
  function validate(ctx) {
    const { op, tool, d, st, on, add } = ctx;
    H.validateConditions(ctx);
    if (!SHAPES.includes(op.shape)) add('error', 5, on + ': 모따기 형상이 올바르지 않습니다.');
    if (op.shape === 'poly' && (!op.poly || Math.abs(G.area(op.poly.outer)) < 1)) add('error', 5, on + ': 자유 형상 윤곽이 없습니다.');
    const cw = toNum(op.cw, NaN), e = toNum(op.extra, NaN);
    if (!(cw >= 0.05 && cw <= 10)) add('error', 9, on + ': 모따기 폭은 0.05~10mm 여야 합니다.');
    if (!(e >= 0 && e <= 3)) add('error', 9, on + ': 끝 여유는 0~3mm 여야 합니다.');
    const a = toNum(tool.angle, NaN);
    if (!(a >= 30 && a <= 150)) add('error', 4, on + ': 모따기 공구 각도(' + tool.angle + '°)가 올바르지 않습니다.');
    const g = geom(op, tool);
    if (g.need > g.R + EPS) add('error', 5, on + ': 모따기 폭 ' + cw + 'mm 에 비해 공구 T' + tool.no + ' (Ø' + tool.dia + ') 가 작습니다 (필요 반경 ' + r3(g.need) + 'mm).');
    if (tool.flute > 0 && g.depth > tool.flute + EPS) add('error', 8, on + ': 모따기 깊이가 공구 날 길이를 넘습니다.');
    if (Math.abs(a - 90) > 0.01) add('info', 9, on + ': ' + a + '° 공구 — 모따기 각은 ' + r3(90 - a / 2) + '° (C 모따기는 90° 공구).');
    add('info', 9, on + ': 모따기는 해당 면을 먼저 가공(윤곽·포켓·구멍)한 뒤에 하세요. 진입점이 깎이지 않은 소재면 검증기가 차단합니다.');
    if (d.depth >= st.sz - EPS) add('error', 8, on + ': 모따기 깊이가 소재 두께 이상입니다.');
    H.validateRPlane(ctx);
  }
  P.OPS.register({
    id: 'chamferMill', label: '모따기', code: 'G01', ncName: 'CHAMFER', ncUnit: 'EDGES', stage: 4, role: 'mill', family: 'mill', toolTypes: ['chamfer'],
    defaults: Object.assign({ depth: 0.8, r: 3 }, PARAMS), params: PARAMS, normalize: normalizeParams, moves: chamferMoves, mill: 'chamfer',
    regions: (op, h, st, tool) => [region(op, h, st, tool)],
    ui: { q: false, dwell: false, thru: false, depthMode: false, pocket: true, chamfer: true },
    depth(op, tool) { const dd = tool ? geom(op, tool).depth : toNum(op.depth, 0); return { depth: r3(dd), full: r3(dd), tip: 0, z: r3(-dd) }; },
    ref: (tool, matKey) => MC.ref(tool, matKey, 'chamfer'),
    recommend: MC.recommend('chamfer'),
    conditions: H.conditionsWith({ tap: false }),
    validate,
    toolpath: () => ({ kind: 'path', spindle: 'cw' })
  });
  Object.assign(P, { chamferMoves, chamferGeom: geom, CHAMFER_PARAMS: PARAMS });
})(typeof globalThis !== 'undefined' ? globalThis : this);
