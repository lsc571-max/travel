/* =====================================================================
 * 푸른 AI CAM - [공정 관리: 포켓 간편 입력] process/pocket-wizard.js
 * 역할: 포켓 모양(사각/원형)·크기·깊이·코너 R 만 입력하면 공구·절입·황삭/정삭 공정을 구성한다.
 * 규칙 (결정적 계산)
 *   - 공구 자동: 보유 평 엔드밀 중 지름 ≤ 포켓 최소 폭의 75% 인 가장 큰 공구.
 *     사각 포켓에 코너 R 이 있으면 반경 ≤ 코너 R 인 공구를 우선 (모서리 R 그대로 가공)
 *   - 1회 절입(자동) = 공구 직경 × 재질 계수 (알루미늄·황동 0.5, 일반강·주철 0.3, 합금강 0.25, 스테인리스 0.2),
 *     날 길이의 90% 이내, 0.1mm 단위
 *   - 황삭: 측벽 여유 0.2 / 바닥 여유 0.1 (변경 가능), 경로 간격 50%
 *   - 정삭: 같은 공구, 최종 깊이·여유 0, 경로 간격 40%
 * 의존: engine/*, ops/pocket.js, process/hole-wizard.js (공구 추가·이름 공용)
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  const { toNum, r3, toolMap } = P;
  const AP_FACTOR = { AL6061: 0.5, C3604: 0.5, SS400: 0.3, S45C: 0.3, FC250: 0.3, SCM440: 0.25, SUS304: 0.2 };

  function newPocketSpec(extra) {
    // [V0.5] semi(중삭)·finishMode('split' = 바닥 정삭 + 측벽 정삭 따로, 'both' = 한 공정)·entry(진입)·relief(모서리 릴리프 구멍)
    return Object.assign({ kind: 'pocket', shape: 'rect', w: 40, h: 30, cr: 5, dia: 30, poly: null, depth: 5, thru: false, brk: 1, rough: true, finish: true, toolNo: 0, stepover: 50, stepdown: 0, allowWall: 0.2, allowFloor: 0.1,
      sides: 6, rot: 0, draft: 0, topR: 0, floorR: 0, profStep: 0.2, semi: false, semiStep: 0, semiWall: 0.1, semiFloor: 0.05, finishMode: 'split', finishFloor: true, finishWall: true, wallStep: 0, entry: 'helix', relief: false }, extra || {});
  }
  function normalizePocketSpec(s) {
    const d = newPocketSpec(), o = { kind: 'pocket' };
    Object.keys(d).forEach(k => {
      if (k === 'kind') return;
      if (typeof d[k] === 'number') o[k] = toNum(s[k], d[k]);
      else if (typeof d[k] === 'boolean') o[k] = typeof s[k] === 'boolean' ? s[k] : d[k];
      else if (k === 'shape') o[k] = ['circle', 'poly', 'ngon'].includes(s[k]) ? s[k] : 'rect';
      else if (k === 'poly') o.poly = P.normPoly(s.poly);
    });
    o.finishMode = s.finishMode === 'split' ? 'split' : 'both'; // 이전 버전 파일(값 없음)은 한 공정 정삭
    o.entry = (P.POCKET_ENTRIES || ['helix']).includes(s.entry) ? s.entry : 'helix';
    if (o.shape === 'poly' && !o.poly) o.shape = 'rect';
    o.toolNo = Math.max(0, Math.round(o.toolNo));
    return o;
  }

  function planPocketSpec(spec, machine, stock) {
    spec = normalizePocketSpec(spec);
    const notes = [], missing = [], ops = [];
    // [V0.5] 다각(정다각형)은 공정에서 자유 형상(poly)으로 바꿔 같은 경로 엔진을 씀
    const geo = P.specGeo(spec);
    const mw = P.pocketMinWidth(geo);
    if (!(mw > 0)) return { ops, notes: [{ level: 'error', msg: '포켓 크기를 입력하세요.' }], missing, spec };
    if (!(spec.depth > 0)) return { ops, notes: [{ level: 'error', msg: '포켓 깊이를 입력하세요.' }], missing, spec };
    if (!spec.rough && !spec.finish) return { ops, notes: [{ level: 'error', msg: '황삭 또는 정삭을 하나 이상 선택하세요.' }], missing, spec };
    if (spec.finish && !spec.rough) notes.push({ level: 'error', msg: '정삭만으로는 포켓을 팔 수 없습니다. 황삭도 선택하세요.' });
    const sz = toNum(stock && stock.sz, 0);
    if (!spec.thru && spec.depth >= sz) notes.push({ level: 'error', msg: '포켓 깊이 ' + spec.depth + 'mm 가 소재 두께 ' + sz + 'mm 이상입니다. 끝까지 뚫으려면 [관통]을 체크하세요.' });
    const depth = spec.thru ? sz + spec.brk : spec.depth;

    // 공구 선택
    const ems = (machine.tools || []).filter(t => t.type === 'endmill').sort((a, b) => b.dia - a.dia || a.no - b.no);
    let tool = null;
    if (spec.toolNo > 0) {
      tool = toolMap(machine).get(spec.toolNo) || null;
      if (!tool || tool.type !== 'endmill') { notes.push({ level: 'error', msg: 'T' + spec.toolNo + ' 은(는) 평 엔드밀이 아닙니다. 공구를 다시 고르세요.' }); tool = null; }
    } else {
      const fitW = t => t.dia <= 0.75 * mw + 1e-9 && 2 * (t.dia / 2 + spec.allowWall) < mw - 0.25 && (spec.entry !== 'helix' || mw / 2 - t.dia / 2 - spec.allowWall >= 0.125 * t.dia + 0.01); // 헬리컬 진입 여유(최소 반경 = 공구 반경 25%) 포함
      const fitR = t => !['rect', 'ngon'].includes(spec.shape) || spec.cr <= 0 || t.dia / 2 <= spec.cr + 1e-9;
      // [V0.5 검토] 자유 형상: 좁은 목이 남지 않는 가장 큰 공구 우선
      const reach = t => geo.shape !== 'poly' || !(P.GEOM.unreachable(P.GEOM.regionPaths(P.GEOM.shapeRegion(geo), 0, 0), t.dia / 2, 0).some(a => a > Math.max(1, 1.2 * t.dia * t.dia / 4)));
      // 진입 불가로 남기는 좁은 곳이 없는 공구 우선 (자유 형상)
      const clean = t => geo.shape !== 'poly' || (() => { const r = P.pocketMoves({ pk: Object.assign({}, P.POCKET_PARAMS, geo, { type: 'pocketRough', allowWall: spec.allowWall, allowFloor: spec.allowFloor, stepover: spec.stepover, stepdown: 1, entry: spec.entry }), type: 'pocketRough', z: -1, r: 3, feed: 100 }, t, { x: 0, y: 0 }, machine); return !r.error && !(r.warn && r.warn.length) && !(P.GEOM.stageExtra(P.GEOM.regionPaths(P.GEOM.shapeRegion(geo), 0, 0), t.dia / 2, spec.allowWall, 0) > Math.max(1.5, 0.3 * t.dia * t.dia / 4)); })();
      tool = ems.find(t => fitW(t) && fitR(t) && reach(t) && clean(t)) || ems.find(t => fitW(t) && fitR(t) && reach(t)) || ems.find(t => fitW(t) && fitR(t)) || null;
      if (!tool) {
        tool = ems.find(fitW) || null;
        if (tool && (spec.shape === 'rect' || spec.shape === 'ngon') && spec.cr > 0) notes.push({ level: 'warn', msg: '코너 R' + spec.cr + ' 보다 작은 엔드밀이 없어 T' + tool.no + ' Ø' + tool.dia + ' 를 씁니다. 모서리는 R' + r3(tool.dia / 2) + ' 로 남습니다.' });
      }
      if (!tool) {
        let want = Math.floor(Math.min(0.6 * mw, spec.shape === 'rect' && spec.cr > 0 ? 2 * spec.cr : Infinity));
        want = Math.max(1, Math.min(want, 20));
        missing.push({ type: 'endmill', dia: want, why: '포켓 폭 ' + r3(mw) + 'mm' });
      }
    }
    if (tool) {
      const f = AP_FACTOR[stock && stock.material] || 0.3;
      let ap = spec.stepdown > 0 ? spec.stepdown : Math.max(0.1, Math.floor(tool.dia * f * 10) / 10);
      if (spec.stepdown <= 0 && tool.flute > 0) ap = Math.min(ap, Math.floor(tool.flute * 0.9 * 10) / 10);
      // [V0.5] 진입점 (선가공 구멍): 사각·원형은 중심, 자유 형상은 가장 넓은 곳
      let ex = 0, ey = 0;
      if (geo.shape === 'poly') {
        const L = P.GEOM.offsetEx(P.GEOM.regionPaths(P.GEOM.shapeRegion(geo), 0, 0), -(tool.dia / 2 + spec.allowWall));
        if (L.length) { const bc = L.map(P.MILL.bestCenter).sort((a, b) => b.fit - a.fit)[0]; ex = r3(bc.x); ey = r3(bc.y); }
      }
      const base = Object.assign({ depth: spec.depth, thru: spec.thru, brk: spec.brk, r: 3, entry: spec.entry, ex, ey, draft: spec.draft, topR: spec.topR, floorR: spec.floorR, profStep: spec.profStep }, geo);
      const prof = spec.draft > 1e-6 || spec.topR > 1e-6 || spec.floorR > 1e-6;
      const pre = preDrills(spec, machine, stock, tool, depth, ex, ey, notes, missing);
      ops.push(...pre);
      let pw = spec.allowWall, pf = spec.allowFloor;
      const names = [];
      if (spec.rough) { ops.push(P.newOp('pocketRough', tool.no, Object.assign({}, base, { stepover: spec.stepover, stepdown: ap, allowWall: pw, allowFloor: pf, auto: true }))); names.push('황삭'); }
      if (spec.semi && spec.rough) {
        const lw = Math.min(pw, Math.max(0, spec.semiWall)), lf = Math.min(pf, Math.max(0, spec.semiFloor));
        if (lw < pw - 1e-9 || lf < pf - 1e-9) {
          ops.push(P.newOp('pocketSemi', tool.no, Object.assign({}, base, { stepover: 40, stepdown: ap, allowWall: pw, allowFloor: pf, leaveWall: lw, leaveFloor: lf, semiStep: Math.max(0, spec.semiStep), auto: true })));
          names.push('중삭' + (spec.semiStep > 0 ? '(' + spec.semiStep + 'mm씩)' : '(한 번에)'));
          pw = lw; pf = lf;
        } else notes.push({ level: 'warn', msg: '중삭 여유가 황삭 여유보다 작지 않아 중삭을 생략합니다.' });
      }
      if (spec.finish && spec.finishMode === 'both' && !prof) { ops.push(P.newOp('pocketFinish', tool.no, Object.assign({}, base, { stepover: 40, stepdown: ap, allowWall: pw, allowFloor: pf, auto: true }))); names.push('정삭'); }
      else if (spec.finish && prof) {
        // 측벽 형상(구배·R): 바닥 정삭(가장 안쪽 벽까지) → 측벽 형상 계단 정삭
        if (pf > 1e-9) { ops.push(P.newOp('pocketFloor', tool.no, Object.assign({}, base, { stepover: 40, stepdown: ap, allowWall: pw, allowFloor: pf, auto: true }))); names.push('바닥 정삭'); pf = 0; }
        ops.push(P.newOp('pocketProfile', tool.no, Object.assign({}, base, { stepover: 40, stepdown: ap, allowWall: pw, allowFloor: pf, auto: true }))); names.push('측벽 형상(구배·R, ' + spec.profStep + 'mm 계단)'); pw = 0;
      }
      else if (spec.finish) {
        if (spec.finishFloor && pf > 1e-9) { ops.push(P.newOp('pocketFloor', tool.no, Object.assign({}, base, { stepover: 40, stepdown: ap, allowWall: pw, allowFloor: pf, auto: true }))); names.push('바닥 정삭'); pf = 0; }
        if (spec.finishWall && pw > 1e-9) { ops.push(P.newOp('pocketWall', tool.no, Object.assign({}, base, { stepover: 40, stepdown: ap, allowWall: pw, allowFloor: pf, wallStep: Math.max(0, spec.wallStep), auto: true }))); names.push('측벽 정삭' + (spec.wallStep > 0 ? '(' + spec.wallStep + 'mm씩)' : '')); pw = 0; }
        if (!spec.finishFloor && !spec.finishWall) notes.push({ level: 'warn', msg: '정삭(바닥·측벽)을 하나도 고르지 않았습니다.' });
      }
      const levels = Math.max(1, Math.ceil((depth - spec.allowFloor) / ap - 1e-9));
      notes.push({ level: 'info', msg: 'T' + tool.no + ' Ø' + tool.dia + ' 엔드밀, 1회 절입 ' + ap + 'mm × ' + levels + '단' + (names.length > 1 ? ' → ' + names.slice(1).join(' → ') : '') + (spec.stepdown > 0 ? '' : ' (재질 기준 자동)') + (spec.entry === 'drill' ? ' · 선가공 구멍으로 진입' : spec.entry === 'ramp' ? ' · 램프 진입' : '') });
      if (spec.rough && (pw > 1e-9 || pf > 1e-9) && spec.finish) notes.push({ level: 'info', msg: '마지막 남은 여유: 측벽 ' + r3(pw) + ' · 바닥 ' + r3(pf) + 'mm' });
      if (tool.flute > 0 && depth > tool.flute) notes.push({ level: 'error', msg: 'T' + tool.no + ' 날 길이 ' + tool.flute + 'mm 보다 포켓이 깊습니다 (' + r3(depth) + 'mm). 긴 엔드밀이 필요합니다.' });
      if (machine.helical === false) notes.push({ level: 'warn', msg: '장비가 헬리컬 보간을 지원하지 않아 중심 수직 진입합니다 (중심 절삭 엔드밀 필요).' });
    }
    missing.forEach(mm => notes.push({ level: 'error', msg: '포켓에 맞는 평 엔드밀(Ø' + mm.dia + ' 이하)이 장비에 없습니다. [공구 추가]를 누르세요.' }));
    return { ops, notes, missing, spec };
  }

  /* ---------- [V0.5] 선가공 구멍·모서리 릴리프 구멍 ----------
   * 선가공(entry 'drill'): 진입점에 엔드밀 지름 이상(없으면 50% 이상) 드릴로 첫 단계 바닥(깊이 − 바닥 여유)까지 끝을 맞춰 뚫음
   * 모서리 릴리프(relief, 사각): 코너 R 이 공구 반경보다 작을 때 네 모서리에 구멍을 뚫어 직각 모서리 확보.
   *   구멍 반경 ρ ≥ 공구 반경/√2 (≈0.707) 이면 엔드밀이 남기는 모서리 살(R=공구 반경)이 모두 구멍 안에 들어감.
   *   중심 = 모서리에서 (ρ/√2, ρ/√2) 안쪽 → 구멍이 모서리 꼭짓점을 지남. 깊이 = 포켓 깊이(직경부 기준)
   */
  function preDrills(spec, machine, stock, tool, depth, ex, ey, notes, missing) {
    const out = [], drills = (machine.tools || []).filter(t => t.type === 'drill' && t.dia > 0).sort((a, b) => a.dia - b.dia);
    const ct = (machine.tools || []).filter(t => t.type === 'center').sort((a, b) => a.no - b.no)[0] || null;
    const add = (dt, at, extra, why, maxC) => {
      // [V0.5 검토] 센터 깊이는 포켓 바닥(황삭 바닥)을 넘지 않게
      if (ct) { const depthC = Math.max(0.1, Math.min(Math.floor((maxC || Infinity) * 10) / 10, Math.floor(Math.min(dt.dia + 0.4, ct.dia * 0.9) / 2 / Math.tan(toNum(ct.angle, 90) / 2 * Math.PI / 180) * 10) / 10)); out.push(P.newOp('center', ct.no, Object.assign({ depth: depthC, r: 3, auto: true }, at ? { at } : {}))); }
      const tipD = extra.depthMode === 'full' ? extra.depth + P.tipLength(dt) : extra.depth;
      const cyc = tipD / dt.dia > 3 ? 'peck' : 'drill';
      out.push(P.newOp(cyc, dt.no, Object.assign({ r: 3, q: Math.max(0.1, Math.floor(dt.dia * 10) / 10), auto: true }, extra, at ? { at } : {})));
      notes.push({ level: 'info', msg: why + ': T' + dt.no + ' Ø' + dt.dia + ' 드릴' + (ct ? ' (센터 T' + ct.no + ' 먼저)' : '') + ', 끝 깊이 ' + r3(tipD) + 'mm' });
    };
    if (spec.entry === 'drill' && spec.rough) {
      // [V0.5 검토] 드릴 구멍이 포켓 벽(측벽 여유)을 넘지 않게: 반경 ≤ 진입점에서 벽까지 − 측벽 여유 − 0.1
      const G = P.GEOM, reg = G.shapeRegion(P.specGeo(spec)), room = G.distToPts([reg.outer].concat(reg.islands || []), ex, ey) - spec.allowWall - 0.1;
      const fits = t => t.dia / 2 <= room + 1e-9;
      const dt = drills.find(t => fits(t) && t.dia >= tool.dia - 1e-9 && t.dia <= tool.dia * 1.6) || drills.filter(t => fits(t) && t.dia >= 0.5 * tool.dia - 1e-9 && t.dia < tool.dia).pop();
      const tip = r3(depth - spec.allowFloor);
      if (!dt) { missing.push({ type: 'drill', dia: Math.ceil(tool.dia), why: '포켓 선가공 구멍' }); notes.push({ level: 'error', msg: '선가공 구멍용 드릴(Ø' + Math.ceil(tool.dia) + ' 정도)이 없습니다. [공구 추가]를 누르세요.' }); }
      else add(dt, (spec.shape === 'poly' || spec.shape === 'ngon') && (ex || ey) ? [[ex, ey]] : null, { depth: tip, depthMode: 'tip' }, '선가공 구멍(진입점)', tip);
    }
    if (spec.relief && spec.rough) {
      if (spec.shape !== 'rect') notes.push({ level: 'warn', msg: '모서리 릴리프 구멍은 사각 포켓에만 넣습니다.' });
      else if (spec.cr >= tool.dia / 2 - 1e-9) notes.push({ level: 'info', msg: '코너 R' + spec.cr + ' 이 공구 반경 이상이라 모서리 릴리프 구멍이 필요 없습니다.' });
      else {
        const need = Math.SQRT2 * tool.dia / 2; // 구멍 반경 ≥ 공구 반경/√2 이면 모서리 살이 남지 않음
        const dt = drills.find(t => t.dia >= need - 1e-9 && t.dia <= tool.dia * 1.2 + 1e-9);
        if (!dt) { const want = Math.max(1, Math.ceil(need * 2) / 2); missing.push({ type: 'drill', dia: want, why: '모서리 릴리프 구멍' }); notes.push({ level: 'error', msg: '모서리 릴리프용 드릴(Ø' + want + ' 이상)이 없습니다. [공구 추가]를 누르세요.' }); }
        else {
          const rr = dt.dia / 2 / Math.SQRT2, ax = r3(spec.w / 2 - rr), ay = r3(spec.h / 2 - rr);
          const extra = spec.thru ? { thru: true, brk: spec.brk, depth: 10 } : { depth: r3(spec.depth), depthMode: 'full' };
          add(dt, [[ax, ay], [-ax, ay], [-ax, -ay], [ax, -ay]], extra, '모서리 릴리프 구멍 4개', spec.thru ? undefined : spec.depth);
          notes.push({ level: 'warn', msg: '릴리프 구멍은 벽 밖으로 ' + r3(dt.dia / 2 - rr) + 'mm 파고들고, 끝 원뿔이 바닥 아래로 내려갑니다 (도면에서 허용되는지 확인).' });
        }
      }
    }
    return out;
  }

  // 간편 입력의 형상 → 공정 형상 (다각 → 자유 형상 점 목록)
  function specGeo(sp) {
    if (sp.shape === 'ngon') {
      const n = Math.max(3, Math.min(24, Math.round(toNum(sp.sides, 6))));
      return { shape: 'poly', w: sp.w, h: sp.h, cr: sp.cr, dia: sp.dia, poly: { outer: P.GEOM.ngonPoly(n, toNum(sp.dia, 0) / 2, toNum(sp.rot, 0), toNum(sp.cr, 0)).map(p => [r3(p[0]), r3(p[1])]), islands: [], name: n + '각' + (sp.cr > 0 ? ' R' + sp.cr : '') }, side: sp.side };
    }
    return { shape: sp.shape, w: sp.w, h: sp.h, cr: sp.cr, dia: sp.dia, poly: sp.shape === 'poly' ? sp.poly : null, side: sp.side };
  }
  Object.assign(P, { newPocketSpec, normalizePocketSpec, planPocketSpec, AP_FACTOR, specGeo });
})(typeof globalThis !== 'undefined' ? globalThis : this);
