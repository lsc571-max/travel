/* =====================================================================
 * 푸른 AI CAM - [공통 엔진: 2D 형상] engine/geom.js  (V0.5)
 * 역할: 가공 경로 생성기가 쓰는 다각형 연산 (오프셋·불리언·면적·포함 판정)
 *   - 계산은 Clipper 6.4.2 (Boost 라이선스, src/vendor) 정수 좌표(1µm 단위)로 수행
 *   - 다각형 표현: 점 배열 [[x, y], …] (닫힌 다각형, 마지막 점 = 첫 점 아님)
 *   - 영역(region) 표현: { outer: [[x,y]…], islands: [[[x,y]…], …] }  (섬 = 남겨 둘 부분)
 * 주의: 독립 NC 검증기(verify/nc-fanuc.js)는 이 모듈을 쓰지 않는다 (검증 독립성).
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  // 브라우저: 앞에서 불러온 window.ClipperLib / Node 테스트: vendor 파일을 직접 불러옴
  const CL = root.ClipperLib || (typeof require === 'function' ? require('../vendor/clipper-6.4.2.js') : null);
  const SC = 1000;          // mm → µm 정수
  const ARC_TOL = 0.004;    // 원호를 선분으로 나눌 때 허용 오차 (mm)
  const toNum = P.toNum;

  const toPath = (pts, dx, dy) => pts.map(p => ({ X: Math.round((p[0] + (dx || 0)) * SC), Y: Math.round((p[1] + (dy || 0)) * SC) }));
  const fromPath = path => path.map(q => [q.X / SC, q.Y / SC]);
  function area(pts) { let a = 0; for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
  const ccw = pts => (area(pts) < 0 ? pts.slice().reverse() : pts);
  const cw = pts => (area(pts) > 0 ? pts.slice().reverse() : pts);
  function bbox(list) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach(pts => pts.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }));
    return { x0, y0, x1, y1 };
  }
  function perimeter(pts) { let L = 0; for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; L += Math.hypot(q[0] - p[0], q[1] - p[1]); } return L; }

  /* ---------- 기본 형상 → 다각형 ---------- */
  function arcSegs(r) { return Math.max(8, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - ARC_TOL / Math.max(r, 1e-6))))); }
  function circlePoly(cx, cy, r) { const n = arcSegs(r), out = []; for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return out; }
  function rrectPoly(cx, cy, w, h, cr) {
    cr = Math.max(0, Math.min(cr, w / 2, h / 2));
    if (cr < 1e-6) return [[cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2], [cx - w / 2, cy - h / 2]];
    const out = [], n = Math.max(2, Math.ceil(arcSegs(cr) / 4));
    const corner = (kx, ky, a0) => { for (let i = 0; i <= n; i++) { const a = a0 + Math.PI / 2 * i / n; out.push([kx + cr * Math.cos(a), ky + cr * Math.sin(a)]); } };
    corner(cx + w / 2 - cr, cy + h / 2 - cr, 0); corner(cx - w / 2 + cr, cy + h / 2 - cr, Math.PI / 2);
    corner(cx - w / 2 + cr, cy - h / 2 + cr, Math.PI); corner(cx + w / 2 - cr, cy - h / 2 + cr, 1.5 * Math.PI);
    return out;
  }
  // 공정의 형상 매개변수 → 영역 (anchor 기준 상대 좌표)
  function shapeRegion(o) {
    if (o.shape === 'circle') return { outer: circlePoly(0, 0, toNum(o.dia, 0) / 2), islands: [] };
    if (o.shape === 'poly') {
      const pl = o.poly || {};
      return { outer: Array.isArray(pl.outer) ? ccw(pl.outer) : [], islands: Array.isArray(pl.islands) ? pl.islands.map(cw) : [] };
    }
    return { outer: rrectPoly(0, 0, toNum(o.w, 0), toNum(o.h, 0), toNum(o.cr, 0)), islands: [] };
  }
  function regionPaths(reg, dx, dy) { return [toPath(ccw(reg.outer), dx, dy)].concat((reg.islands || []).map(isl => toPath(cw(isl), dx, dy))); }

  /* ---------- 오프셋 ---------- */
  // paths(Clipper 경로들, 바깥=반시계·구멍=시계) 를 delta(mm) 만큼 오프셋 → ExPolygon 목록 [{ outer, holes }]
  function offsetEx(paths, delta, tol) {
    const co = new CL.ClipperOffset(2, (tol || ARC_TOL) * SC); // [V0.5 검토] tol: 원호 근사 허용 오차 (황삭은 크게 → NC 줄 수 감소)
    co.AddPaths(paths, CL.JoinType.jtRound, CL.EndType.etClosedPolygon);
    const tree = new CL.PolyTree();
    co.Execute(tree, delta * SC);
    return CL.JS.PolyTreeToExPolygons(tree).map(e => ({ outer: e.outer, holes: e.holes || [] })).filter(e => Math.abs(CL.Clipper.Area(e.outer)) > 1e-3 * SC * SC);
  }
  const exPaths = ex => [ex.outer].concat(ex.holes);
  function offsetPts(list, delta) { return offsetEx(list.map(pts => toPath(pts)), delta).map(e => ({ outer: fromPath(e.outer), holes: e.holes.map(fromPath) })); }

  /* ---------- 판정 ---------- */
  // 점이 영역(Clipper 경로들) 안인지: 바깥 안이고 모든 구멍 밖
  function inPaths(paths, x, y) {
    const pt = { X: Math.round(x * SC), Y: Math.round(y * SC) };
    let inside = false;
    paths.forEach(p => { const r = CL.Clipper.PointInPolygon(pt, p); if (r !== 0) inside = !inside; });
    return inside;
  }
  function segDist(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
    let t = L2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - ax - t * vx, py - ay - t * vy);
  }
  function distToPts(list, x, y) { let d = Infinity; list.forEach(pts => { for (let i = 0, n = pts.length; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; d = Math.min(d, segDist(x, y, a[0], a[1], b[0], b[1])); } }); return d; }
  // 다각형 정리: 자기 교차·중복 점 제거. 결과 영역 목록
  function cleanRegion(reg) {
    const paths = regionPaths(reg, 0, 0);
    const c = new CL.Clipper(); c.AddPaths(paths, CL.PolyType.ptSubject, true);
    const tree = new CL.PolyTree(); c.Execute(CL.ClipType.ctUnion, tree, CL.PolyFillType.pftEvenOdd, CL.PolyFillType.pftEvenOdd);
    return CL.JS.PolyTreeToExPolygons(tree).map(e => ({ outer: fromPath(e.outer), islands: (e.holes || []).map(fromPath) }));
  }
  // 두 다각형 목록의 겹치는 면적 (mm²)
  function overlapArea(aList, bList) {
    const c = new CL.Clipper(); c.AddPaths(aList.map(p => toPath(ccw(p))), CL.PolyType.ptSubject, true); c.AddPaths(bList.map(p => toPath(ccw(p))), CL.PolyType.ptClip, true);
    const sol = new CL.Paths(); c.Execute(CL.ClipType.ctIntersection, sol, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
    return sol.reduce((s, p) => s + Math.abs(CL.Clipper.Area(p)), 0) / (SC * SC);
  }

  // [V0.5 검토] 공구가 닿지 않는 부분: 영역 − (영역을 d 만큼 줄였다가 rt 만큼 다시 넓힌 것). 조각별 면적(mm²)
  function unreachable(paths, rt, aw) {
    const open = [].concat(...offsetEx([].concat(...offsetEx(paths, -(rt + aw)).map(exPaths)), rt + aw).map(exPaths));
    const c = new CL.Clipper(); c.AddPaths(paths, CL.PolyType.ptSubject, true); if (open.length) c.AddPaths(open, CL.PolyType.ptClip, true);
    const sol = new CL.Paths(); c.Execute(CL.ClipType.ctDifference, sol, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
    return sol.map(p => Math.abs(CL.Clipper.Area(p)) / (SC * SC)).filter(a => a > 1e-3).sort((a, b) => b - a);
  }
  P.GEOM = Object.freeze({ unreachable, SC, ARC_TOL, ok: !!CL, toPath, fromPath, area, ccw, cw, bbox, perimeter, circlePoly, rrectPoly, shapeRegion, regionPaths, offsetEx, exPaths, offsetPts, inPaths, segDist, distToPts, cleanRegion, overlapArea });
})(typeof globalThis !== 'undefined' ? globalThis : this);
