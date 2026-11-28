/* =====================================================================
 * 푸른 AI CAM - [검증 모듈: 독립 NC 검증기 FANUC] verify/nc-fanuc.js
 * 역할: 포스트프로세서와 별도의 코드로 NC 텍스트를 한 줄씩 해석·시뮬레이션하여
 *       문법·모달 상태·이동 경로·충돌·탭 이송을 검사하고, 생성기 결과와 교차 비교한다.
 *       사용자가 직접 수정한 NC 도 이 검증기를 통과해야 출력할 수 있다.
 * 의존: engine/common.js, 가공 모듈의 참고 절삭 조건표(refConditions) — 포스트프로세서(생성기) 코드에는 의존하지 않음
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  const { EPS, CLAMP_MARGIN, toNum, r3, fmt, toolMap, stockRect, segRectHit, clampRect, inRect, tipLength } = P;
  /* ---------------- 독립 NC 검증기 (G코드 해석·시뮬레이션) ----------------
   * 생성기와 별도로 NC 텍스트를 한 줄씩 해석하여 모달 상태를 추적하고
   * 문법, 이동 경로, 소재/클램프 충돌, 조건을 검사한다. 사용자 수정 NC도 동일하게 검사. */
  const ALLOWED_G = new Set([0, 1, 2, 3, 4, 17, 21, 28, 40, 43, 49, 54, 55, 56, 57, 58, 59, 73, 76, 80, 81, 82, 83, 84, 85, 86, 90, 91, 94, 98, 99]);
  const CYCLES = [73, 76, 81, 82, 83, 84, 85, 86]; // [V0.6] G76 정밀 보링·G85 리머·G86 보링
  const ALLOWED_M = new Set([0, 1, 2, 3, 5, 6, 8, 9, 29, 30]);
  // FANUC 모달 그룹 (같은 그룹 동시 지령 금지 검사용)
  const GROUPS = [['00 비모달', [4, 28]], ['01 이동', [0, 1, 2, 3]], ['02 평면', [17]], ['03 절대/증분', [90, 91]], ['05 이송', [94]], ['06 단위', [21]],
    ['07 반경보정', [40]], ['08 공구길이', [43, 49]], ['09 고정사이클', [73, 76, 80, 81, 82, 83, 84, 85, 86]], ['10 복귀', [98, 99]], ['14 좌표계', [54, 55, 56, 57, 58, 59]]];
  // 이동을 0.5mm 간격 점으로 나눔 (직선·원호, Z 는 선형 보간)
  function sampleMove(x0, y0, z0, x1, y1, z1, arc) {
    const pts = [];
    if (z0 === Infinity) z0 = z1;
    if (!arc) {
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0), n = Math.max(1, Math.ceil(len / 0.5));
      for (let i = 0; i <= n; i++) { const t = i / n; pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, z: z0 + (z1 - z0) * t }); }
      return pts;
    }
    const a0 = Math.atan2(y0 - arc.cy, x0 - arc.cx), a1 = Math.atan2(y1 - arc.cy, x1 - arc.cx), TAU = Math.PI * 2;
    let sw = arc.ccw ? (a1 - a0) : (a0 - a1);
    sw = ((sw % TAU) + TAU) % TAU; if (sw < 1e-9) sw = TAU; // 시작=끝 → 전체 원
    const n = Math.max(4, Math.ceil(sw * arc.r / 0.5));
    for (let i = 0; i <= n; i++) { const t = i / n, a = a0 + (arc.ccw ? 1 : -1) * sw * t; pts.push({ x: arc.cx + arc.r * Math.cos(a), y: arc.cy + arc.r * Math.sin(a), z: z0 + (z1 - z0) * t }); }
    return pts;
  }
  /* ---------- [V0.5] 밀링 허용 영역 판정 (생성기·Clipper 와 독립된 직접 계산) ---------- */
  function pip(poly, x, y) { // 짝수-홀수 규칙
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  function edgeDist(poly, x, y) {
    let d = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i], vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
      let t = L2 > 0 ? ((x - a[0]) * vx + (y - a[1]) * vy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      d = Math.min(d, Math.hypot(x - a[0] - t * vx, y - a[1] - t * vy));
    }
    return d;
  }
  // 공구 유효 반경: 모따기 공구는 깊이에 따라 (끝 반경 + 깊이 × tan(각/2)), 최대 직경/2
  function effRad(tool, z) {
    if (!tool) return 0;
    const R = tool.dia / 2;
    if (tool.type !== 'chamfer') return R;
    return Math.min(R, Math.max(0, toNum(tool.tip, 0)) / 2 + Math.max(0, -z) * Math.tan(toNum(tool.angle, 90) / 2 * Math.PI / 180));
  }
  const TOL = 0.01;
  // [V0.5] 측벽 형상(구배·입구 R·바닥 R): 윗면에서 깊이 u 인 곳의 벽이 도면 윤곽보다 바깥(+)/안쪽(−)으로 있는 거리 (검증기 자체 계산)
  function wallShift(pf, u) {
    const tn = Math.tan(Math.max(0, Math.min(89, pf.draft || 0)) * Math.PI / 180);
    let o = -Math.max(0, u) * tn;
    const Rt = pf.topR || 0, Rf = pf.floorR || 0, hf = pf.depth - u;
    if (Rt > 0 && u < Rt) { const k = Rt - Math.max(0, u); o += Rt - Math.sqrt(Math.max(0, Rt * Rt - k * k)); }
    if (Rf > 0 && hf < Rf) { const k = Rf - Math.max(0, hf); o -= Rf - Math.sqrt(Math.max(0, Rf * Rf - k * k)); }
    return o;
  }
  function regionOk(rg, x, y, z, tool) {
    if (z < rg.floorZ - 0.005) return false;
    let r = effRad(tool, z - (rg.top || 0)); // [V0.5 검토] 먼저 깎인 면(평면 등) 기준 깊이로 모따기 유효 반경
    // 평 엔드밀 바닥(z)에서 벽까지 거리: 공구는 z 위로 원통이므로 z 높이의 벽 위치로 판정 (벽은 아래로만 좁아짐)
    if (rg.prof) r -= wallShift(rg.prof, (rg.top || 0) - z);
    if (!rg.kind) return P.inPocketRegion(rg, x, y, r, TOL); // 사각·원형 포켓 (V0.4 규칙)
    if (rg.kind === 'face') return x >= rg.x0 && x <= rg.x1 && y >= rg.y0 && y <= rg.y1;
    if (rg.kind === 'area') {
      if (!pip(rg.outer, x, y) || rg.islands.some(isl => pip(isl, x, y))) return false;
      return Math.min(edgeDist(rg.outer, x, y), ...rg.islands.map(isl => edgeDist(isl, x, y))) >= r - TOL;
    }
    // [V0.5 검토] 모따기 허용(부품 쪽으로 모따기 폭만큼)은 모따기 공구에만 적용 — 엔드밀이 모따기 영역으로 부품을 파고드는 것 차단
    const ch = tool && tool.type === 'chamfer';
    const inside = pip(rg.part, x, y), d = edgeDist(rg.part, x, y), need = r - (ch ? rg.chamfer || 0 : 0) - TOL;
    if (rg.kind === 'outside') return !inside && d >= need && d <= rg.dMax + TOL;
    if (rg.kind === 'inside') return inside && d >= need && (d <= rg.dMax + TOL || (rg.centerOk && ch));
    return false;
  }
  const MILL_TOOLS = { endmill: 'pocketRough', facemill: 'faceMill', chamfer: 'chamferMill' };

  function verifyNC(text, ctx) {
    const errors = [], warnings = [], hits = [], moves = [];
    const E = (ln, m) => { if (errors.length < 200) errors.push({ line: ln, msg: m }); };
    const W = (ln, m) => { if (warnings.length < 200) warnings.push({ line: ln, msg: m }); };
    const stock = ctx.stock, machine = ctx.machine, clamps = ctx.clamps || [];
    const sr = stockRect(stock);
    const bottom = -(stock.sz + toNum(stock.under, 0));
    const tm = toolMap(machine);
    const drilled = new Map(); // 위치별 드릴 구멍 기록 (탭 기초 구멍 확인용)
    const cuts = [], motions = []; // 절삭 이동 끝점(교차 비교) · 전체 이동(3D 시뮬레이션용)
    const regions = ctx.pockets || []; // 포켓 영역 (모델 데이터에서 계산, 과삭 검사)
    const zHome = toNum(ctx.settings && ctx.settings.initialZ, 50) + 50; // 원점 복귀 높이 (표시용)
    const mz = z => (z === Infinity || z === null ? zHome : z);
    const wantWcs = ctx.settings && /^G5[4-9]$/.test(ctx.settings.wcs) ? parseInt(ctx.settings.wcs.slice(1), 10) : null;
    let wcsChecked = false;
    const zSafe = Math.max(1, ...(ctx.clamps || []).map(c => c.height + CLAMP_MARGIN)); // XY 미지정 상태 하강 한계
    const cutPts = []; // [V0.4] 엔드밀이 이미 깎은 점 (수직 하강 검사용)
    const drillTips = [];
    let run = null;
    // 하강 구간 끝: 깎이지 않은 소재로 0.3mm 넘게 들어갔는데 XY 폭이 작으면 차단 (모따기 공구는 0.05mm)
    function endRun() {
      const r = run; run = null;
      if (!r) return;
      const t = tm.get(r.tool); if (!t) return;
      const R = t.dia / 2, ext = Math.max(r.maxx - r.minx, r.maxy - r.miny);
      if (t.type !== 'chamfer' && !(ext < 0.5 * R)) return; // 충분히 넓은 헬리컬·경사
      const into = Math.min(0, clearedTo(r.sx, r.sy, effRad(t, r.sz), undefined, r.seq)) - r.zEnd; // 하강 시작 전 그 자리 윗면 기준
      if (r.maxx + R < sr.x0 || r.minx - R > sr.x1 || r.maxy + R < sr.y0 || r.miny - R > sr.y1) return; // 소재 밖
      const pre = cutPts.slice(0, r.nCut), tips = drillTips.slice(0, r.nTip);
      if (t.type === 'chamfer') {
        if (into > 0.05 && r.zEnd < -0.05) {
          const re = effRad(t, r.zEnd);
          if (!pre.some(q => q.z <= r.zEnd + 0.05 && Math.hypot(q.x - r.x, q.y - r.y) + re <= q.r + 0.05)) E(r.ln, '모따기 공구 T' + t.no + ' 가 깎이지 않은 소재로 Z' + fmt(r.zEnd) + ' 까지 내려가며 절삭 (헬리컬·경사 포함) — 모따기 공구는 바닥을 깎지 못합니다. 윤곽·포켓·구멍 가공 뒤 모서리만 모따기 하세요.');
        }
      } else if (into > 0.3 && ext < 0.5 * R && machine.helical !== false) {
        const ok = pre.some(q => q.z <= r.zEnd + 0.3 && Math.hypot(q.x - r.x, q.y - r.y) <= R * 0.6 + 1e-6) || tips.some(q => q.z <= r.zEnd + 0.3 && Math.hypot(q.x - r.x, q.y - r.y) + 0.25 * R <= q.r + 1e-6);
        if (!ok) E(r.ln, '진입 경로의 폭(' + fmt(ext) + 'mm)이 공구 지름의 25%보다 작아 사실상 수직 하강입니다 (Z' + fmt(r.zEnd) + ' 까지, 엔드밀 파손 위험). 헬리컬을 크게 하거나 선가공 구멍으로 진입하세요.');
      }
    } // [V0.5] 드릴 구멍 (끝 깊이): 엔드밀 중심부(반경의 25%)가 구멍 안이고 구멍 끝이 하강 깊이까지면 선가공 구멍 진입으로 허용
    // [V0.5] 깎인 점 공간 격자 (5mm 칸): 위치별 '이미 깎인 깊이' 조회
    const cutGrid = new Map(), CG = 5;
    // [V0.5 검토] 0.2mm·반경 0.1mm 단위로 같은 자리는 가장 깊은 것만 보관 (긴 프로그램에서 검사 시간이 폭증하지 않게)
    let maxCutR = 0, cutSeq = 0;
    const addCut = q => {
      const k = Math.floor(q.x / CG) + ',' + Math.floor(q.y / CG); let a = cutGrid.get(k); if (!a) cutGrid.set(k, a = new Map());
      const kk = Math.round(q.x * 5) + ',' + Math.round(q.y * 5) + ',' + Math.round(q.r * 10), o = a.get(kk);
      if (o && o.z <= q.z) return;
      q.i = cutSeq++; a.set(kk, q); if (q.r > maxCutR) maxCutR = q.r;
      if (cutPts.length < 400000) cutPts.push(q);
    };
    // (x, y) 에서 반경 rad 원 전체가 들어가는 깎인 원(공구 자국)들 중 가장 깊은 바닥. 없으면 Infinity (= 깎이지 않음)
    // (x, y) 반경 rad 원 전체가 깎인 깊이: 한 공구 자국이 원 전체를 덮으면 그 바닥, 아니면
    // [V0.5] 여러 자국의 합(원 안 37점 표본이 모두 덮여야 함)으로 판정 — 가장 얕게 깎인 표본의 깊이. 없으면 Infinity
    const cellsNear = (x, y, f) => {
      const gx = Math.floor(x / CG), gy = Math.floor(y / CG), span = Math.min(8, Math.ceil(maxCutR / CG) + 1);
      for (let i = gx - span; i <= gx + span; i++) for (let j = gy - span; j <= gy + span; j++) { const a = cutGrid.get(i + ',' + j); if (a) for (const q of a.values()) f(q); }
    };
    // [V0.6] 공구별로 나눈 NC: 앞 파일들이 깎은 상태(자국·드릴 구멍)를 이어받아 검사 (ctx.carryIn = 앞 결과의 carry)
    if (ctx.carryIn) {
      (ctx.carryIn.cuts || []).forEach(q => addCut({ x: q.x, y: q.y, z: q.z, r: q.r }));
      (ctx.carryIn.drilled || []).forEach(([k, v]) => drilled.set(k, v.slice()));
      (ctx.carryIn.tips || []).forEach(q => drillTips.push(Object.assign({}, q)));
    }
    const SAMP = [[0, 0]];
    [[0.35, 8], [0.7, 12], [1, 16]].forEach(([f, n]) => { for (let k = 0; k < n; k++) SAMP.push([f * Math.cos(2 * Math.PI * k / n), f * Math.sin(2 * Math.PI * k / n)]); });
    // need: 이 깊이 이하로 깎였는지만 알면 될 때 (빠른 판정)
    // before: 이 순번 이전에 깎인 자국만 (하강 구간 시작 시점의 상태)
    const clearedTo = (x, y, rad, need, before) => {
      if (!cutGrid.size) return Infinity;
      const lim = need === undefined ? -Infinity : need, bi = before === undefined ? Infinity : before;
      let best = Infinity;
      cellsNear(x, y, q => { if (q.z < best && q.i < bi && Math.hypot(q.x - x, q.y - y) + rad <= q.r - 0.05) best = q.z; });
      if (best <= lim) return best;
      let worst = -Infinity;
      for (const sp of SAMP) {
        const px = x + sp[0] * rad, py = y + sp[1] * rad;
        let b = Infinity;
        cellsNear(px, py, q => { if (q.z < b && q.i < bi && Math.hypot(q.x - px, q.y - py) <= q.r - 0.05) b = q.z; });
        if (b === Infinity || b > best) return best; // 합으로도 더 깊지 않음
        if (b > worst) worst = b;
      }
      return Math.min(best, worst);
    };
    // 그 위치의 현재 윗면 높이 (깎인 바닥 또는 0)
    const surfAt = (x, y, rad) => Math.min(0, clearedTo(x, y, rad));
    const s = { plane: null, feedMode: null, units: null, abs: true, motion: null, cycle: null, ret: 98, h: null, hNeed: true, tool: null, nextT: null, spin: false, S: 0, F: 0,
      m29: false, m29S: 0, x: null, y: null, z: Infinity, cz: null, cr: null, cq: null, cp: 0, initZ: null, cool: false, ended: false, wcs: null };
    let pct = 0, hasO = false, unitsWarned = false, sawMotion = false;
    const lines = String(text).split(/\r?\n/);
    const clampHit = (x0, y0, x1, y1, z, rad, ln, what, holder) => {
      // [V0.6] 공구 홀더도 같은 경로로 검사 (돌출 길이·홀더 지름이 입력된 공구만): 홀더 밑면 = 공구 끝 + 돌출 길이
      const ht = !holder && s.tool !== null ? tm.get(s.tool) : null;
      if (ht && ht.stick > 0 && ht.holderDia > 0) clampHit(x0, y0, x1, y1, z + ht.stick, ht.holderDia / 2, ln, what.replace(/ 경로| 이동/, '') + ' 중 홀더(T' + ht.no + ')', true);
      clamps.forEach((c, ci) => {
        if (z <= c.height + CLAMP_MARGIN - EPS) {
          const r = clampRect(c, rad + 1);
          const hit = (x0 === null || y0 === null) ? inRect(x1, y1, r) : segRectHit(x0, y0, x1, y1, r);
          if (hit) E(ln, what + ' 경로가 Z' + fmt(z) + ' 높이에서 클램프 ' + (ci + 1) + '(높이 ' + c.height + ')와 충돌합니다.');
        }
      });
    };
    // [V0.6] 홀더가 소재(깎이지 않은 곳) 안으로 들어가는지: 홀더 밑면 높이에서 홀더 원이 모두 깎인 곳이어야 함
    const holderDeep = (tool, x, y, z, ln) => {
      if (!tool || !(tool.stick > 0) || x === null || y === null) return;
      const zh = z + tool.stick, hr = tool.holderDia > 0 ? tool.holderDia / 2 : tool.dia / 2;
      if (zh >= -EPS) return;
      if (!overStock(x, y, hr)) return;
      if (clearedTo(x, y, hr, zh + 0.05) <= zh + 0.05) return;
      E(ln, 'T' + tool.no + ' 홀더(돌출 길이 ' + tool.stick + 'mm)가 Z' + fmt(r3(zh)) + ' 까지 내려가 소재에 닿습니다 (공구 끝 Z' + fmt(z) + '). 돌출 길이를 늘리거나 깊이를 확인하세요.');
    };
    const overStock = (x, y, rad) => x !== null && y !== null && x + rad > sr.x0 && x - rad < sr.x1 && y + rad > sr.y0 && y - rad < sr.y1;
    // 이동 선분 전체가 소재(공구 반경만큼 확장)를 지나는지 (끝점만 보면 관통 이동을 놓침)
    const crossStock = (x0, y0, x1, y1, rad) => (x0 === null || y0 === null) ? overStock(x1, y1, rad) : segRectHit(x0, y0, x1, y1, { x0: sr.x0 - rad, y0: sr.y0 - rad, x1: sr.x1 + rad, y1: sr.y1 + rad });

    // 공정 검증 (수정한 NC 포함): 탭 기초 구멍, 절삭 조건 한계
    function checkProcess(ln, tool, x, y) {
      const key = s.wcs + ':' + r3(x) + ',' + r3(y); // 좌표계별로 구분
      if (s.cycle !== 84 && tool.type === 'drill') {
        if (!drilled.has(key)) drilled.set(key, []);
        drilled.get(key).push({ dia: tool.dia, fullZ: s.cz + tipLength(tool) });
      }
      if (s.cycle === 84 && tool.type === 'tap' && tool.pitch > 0) {
        const lo = P.minorD1(tool.dia, tool.pitch), hi = tool.dia - 0.5 * tool.pitch;
        const good = (drilled.get(key) || []).filter(d => d.dia >= lo - EPS && d.dia < hi - EPS);
        if (!good.length) E(ln, 'X' + fmt(x) + ' Y' + fmt(y) + ' 탭 위치에 맞는 기초 드릴 구멍(Ø' + r3(lo) + '~' + r3(hi) + ')이 앞에서 가공되지 않았습니다.');
        else if (!good.some(d => d.fullZ <= s.cz + 1e-3 || d.fullZ <= -stock.sz + 1e-3)) E(ln, 'X' + fmt(x) + ' Y' + fmt(y) + ' 탭 깊이 Z' + fmt(s.cz) + ' 이(가) 기초 드릴 직경부 깊이보다 깊습니다 (탭 파손).');
      }
      // 절삭 조건: 모델 검증과 같은 한계 (참고값 3배 초과 = 오류)
      const type = s.cycle === 84 ? (s.m29 ? 'rigid' : 'tap') : s.cycle === 73 ? 'peck' : s.cycle === 83 ? 'deep' : tool.type === 'reamer' ? 'ream' : tool.type === 'boring' ? 'bore' : (tool.type === 'center' ? 'center' : 'drill');
      // [V0.6] 리머·보링 밑구멍: 깎인 깊이로 확인 (드릴·포켓 자국). 리머 여유 지름 0.05~0.6, 보링 반경 여유 ≤ 1.5
      if (tool.type === 'reamer' || tool.type === 'boring') {
        const R = tool.dia / 2, need = tool.type === 'reamer' ? R - 0.3 : Math.max(0.1, R - 1.5), zf = s.cz + (tool.type === 'reamer' ? tipLength(tool) : 0);
        if (!(clearedTo(x, y, need, zf + 0.05) <= zf + 0.05)) E(ln, 'X' + fmt(x) + ' Y' + fmt(y) + ' ' + (tool.type === 'reamer' ? '리머' : '보링') + ' Ø' + tool.dia + ' 앞에 충분한 밑구멍(지름 ' + r3(2 * need) + ' 이상, Z' + fmt(r3(zf)) + ' 까지)이 없습니다 (공구 파손·불량).');
        else if (clearedTo(x, y, R - 0.02, zf + 0.05) <= zf + 0.05) W(ln, 'X' + fmt(x) + ' Y' + fmt(y) + ' 밑구멍이 이미 완성 지름에 가까워 ' + (tool.type === 'reamer' ? '리머' : '보링') + ' 여유가 거의 없습니다.');
      }
      const rpm = s.cycle === 84 && s.m29 ? s.m29S : s.S;
      const ref = P.refConditions(type, tool, stock.material);
      if (ref && ref.vc > 0 && rpm > 0) {
        const vc = Math.PI * tool.dia * rpm / 1000;
        if (vc / ref.vc > 3) E(ln, 'T' + tool.no + ' 절삭속도 Vc ' + r3(vc) + ' m/min 이 참고값(' + r3(ref.vc) + ')의 3배를 넘습니다.');
        if (s.cycle !== 84 && s.F > 0 && (s.F / rpm) / ref.fpr > 3) E(ln, 'T' + tool.no + ' 회전당 이송 ' + r3(s.F / rpm) + ' mm/rev 가 참고값(' + r3(ref.fpr) + ')의 3배를 넘습니다.');
      }
    }
    for (let i = 0; i < lines.length; i++) {
      const ln = i + 1, raw = lines[i];
      if ((raw.match(/\(/g) || []).length !== (raw.match(/\)/g) || []).length) { E(ln, '주석 괄호가 짝이 맞지 않습니다.'); continue; }
      const cmt = raw.match(/\(([^)]*)\)/g) || [];
      cmt.forEach(c => { if (/[^\x20-\x7E]/.test(c)) W(ln, '주석에 영문/숫자 외 문자가 있어 장비에서 알람이 날 수 있습니다.'); });
      let line = raw.replace(/\([^)]*\)/g, '').replace(/\s+/g, '').toUpperCase();
      if (!line) continue;
      if (line === '%') { pct++; continue; }
      if (s.ended) { W(ln, 'M30 이후 내용은 실행되지 않습니다.'); continue; }
      if (line[0] === '/') { E(ln, '블록 스킵(/)은 V0.1 검증기가 지원하지 않습니다.'); continue; }
      if (line[0] === 'O') {
        if (!/^O\d{1,4}$/.test(line) || /^O0+$/.test(line)) E(ln, '프로그램 번호 형식이 잘못되었습니다 (O0001~O9999).');
        if (hasO) E(ln, '프로그램 번호(O)가 두 번 이상 있습니다.');
        hasO = true; continue;
      }
      // 토큰 해석
      const words = []; let pos = 0, bad = false;
      while (pos < line.length) {
        const m = /^([A-Z])([-+]?(?:\d+\.?\d*|\.\d+))/.exec(line.slice(pos));
        if (!m) { E(ln, '해석할 수 없는 문자: "' + line.slice(pos, pos + 6) + '"'); bad = true; break; }
        words.push({ L: m[1], v: parseFloat(m[2]), raw: m[2] });
        pos += m[0].length;
      }
      if (bad) continue;
      const G = [], M = [], A = {};
      let dup = false;
      words.forEach(w => {
        if (w.L === 'G') G.push(w.v);
        else if (w.L === 'M') M.push(w.v);
        else if (w.L === 'N') { if (!(w.v >= 1 && w.v <= 99999 && Number.isInteger(w.v))) E(ln, '시퀀스 번호 N' + w.raw + ' 은(는) 1~99999 범위여야 합니다.'); }
        else { if (A[w.L]) dup = true; A[w.L] = w; }
      });
      if (dup) { E(ln, '한 블록에 같은 주소가 두 번 있습니다.'); continue; }
      const unknownL = Object.keys(A).filter(k => !'XYZRQPFSTHIJ'.includes(k));
      if (unknownL.length) { E(ln, '지원하지 않는 주소: ' + unknownL.join(', ') + ' (공구 보정·K 등은 지원 범위 밖)'); continue; }
      ['X', 'Y', 'Z', 'R', 'Q', 'I', 'J'].forEach(k => { if (A[k] && !A[k].raw.includes('.')) E(ln, k + A[k].raw + ': 소수점이 없습니다. FANUC 은 ' + k + A[k].raw + ' 를 ' + (A[k].v / 1000) + 'mm 로 해석할 수 있습니다.'); });
      if (A.P && A.P.raw.includes('.')) E(ln, 'P(드웰)는 ms 단위 정수로 입력하세요.');
      if (G.some(g => !Number.isInteger(g)) || M.some(m => !Number.isInteger(m))) { E(ln, '소수점이 있는 G/M 코드는 지원하지 않습니다.'); continue; }
      const badG = G.filter(g => !ALLOWED_G.has(g)), badM = M.filter(m => !ALLOWED_M.has(m));
      if (badG.length) { E(ln, '검증할 수 없는 G코드: ' + badG.map(g => 'G' + g).join(', ') + (badG.includes(20) ? ' (인치 단위 미지원)' : '')); continue; }
      if (badM.length) { E(ln, '검증할 수 없는 M코드: ' + badM.map(m => 'M' + m).join(', ') + (badM.includes(4) ? ' (역회전 미지원)' : '')); continue; }
      if (M.length > 1) W(ln, '한 블록에 M코드가 여러 개입니다 (장비 설정에 따라 알람).');
      // 같은 모달 그룹의 G코드가 한 블록에 둘 이상이면 FANUC 은 마지막 것만 적용 → 해석이 어긋나므로 차단
      const grpOf = g => GROUPS.find(x => x[1].includes(g));
      const seenGrp = new Map(); let grpBad = null;
      G.forEach(g => { const gr = grpOf(g); if (!gr) return; if (seenGrp.has(gr[0])) grpBad = gr[0]; seenGrp.set(gr[0], g); });
      if (grpBad) { E(ln, '같은 그룹(' + grpBad + ')의 G코드가 한 블록에 여러 개입니다: ' + G.map(g => 'G' + g).join(' ') + ' — 한 블록에 하나만 쓰세요.'); continue; }
      if (G.some(g => g <= 3) && G.some(g => CYCLES.includes(g))) { E(ln, 'G00~G03 과 고정 사이클을 한 블록에 함께 쓸 수 없습니다.'); continue; }

      // 모달 설정
      let g28 = false, g43 = false, newCycle = null, g04 = false;
      G.forEach(g => {
        if (g === 21) s.units = 'mm';
        else if (g === 90) s.abs = true;
        else if (g === 91) s.abs = false;
        else if (g === 94) s.feedMode = 94;
        else if (g === 17 || g === 18 || g === 19) s.plane = g;
        else if (g === 98) s.ret = 98;
        else if (g === 99) s.ret = 99;
        else if (g >= 54 && g <= 59) s.wcs = g;
        else if (g === 49) { s.h = null; }
        else if (g === 80) { s.cycle = null; s.m29 = false; s.initZ = null; s.cq = null; s.cp = 0; s.cz = null; s.cr = null; } // [V0.6 검토] G80 은 사이클 데이터(Z·R·Q·P)를 지움
        else if (g >= 0 && g <= 3) { s.motion = g; s.m29 = false; s.m29S = 0; if (s.cycle !== null) { s.cycle = null; s.initZ = null; } }
        else if (g === 28) g28 = true;
        else if (g === 43) g43 = true;
        else if (g === 4) g04 = true;
        else if (CYCLES.includes(g)) newCycle = g;
      });
      if (A.F && s.feedMode !== 94) E(ln, 'G94(분당 이송) 지정 전에 F를 사용합니다. G95 상태가 남아 있으면 F가 mm/rev 로 해석됩니다.');
      if (A.F) { if (!(A.F.v > 0)) E(ln, '이송속도 F는 0보다 커야 합니다.'); else if (A.F.v > machine.maxFeed) E(ln, 'F' + A.F.raw + ' 이(가) 장비 최대 이송 ' + machine.maxFeed + ' 을 초과합니다.'); s.F = A.F.v; }
      if (A.T) {
        const tn = A.T.v;
        if (!Number.isInteger(tn) || !tm.get(tn)) E(ln, 'T' + A.T.raw + ' 공구가 장비 공구 목록에 없습니다.');
        else if (tn > machine.magazine) E(ln, 'T' + tn + ' 가 매거진 수를 초과합니다.');
        s.nextT = tn;
      }
      if (A.S) {
        if (!(A.S.v > 0) || !Number.isInteger(A.S.v)) E(ln, 'S는 0보다 큰 정수여야 합니다.');
        else if (A.S.v > machine.maxRpm) E(ln, 'S' + A.S.raw + ' 이(가) 장비 최대 회전수 ' + machine.maxRpm + ' 을 초과합니다.');
        s.S = A.S.v;
      }
      // M코드
      M.forEach(m => {
        if (m === 6) {
          if (s.cycle !== null) E(ln, '고정 사이클(G80 미취소) 상태에서 공구 교환합니다.');
          if (s.nextT === null || !tm.get(s.nextT)) E(ln, '교환할 공구(T)가 지정되지 않았습니다.');
          if (s.z !== Infinity) W(ln, 'Z축 원점 복귀(G91 G28 Z0.) 없이 공구를 교환합니다 (장비 M06 매크로 확인).');
          if (s.spin) W(ln, '주축 회전 중 공구 교환 (M05 권장).');
          endRun(); s.tool = s.nextT; s.hNeed = true; s.h = null; s.spin = false; // 대부분의 M06 매크로는 주축 정지(정위치) → M03 재지령 필요
        } else if (m === 3) { if (!(s.S > 0)) E(ln, '회전수(S) 없이 M03 주축 정회전.'); s.spin = true; }
        else if (m === 5) s.spin = false;
        else if (m === 8) s.cool = true;
        else if (m === 9) s.cool = false;
        else if (m === 29) {
          if (!A.S) E(ln, 'M29(리지드 탭)는 같은 블록에 S가 필요합니다.');
          if (!machine.rigidTap) E(ln, '장비가 리지드 탭을 지원하지 않도록 설정되어 있습니다.');
          if (s.spin) { if (machine.rigidM03) W(ln, '주축 회전 중 M29 지령 (장비 설정: 리지드 탭 전 M03 사용).'); else E(ln, '주축 회전 중 M29 지령 — 주축 정지(M05) 후 지령해야 합니다.'); }
          s.m29 = true; s.m29S = A.S ? A.S.v : 0;
          if (A.S && A.S.v > (machine.maxTapRpm || machine.maxRpm)) E(ln, '리지드 탭 S' + A.S.v + ' 이(가) 탭 최대 회전수를 초과합니다.');
        } else if (m === 30 || m === 2) s.ended = true;
      });
      if (g43) {
        if (!A.H) E(ln, 'G43 에 H 번호가 없습니다.');
        else if (s.tool === null) E(ln, '공구가 장착되지 않은 상태에서 G43.');
        else if (A.H.v !== s.tool) E(ln, 'H' + A.H.raw + ' 가 장착 공구 T' + s.tool + ' 와 다릅니다 (공구 길이 보정 오류 → 충돌 위험).');
        if (!A.Z) W(ln, 'G43 블록에 Z 이동이 없습니다.');
        s.h = A.H ? A.H.v : null; s.hNeed = false;
      } else if (A.H) E(ln, 'G43 없이 H 단어가 사용되었습니다.');
      if (g04) { if (!A.P) E(ln, 'G04 드웰에 P가 없습니다.'); continue; }

      const hasAxis = !!(A.X || A.Y || A.Z);
      if (g28) {
        if (s.abs) E(ln, 'G90(절대) 상태의 G28 은 공작물 좌표 지점을 경유하여 충돌 위험이 있습니다. G91 G28 을 사용하세요.');
        ['X', 'Y', 'Z'].forEach(k => { if (A[k] && Math.abs(A[k].v) > EPS) E(ln, 'G91 G28 ' + k + ' 값은 0 이어야 합니다.'); });
        if (A.Z) s.z = Infinity;
        if (A.X) s.x = null;
        if (A.Y) s.y = null;
        continue;
      }
      if (hasAxis && !s.units) { if (!unitsWarned) E(ln, 'G21(mm 단위) 지정 전에 이동 명령이 있습니다.'); unitsWarned = true; }
      if (hasAxis && !s.abs) { E(ln, '증분(G91) 이동은 검증기가 지원하지 않습니다 (G28 제외).'); continue; }
      if (hasAxis) {
        if (s.wcs === null) { if (!wcsChecked) E(ln, '공작물 좌표계(G54~G59) 지정 없이 이동합니다.'); wcsChecked = true; }
        else if (wantWcs !== null && s.wcs !== wantWcs) E(ln, '좌표계 G' + s.wcs + ' 이(가) 프로젝트 설정 G' + wantWcs + ' 와 다른 상태에서 이동합니다.');
      }

      const rad = s.tool && tm.get(s.tool) ? tm.get(s.tool).dia / 2 : 0;
      if (newCycle !== null && newCycle !== 84) { s.m29 = false; s.m29S = 0; }
      if (newCycle !== null) {
        if (s.cycle === null) s.initZ = s.z;
        s.cycle = newCycle;
        s.motion = null;
      }
      if (s.cycle !== null && (newCycle !== null || A.X || A.Y || A.Z || A.R)) {
        // 고정 사이클 실행 (구멍 1개)
        if (s.cycle === 84 && s.m29 && A.S) E(ln, '리지드 탭(M29) 중 G84 블록에서 S를 바꿀 수 없습니다 (F = S × P 불일치).');
        if (A.Z) s.cz = A.Z.v;
        if (A.R) s.cr = A.R.v;
        if (A.Q) s.cq = A.Q.v;
        if (A.P) s.cp = A.P.v;
        const nx = A.X ? A.X.v : s.x, ny = A.Y ? A.Y.v : s.y;
        const tool = s.tool !== null ? tm.get(s.tool) : null;
        const code = 'G' + s.cycle;
        sawMotion = true;
        if (nx === null || ny === null) { E(ln, '고정 사이클 XY 위치가 정해지지 않았습니다.'); continue; }
        if (s.cz === null || s.cr === null) { E(ln, code + ' 에 Z 또는 R 값이 없습니다.'); continue; }
        if (!tool) E(ln, '공구가 장착되지 않은 상태에서 가공합니다.');
        if (s.hNeed || s.h === null) E(ln, '공구 길이 보정(G43 H) 없이 가공합니다.');
        if (s.initZ === null || s.initZ === Infinity) E(ln, '초기점 Z가 정해지지 않은 상태(공구 길이 보정 전)에서 고정 사이클을 시작합니다.');
        // [V0.5] R점이 Z0 아래면: 그 자리가 R점보다 0.5mm 이상 아래까지 이미 깎였을 때만 허용 (포켓 바닥의 구멍 등)
        const surf0 = surfAt(nx, ny, rad);
        holderDeep(tool, nx, ny, s.cz, ln);
        if (s.cr <= surf0 + (surf0 < 0 ? 0.5 - EPS : 0)) E(ln, 'R점 ' + fmt(s.cr) + ' 이(가) ' + (surf0 < 0 ? '이미 깎인 면 Z' + fmt(r3(surf0)) + ' 보다 0.5mm 이상 높지 않습니다' : '소재 상면(Z0) 이하입니다') + ' (급속으로 소재에 진입).');
        if (s.cz >= s.cr) E(ln, 'Z(' + fmt(s.cz) + ')가 R점(' + fmt(s.cr) + ')보다 높습니다.');
        if (s.initZ !== null && s.initZ !== Infinity && s.initZ < s.cr - EPS) E(ln, '초기점 Z' + fmt(s.initZ) + ' 이(가) R점보다 낮습니다.');
        if (s.cz < bottom - EPS) E(ln, '가공 Z' + fmt(s.cz) + ' 이(가) 소재 바닥 아래 허용 한계 Z' + fmt(bottom) + ' 를 넘습니다 (테이블/지그 충돌).');
        if (s.cz > 0) W(ln, '가공 Z가 소재 상면 위입니다 (공회전).');
        if (!(s.F > 0)) E(ln, '이송속도 F가 지정되지 않았습니다.');
        if ((s.cycle === 73 || s.cycle === 83) && !(s.cq > 0)) E(ln, code + ' 에 펙 깊이 Q가 없습니다.');
        if (s.cycle === 82 && !(s.cp > 0)) W(ln, 'G82 에 드웰 P가 없습니다.');
        if (tool) {
          if (s.cycle === 84 && tool.type !== 'tap') E(ln, 'G84(탭) 사이클에 탭이 아닌 공구 T' + tool.no + ' 사용.');
          if (s.cycle !== 84 && tool.type === 'tap') E(ln, '탭 공구 T' + tool.no + ' 로 ' + code + ' 드릴 사이클 실행 (공구 파손).');
          // [V0.6] 리머·보링 바는 이송 복귀(G85)·정위치 복귀(G76)·주축 정지 복귀(G86) 사이클만
          if ((tool.type === 'reamer' || tool.type === 'boring') && ![76, 85, 86].includes(s.cycle)) E(ln, (tool.type === 'reamer' ? '리머' : '보링 바') + ' T' + tool.no + ' 로 ' + code + ' 실행 — 급속 복귀로 구멍 벽을 긁습니다. 리머는 G85, 보링은 G76(또는 G86)을 쓰세요.');
          if ([76, 85, 86].includes(s.cycle) && tool.type !== 'reamer' && tool.type !== 'boring') E(ln, code + ' 는 리머·보링 바 전용입니다 (T' + tool.no + ' ' + tool.type + ').');
          if (s.cycle === 76 && tool.type !== 'boring') E(ln, 'G76 정밀 보링은 보링 바로만 가공합니다.');
          if (tool.type === 'reamer' && s.cycle !== 85) E(ln, '리머 T' + tool.no + ' 는 G85(이송 복귀)로만 가공합니다 — ' + code + ' 는 급속·정지 복귀로 구멍 벽을 긁습니다.');
          if (s.cycle === 76 && !(s.cq >= 0.05 && s.cq <= 0.5 + EPS)) E(ln, 'G76 날 빼기 거리 Q' + (s.cq === null ? ' 없음' : fmt(s.cq)) + ' — 0.05~0.5mm 여야 합니다 (반대쪽 벽 충돌·벽 긁힘).');
          if (s.cycle === 76 && machine.g76 === false) E(ln, '이 장비는 G76(주축 정위치)을 지원하지 않습니다.');
          if ((s.cycle === 73 || s.cycle === 83) && tool.type === 'center') W(ln, '센터 드릴로 펙 사이클을 사용합니다.');
          if (tool.type === 'endmill') E(ln, '엔드밀 T' + tool.no + ' 로 드릴 고정 사이클(' + code + ') 실행 — 엔드밀은 포켓 경로(G01/G03)로만 가공합니다.');
          if (tool.flute > 0 && surf0 - s.cz > tool.flute + EPS) E(ln, '가공 깊이 ' + fmt(-s.cz) + ' 이(가) T' + tool.no + ' 유효 날 길이 ' + tool.flute + ' 를 초과합니다.');
          if (s.cycle === 84) {
            const S = s.m29 ? s.m29S : s.S, want = S * toNum(tool.pitch, 0);
            if (!s.m29 && !s.spin) E(ln, '주축 정지 상태에서 일반 탭(G84) 실행 (M03 또는 M29 필요).');
            if (Math.abs(s.F - want) > Math.max(0.01, want * 0.001)) E(ln, '탭 이송 F' + s.F + ' 가 S' + S + ' × 피치 ' + tool.pitch + ' = ' + r3(want) + ' 와 다릅니다 (나사산 손상·탭 파손).');
          } else if (!s.spin) E(ln, '주축 정지 상태에서 드릴 사이클 실행.');
          if (nx - rad < sr.x0 - EPS || nx + rad > sr.x1 + EPS || ny - rad < sr.y0 - EPS || ny + rad > sr.y1 + EPS) E(ln, 'X' + fmt(nx) + ' Y' + fmt(ny) + ' 가공 위치가 소재 범위를 벗어납니다.');
          clamps.forEach((c, ci) => { if (inRect(nx, ny, clampRect(c, rad + 1))) E(ln, 'X' + fmt(nx) + ' Y' + fmt(ny) + ' 가공 위치가 클램프 ' + (ci + 1) + ' 와 겹칩니다.'); });
          // [V0.6] 구멍 바닥까지 내려갔을 때 홀더(공구 끝 + 돌출 길이)가 클램프 높이보다 낮고 겹치면 충돌
          if (tool.stick > 0 && tool.holderDia > 0) clamps.forEach((c, ci) => { if (s.cz + tool.stick <= c.height + CLAMP_MARGIN - EPS && inRect(nx, ny, clampRect(c, tool.holderDia / 2 + 1))) E(ln, 'X' + fmt(nx) + ' Y' + fmt(ny) + ' 구멍 바닥(Z' + fmt(s.cz) + ')에서 T' + tool.no + ' 홀더(돌출 ' + tool.stick + ', Ø' + tool.holderDia + ')가 클램프 ' + (ci + 1) + '(높이 ' + c.height + ')와 충돌합니다.'); });
        }
        // 구멍 사이 이동: 현재 높이에서 XY 이동
        const travelZ = s.z;
        if (s.x !== null && s.y !== null) moves.push({ x0: s.x, y0: s.y, x1: nx, y1: ny, z: travelZ, rapid: true });
        clampHit(s.x, s.y, nx, ny, travelZ, rad, ln, '구멍 간 이동');
        if (travelZ <= 0 && crossStock(s.x, s.y, nx, ny, rad)) E(ln, '소재 상면 아래 높이에서 구멍 간 급속 이동.');
        if (tool) checkProcess(ln, tool, nx, ny);
        s.x = nx; s.y = ny;
        hits.push({ t: s.tool, x: r3(nx), y: r3(ny), z: r3(s.cz), r: r3(s.cr), code, line: ln });
        const z0 = mz(travelZ), px = s.x === null ? nx : s.x, py = s.y === null ? ny : s.y;
        motions.push({ k: 'rapid', t: s.tool, x0: px, y0: py, z0, x1: nx, y1: ny, z1: z0, line: ln });
        motions.push({ k: 'rapid', t: s.tool, x0: nx, y0: ny, z0, x1: nx, y1: ny, z1: s.cr, line: ln });
        motions.push({ k: 'drill', t: s.tool, code, f: s.F, q: s.cycle === 73 || s.cycle === 83 ? s.cq : 0, x0: nx, y0: ny, z0: s.cr, x1: nx, y1: ny, z1: s.cz, line: ln });
        if (tool && (tool.type === 'reamer' || tool.type === 'boring')) addCut({ x: nx, y: ny, z: s.cz + tipLength(tool), r: tool.dia / 2 });
        if (tool && tool.type === 'drill') { addCut({ x: nx, y: ny, z: s.cz + tipLength(tool), r: tool.dia / 2 }); drillTips.push({ x: nx, y: ny, z: s.cz, r: tool.dia / 2 }); } // [V0.5] 뚫린 구멍 (모따기 진입·선가공 구멍 진입 확인용)
        s.z = s.ret === 98 ? s.initZ : s.cr;
        motions.push({ k: 'rapid', t: s.tool, x0: nx, y0: ny, z0: s.cz, x1: nx, y1: ny, z1: mz(s.z), line: ln });
        continue;
      }
      const isArc = s.motion === 2 || s.motion === 3;
      if (hasAxis || (isArc && (A.I || A.J))) {
        sawMotion = true;
        if (s.motion === null) { E(ln, '이동 모드(G00~G03)가 지정되지 않은 상태의 이동.'); continue; }
        if (isArc && A.R) { E(ln, 'R 지정 원호는 검증하지 않습니다. I, J 로 중심을 지정하세요.'); continue; }
        const tx = A.X ? A.X.v : s.x, ty = A.Y ? A.Y.v : s.y, tz = A.Z ? A.Z.v : s.z;
        const cutting = s.motion >= 1, tool = s.tool !== null ? tm.get(s.tool) : null;
        if (run && !(cutting && tool && MILL_TOOLS[tool.type] && tz < s.z - EPS && !(Math.abs(tx - s.x) < 1e-6 && Math.abs(ty - s.y) < 1e-6 && !isArc))) endRun();
        if (A.Z && (s.hNeed || s.h === null) && !g43) E(ln, '공구 길이 보정(G43 H) 없이 Z축 이동 (충돌 위험).');
        if (cutting && !(s.F > 0)) E(ln, 'G0' + s.motion + ' 에 이송속도 F가 없습니다.');
        if (tz < bottom - EPS) E(ln, 'Z' + fmt(tz) + ' 이(가) 소재 바닥 허용 한계 아래입니다.');
        // 원호 기하
        let arc = null;
        if (isArc) {
          if (s.x === null || s.y === null || s.z === Infinity) { E(ln, '원호 시작점(XYZ)이 정해지지 않았습니다.'); continue; }
          if (!A.I && !A.J) { E(ln, '원호에 I, J 가 없습니다.'); continue; }
          if (s.plane !== 17) E(ln, '원호 전에 G17(XY 평면)이 지정되지 않았습니다 — 장비에 G18/G19 가 남아 있으면 다른 평면으로 원호가 그려집니다.');
          const cx = s.x + (A.I ? A.I.v : 0), cy = s.y + (A.J ? A.J.v : 0);
          const r0 = Math.hypot(s.x - cx, s.y - cy), r1 = Math.hypot(tx - cx, ty - cy);
          if (!(r0 > 1e-3)) { E(ln, '원호 반경이 0 입니다.'); continue; }
          if (Math.abs(r0 - r1) > 0.005) E(ln, '원호 시작점과 끝점의 반경이 다릅니다 (' + r3(r0) + ' / ' + r3(r1) + ') — 장비 알람 또는 잘못된 경로.');
          arc = { cx, cy, r: r0, ccw: s.motion === 3 };
        }
        // 절삭 이송이 소재 상면 아래로 들어가면: 엔드밀 + 포켓 영역 안 + 바닥 위 + 주축 회전
        const zLowMove = Math.min(tz, s.z);
        if (cutting && zLowMove < -EPS) {
          if (!tool) E(ln, '공구가 장착되지 않은 상태에서 절삭합니다.');
          else if (!MILL_TOOLS[tool.type]) E(ln, 'G0' + s.motion + ' 로 소재 상면(Z0) 아래 절삭 — 드릴·탭·센터 공구는 고정 사이클만 허용합니다 (G01 로 소재 상면 아래 이동 금지).');
          else {
            if (!s.spin) E(ln, '주축 정지 상태에서 절삭 이송합니다.');
            if (tool.stick > 0 && tx !== null && zLowMove + tool.stick < -EPS) holderDeep(tool, tx, ty, zLowMove, ln);
            if (tool.flute > 0 && -zLowMove > tool.flute + EPS && Math.min(0, clearedTo(tx, ty, rad, zLowMove + tool.flute)) - zLowMove > tool.flute + EPS) E(ln, '절삭 깊이 ' + fmt(-zLowMove) + ' 이(가) T' + tool.no + ' 날 길이 ' + tool.flute + ' 를 넘습니다.');
            if (s.x !== null && s.y !== null) {
              const pts = sampleMove(s.x, s.y, s.z, tx, ty, tz, arc);
              // 수직 하강(XY 그대로 Z 만 내려감): 이미 깎인 곳이 아니면 차단 (헬리컬 지원 장비)
              const plunge = !arc && Math.abs(tx - s.x) < 1e-6 && Math.abs(ty - s.y) < 1e-6 && tz < s.z - EPS;
              // 공구 전체가 소재 밖 = 공중, 또는 그 자리가 이미 그 깊이까지 깎임 (수직 하강일 때만 계산)
              const outsideStock = !plunge || tx + rad < sr.x0 || tx - rad > sr.x1 || ty + rad < sr.y0 || ty - rad > sr.y1 || clearedTo(tx, ty, effRad(tool, tz), tz + 0.05) <= tz + 0.05;
              if (plunge && !outsideStock && tool.type === 'chamfer' && tz < -0.05) {
                // 모따기 공구는 바닥 절삭이 거의 안 됨: 하강하는 자리가 이미 다른 공구로 충분히 깎였어야 함
                const re = effRad(tool, tz);
                if (!cutPts.some(q => q.z <= tz + 0.05 && Math.hypot(q.x - tx, q.y - ty) + re <= q.r + 0.05)) E(ln, '모따기 공구 T' + tool.no + ' 가 깎이지 않은 소재로 Z' + fmt(tz) + ' 까지 수직 하강 — 윤곽·포켓·구멍 가공 뒤에 모따기 하세요.');
              } else if (plunge && !outsideStock && tz < -0.3 && machine.helical !== false) {
                const ok = cutPts.some(q => q.z <= tz + 0.3 && Math.hypot(q.x - tx, q.y - ty) <= rad * 0.6 + 1e-6) || drillTips.some(q => q.z <= tz + 0.3 && Math.hypot(q.x - tx, q.y - ty) + 0.25 * rad <= q.r + 1e-6);
                if (!ok) E(ln, 'G01 로 Z' + fmt(tz) + ' 까지 수직 하강 — 깎이지 않은 소재로 곧장 들어갑니다 (엔드밀 파손 위험). 헬리컬 진입을 사용하세요.');
              }
              // [V0.5 검토] 하강 구간(헬리컬·경사 포함) 추적: XY 폭이 공구 지름의 25% 미만이면 사실상 수직 하강
              if (tz < s.z - EPS && !plunge) {
                if (!run || run.tool !== tool.no) run = { tool: tool.no, ln, minx: s.x, maxx: s.x, miny: s.y, maxy: s.y, sx: s.x, sy: s.y, sz: s.z, seq: cutSeq, nCut: cutPts.length, nTip: drillTips.length, zEnd: tz, x: tx, y: ty };
                pts.forEach(q => { run.minx = Math.min(run.minx, q.x); run.maxx = Math.max(run.maxx, q.x); run.miny = Math.min(run.miny, q.y); run.maxy = Math.max(run.maxy, q.y); });
                run.zEnd = tz; run.x = tx; run.y = ty;
              }
              pts.forEach(q => { if (q.z < -EPS) addCut({ x: q.x, y: q.y, z: q.z, r: effRad(tool, q.z) }); });
              const bad = pts.find(p => p.z < -EPS && !regions.some(rg => regionOk(rg, p.x, p.y, p.z, tool)));
              if (bad) E(ln, 'G0' + s.motion + ' 로 소재 상면(Z0) 아래 절삭 — 가공 영역(포켓·윤곽·평면·모따기) 밖 또는 바닥 아래 (X' + fmt(bad.x) + ' Y' + fmt(bad.y) + ' Z' + fmt(bad.z) + ', G01 로 소재 상면 아래 과삭·충돌).');
            } else E(ln, 'XY 위치를 모르는 상태에서 절삭 이송합니다.');
            const ref = P.refConditions(MILL_TOOLS[tool.type], tool, stock.material), rpm = s.S;
            if (ref && rpm > 0) {
              const vc = Math.PI * tool.dia * rpm / 1000;
              if (vc / ref.vc > 3) E(ln, 'T' + tool.no + ' 절삭속도 Vc ' + r3(vc) + ' m/min 이 참고값(' + r3(ref.vc) + ')의 3배를 넘습니다.');
              if (s.F > 0 && (s.F / rpm) / ref.fpr > 3) E(ln, 'T' + tool.no + ' 회전당 이송 ' + r3(s.F / rpm) + ' mm/rev 가 참고값(' + r3(ref.fpr) + ')의 3배를 넘습니다.');
            }
          }
        }
        const xyMove = (A.X || A.Y || isArc) && tx !== null && ty !== null && (isArc || s.x === null || s.y === null || Math.abs(tx - s.x) > 1e-9 || Math.abs(ty - s.y) > 1e-9); // 같은 XY 재지령은 이동 아님
        const zLow = Math.min(tz, s.z);
        if (xyMove) {
          const zAt = tz < s.z ? tz : s.z; // 하강이 섞이면 낮은 높이로 보수적 판단
          if (arc && s.x !== null) { const ap = sampleMove(s.x, s.y, zAt, tx, ty, zAt, arc); for (let k = 1; k < ap.length; k++) clampHit(ap[k - 1].x, ap[k - 1].y, ap[k].x, ap[k].y, zAt, rad, ln, '원호 절삭 이동'); }
          else clampHit(s.x, s.y, tx, ty, zAt, rad, ln, (s.motion === 0 ? '급속' : '절삭') + ' 이동');
          if (s.motion === 0 && zAt <= 0 && crossStock(s.x, s.y, tx, ty, rad)) E(ln, '소재 상면 높이 이하에서 급속 XY 이동 (소재 충돌).');
          if (s.x !== null && s.y !== null) moves.push({ x0: s.x, y0: s.y, x1: tx, y1: ty, z: zAt, rapid: s.motion === 0, arc });
        }
        if (A.Z && s.motion === 0 && tz < s.z && tz < 1 - EPS && overStock(tx, ty, rad) && !(clearedTo(tx, ty, rad, tz - 1 + EPS) <= tz - 1 + EPS)) E(ln, '급속 이송(G00)으로 소재 상면 1mm 이내로 하강 (Z' + fmt(tz) + ').');
        if (A.Z && (tx === null || ty === null) && tz < zSafe) E(ln, 'XY 위치를 모르는 상태(원점 복귀 후 등)에서 Z' + fmt(tz) + ' 까지 하강합니다 — 먼저 XY 를 지정하세요.');
        if (A.Z && zLow !== Infinity) clampHit(null, null, tx === null ? -1e9 : tx, ty === null ? -1e9 : ty, tz, rad, ln, 'Z 하강');
        if (tx !== null && ty !== null) motions.push({ k: s.motion === 0 ? 'rapid' : isArc ? 'arc' : 'feed', t: s.tool, f: s.F, x0: s.x === null ? tx : s.x, y0: s.y === null ? ty : s.y, z0: mz(s.z), x1: tx, y1: ty, z1: mz(tz), cx: arc ? arc.cx : undefined, cy: arc ? arc.cy : undefined, ccw: arc ? arc.ccw : undefined, line: ln });
        if (cutting) cuts.push({ t: s.tool, x: r3(tx), y: r3(ty), z: r3(tz), line: ln });
        s.x = tx; s.y = ty; s.z = tz;
      }
    }
    endRun();
    // [V0.5 검토] 아주 긴 프로그램: 장비 메모리·순번(N) 한계 안내
    if (lines.length > 100000) W(0, 'NC 가 ' + lines.length + '줄(약 ' + Math.round(text.length / 1024) + 'KB)로 매우 깁니다. 장비 메모리를 넘을 수 있으니 DNC(외부 운전)로 보내거나, 더 큰 공구·넓은 경로 간격을 쓰세요.');
    if (lines.some(l => /^N(\d{6,})/.test(l))) W(0, '순번(N)이 99999 를 넘습니다. 장비에 따라 알람이 날 수 있으니 순번 출력을 끄세요.');
    if (!hasO) E(0, '프로그램 번호(O)가 없습니다.');
    if (!s.units) E(0, 'G21(mm 단위) 지정이 없습니다.');
    if (!s.ended) E(0, '프로그램 끝(M30)이 없습니다.');
    else {
      if (s.cycle !== null) E(0, '고정 사이클이 G80 으로 취소되지 않았습니다.');
      if (s.spin) W(0, '프로그램 끝에서 주축이 회전 중입니다 (M05 권장).');
      if (s.cool) W(0, '프로그램 끝에서 절삭유가 켜져 있습니다 (M09 권장).');
    }
    if (pct < 2) W(0, '프로그램 시작/끝의 % 표시가 없습니다 (전송 방식에 따라 필요).');
    if (!sawMotion || (!hits.length && !cuts.some(c => c.z < 0))) E(0, '가공(고정 사이클·절삭) 블록이 없습니다.');

    // 생성기 결과와 교차 검증 (수정하지 않은 NC 인 경우)
    let match = null;
    if (ctx.expected) {
      const ex = ctx.expected;
      match = ex.length === hits.length && ex.every((e, k) => {
        const h = hits[k];
        return h.t === e.t && Math.abs(h.x - e.x) < 5e-4 && Math.abs(h.y - e.y) < 5e-4 && Math.abs(h.z - e.z) < 5e-4 && Math.abs(h.r - e.r) < 5e-4 && h.code === e.code;
      });
      if (!match) E(0, '생성기 계산 결과와 NC 해석 결과가 일치하지 않습니다 (예상 ' + ex.length + '개, 해석 ' + hits.length + '개 구멍).');
    }
    if (ctx.expectedCuts) {
      const ex = ctx.expectedCuts;
      const ok = ex.length === cuts.length && ex.every((e, k) => { const c = cuts[k]; return c.t === e.t && Math.abs(c.x - e.x) < 5e-4 && Math.abs(c.y - e.y) < 5e-4 && Math.abs(c.z - e.z) < 5e-4; });
      if (!ok) E(0, '생성기 절삭 경로와 NC 해석 경로가 일치하지 않습니다 (예상 ' + ex.length + '개, 해석 ' + cuts.length + '개 이동).');
      match = (match === null ? true : match) && ok;
    }
    return { errors, warnings, hits, moves, match, cuts, motions, carry: { cuts: cutPts.map(q => ({ x: q.x, y: q.y, z: q.z, r: q.r })), drilled: [...drilled.entries()], tips: drillTips.slice() } };
  }

  // 제어기별 NC 검증기 등록소 (포스트프로세서의 verifier 이름으로 선택)
  const NCV = { FANUC: verifyNC };
  P.NCV = NCV;
  P.sampleMove = sampleMove;
  P.verifyNC = (text, ctx) => {
    const post = ctx && ctx.machine && P.POST.get(ctx.machine.control);
    const fn = post && NCV[post.verifier];
    if (!fn) return { errors: [{ line: 0, msg: '이 제어기용 NC 검증기가 없습니다: ' + (ctx && ctx.machine && ctx.machine.control) }], warnings: [], hits: [], moves: [], match: false };
    return fn(text, ctx);
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
