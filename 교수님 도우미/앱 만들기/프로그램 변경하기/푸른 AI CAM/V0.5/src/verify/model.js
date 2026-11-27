/* =====================================================================
 * 푸른 AI CAM - [검증 모듈: 모델 검증] verify/model.js
 * 역할: 입력값(프로젝트·장비·공정) 11개 항목 검증. 공통 항목(좌표·소재·중복·공구·클램프·NC 구조)은
 *       여기서, 가공 종류별 항목은 각 가공 모듈의 validate(ctx) 를 호출하여 검사한다.
 *       오류(error) 1건 이상이면 화면에서 NC 출력이 차단된다.
 * 의존: engine/*, ops/*, process/plan.js, post/registry.js
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  const { EPS, CLAMP_MARGIN, MAX_HOLES, FANUC_MAX, TOOL_TYPES, isNum, r3, toNum, fmt, toolMap, stockRect, segRectHit, clampRect, inRect } = P;
  const CHECKS = [
    { id: 1, name: '좌표값 유효성' },
    { id: 2, name: '소재 범위' },
    { id: 3, name: '중복·간섭 홀' },
    { id: 4, name: '공구 번호·종류' },
    { id: 5, name: '공구 직경·탭 기초 드릴' },
    { id: 6, name: '절삭 조건 (S·F·Vc)' },
    { id: 7, name: '탭 이송·장비 지원' },
    { id: 8, name: '가공 깊이' },
    { id: 9, name: '펙·사이클 조건' },
    { id: 10, name: '안전 높이·충돌' },
    { id: 11, name: 'NC 구조·장비 설정' }
  ];

  /* ---------------- 모델 검증 (11개 항목) ---------------- */
  function validateProject(project, machine) {
    const issues = [];
    const add = (level, cat, msg, ref) => issues.push({ level, cat, msg, ref: ref || null });
    const st = project.stock, set = project.settings;
    const tm = machine ? toolMap(machine) : new Map();
    if (!machine) { add('error', 11, '장비가 선택되지 않았습니다.'); return { issues, plan: { steps: [], info: [] } }; }
    const sr = stockRect(st);
    const under = toNum(st.under, 0);

    // 11. 장비·프로그램 기본 설정
    if (!P.POST.get(machine.control)) add('error', 11, '지원하지 않는 제어기입니다: ' + machine.control + ' (현재 FANUC 만 지원)');
    if (!(Number.isInteger(project.programNo) && project.programNo >= 1 && project.programNo <= 9999)) add('error', 11, '프로그램 번호는 1~9999 정수여야 합니다 (O0001 형식).');
    else if (project.programNo >= 8000) add('warn', 11, 'O8000~O9999는 장비에서 보호 영역(매크로)으로 쓰이는 경우가 많습니다.');
    if (!machine.verified) add('warn', 11, '장비 "' + machine.name + '" 은(는) 실가공 검증 전입니다. NC 파일은 "검증용"으로 표시됩니다.');
    if (!(machine.maxRpm > 0) || !(machine.maxFeed > 0)) add('error', 11, '장비의 최대 회전수/최대 이송속도 설정이 잘못되었습니다.');
    if (!/^G5[4-9]$/.test(set.wcs)) add('error', 11, '공작물 좌표계는 G54~G59 중 하나여야 합니다.');

    // 1. 소재·좌표 기본값
    if (!(st.sx > 0 && st.sy > 0 && st.sz > 0)) add('error', 1, '소재 크기(X, Y, 두께)는 0보다 커야 합니다.');
    if (st.sx > machine.travel.x || st.sy > machine.travel.y) add('error', 1, '소재 크기가 장비 X/Y 행정(' + machine.travel.x + '×' + machine.travel.y + ')을 초과합니다.');
    if (!(under >= 0)) add('error', 8, '소재 하부 여유는 0 이상이어야 합니다.');
    if (!(set.initialZ > 0)) add('error', 10, '초기점(안전 높이) Z는 0보다 커야 합니다.');
    if (set.initialZ > machine.travel.z) add('error', 1, '초기점 Z가 장비 Z 행정을 초과합니다.');

    // 툴 번호 중복
    const seen = new Set();
    (machine.tools || []).forEach(t => {
      if (seen.has(t.no)) add('error', 4, '장비 공구 목록에 T' + t.no + ' 번호가 중복되어 있습니다.');
      seen.add(t.no);
      if (!(t.dia > 0)) add('error', 4, 'T' + t.no + ' 공구 직경이 올바르지 않습니다.');
      if (t.type === 'tap' && !(t.pitch > 0)) add('error', 7, 'T' + t.no + ' 탭 피치가 올바르지 않습니다.');
    });

    let totalHoles = 0;
    const allHoles = [];
    project.groups.forEach(g => {
      const gname = '[' + g.name + ']';
      const dia = P.holeDiaForGroup(g, tm);
      const rad = dia / 2;
      // 소재 범위·클램프는 이 홀에 쓰는 가장 큰 공구(스팟 드릴 포함) 반경으로 검사 (NC 검증기와 같은 기준)
      // [V0.5] 윤곽·평면·모따기 공정 (위치 = 형상 기준점). 포켓과 따로 검사
      const outl = g.ops.filter(o => P.OPS.get(o.type) && ['contour', 'face', 'chamfer'].includes(P.OPS.get(o.type).mill));
      const pext = (() => { const mo = g.ops.filter(o => P.OPS.get(o.type) && P.OPS.get(o.type).mill === 'pocket'); if (!mo.length) return null; let ex = 0, ey = 0; mo.forEach(o => { const e = P.pocketExtent(o); ex = Math.max(ex, e.ex); ey = Math.max(ey, e.ey); }); return { ex, ey, circle: mo.every(o => o.shape === 'circle') }; })();
      const cutRad = Math.max(rad, ...g.ops.map(o => { const t = tm.get(o.toolNo); return t && t.dia > 0 ? t.dia / 2 : 0; }));
      totalHoles += g.holes.length;
      if (g.holes.length && !g.ops.length) add('warn', 4, gname + ' 홀은 있지만 공정이 없어 가공되지 않습니다.', { gid: g.id });
      // 간편 입력 그룹: 필요한 공구가 없어 공정이 빠졌으면 차단 (예: 탭 지정인데 센터 드릴만 생성되는 경우)
      if (g.spec && P.planHoleSpec) {
        const plan0 = P.planHoleSpec(g.spec, machine, st);
        if (g.holes.length) plan0.missing.forEach(mm => add('error', 4, gname + ' ' + (g.spec.kind === 'tap' ? '탭' : '구멍') + ' 가공에 필요한 ' + (mm.type === 'tap' ? '탭 M' + mm.dia + '×' + mm.pitch : mm.type === 'center' ? '센터 드릴' : '드릴 Ø' + mm.dia) + ' 이(가) 장비에 없어 공정이 완성되지 않았습니다.', { gid: g.id }));
        // 공정 내용까지 비교 (되돌리기·장비 변경 뒤 오래된 공정이 남는 것 방지)
        const sig = o => { const def = P.OPS.get(o.type); return [o.type, o.toolNo, P.r3(+o.depth), o.depthMode, !!o.thru, P.r3(+o.brk), P.r3(+o.q), P.r3(+o.r), P.r3(+o.dwell), !!o.auto].concat(def && def.params ? Object.keys(def.params).map(k => typeof def.params[k] === 'number' ? P.r3(+o[k]) : JSON.stringify(o[k] === undefined ? null : o[k])) : []).join('|'); }; // [V0.4·V0.5] 밀링 매개변수(형상 포함) 모두 비교
        if (g.holes.length && (g.ops.length !== plan0.ops.length || g.ops.some((o, k) => sig(o) !== sig(plan0.ops[k])))) add('error', 11, gname + ' 간편 입력과 공정 목록이 일치하지 않습니다 (설정 변경 후 갱신되지 않음). 가공 방법을 다시 선택하거나 값을 다시 입력하세요.', { gid: g.id });
      }
      if (!g.holes.length && g.ops.length) add('info', 4, gname + ' 공정은 있지만 홀이 없습니다.', { gid: g.id });

      // 1, 2. 좌표·소재 범위
      g.holes.forEach((h, hi) => {
        const ref = { gid: g.id, hid: h.id };
        const hn = gname + ' 홀 ' + (hi + 1);
        if (!isNum(h.x) || !isNum(h.y)) { add('error', 1, hn + ': 좌표가 숫자가 아닙니다.', ref); return; }
        if (Math.abs(h.x) > FANUC_MAX || Math.abs(h.y) > FANUC_MAX) add('error', 1, hn + ': 좌표가 입력 한계를 넘습니다.', ref);
        if (outl.length) {
          const sr0 = [[sr.x0, sr.y0], [sr.x1, sr.y0], [sr.x1, sr.y1], [sr.x0, sr.y1]], G = P.GEOM;
          outl.forEach(o => {
            const def = P.OPS.get(o.type), tool = tm.get(o.toolNo);
            if (def.mill === 'face' || !tool) return;
            const rg = def.regions(o, h, st, tool)[0], on = gname + ' 위치 ' + (hi + 1) + ' (' + def.label + ')';
            const partArea = Math.abs(G.area(rg.part));
            if (partArea < 1e-6) return;
            const inStock = G.overlapArea([rg.part], [sr0]);
            if (rg.kind === 'inside' && inStock < partArea - 0.01) add('error', 2, on + ': 안쪽 윤곽이 소재 밖으로 벗어납니다.', ref);
            if (rg.kind === 'outside' && inStock < 0.01) add('warn', 2, on + ': 윤곽이 소재 밖에 있어 공중에서 깎습니다 (위치를 확인하세요).', ref);
            // 공구가 지나는 범위(바깥 윤곽: 오프셋 띠 / 안쪽: 윤곽 안)와 클램프 겹침
            const sweep = rg.kind === 'outside' ? G.offsetPts([rg.part], rg.dMax + tool.dia / 2).map(e => e.outer) : [rg.part];
            project.clamps.forEach((c, ci) => {
              const cr = clampRect(c, 1), cp = [[cr.x0, cr.y0], [cr.x1, cr.y0], [cr.x1, cr.y1], [cr.x0, cr.y1]];
              if (G.overlapArea(sweep, [cp]) > 0.01) add('error', 10, on + ': 공구가 지나는 범위가 클램프 ' + (ci + 1) + ' 와 겹칩니다 (공구 충돌).', ref);
            });
          });
          return;
        }
        if (pext) {
          // 포켓: 실제 사각·원 크기로 소재 범위·벽 두께·클램프 검사
          const pn = gname + ' 포켓 ' + (hi + 1);
          const x0 = h.x - pext.ex, x1 = h.x + pext.ex, y0 = h.y - pext.ey, y1 = h.y + pext.ey;
          if (x0 < sr.x0 - EPS || x1 > sr.x1 + EPS || y0 < sr.y0 - EPS || y1 > sr.y1 + EPS) add('error', 2, pn + ' (X' + fmt(h.x) + ' Y' + fmt(h.y) + '): 포켓(' + r3(2 * pext.ex) + '×' + r3(2 * pext.ey) + ')이 소재 밖으로 벗어납니다.', ref);
          else { const wall = Math.min(x0 - sr.x0, sr.x1 - x1, y0 - sr.y0, sr.y1 - y1); if (wall < 1) add('warn', 2, pn + ': 소재 가장자리까지 남는 벽 두께가 ' + r3(wall) + 'mm 로 얇습니다.', ref); }
          project.clamps.forEach((c, ci) => { const cr = clampRect(c, 1); if (x0 <= cr.x1 && x1 >= cr.x0 && y0 <= cr.y1 && y1 >= cr.y0) add('error', 10, pn + ': 클램프 ' + (ci + 1) + ' 영역과 겹칩니다 (공구 충돌).', ref); });
          allHoles.push({ g, h, rad: pext.circle ? pext.ex : Math.hypot(pext.ex, pext.ey), hi, ref, hn: pn }); // 사각은 모서리까지 (보수적)
          return;
        }
        if (h.x - cutRad < sr.x0 - EPS || h.x + cutRad > sr.x1 + EPS || h.y - cutRad < sr.y0 - EPS || h.y + cutRad > sr.y1 + EPS)
          add('error', 2, hn + ' (X' + fmt(h.x) + ' Y' + fmt(h.y) + '): ' + (cutRad > rad ? '공구' : '홀') + '(Ø' + r3(cutRad * 2) + ')이 소재 밖으로 벗어납니다.', ref);
        else {
          const wall = Math.min(h.x - rad - sr.x0, sr.x1 - h.x - rad, h.y - rad - sr.y0, sr.y1 - h.y - rad);
          if (dia > 0 && wall < Math.max(1, dia * 0.25)) add('warn', 2, hn + ': 소재 가장자리까지 남는 살 두께가 ' + r3(wall) + 'mm 로 얇습니다.', ref);
        }
        // 10. 클램프 영역
        project.clamps.forEach((c, ci) => {
          if (inRect(h.x, h.y, clampRect(c, cutRad + 1))) add('error', 10, hn + ': 클램프 ' + (ci + 1) + ' 영역과 겹칩니다 (공구 충돌).', ref);
        });
        allHoles.push({ g, h, rad, hi, ref, hn });
      });

      // 공정별 검사
      const ops = g.ops;
      ops.forEach((op, oi) => {
        const ref = { gid: g.id, opId: op.id };
        const def = P.OPS.get(op.type);
        if (!def) { add('error', 4, gname + ' 공정 ' + (oi + 1) + ': 지원하지 않는 가공 방식입니다 (' + op.type + ').', ref); return; }
        const on = gname + ' 공정 ' + (oi + 1) + ' (' + def.label + ')';
        const tool = tm.get(op.toolNo);
        // 4. 공구
        if (!Number.isInteger(op.toolNo) || op.toolNo < 1) { add('error', 4, on + ': 공구 번호가 올바르지 않습니다.', ref); return; }
        if (op.toolNo > machine.magazine) add('error', 4, on + ': T' + op.toolNo + ' 가 매거진 수(' + machine.magazine + ')를 초과합니다.', ref);
        if (!tool) { add('error', 4, on + ': T' + op.toolNo + ' 공구가 장비 공구 목록에 없습니다.', ref); return; }
        if (!def.toolTypes.includes(tool.type)) { add('error', 4, on + ': T' + op.toolNo + '(' + TOOL_TYPES[tool.type] + ')는 이 공정에 사용할 수 없습니다.', ref); return; }

        // 가공 모듈 전용 검증 (공통 순서: 조건 → 모듈 전용 → 깊이 → R점, ops/hole-common.js)
        const ctx = {
          op, oi, ops, tool, tm, machine, st, set, under, on, project, g,
          d: P.opDepth(op, tool, st), c: P.opConditions(op, tool, st.material, machine),
          add: (level, cat, msg, noRef) => add(level, cat, msg, noRef ? null : ref)
        };
        def.validate(ctx);
      });
    });

    if (totalHoles > MAX_HOLES) add('error', 1, '홀 수가 최대 ' + MAX_HOLES + '개를 초과합니다.');
    // 1. 홀 분포가 장비 행정 이내인지
    const xs = allHoles.map(a => a.h.x), ys = allHoles.map(a => a.h.y);
    if (xs.length && (Math.max(...xs) - Math.min(...xs) > machine.travel.x || Math.max(...ys) - Math.min(...ys) > machine.travel.y)) add('error', 1, '홀 분포 범위가 장비 X/Y 행정을 초과합니다.');

    // 3. 중복·간섭 홀 (공간 해시로 대량 홀도 빠르게 검사)
    let maxRad = 0;
    allHoles.forEach((a, k) => { a.k = k; if (a.rad > maxRad) maxRad = a.rad; });
    const cell = Math.max(20, maxRad * 4), grid = new Map();
    allHoles.forEach(a => { const k = Math.floor(a.h.x / cell) + ',' + Math.floor(a.h.y / cell); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(a); });
    let nDup = 0, nOv = 0;
    allHoles.forEach(a => {
      const cx = Math.floor(a.h.x / cell), cy = Math.floor(a.h.y / cell);
      for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) {
        (grid.get(i + ',' + j) || []).forEach(b => {
          if (b.k <= a.k) return;
          const dist = Math.hypot(a.h.x - b.h.x, a.h.y - b.h.y);
          const same = a.g === b.g;
          if (dist < 0.01) {
            nDup++;
            if (nDup <= 50) add('error', 3, a.hn + ' 과 ' + b.hn + ' 의 위치가 같습니다 (' + (same ? '중복 홀' : '그룹 간 중복 홀') + ').', b.ref);
          } else if (dist < a.rad + b.rad - EPS) {
            nOv++;
            if (nOv <= 50) add('warn', 3, a.hn + ' 과 ' + b.hn + ' 이(가) 서로 겹칩니다 (중심 간격 ' + r3(dist) + 'mm).', b.ref);
          }
        });
      }
    });
    if (nDup > 50) add('error', 3, '중복 홀이 그 외 ' + (nDup - 50) + '건 더 있습니다.');
    if (nOv > 50) add('warn', 3, '겹치는 홀이 그 외 ' + (nOv - 50) + '건 더 있습니다.');

    // 10. 클램프 높이 vs 초기점 / G99 이동
    let maxClamp = -Infinity;
    project.clamps.forEach((c, ci) => {
      if (!(c.w !== 0 && c.h !== 0)) add('error', 10, '클램프 ' + (ci + 1) + ' 크기가 0입니다.');
      maxClamp = Math.max(maxClamp, c.height);
    });
    if (project.clamps.length && set.initialZ < maxClamp + CLAMP_MARGIN) add('error', 10, '초기점 Z' + set.initialZ + ' 가 클램프 최고 높이 ' + maxClamp + ' + 여유 ' + CLAMP_MARGIN + 'mm 보다 낮습니다 (이동 중 충돌).');

    const plan = P.buildPlan(project, machine);
    if (!plan.steps.length) add('error', 11, '가공할 홀/공정이 없습니다.');
    plan.info.forEach(m => add('info', 11, m));
    if (set.retract === 'G99' && project.clamps.length) {
      plan.steps.forEach(s => {
        const rad = s.tool ? s.tool.dia / 2 : 0;
        for (let k = 1; k < s.holes.length; k++) {
          const a = s.holes[k - 1], b = s.holes[k];
          project.clamps.forEach((c, ci) => {
            if (s.r < c.height + CLAMP_MARGIN && segRectHit(a.x, a.y, b.x, b.y, clampRect(c, rad + 1)))
              add('error', 10, '공정 ' + s.idx + ': G99(R점 복귀) 이동 경로가 클램프 ' + (ci + 1) + ' 위를 지나갑니다. G98 사용 또는 R점을 높이세요.', { gid: b.gid, hid: b.hid });
          });
        }
      });
    }
    return { issues, plan };
  }

  Object.assign(P, { CHECKS, validateProject });
})(typeof globalThis !== 'undefined' ? globalThis : this);
