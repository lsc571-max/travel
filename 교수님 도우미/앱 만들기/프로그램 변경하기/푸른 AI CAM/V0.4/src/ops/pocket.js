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
 * 의존: engine/*, ops/registry.js, ops/hole-common.js (절삭 조건 공통 검증)
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM, H = P.HOLE;
  const { MATERIALS, toNum, r3, EPS } = P;
  const RAMP_DEG = 3;           // 헬리컬 경사각
  const STEPOVER_MAX = 75;      // 경로 간격 상한 (% of D) — 루프 사이 남는 살 방지

  // 포켓 공통 매개변수 (공정에 저장)
  const PARAMS = { shape: 'rect', w: 40, h: 30, cr: 5, dia: 30, stepover: 50, stepdown: 2, allowWall: 0.2, allowFloor: 0.1 };
  const SHAPES = ['rect', 'circle'];

  /* ---------- 절삭 조건 (엔드밀) ---------- */
  const mat = k => MATERIALS[k] || MATERIALS.S45C;
  function emRef(tool, matKey, finish) {
    const m = mat(matKey), carb = tool.mat === 'CARBIDE';
    const fz = Math.min(0.08, Math.max(0.01, 0.005 * tool.dia)) * m.fFactor * (finish ? 0.7 : 1);
    return { vc: carb ? m.emCarb : m.emHss, fpr: fz * Math.max(1, toNum(tool.z, 3)), fz };
  }
  function recommendEm(finish) {
    return function (tool, matKey, machine) {
      const ref = emRef(tool, matKey, finish);
      let rpm = Math.max(10, Math.round(ref.vc * 1000 / (Math.PI * tool.dia) / 10) * 10), limited = false;
      if (rpm > machine.maxRpm) { rpm = Math.floor(machine.maxRpm / 10) * 10; limited = true; }
      let feed = Math.max(1, Math.round(rpm * ref.fpr));
      if (feed > machine.maxFeed) { feed = machine.maxFeed; limited = true; }
      return { rpm, feed, limited };
    };
  }

  /* ---------- 형상 ---------- */
  function extent(o) { return o.shape === 'circle' ? { ex: toNum(o.dia, 0) / 2, ey: toNum(o.dia, 0) / 2 } : { ex: toNum(o.w, 0) / 2, ey: toNum(o.h, 0) / 2 }; }
  function minWidth(o) { return o.shape === 'circle' ? toNum(o.dia, 0) : Math.min(toNum(o.w, 0), toNum(o.h, 0)); }

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
    const pk = s.pk, rt = tool.dia / 2, D = tool.dia;
    const finish = s.type === 'pocketFinish';
    const aw = finish ? 0 : toNum(pk.allowWall, 0), af = finish ? 0 : toNum(pk.allowFloor, 0);
    const so = Math.max(0.05, Math.min(STEPOVER_MAX, toNum(pk.stepover, 50)) / 100) * D;
    const depth = -s.z, F = s.feed, Fr = Math.max(1, Math.round(F * 0.5));
    const geo = loopsFor(pk, rt, aw, so);
    if (!geo) return { sx: c.x, sy: c.y, moves: [], error: '공구가 포켓보다 큽니다.' };
    const levels = [];
    if (finish) levels.push(-depth);
    else {
      const total = depth - af, sd = Math.max(0.05, toNum(pk.stepdown, 1));
      const n = Math.max(1, Math.ceil(total / sd - 1e-9));
      for (let i = 1; i <= n; i++) levels.push(-total * i / n);
    }
    const helical = machine.helical !== false;
    const rh = Math.min(0.5 * rt, geo.fit);
    const useHelix = helical && rh >= 0.1;
    const cx = c.x, cy = c.y, M = [];
    const push = (g, x, y, z, f, ij) => M.push(Object.assign({ g, x: r3(x), y: r3(y), z: r3(z), f }, ij || {}));
    const hx = useHelix ? cx + rh : cx;
    let z = 0.5;
    push(1, hx, cy, z, Fr); // R점 → 소재 위 0.5mm
    if (finish) {
      // 황삭으로 이미 파인 공간: 황삭 바닥 + 0.2 까지 이송 하강 후 마지막 구간만 헬리컬
      const zPre = Math.min(0.5, r3(-(depth - toNum(pk.allowFloor, 0)) + 0.2));
      if (zPre < z) { push(1, hx, cy, zPre, Fr); z = zPre; }
    }
    levels.forEach((zl, li) => {
      if (li > 0) push(1, hx, cy, z, F); // 중심으로 복귀
      if (useHelix) {
        const per = Math.max(0.05, Math.min(toNum(pk.stepdown, 1), 2 * Math.PI * rh * Math.tan(RAMP_DEG * Math.PI / 180)));
        const turns = Math.max(1, Math.ceil((z - zl) / per - 1e-9));
        for (let k = 1; k <= turns; k++) push(3, hx, cy, z - (z - zl) * k / turns, Fr, { i: r3(-rh), j: 0 });
        push(3, hx, cy, zl, F, { i: r3(-rh), j: 0 }); // 바닥 평탄화 1회전
      } else push(1, cx, cy, zl, Math.max(1, Math.round(F * 0.3)));
      // 중심선 (사각, 긴 축)
      if (geo.line) {
        const l = geo.line;
        if (l.ax === 'x') { push(1, cx - l.h, cy, zl, F); push(1, cx + l.h, cy, zl, F); }
        else { push(1, cx, cy - l.h, zl, F); push(1, cx, cy + l.h, zl, F); }
      }
      geo.loops.forEach(lp => {
        if (lp.type === 'circle') {
          push(1, cx + lp.rad, cy, zl, F);
          push(3, cx + lp.rad, cy, zl, F, { i: r3(-lp.rad), j: 0 });
        } else rectLoop(push, cx, cy, zl, lp, F);
      });
      z = zl;
    });
    // 벽에서 안쪽으로 0.5mm 떨어진 뒤 상승 (포스트에서 G00)
    const last = M[M.length - 1];
    const back = Math.min(0.5, geo.fit);
    push(1, last.x - back, last.y, last.z, F);
    return { sx: hx, sy: cy, moves: M };
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
  function validatePocket(ctx, finish) {
    const { op, oi, ops, tool, d, st, on, add, machine } = ctx;
    const rt = tool.dia / 2;
    if (!SHAPES.includes(op.shape)) add('error', 5, on + ': 포켓 모양이 올바르지 않습니다.');
    const mw = minWidth(op);
    if (op.shape === 'circle') { if (!(op.dia > 0)) add('error', 5, on + ': 원형 포켓 지름이 0 이하입니다.'); }
    else if (!(op.w > 0 && op.h > 0)) add('error', 5, on + ': 사각 포켓 가로·세로가 0 이하입니다.');
    const aw = finish ? 0 : toNum(op.allowWall, 0), af = finish ? 0 : toNum(op.allowFloor, 0);
    if (!finish) {
      if (!(aw >= 0 && aw <= 2)) add('error', 9, on + ': 측벽 여유는 0~2mm 범위여야 합니다.');
      if (!(af >= 0 && af <= 2)) add('error', 9, on + ': 바닥 여유는 0~2mm 범위여야 합니다.');
      if (af >= d.depth) add('error', 9, on + ': 바닥 여유가 포켓 깊이 이상입니다.');
      const sd = toNum(op.stepdown, NaN);
      if (!(sd >= 0.05)) add('error', 9, on + ': 절입 깊이(1회)는 0.05mm 이상이어야 합니다.');
      else if (sd > tool.dia + EPS) add('error', 9, on + ': 절입 깊이 ' + sd + 'mm 가 공구 직경 Ø' + tool.dia + ' 을 넘습니다.');
      else if (tool.flute > 0 && sd > tool.flute + EPS) add('error', 9, on + ': 절입 깊이가 공구 날 길이를 넘습니다.');
    }
    const so = toNum(op.stepover, NaN);
    if (!(so >= 10 && so <= STEPOVER_MAX)) add('error', 9, on + ': 경로 간격은 공구 직경의 10~' + STEPOVER_MAX + '% 여야 합니다 (현재 ' + op.stepover + '%).');
    const g0 = mw > 0 && 2 * (rt + aw) < mw - 0.02 ? loopsFor(op, rt, aw, Math.max(0.05, Math.min(STEPOVER_MAX, toNum(op.stepover, 50)) / 100) * tool.dia) : null;
    if (mw > 0 && 2 * (rt + aw) >= mw - 0.02) add('error', 5, on + ': 공구 Ø' + tool.dia + (aw ? ' + 측벽 여유' : '') + ' 가 포켓 폭 ' + r3(mw) + 'mm 보다 커서 가공할 수 없습니다.');
    else if (g0 && machine.helical !== false && Math.min(0.5 * rt, g0.fit) < 0.1) add('error', 5, on + ': 포켓이 공구보다 너무 조금 넓어 헬리컬 진입 공간이 없습니다 (수직 하강 위험). 더 작은 엔드밀을 쓰거나 포켓을 넓히세요.');
    else if (mw > 0 && tool.dia > 0.8 * mw) add('warn', 5, on + ': 공구가 포켓 폭에 비해 큽니다 (권장: 폭의 75% 이하).');
    if (op.shape === 'rect') {
      if (op.cr > Math.min(op.w, op.h) / 2 + EPS) add('error', 5, on + ': 코너 R ' + op.cr + ' 이 포켓 폭의 절반보다 큽니다.');
      else if (op.cr < rt - EPS) add('warn', 5, on + ': 코너 R ' + op.cr + ' 이 공구 반경 ' + r3(rt) + ' 보다 작아, 모서리는 R' + r3(rt) + ' 로 남습니다.');
    }
    if (d.depth >= st.sz - EPS) add('error', 8, on + ': 포켓 깊이 ' + d.depth + ' 가 소재 두께 ' + st.sz + ' 이상입니다 (관통 포켓은 지원하지 않음).');
    if (finish) {
      // 정삭은 황삭이 남긴 바닥(바닥 여유) 바로 위까지 이송 하강하므로, 남김 여유까지 같아야 함
      const sameGeo = o => o.type === 'pocketRough' && o.shape === op.shape && ['w', 'h', 'cr', 'dia', 'depth', 'allowWall', 'allowFloor'].every(k => Math.abs(toNum(o[k], 0) - toNum(op[k], 0)) < 1e-6);
      if (!ops.slice(0, oi).some(sameGeo)) add('error', 5, on + ': 정삭 앞에 같은 포켓(모양·크기·깊이·남김 여유가 같은)의 황삭 공정이 없습니다.');
    }
    if (machine.helical === false) add('warn', 9, on + ': 장비가 헬리컬 보간을 지원하지 않아 중심 수직 진입합니다 (중심 절삭 가능 엔드밀 필요).');
  }

  function definePocket(id, label, ncName, finish) {
    return {
      id, label, code: 'G01·G03', ncName, stage: finish ? 0.5 : 0, role: 'mill', family: 'mill', toolTypes: ['endmill'],
      defaults: Object.assign({ depth: 5, r: 3 }, PARAMS, finish ? { stepover: 40 } : {}),
      params: PARAMS,
      ui: { q: false, dwell: false, thru: false, depthMode: false, pocket: true },
      depth(op) { const dd = toNum(op.depth, 0); return { depth: r3(dd), full: r3(dd), tip: 0, z: r3(-dd) }; },
      ref: (tool, matKey) => emRef(tool, matKey, finish),
      recommend: recommendEm(finish),
      conditions: H.conditionsWith({ tap: false }),
      validate(ctx) {
        H.validateConditions(ctx);
        const { tool, d, on, add } = ctx;
        if (!(d.depth > 0)) add('error', 8, on + ': 포켓 깊이가 0 이하입니다.');
        if (tool.flute > 0 && d.depth > tool.flute + EPS) add('error', 8, on + ': 포켓 깊이 ' + d.depth + ' 가 공구 유효 날 길이 ' + tool.flute + ' 를 넘습니다.');
        validatePocket(ctx, finish);
        H.validateRPlane(ctx);
        if (toNum(ctx.op.r, 0) < 1 - EPS) add('error', 10, on + ': 포켓 R점은 소재 상면 위 1mm 이상이어야 합니다 (급속 하강 안전 거리).');
      },
      toolpath: () => ({ kind: 'path', spindle: 'cw' })
    };
  }
  P.OPS.register(definePocket('pocketRough', '포켓 황삭', 'POCKET ROUGH', false));
  P.OPS.register(definePocket('pocketFinish', '포켓 정삭', 'POCKET FINISH', true));

  // 프로젝트의 포켓 영역 목록 (독립 NC 검증기의 과삭 검사용: 모델 데이터에서 직접 계산)
  function pocketRegions(project) {
    const out = [];
    project.groups.forEach(g => {
      const mill = g.ops.filter(o => o.type === 'pocketRough' || o.type === 'pocketFinish');
      if (!mill.length) return;
      mill.forEach(o => g.holes.forEach(h => {
        if (!P.isNum(h.x) || !P.isNum(h.y)) return;
        out.push({ shape: o.shape, cx: h.x, cy: h.y, w: toNum(o.w, 0), h: toNum(o.h, 0), cr: toNum(o.cr, 0), dia: toNum(o.dia, 0), floorZ: -toNum(o.depth, 0) });
      }));
    });
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

  Object.assign(P, { pocketMoves, pocketRegions, inPocketRegion, pocketExtent: extent, pocketMinWidth: minWidth, POCKET_PARAMS: PARAMS, STEPOVER_MAX });
})(typeof globalThis !== 'undefined' ? globalThis : this);
