/* =====================================================================
 * 푸른 AI CAM - [가공 모듈: 포켓] ops/pocket.js
 * 역할: 사각·원형 포켓의 황삭(pocketRough)·정삭(pocketFinish) 가공 모듈과 공구 경로 계산.
 *   경로 (모두 결정적 계산, AI 미사용, 공구 중심 기준)
 *   - 진입: 포켓 중심에서 헬리컬(G03, 3° 경사, 반경 ≤ 공구 반경의 1/2). 장비가 헬리컬을
 *     지원하지 않으면 중심 수직 진입 (중심 절삭 엔드밀 필요 경고)
 *   - 절삭: 안쪽 → 바깥 방향 오프셋 루프, 반시계(G03, 주축 정회전 시 하향 절삭)
 *     사각: 둥근 모서리 사각 루프 + 긴 축 중심선 / 원형: 동심원(G03 전체 원)
 *     루프 간격 = 경로 간격(공구 직경 %) 이하로 균등 분할 → 남는 살 없음 (간격 ≤ 75%)
 *   - 깊이: 황삭은 (깊이 − 바닥 여유)를 절입 깊이 이하로 균등 분할, 측벽 여유 남김
 *           정삭은 최종 깊이 1회 (바닥 + 측벽 0 여유)
 *   - 빠져나오기: 벽에서 0.5mm 안쪽으로 이동 후 급속 상승(포스트)
 *   [V0.5] 자유 형상(shape 'poly': 바깥 윤곽 + 섬) 포켓: ops/mill-common.js 의 영역 비우기(clearRegion)
 *          관통 포켓(thru): 깊이 = 소재 두께 + 관통 여유, 하부 여유 안에서만
 * 의존: engine/*, engine/geom.js, ops/registry.js, ops/hole-common.js, ops/mill-common.js
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM, H = P.HOLE;
  const { toNum, r3, EPS } = P;
  const RAMP_DEG = 3;           // 헬리컬 경사각
  const HMIN_F = 0.25;          // [V0.5 검토] 헬리컬 최소 반경 = 공구 반경의 25% (헬리컬 지름 ≥ 공구 지름 25%) (더 작으면 사실상 수직 하강)
  const STEPOVER_MAX = 75;      // 경로 간격 상한 (% of D) — 루프 사이 남는 살 방지

  // 포켓 공통 매개변수 (공정에 저장)
  // [V0.5] entry: 진입 방식 'helix'(헬리컬, 기본) | 'ramp'(윤곽 따라 3° 경사) | 'drill'(선가공 구멍으로 수직 진입, ex·ey = 진입점)
  // [V0.5] 측벽 형상: draft 구배(°, 수직=0, 입구가 도면 치수) · topR 입구 모서리 R · floorR 바닥 모서리 R · profStep 계단 높이
  const PARAMS = { shape: 'rect', w: 40, h: 30, cr: 5, dia: 30, stepover: 50, stepdown: 2, allowWall: 0.2, allowFloor: 0.1, poly: null, entry: 'helix', ex: 0, ey: 0, draft: 0, topR: 0, floorR: 0, profStep: 0.2 };
  // [V0.5] 단계별 추가 매개변수
  //   중삭(pocketSemi): 앞 단계 여유(allowWall·allowFloor) → 이 단계 여유(leaveWall·leaveFloor), semiStep 0 = 한 번에, > 0 = 그 깊이씩 내려가며
  //   바닥 정삭(pocketFloor): 바닥만 0 으로, 측벽은 앞 단계 여유 그대로
  //   측벽 정삭(pocketWall): 측벽만 0 으로 (바닥 여유 높이까지), wallStep 0 = 한 번에, > 0 = 그 깊이씩
  const SEMI_PARAMS = Object.assign({}, PARAMS, { leaveWall: 0.1, leaveFloor: 0.05, semiStep: 0 });
  const WALL_PARAMS = Object.assign({}, PARAMS, { wallStep: 0 });
  const ENTRIES = ['helix', 'ramp', 'drill'];
  /* ---------- [V0.5] 측벽 형상 (구배·입구 R·바닥 R) ----------
   * off(u): 윗면에서 u 깊이에서 측벽이 도면 윤곽보다 바깥(+)/안쪽(−)으로 있는 거리
   *   구배: −u·tan(draft) (아래로 갈수록 좁아짐, 입구가 도면 치수)
   *   입구 R: u < R 이면 +(R − √(R² − (R − u)²))  (모서리를 둥글게 깎아 냄)
   *   바닥 R: 바닥에서 높이 h < R 이면 −(R − √(R² − (R − h)²))  (바닥과 벽 사이 둥근 살)
   * 아래로 갈수록 벽이 안쪽으로만 가므로(단조) 평 엔드밀로 위에서부터 계단식으로 깎으면 과삭이 없다.
   */
  const hasProf = pk => toNum(pk.draft, 0) > 1e-6 || toNum(pk.topR, 0) > 1e-6 || toNum(pk.floorR, 0) > 1e-6;
  function profOff(pk, depth, u) {
    const t = Math.tan(Math.min(89, Math.max(0, toNum(pk.draft, 0))) * Math.PI / 180), Rt = Math.max(0, toNum(pk.topR, 0)), Rf = Math.max(0, toNum(pk.floorR, 0));
    let o = -u * t;
    if (Rt > 0 && u < Rt) o += Rt - Math.sqrt(Math.max(0, Rt * Rt - (Rt - u) * (Rt - u)));
    const hf = depth - u;
    if (Rf > 0 && hf < Rf) o -= Rf - Math.sqrt(Math.max(0, Rf * Rf - (Rf - hf) * (Rf - hf)));
    return o;
  }
  // 가장 안쪽으로 들어간 거리 (다른 단계가 벽을 건드리지 않도록 이만큼 더 안쪽에서 가공)
  function profInset(pk, depth) { if (!hasProf(pk)) return 0; let m = 0; for (let i = 0; i <= 200; i++) m = Math.min(m, profOff(pk, depth, depth * i / 200)); return r3(-m + 1e-9); }
  const SHAPES = ['rect', 'circle', 'poly'];
  const G = P.GEOM, MC = P.MILL;
  // 자유 형상 데이터 정규화 (외부 파일 방어: 점 수·좌표 범위 제한)
  function normPoly(pl) {
    const pts = a => Array.isArray(a) ? a.slice(0, 20000).map(p => [toNum(p && p[0], NaN), toNum(p && p[1], NaN)]).filter(p => isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) < 1e5 && Math.abs(p[1]) < 1e5) : [];
    if (!pl || typeof pl !== 'object') return null;
    const outer = pts(pl.outer);
    if (outer.length < 3) return null;
    return { outer, islands: (Array.isArray(pl.islands) ? pl.islands.slice(0, 500) : []).map(pts).filter(a => a.length >= 3), name: String(pl.name || '').slice(0, 60) };
  }
  function normalizeParams(n, o) { n.shape = SHAPES.includes(o && o.shape) ? o.shape : 'rect'; n.poly = n.shape === 'poly' ? normPoly(o && o.poly) : null; if (n.shape === 'poly' && !n.poly) n.shape = 'rect'; n.entry = ENTRIES.includes(o && o.entry) ? o.entry : 'helix'; }

  /* ---------- 형상 ---------- */
  function extent(o) {
    if (o.shape === 'poly') { if (!o.poly) return { ex: 0, ey: 0 }; const b = G.bbox([o.poly.outer]); return { ex: Math.max(Math.abs(b.x0), Math.abs(b.x1)), ey: Math.max(Math.abs(b.y0), Math.abs(b.y1)) }; }
    return o.shape === 'circle' ? { ex: toNum(o.dia, 0) / 2, ey: toNum(o.dia, 0) / 2 } : { ex: toNum(o.w, 0) / 2, ey: toNum(o.h, 0) / 2 };
  }
  // 최소 폭: 사각·원은 치수, 자유 형상은 영역 안 가장 큰 내접원 지름(근사)
  function minWidth(o) {
    if (o.shape === 'poly') {
      if (!o.poly) return 0;
      const ex = G.offsetEx(G.regionPaths(G.shapeRegion(o), 0, 0), 0);
      return ex.length ? 2 * Math.max(...ex.map(e => MC.bestCenter(e).fit)) : 0;
    }
    return o.shape === 'circle' ? toNum(o.dia, 0) : Math.min(toNum(o.w, 0), toNum(o.h, 0));
  }
  // 포켓 깊이 (관통이면 소재 두께 + 관통 여유)
  function pocketDepth(op, st) { return op.thru && st ? toNum(st.sz, 0) + Math.max(0, toNum(op.brk, 0.5)) : toNum(op.depth, 0); }
  /* ---------- [V0.5] 단계 (황삭·중삭·바닥 정삭·측벽 정삭·정삭) ----------
   * aw·af: 이 단계가 남길 측벽·바닥 여유 / pw·pf: 앞 단계가 남긴 여유 (null = 앞 단계 없음 = 황삭)
   * levels: [{ z, wall }]  wall = 측벽 루프만 깎는 단 (안쪽은 앞 단계가 이미 비운 높이)
   */
  function stepped(total, sd) { const n = Math.max(1, Math.ceil(total / Math.max(0.05, sd) - 1e-9)), out = []; for (let i = 1; i <= n; i++) out.push(-total * i / n); return out; }
  function stageOf(type, pk, depth) {
    const aw0 = toNum(pk.allowWall, 0), af0 = toNum(pk.allowFloor, 0);
    if (type === 'pocketProfile') return { aw: 0, af: 0, pw: aw0, pf: af0, levels: [] };
    if (type === 'pocketFinish') return { aw: 0, af: 0, pw: aw0, pf: af0, levels: [{ z: -depth, wall: false }] };
    if (type === 'pocketFloor') return { aw: aw0, af: 0, pw: aw0, pf: af0, levels: [{ z: -depth, wall: false }] };
    if (type === 'pocketWall') { const ws = toNum(pk.wallStep, 0); return { aw: 0, af: af0, pw: aw0, pf: af0, levels: (ws > 0 ? stepped(depth - af0, ws) : [-(depth - af0)]).map(z => ({ z, wall: true })) }; }
    if (type === 'pocketSemi') {
      const aw = Math.min(aw0, Math.max(0, toNum(pk.leaveWall, 0))), af = Math.min(af0, Math.max(0, toNum(pk.leaveFloor, 0))), ss = toNum(pk.semiStep, 0), zPrev = -(depth - af0);
      return { aw, af, pw: aw0, pf: af0, levels: (ss > 0 ? stepped(depth - af, ss) : [-(depth - af)]).map(z => ({ z, wall: z > zPrev + 1e-6 })) };
    }
    return { aw: aw0, af: af0, pw: null, pf: null, levels: stepped(depth - af0, toNum(pk.stepdown, 1)).map(z => ({ z, wall: false })) };
  }
  // 이 단계가 끝난 뒤 남는 여유 [측벽, 바닥] (다음 단계 검증용)
  function leaveOf(o) {
    const aw0 = toNum(o.allowWall, 0), af0 = toNum(o.allowFloor, 0);
    if (o.type === 'pocketRough') return [aw0, af0];
    if (o.type === 'pocketSemi') return [Math.min(aw0, Math.max(0, toNum(o.leaveWall, 0))), Math.min(af0, Math.max(0, toNum(o.leaveFloor, 0)))];
    if (o.type === 'pocketFloor') return [aw0, 0];
    if (o.type === 'pocketWall' || o.type === 'pocketProfile') return [0, af0];
    return [0, 0];
  }

  // 측벽 형상이 있으면 다른 단계는 가장 안쪽 벽(바닥 근처)보다 더 안쪽에서만 가공
  function withInset(st, pk, depth) { const ins = profInset(pk, depth); if (!ins) return st; return Object.assign({}, st, { aw: st.aw + ins, pw: st.pw == null ? null : st.pw + ins }); }
  // [V0.5] 측벽 형상 정삭: 윗면부터 profStep 씩 내려가며 그 높이의 벽 위치까지 안쪽→바깥 여러 바퀴 (평 엔드밀 계단 근사)
  const profCache = new Map();
  function profileMoves(s, tool, c, machine) {
    const pk = s.pk, rt = tool.dia / 2, depth = -s.z, ins = profInset(pk, depth);
    const key = JSON.stringify([pk, s.z, s.r, s.feed, tool.dia, c.x, c.y]);
    if (profCache.has(key)) return profCache.get(key);
    const F = s.feed, Fr = Math.max(1, Math.round(F * 0.5)), zClear = Math.max(1, toNum(s.r, 3));
    const reg = G.regionPaths(G.shapeRegion(pk), c.x, c.y), af = toNum(pk.allowFloor, 0);
    const A0 = toNum(pk.allowWall, 0) + ins, sp = Math.min(0.9 * rt, Math.max(0.05, Math.min(STEPOVER_MAX, toNum(pk.stepover, 40)) / 100 * tool.dia));
    const dz = Math.max(0.05, Math.min(2, toNum(pk.profStep, 0.2))), us = [];
    for (let u = dz; u < depth - af - 1e-6; u += dz) us.push(u);
    us.push(depth - af);
    let moves = [], err = null;
    for (const u of us) {
      const a = -profOff(pk, depth, u); // 이 높이 벽까지 공구 중심 오프셋 = rt + a
      let prev = A0;
      if (a > A0 - 1e-4) continue; // 아직 다른 단계가 깎은 범위 안 (깎을 벽 없음)
      while (prev - a > 1e-4) {
        const nx = Math.max(a, prev - sp);
        const r = MC.wallPasses(reg, { rt, aw: nx, pw: prev, zs: [r3(-u)], zClear, F, Fr });
        if (r.error) { err = r.error; break; }
        if (moves.length) { const l = moves[moves.length - 1]; moves.push({ g: 0, x: l.x, y: l.y, z: r3(zClear), f: 0 }, { g: 0, x: r.moves[0].x, y: r.moves[0].y, z: r3(zClear), f: 0 }); }
        moves = moves.concat(r.moves);
        prev = nx;
      }
      if (err) break;
    }
    if (!err && !moves.length) err = '깎을 측벽 형상이 없습니다 (구배·R 이 0).';
    const out = err ? { sx: c.x, sy: c.y, moves: [], error: err } : { sx: moves[0].x, sy: moves[0].y, moves };
    if (profCache.size > 30) profCache.clear();
    profCache.set(key, out);
    return out;
  }

  // 자유 형상 경로 (같은 입력이면 다시 계산하지 않음)
  const polyCache = new Map();
  function polyMoves(s, tool, c, machine) {
    const pk = s.pk, rt = tool.dia / 2, depth = -s.z, st = withInset(stageOf(s.type, pk, depth), pk, depth);
    const so = Math.max(0.05, Math.min(STEPOVER_MAX, toNum(pk.stepover, 50)) / 100) * tool.dia;
    const key = JSON.stringify([pk, s.type, s.z, s.r, s.feed, tool.dia, c.x, c.y, machine.helical !== false]);
    if (polyCache.has(key)) return polyCache.get(key);
    const F = s.feed, Fr = Math.max(1, Math.round(F * 0.5)), zClear = Math.max(1, toNum(s.r, 3));
    const reg = G.regionPaths(G.shapeRegion(pk), c.x, c.y);
    const wallCut = st.pw != null && st.pw - st.aw > 1e-6;
    const wl = st.levels.filter(L => L.wall && wallCut).map(L => L.z), fl = st.levels.filter(L => !L.wall).map(L => L.z);
    let moves = [], err = wl.length || fl.length ? null : '이 단계에서 깎을 여유가 없습니다 (앞 단계 여유가 0).';
    const warns = [];
    if (!err && wl.length) { const r = MC.wallPasses(reg, { rt, aw: st.aw, pw: st.pw, zs: wl, zClear, F, Fr }); if (r.error) err = r.error; else moves = r.moves; }
    if (!err && fl.length) {
      const fast = st.pw != null ? [].concat(...G.offsetEx(reg, -(rt + st.pw)).map(G.exPaths)) : null;
      const r = MC.clearRegion(reg, {
        rt, aw: st.aw, step: Math.min(so, 0.95 * rt), zs: fl, zEntry: 0.5, zClear, F, Fr, tol: 0.02,
        helical: machine.helical !== false && pk.entry !== 'ramp', stepdown: toNum(pk.stepdown, 1),
        fastPaths: fast && fast.length ? fast : null, zFast: st.pf != null ? Math.min(0.5, r3(-(depth - st.pf) + 0.2)) : 0.5,
        pre: pk.entry === 'drill' ? { x: c.x + toNum(pk.ex, 0), y: c.y + toNum(pk.ey, 0) } : null
      });
      if (r.error) err = r.error;
      else {
        if (r.warn && r.warn.length) warns.push(...r.warn);
        if (moves.length) { const l = moves[moves.length - 1]; moves.push({ g: 0, x: l.x, y: l.y, z: r3(zClear), f: 0 }, { g: 0, x: r.sx, y: r.sy, z: r3(zClear), f: 0 }); }
        moves = moves.concat(r.moves);
      }
    }
    const out = err ? { sx: c.x, sy: c.y, moves: [], error: err } : { sx: moves[0].x, sy: moves[0].y, moves, warn: warns };
    if (polyCache.size > 60) polyCache.clear();
    polyCache.set(key, out);
    return out;
  }

  // 공구 중심 경로 루프 (바깥 → 안쪽 순서로 계산 후 뒤집어 사용)
  function loopsFor(pk, rt, aw, so) {
    if (pk.shape === 'circle') {
      const Rb = pk.dia / 2 - rt - aw;
      if (!(Rb > 1e-6)) return null;
      const n = Math.max(1, Math.ceil(Rb / so - 1e-9)), sp = Rb / n, out = [];
      for (let i = 0; i < n; i++) out.push({ type: 'circle', rad: Rb - i * sp });
      return { loops: out.reverse(), fit: Rb, line: null };
    }
    const A = pk.w / 2 - rt - aw, B = pk.h / 2 - rt - aw;
    if (!(A > 1e-6 && B > 1e-6)) return null;
    const rc0 = Math.max(0, pk.cr - rt - aw), M = Math.min(A, B);
    const n = Math.max(1, Math.ceil(M / so - 1e-9)), sp = M / n, out = [];
    for (let i = 0; i < n; i++) { const d = i * sp, a = A - d, b = B - d; out.push({ type: 'rect', a, b, r: Math.min(Math.max(0, rc0 - d), Math.min(a, b)) }); }
    const inner = out[out.length - 1];
    const line = inner.a - inner.b > 1e-3 ? { ax: 'x', h: inner.a - inner.b } : inner.b - inner.a > 1e-3 ? { ax: 'y', h: inner.b - inner.a } : null;
    return { loops: out.reverse(), fit: M, line };
  }

  // 포켓 1개의 이동 목록 (절대좌표). 시작점 sx, sy 는 R점 위에서 급속 위치결정할 점
  function pocketMoves(s, tool, c, machine) {
    if (s.type === 'pocketProfile') return profileMoves(s, tool, c, machine);
    if (s.pk && (s.pk.shape === 'poly' || hasProf(s.pk))) return polyMoves(s, tool, c, machine);
    const pk = s.pk, rt = tool.dia / 2, D = tool.dia;
    const depth = -s.z, F = s.feed, Fr = Math.max(1, Math.round(F * 0.5));
    const st = stageOf(s.type, pk, depth);
    const so = Math.max(0.05, Math.min(STEPOVER_MAX, toNum(pk.stepover, 50)) / 100) * D;
    const geo = loopsFor(pk, rt, st.aw, so);
    if (!geo) return { sx: c.x, sy: c.y, moves: [], error: '공구가 포켓보다 큽니다.' };
    const wallCut = st.pw != null && st.pw - st.aw > 1e-6;
    const lv = st.levels.filter(L => !L.wall || wallCut);
    if (!lv.length) return { sx: c.x, sy: c.y, moves: [], error: '이 단계에서 깎을 여유가 없습니다 (앞 단계 여유가 0).' };
    const pre = st.pw != null ? loopsFor(pk, rt, st.pw, so) : null; // 앞 단계가 비운 영역
    const entry = ENTRIES.includes(pk.entry) ? pk.entry : 'helix';
    const helical = machine.helical !== false;
    const rh = Math.min(0.5 * rt, geo.fit);
    const useHelix = entry === 'helix' && helical && rh >= HMIN_F * rt;
    const cx = c.x, cy = c.y, M = [];
    const push = (g, x, y, z, f, ij) => M.push(Object.assign({ g, x: r3(x), y: r3(y), z: r3(z), f }, ij || {}));
    // 램프 진입: 가장 안쪽 루프를 따라 3° 경사
    const inner = geo.loops[0];
    const rampPts = entry === 'ramp' ? G.ccw(inner.type === 'circle' ? G.circlePoly(cx, cy, inner.rad) : G.rrectPoly(cx, cy, 2 * inner.a, 2 * inner.b, inner.r)) : null;
    if (rampPts && (() => { const b = G.bbox([rampPts]); return Math.max(b.x1 - b.x0, b.y1 - b.y0) < rt; })()) return { sx: c.x, sy: c.y, moves: [], error: '램프 진입 공간이 너무 좁습니다.' };
    const ep = useHelix ? [cx + rh, cy] : rampPts ? rampPts[0] : [cx, cy]; // 진입점
    const outer = geo.loops[geo.loops.length - 1];
    const plo = pre ? pre.loops[pre.loops.length - 1] : null;
    const px = plo ? cx + (plo.type === 'circle' ? plo.rad : plo.a) : cx; // 측벽 단: 앞 단계가 비운 곳에서 하강
    const zPre = st.pf != null ? Math.min(0.5, r3(-(depth - st.pf) + 0.2)) : null;
    const sx = lv[0].wall ? px : ep[0], sy = lv[0].wall ? cy : ep[1];
    let z = 0.5;
    push(1, sx, sy, z, Fr); // R점 → 소재 위 0.5mm
    const wallLoop = (lp, zl) => {
      if (lp.type === 'circle') { push(1, cx + lp.rad, cy, zl, F); push(3, cx + lp.rad, cy, zl, F, { i: r3(-lp.rad), j: 0 }); }
      else rectLoop(push, cx, cy, zl, lp, F);
    };
    lv.forEach((L, li) => {
      const zl = L.z;
      if (L.wall) {
        if (li > 0) push(1, px, cy, z, F);
        push(1, px, cy, zl, Fr);   // 이미 비운 공간 안에서 이송 하강
        wallLoop(outer, zl);       // 측벽 한 바퀴 (반시계 = 하향 절삭)
        push(1, px, cy, zl, F);    // 다시 안쪽으로
        z = zl;
        return;
      }
      if (li > 0) push(1, ep[0], ep[1], z, F); // 진입점으로 복귀
      if (zPre != null && zPre < z) { push(1, ep[0], ep[1], zPre, Fr); z = zPre; } // 앞 단계가 판 바닥 바로 위까지 이송 하강
      if (useHelix) {
        const per = Math.max(0.05, Math.min(toNum(pk.stepdown, 1), 2 * Math.PI * rh * Math.tan(RAMP_DEG * Math.PI / 180)));
        const turns = Math.max(1, Math.ceil((z - zl) / per - 1e-9));
        for (let k = 1; k <= turns; k++) push(3, ep[0], cy, z - (z - zl) * k / turns, Fr, { i: r3(-rh), j: 0 });
        push(3, ep[0], cy, zl, F, { i: r3(-rh), j: 0 }); // 바닥 평탄화 1회전
      } else if (rampPts) {
        const B = MC.builder(); B.ramp(rampPts, z, zl, Fr); M.push(...B.M);
      } else push(1, cx, cy, zl, Math.max(1, Math.round(F * 0.3))); // 선가공 구멍 또는 헬리컬 미지원 장비: 중심 수직 진입
      // 중심선 (사각, 긴 축)
      if (geo.line) {
        const l = geo.line;
        if (l.ax === 'x') { push(1, cx - l.h, cy, zl, F); push(1, cx + l.h, cy, zl, F); }
        else { push(1, cx, cy - l.h, zl, F); push(1, cx, cy + l.h, zl, F); }
      }
      geo.loops.forEach(lp => wallLoop(lp, zl));
      z = zl;
    });
    // 벽에서 안쪽으로 0.5mm 떨어진 뒤 상승 (포스트에서 G00)
    const last = M[M.length - 1];
    const back = Math.min(0.5, geo.fit);
    push(1, last.x - back, last.y, last.z, F);
    return { sx, sy, moves: M };
  }
  // 둥근 모서리 사각 루프: (cx+a, cy) 에서 시작해 반시계로 한 바퀴
  function rectLoop(push, cx, cy, z, lp, F) {
    const { a, b, r } = lp;
    push(1, cx + a, cy, z, F);
    const arc = (ex, ey, i, j) => push(3, ex, ey, z, F, { i: r3(i), j: r3(j) });
    if (r > 1e-6) {
      push(1, cx + a, cy + b - r, z, F); arc(cx + a - r, cy + b, -r, 0);
      push(1, cx - a + r, cy + b, z, F); arc(cx - a, cy + b - r, 0, -r);
      push(1, cx - a, cy - b + r, z, F); arc(cx - a + r, cy - b, r, 0);
      push(1, cx + a - r, cy - b, z, F); arc(cx + a, cy - b + r, 0, r);
      push(1, cx + a, cy, z, F);
    } else {
      push(1, cx + a, cy + b, z, F); push(1, cx - a, cy + b, z, F);
      push(1, cx - a, cy - b, z, F); push(1, cx + a, cy - b, z, F); push(1, cx + a, cy, z, F);
    }
  }

  /* ---------- 검증 (모듈 전용) ---------- */
  function validatePocket(ctx, kind) {
    const { op, oi, ops, tool, d, st, on, add, machine } = ctx;
    const rt = tool.dia / 2, finish = kind !== 'rough';
    const sg = stageOf(op.type, op, d.depth);
    if (!SHAPES.includes(op.shape)) add('error', 5, on + ': 포켓 모양이 올바르지 않습니다.');
    const mw = minWidth(op);
    if (op.shape === 'circle') { if (!(op.dia > 0)) add('error', 5, on + ': 원형 포켓 지름이 0 이하입니다.'); }
    else if (op.shape === 'poly') { if (!op.poly || Math.abs(G.area(op.poly.outer)) < 1) add('error', 5, on + ': 자유 형상 포켓의 윤곽이 없거나 너무 작습니다.'); }
    else if (!(op.w > 0 && op.h > 0)) add('error', 5, on + ': 사각 포켓 가로·세로가 0 이하입니다.');
    const aw = kind === 'finish' ? 0 : sg.aw, af = kind === 'finish' ? 0 : toNum(op.allowFloor, 0);
    if (kind !== 'finish') {
      if (!(toNum(op.allowWall, 0) >= 0 && toNum(op.allowWall, 0) <= 2)) add('error', 9, on + ': 측벽 여유는 0~2mm 범위여야 합니다.');
      if (!(af >= 0 && af <= 2)) add('error', 9, on + ': 바닥 여유는 0~2mm 범위여야 합니다.');
      if (af >= d.depth) add('error', 9, on + ': 바닥 여유가 포켓 깊이 이상입니다.');
    }
    // [V0.5] 중삭·바닥/측벽 정삭: 단계 매개변수
    const stepChk = (v, name) => { if (!(v === 0 || v >= 0.05)) add('error', 9, on + ': ' + name + '은(는) 0(한 번에) 또는 0.05mm 이상이어야 합니다.'); else if (v > tool.dia + EPS || (tool.flute > 0 && v > tool.flute + EPS)) add('error', 9, on + ': ' + name + ' ' + v + 'mm 가 공구 직경·날 길이를 넘습니다.'); };
    if (kind === 'semi') {
      const lw = toNum(op.leaveWall, NaN), lf = toNum(op.leaveFloor, NaN);
      if (!(lw >= 0 && lw <= toNum(op.allowWall, 0) + EPS)) add('error', 9, on + ': 중삭 측벽 여유(' + op.leaveWall + ')는 0 이상, 황삭 측벽 여유(' + op.allowWall + ') 이하여야 합니다.');
      if (!(lf >= 0 && lf <= af + EPS)) add('error', 9, on + ': 중삭 바닥 여유(' + op.leaveFloor + ')는 0 이상, 황삭 바닥 여유(' + op.allowFloor + ') 이하여야 합니다.');
      if (Math.abs(lw - toNum(op.allowWall, 0)) < 1e-6 && Math.abs(lf - af) < 1e-6) add('error', 9, on + ': 중삭 여유가 앞 단계 여유와 같아 깎을 것이 없습니다.');
      stepChk(toNum(op.semiStep, 0), '중삭 단 깊이');
    } else if (kind === 'floor') {
      if (!(af > 1e-6)) add('error', 9, on + ': 앞 단계 바닥 여유가 0 이라 바닥 정삭할 것이 없습니다.');
    } else if (kind === 'wall') {
      if (!(toNum(op.allowWall, 0) > 1e-6)) add('error', 9, on + ': 앞 단계 측벽 여유가 0 이라 측벽 정삭할 것이 없습니다.');
      stepChk(toNum(op.wallStep, 0), '측벽 정삭 단 깊이');
    }
    if (!finish) {
      const sd = toNum(op.stepdown, NaN);
      if (!(sd >= 0.05)) add('error', 9, on + ': 절입 깊이(1회)는 0.05mm 이상이어야 합니다.');
      else if (sd > tool.dia + EPS) add('error', 9, on + ': 절입 깊이 ' + sd + 'mm 가 공구 직경 Ø' + tool.dia + ' 을 넘습니다.');
      else if (tool.flute > 0 && sd > tool.flute + EPS) add('error', 9, on + ': 절입 깊이가 공구 날 길이를 넘습니다.');
    }
    const so = toNum(op.stepover, NaN);
    if (!(so >= 10 && so <= STEPOVER_MAX)) add('error', 9, on + ': 경로 간격은 공구 직경의 10~' + STEPOVER_MAX + '% 여야 합니다 (현재 ' + op.stepover + '%).');
    if (op.shape === 'poly' && op.poly) {
      // 자유 형상: 실제 경로를 계산해 공구가 들어가는지·진입 공간이 있는지 확인
      const cleaned = G.cleanRegion(G.shapeRegion(op));
      if (cleaned.length !== 1) add('error', 5, on + ': 자유 형상 윤곽이 서로 꼬여 있거나 여러 조각입니다 (도면을 확인하세요).');
      const res = pocketMoves({ pk: op, type: op.type, z: -d.depth, r: op.r, feed: 100 }, tool, { x: 0, y: 0 }, machine);
      if (res.error) add('error', 5, on + ': ' + res.error);
      else if (res.warn && res.warn.length && kind === 'rough') res.warn.forEach(w => add('warn', 5, on + ': ' + w));
      if (!res.error && toNum(op.stepover, 50) / 100 * tool.dia > 0.95 * rt + 1e-9) add('info', 9, on + ': 자유 형상은 남는 살이 없도록 경로 간격을 공구 반경의 95%(' + r3(0.95 * rt) + 'mm) 이하로 자동 제한합니다.');
      if (mw > 0 && tool.dia > 0.8 * mw) add('warn', 5, on + ': 공구가 포켓의 가장 넓은 곳에 비해 큽니다.');
      // [V0.5 검토] 공구보다 좁은 목·뾰족한 모서리: 깎이지 않고 남는 부분 안내 (모서리 R 수준을 넘는 것만)
      if (kind === 'rough') {
        const left = G.unreachable(G.regionPaths(G.shapeRegion(op), 0, 0), rt, 0).filter(a => a > Math.max(1, 1.2 * rt * rt));
        if (left.length) add('warn', 5, on + ': 공구 Ø' + tool.dia + ' 가 들어가지 못해 깎이지 않고 남는 곳이 ' + left.length + '군데 있습니다 (가장 큰 곳 약 ' + r3(left[0]) + 'mm², 좁은 목·뾰족한 모서리). 더 작은 엔드밀로 잔삭 공정을 추가하세요.');
      }
      if (op.thru && op.poly.islands.length && kind === 'rough') add('warn', 8, on + ': 관통 포켓 안의 섬 ' + op.poly.islands.length + '개는 가공 끝에 소재에서 떨어져 나갑니다 (회전하는 공구 옆 낙하·튐 위험). 섬을 붙잡아 두는 방법(테이프·탭 남김)을 확인하세요.');
    }
    const g0 = op.shape !== 'poly' && op.entry !== 'drill' && op.entry !== 'ramp' && mw > 0 && 2 * (rt + aw) < mw - 0.02 ? loopsFor(op, rt, aw, Math.max(0.05, Math.min(STEPOVER_MAX, toNum(op.stepover, 50)) / 100) * tool.dia) : null;
    if (op.shape !== 'poly' && mw > 0 && 2 * (rt + aw) >= mw - 0.02) add('error', 5, on + ': 공구 Ø' + tool.dia + (aw ? ' + 측벽 여유' : '') + ' 가 포켓 폭 ' + r3(mw) + 'mm 보다 커서 가공할 수 없습니다.');
    else if (g0 && machine.helical !== false && Math.min(0.5 * rt, g0.fit) < HMIN_F * rt) add('error', 5, on + ': 포켓이 공구보다 너무 조금 넓어 헬리컬 진입 공간이 없습니다 (수직 하강 위험). 더 작은 엔드밀을 쓰거나 포켓을 넓히세요.');
    else if (mw > 0 && tool.dia > 0.8 * mw) add('warn', 5, on + ': 공구가 포켓 폭에 비해 큽니다 (권장: 폭의 75% 이하).');
    if (op.shape === 'rect') {
      if (op.cr > Math.min(op.w, op.h) / 2 + EPS) add('error', 5, on + ': 코너 R ' + op.cr + ' 이 포켓 폭의 절반보다 큽니다.');
      else if (op.cr < rt - EPS) add('warn', 5, on + ': 코너 R ' + op.cr + ' 이 공구 반경 ' + r3(rt) + ' 보다 작아, 모서리는 R' + r3(rt) + ' 로 남습니다.');
    }
    if (op.thru) {
      const under = toNum(st.under, 0), brk = toNum(op.brk, 0);
      if (!(brk >= 0.3)) add('error', 8, on + ': 관통 여유는 0.3mm 이상이어야 합니다.');
      else if (brk > under + EPS) add('error', 8, on + ': 관통 포켓 여유 ' + brk + 'mm 가 소재 하부 여유(패럴렐 틈) ' + under + 'mm 보다 큽니다 → 테이블·바이스 절삭 위험. 소재 아래에 받침(패럴렐)을 두고 하부 여유를 입력하세요.');
      if (kind === 'rough') add('warn', 8, on + ': 관통 포켓 — 마지막 단에서 가운데 조각이 아니라 전체를 깎아 내므로 칩이 많이 쌓입니다. 절삭유·칩 제거를 확인하세요.');
    } else if (d.depth >= st.sz - EPS) add('error', 8, on + ': 포켓 깊이 ' + d.depth + ' 가 소재 두께 ' + st.sz + ' 이상입니다. 끝까지 뚫으려면 [관통]을 체크하세요.');
    if (finish) {
      // 정삭·중삭은 앞 단계가 남긴 바닥(바닥 여유) 바로 위까지 이송 하강하고 비운 곳에서 진입하므로, 바로 앞 같은 포켓 공정이 남긴 여유와 같아야 함
      const sameShape = o => P.OPS.get(o.type) && P.OPS.get(o.type).mill === 'pocket' && o.shape === op.shape && !!o.thru === !!op.thru && JSON.stringify(o.poly || null) === JSON.stringify(op.poly || null) && ['w', 'h', 'cr', 'dia', 'depth', 'brk', 'sides', 'rot'].every(k => Math.abs(toNum(o[k], 0) - toNum(op[k], 0)) < 1e-6);
      const prev = ops.slice(0, oi).filter(sameShape).pop();
      const lv = prev ? leaveOf(prev) : null;
      const ok = lv && Math.abs(lv[0] - toNum(op.allowWall, 0)) < 1e-6 && Math.abs(lv[1] - toNum(op.allowFloor, 0)) < 1e-6;
      if (!ok) {
        if (kind === 'finish') add('error', 5, on + ': 정삭 앞에 같은 포켓(모양·크기·깊이·남김 여유가 같은)의 황삭 공정이 없습니다.');
        else add('error', 5, on + ': 바로 앞 같은 포켓 공정이 남긴 여유' + (lv ? '(측벽 ' + r3(lv[0]) + ' · 바닥 ' + r3(lv[1]) + ')' : '') + '와 이 공정의 앞 단계 여유(측벽 ' + toNum(op.allowWall, 0) + ' · 바닥 ' + toNum(op.allowFloor, 0) + ')가 다릅니다. 황삭 → 중삭 → 정삭 순서와 여유를 맞추세요.');
      }
    }
    // [V0.5] 측벽 형상(구배·입구 R·바닥 R)
    if (hasProf(op) && op.shape !== 'poly') { const res = pocketMoves({ pk: op, type: op.type, z: -d.depth, r: op.r, feed: 100 }, tool, { x: 0, y: 0 }, machine); if (res.error) add('error', 5, on + ': ' + res.error); }
    if (hasProf(op)) {
      const dr = toNum(op.draft, 0), Rt = toNum(op.topR, 0), Rf = toNum(op.floorR, 0), ps = toNum(op.profStep, 0.2);
      if (!(dr >= 0 && dr < 89)) add('error', 5, on + ': 구배는 0° 이상 89° 미만이어야 합니다.');
      else if (dr > 45) add('warn', 5, on + ': 구배 ' + dr + '° — 벽이 많이 누워 계단(높이 ' + ps + 'mm)이 넓게 보입니다. 계단 높이를 줄이거나 볼 엔드밀 가공을 고려하세요.');
      if (!(Rt >= 0 && Rf >= 0)) add('error', 5, on + ': 입구 R·바닥 R 은 0 이상이어야 합니다.');
      if (Rt + Rf > d.depth + EPS) add('error', 5, on + ': 입구 R(' + Rt + ') + 바닥 R(' + Rf + ')이 포켓 깊이(' + d.depth + ')보다 큽니다.');
      if (!(ps >= 0.05 && ps <= 2)) add('error', 9, on + ': 계단 높이는 0.05~2mm 여야 합니다.');
      const ins = profInset(op, d.depth);
      if (op.shape !== 'poly' && mw > 0 && 2 * (rt + aw + ins) >= mw - 0.02) add('error', 5, on + ': 구배·바닥 R 로 바닥이 ' + r3(ins) + 'mm 씩 좁아져 공구 Ø' + tool.dia + ' 가 들어가지 않습니다.');
      if (op.thru && Rf > 0) add('warn', 5, on + ': 관통 포켓에는 바닥 R 이 의미가 없습니다.');
      if (kind === 'profile') add('info', 9, on + ': 측벽 형상은 평 엔드밀로 ' + ps + 'mm 계단씩 깎습니다 (곡면은 계단 근사). 구배 ' + dr + '° · 입구 R' + Rt + ' · 바닥 R' + Rf + ', 가장 안쪽 ' + r3(ins) + 'mm');
    } else if (kind === 'profile') add('error', 5, on + ': 구배·입구 R·바닥 R 이 모두 0 이라 측벽 형상 정삭이 필요 없습니다.');
    if (op.entry === 'drill') {
      // 선가공 구멍: 같은 그룹의 앞 공정 중 진입점에 뚫는 드릴 (지름 ≥ 엔드밀 50%, 끝이 첫 단계 바닥까지)
      const ex = op.shape === 'poly' ? toNum(op.ex, 0) : 0, ey = op.shape === 'poly' ? toNum(op.ey, 0) : 0, zNeed = sg.levels.filter(L => !L.wall).reduce((m, L) => Math.min(m, L.z), 0);
      const tmap = P.toolMap(machine);
      const has = ops.slice(0, oi).some(o => { const def = P.OPS.get(o.type), t = tmap.get(o.toolNo); if (!def || def.role !== 'drill' || !t || !(t.dia >= 0.5 * tool.dia - EPS)) return false; const at = Array.isArray(o.at) && o.at.length ? o.at : [[0, 0]]; const dd = P.opDepth(o, t, st); return at.some(a => Math.abs(a[0] - ex) < 0.01 && Math.abs(a[1] - ey) < 0.01) && dd.z <= zNeed + 0.3 + EPS; });
      if (!has) add('error', 5, on + ': 진입 방식이 [선가공 구멍]인데, 같은 그룹 앞 공정에 진입점(X' + r3(ex) + ' Y' + r3(ey) + ')을 Z' + r3(zNeed) + ' 까지 뚫는 드릴(엔드밀 지름의 50% 이상)이 없습니다.');
    }
    if (op.entry === 'ramp' && op.shape !== 'poly' && mw > 0 && 2 * (rt + aw) < mw - 0.02) {
      const gr = loopsFor(op, rt, aw, Math.max(0.05, Math.min(STEPOVER_MAX, toNum(op.stepover, 50)) / 100) * tool.dia), il = gr && gr.loops[0];
      const ext = il ? (il.type === 'circle' ? 2 * il.rad : 2 * Math.max(il.a, il.b)) : 0;
      if (ext < rt) add('error', 5, on + ': 램프 진입 경로가 너무 짧아 사실상 수직 하강입니다. 헬리컬이나 [선가공 구멍] 진입을 쓰세요.');
    }
    if (op.entry === 'ramp' && kind === 'rough') add('info', 9, on + ': 램프 진입 — 가장 안쪽 경로를 따라 3° 경사로 내려갑니다.');
    if (machine.helical === false) add('warn', 9, on + ': 장비가 헬리컬 보간을 지원하지 않아 중심 수직 진입합니다 (중심 절삭 가능 엔드밀 필요).');
  }

  // kind: 'rough' | 'semi' | 'floor' | 'wall' | 'finish'
  function definePocket(id, label, ncName, kind, stage, params) {
    const finish = kind !== 'rough';
    return {
      id, label, code: 'G01·G03', ncName, stage, role: 'mill', family: 'mill', toolTypes: ['endmill'], pocketStage: kind,
      defaults: Object.assign({ depth: 5, r: 3 }, params, finish ? { stepover: 40 } : {}),
      params, normalize: normalizeParams, moves: pocketMoves, mill: 'pocket',
      regions: (op, h, st) => [region(op, h, st)],
      ui: { q: false, dwell: false, thru: false, depthMode: false, pocket: true },
      depth(op, tool, st) { const dd = pocketDepth(op, st); return { depth: r3(dd), full: r3(dd), tip: 0, z: r3(-dd) }; },
      ref: (tool, matKey) => MC.ref(tool, matKey, finish ? 'finish' : 'rough'),
      recommend: MC.recommend(finish ? 'finish' : 'rough'),
      conditions: H.conditionsWith({ tap: false }),
      validate(ctx) {
        H.validateConditions(ctx);
        const { tool, d, on, add } = ctx;
        if (!(d.depth > 0)) add('error', 8, on + ': 포켓 깊이가 0 이하입니다.');
        if (tool.flute > 0 && d.depth > tool.flute + EPS) add('error', 8, on + ': 포켓 깊이 ' + d.depth + ' 가 공구 유효 날 길이 ' + tool.flute + ' 를 넘습니다.');
        validatePocket(ctx, kind);
        H.validateRPlane(ctx);
        if (toNum(ctx.op.r, 0) < 1 - EPS) add('error', 10, on + ': 포켓 R점은 소재 상면 위 1mm 이상이어야 합니다 (급속 하강 안전 거리).');
      },
      toolpath: () => ({ kind: 'path', spindle: 'cw' })
    };
  }
  P.OPS.register(definePocket('pocketRough', '포켓 황삭', 'POCKET ROUGH', 'rough', 0, PARAMS));
  P.OPS.register(definePocket('pocketSemi', '포켓 중삭', 'POCKET SEMI', 'semi', 0.2, SEMI_PARAMS));
  P.OPS.register(definePocket('pocketFloor', '포켓 바닥 정삭', 'POCKET FLOOR', 'floor', 0.4, PARAMS));
  P.OPS.register(definePocket('pocketWall', '포켓 측벽 정삭', 'POCKET WALL', 'wall', 0.45, WALL_PARAMS));
  P.OPS.register(definePocket('pocketProfile', '포켓 측벽 형상(구배·R)', 'POCKET PROFILE', 'profile', 0.47, PARAMS));
  P.OPS.register(definePocket('pocketFinish', '포켓 정삭', 'POCKET FINISH', 'finish', 0.5, PARAMS));

  // 프로젝트의 포켓 영역 목록 (독립 NC 검증기의 과삭 검사용: 모델 데이터에서 직접 계산)
  // 포켓 1개의 허용 영역 (검증기용, 절대 좌표). 자유 형상은 다각형 그대로 넘긴다
  function region(o, h, st) {
    const floorZ = -pocketDepth(o, st);
    if (hasProf(o)) { const rg = { kind: 'area', outer: G.ccw(G.shapeRegion(o).outer).map(p => [p[0] + h.x, p[1] + h.y]), islands: (G.shapeRegion(o).islands || []).map(a => a.map(p => [p[0] + h.x, p[1] + h.y])), floorZ }; rg.prof = { draft: toNum(o.draft, 0), topR: toNum(o.topR, 0), floorR: toNum(o.floorR, 0), depth: -floorZ }; return rg; }
    if (o.shape === 'poly' && o.poly) return { kind: 'area', outer: o.poly.outer.map(p => [p[0] + h.x, p[1] + h.y]), islands: o.poly.islands.map(a => a.map(p => [p[0] + h.x, p[1] + h.y])), floorZ };
    return { shape: o.shape, cx: h.x, cy: h.y, w: toNum(o.w, 0), h: toNum(o.h, 0), cr: toNum(o.cr, 0), dia: toNum(o.dia, 0), floorZ };
  }
  // 프로젝트 전체의 밀링 허용 영역 (포켓·윤곽·평면·모따기 모듈이 각자 regions() 로 제공)
  function pocketRegions(project, machine) {
    const out = [], tm = machine ? P.toolMap(machine) : new Map();
    // [V0.5] 먼저 가공된 바닥 기준(자동)이면 각 영역 바닥을 그 기준면만큼 내림 (계획과 같은 값)
    const refMap = new Map();
    if (machine && project.settings && project.settings.depthRef === 'auto') P.buildPlan(project, machine).steps.forEach(s => { if (s.ref) s.holes.forEach(h => refMap.set(h.gid + '|' + h.hid + '|' + s.type, s.ref)); });
    project.groups.forEach(g => g.ops.forEach(o => {
      const def = P.OPS.get(o.type);
      if (!def || !def.regions) return;
      const tool = tm.get(o.toolNo) || null;
      g.holes.forEach(h => { if (P.isNum(h.x) && P.isNum(h.y)) def.regions(o, h, project.stock, tool).forEach(r => { const t = refMap.get(g.id + '|' + h.id + '|' + o.type); if (t) { r.floorZ = P.r3(r.floorZ + t); r.top = t; } out.push(r); }); });
    }));
    return out;
  }
  // 공구 중심이 포켓 영역 안인지 (공구 반경만큼 안쪽, 허용오차 tol)
  function inPocketRegion(reg, x, y, rt, tol) {
    const dx = Math.abs(x - reg.cx), dy = Math.abs(y - reg.cy);
    if (reg.shape === 'circle') return Math.hypot(dx, dy) <= reg.dia / 2 - rt + tol;
    const ax = reg.w / 2 - rt + tol, ay = reg.h / 2 - rt + tol;
    if (dx > ax || dy > ay) return false;
    if (reg.cr > rt) {
      const kx = reg.w / 2 - reg.cr, ky = reg.h / 2 - reg.cr;
      if (dx > kx && dy > ky) return Math.hypot(dx - kx, dy - ky) <= reg.cr - rt + tol;
    }
    return true;
  }

  Object.assign(P, { pocketMoves, pocketProfOff: profOff, pocketProfInset: profInset, pocketHasProf: hasProf, pocketStage: stageOf, pocketLeave: leaveOf, POCKET_ENTRIES: ENTRIES, pocketRegions, millRegions: pocketRegions, inPocketRegion, pocketExtent: extent, pocketMinWidth: minWidth, pocketDepth, normPoly, POCKET_PARAMS: PARAMS, STEPOVER_MAX });
})(typeof globalThis !== 'undefined' ? globalThis : this);
