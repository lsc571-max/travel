/* =====================================================================
 * 푸른 AI CAM - [공정 관리 모듈] process/plan.js
 * 역할: 가공 블록 조합·순서 관리: 공정 묶음(프리셋) 적용·저장·적합성 확인, 공구 교환 최소화 정렬(그룹 내부 순서 보존),
 *       같은 조건 병합, 구멍 순서, 표준 가공 데이터(toolpath)·공구 교환 표시 생성
 * 의존: engine/*, ops/*
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  const { uid, toNum, r3, clone, toolMap, TOOL_TYPES, stockRect, newGroup, newProject } = P;

  /* ---------------- 기본 공정 묶음 ---------------- */
  function defaultBundles(machine) {
    const tm = toolMap(machine), newOp = P.newOp;
    const spec = n => { const t = tm.get(n); return t ? { type: t.type, dia: t.dia, pitch: t.pitch || 0 } : null; };
    const b = (name, desc, ops) => ({ id: uid('b'), name, desc, ops: ops.map(o => { const op = newOp(o[0], o[1], o[2]); op.toolSpec = spec(o[1]); delete op.id; return op; }) });
    return [
      b('M5 탭 (깊이 10)', '스팟 → Ø4.2 펙 드릴 14 → M5 리지드 탭 10', [['center', 1, { depth: 2.6 }], ['peck', 3, { depth: 14, q: 2 }], ['rigid', 12, { depth: 10 }]]),
      b('M6 탭 (깊이 12)', '스팟 → Ø5.0 펙 드릴 17 → M6 리지드 탭 12', [['center', 1, { depth: 3 }], ['peck', 4, { depth: 17, q: 2 }], ['rigid', 13, { depth: 12 }]]),
      b('M8 탭 (깊이 15)', '스팟 → Ø6.8 심공 드릴 21 → M8 리지드 탭 15', [['center', 1, { depth: 3 }], ['deep', 5, { depth: 21, q: 3 }], ['rigid', 14, { depth: 15 }]]),
      b('M10 탭 (깊이 18)', '스팟 → Ø8.5 심공 드릴 25 → M10 리지드 탭 18', [['center', 1, { depth: 3 }], ['deep', 6, { depth: 25, q: 3 }], ['rigid', 15, { depth: 18 }]]),
      b('Ø6.6 볼트 구멍 (관통)', '스팟 → Ø6.6 펙 드릴 관통 (하부 여유 필요)', [['center', 1, { depth: 3 }], ['peck', 7, { thru: true, brk: 1, q: 3 }]]),
      b('Ø9.0 볼트 구멍 (관통)', '스팟 → Ø9.0 펙 드릴 관통 (하부 여유 필요)', [['center', 1, { depth: 3 }], ['peck', 8, { thru: true, brk: 1, q: 3 }]])
    ];
  }

  /* ---------------- 공정 묶음 적용·적합성 ---------------- */
  function findToolBySpec(machine, spec) {
    if (!spec) return null;
    return (machine.tools || []).find(t => t.type === spec.type && Math.abs(t.dia - spec.dia) < 1e-6 && (t.type !== 'tap' || Math.abs((t.pitch || 0) - spec.pitch) < 1e-6)) || null;
  }
  function specMatches(t, spec) { return !!(t && spec && t.type === spec.type && Math.abs(t.dia - spec.dia) < 1e-6 && (t.type !== 'tap' || Math.abs((t.pitch || 0) - spec.pitch) < 1e-6)); }
  function specText(s) { return s ? (s.type === 'tap' ? '탭 M' + s.dia + '×' + s.pitch : TOOL_TYPES[s.type] + ' Ø' + s.dia) : '-'; }

  // 묶음을 현재 장비에 맞춰 공정 목록으로 변환 (공구 사양이 맞는 번호로 자동 매칭)
  function applyBundle(bundle, machine) {
    const tm = toolMap(machine), notes = [];
    const ops = bundle.ops.map(t => {
      const op = P.normalizeOp(t);
      if (!op) { notes.push('지원하지 않는 가공 방식(' + String(t && t.type).slice(0, 30) + ')은 제외했습니다. 공정 확인 필요'); return null; }
      op.id = uid('o');
      const cur = tm.get(op.toolNo);
      if (t.toolSpec && !specMatches(cur, t.toolSpec)) {
        const alt = findToolBySpec(machine, t.toolSpec);
        if (alt) { notes.push(P.OPS.get(op.type).label + ': T' + op.toolNo + ' → T' + alt.no + ' (' + specText(t.toolSpec) + ' 사양 일치 공구로 변경)'); op.toolNo = alt.no; }
        else notes.push(P.OPS.get(op.type).label + ': 장비에 ' + specText(t.toolSpec) + ' 공구가 없습니다. 공구 확인 필요');
      }
      delete op.toolSpec;
      return op;
    }).filter(Boolean);
    return { ops, notes };
  }
  function opsToBundle(name, ops, machine) {
    const tm = toolMap(machine);
    return P.normalizeBundle({ name, desc: '', ops: ops.map(o => { const c = clone(o); delete c.id; const t = tm.get(o.toolNo); c.toolSpec = t ? { type: t.type, dia: t.dia, pitch: t.pitch || 0 } : null; return c; }) });
  }

  // 묶음 적합성 확인: 묶음 하나를 임시 프로젝트에 적용하여 가공 조건만 검사
  function checkBundleFit(bundle, machine, stock) {
    const res = applyBundle(bundle, machine);
    const r = stockRect(stock);
    const g = newGroup('적합성 확인', 0);
    g.holes = [{ id: 'chk', x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }];
    g.ops = res.ops;
    const p = newProject(machine); p.stock = clone(stock); p.groups = [g]; p.machineId = machine.id;
    const v = P.validateProject(p, machine);
    const issues = v.issues.filter(i => ![1, 2, 3, 10, 11].includes(i.cat) && i.level !== 'info');
    return { notes: res.notes, issues, ok: !issues.some(i => i.level === 'error') && !res.notes.some(n => n.includes('없습니다') || n.includes('제외')) };
  }

  /* ---------------- 가공 계획 (공정 순서) ---------------- */
  function buildPlan(project, machine) {
    const tm = toolMap(machine), info = [];
    const inst = [];
    project.groups.forEach((g, gi) => {
      if (!g.holes.length) return;
      g.ops.forEach((op, oi) => inst.push({ g, gi, op, oi, tool: tm.get(op.toolNo) || null, stage: P.OPS.get(op.type).stage, idx: inst.length }));
    });
    let ordered = inst;
    if (project.settings.toolOrder === 'tool') {
      const first = new Map();
      inst.forEach(i => { if (!first.has(i.op.toolNo)) first.set(i.op.toolNo, i.idx); });
      const sorted = inst.slice().sort((a, b) => a.stage - b.stage || first.get(a.op.toolNo) - first.get(b.op.toolNo) || a.idx - b.idx);
      // 그룹 내부 공정 순서가 바뀌면 안전을 위해 그룹 순서로 되돌림
      const ok = project.groups.every(g => { let last = -1; return sorted.filter(i => i.g === g).every(i => { const r = i.oi > last; last = i.oi; return r; }); });
      if (ok) ordered = sorted; else info.push('공구 교환 최소화 시 그룹 내부 공정 순서가 바뀌므로 그룹 순서대로 가공합니다.');
    }
    const steps = [];
    const surf = project.settings.depthRef === 'auto' ? surfaces(project, machine, ordered) : null;
    const expanded = [];
    // [V0.5] 위치마다 '깊이 기준면(완성 형상의 바닥)' 과 '시작면(이미 깎인 면)' 이 다르면 공정을 나눔
    ordered.forEach(i => {
      if (!surf) { expanded.push({ i, holes: i.g.holes, ref: 0, start: 0 }); return; }
      const bucket = new Map();
      i.g.holes.forEach(h => { const t = surf(i, h), k = t.ref + '|' + t.start; if (!bucket.has(k)) bucket.set(k, { i, holes: [], ref: t.ref, start: t.start }); bucket.get(k).holes.push(h); });
      bucket.forEach(b => expanded.push(b));
    });
    expanded.forEach(e => {
      const i = e.i;
      const def = P.OPS.get(i.op.type);
      const d0 = P.opDepth(i.op, i.tool, project.stock);
      // [V0.5 검토] 관통 공정은 소재 바닥 기준 깊이(기준면을 더하지 않음). 센터 드릴(자리 표시)은 실제로 깎인 면(시작면) 기준
      const addRef = i.op.thru ? 0 : def.role === 'spot' ? e.start : e.ref;
      const d = e.ref || e.start ? Object.assign({}, d0, { z: r3(d0.z + addRef) }) : d0;
      const c = P.opConditions(i.op, i.tool, project.stock.material, machine);
      const params = {
        type: i.op.type, toolNo: i.op.toolNo, z: d.z, r: r3(toNum(i.op.r, 3) + e.start),
        q: def.ui.q ? r3(toNum(i.op.q, 0)) : 0,
        dwell: def.ui.dwell ? Math.round(toNum(i.op.dwell, 0)) : 0,
        rpm: c.rpm, feed: c.feed
      };
      if (e.start) params.top = e.start; // [V0.5] 시작면 (이미 깎인 면, 0 이면 생략 → 이전 버전과 같은 계획)
      if (e.ref) params.ref = e.ref;
      if (def.params) { params.pk = {}; Object.keys(def.params).forEach(k => { params.pk[k] = typeof def.params[k] === 'number' ? r3(toNum(i.op[k], def.params[k])) : i.op[k]; }); }
      const key = JSON.stringify(params);
      // [V0.5] 공정 위치 오프셋(at): 포켓 진입 선가공 구멍·모서리 릴리프 구멍 등
      const offs = Array.isArray(i.op.at) && i.op.at.length ? i.op.at : [[0, 0]];
      const holes = [];
      e.holes.forEach(h => offs.forEach(o => holes.push({ x: o[0] ? r3(h.x + o[0]) : h.x, y: o[1] ? r3(h.y + o[1]) : h.y, gid: i.g.id, hid: h.id })));
      const last = steps[steps.length - 1];
      if (last && last.key === key) { last.holes.push(...holes); last.refs.push({ gid: i.g.id, opId: i.op.id }); }
      else steps.push(Object.assign({ key, tool: i.tool, holes, refs: [{ gid: i.g.id, opId: i.op.id }], depthInfo: d }, params));
    });
    // 표준 가공 데이터: 가공 모듈이 사이클 종류를 정하고, 공구 교환·안전 이동은 여기서 통합 관리
    let pos = { x: 0, y: 0 }, prevTool = null;
    steps.forEach((s, k) => {
      s.idx = k + 1;
      const def = P.OPS.get(s.type);
      s.ncName = def.ncName;
      s.toolpath = Object.assign({ z: s.z, r: s.r, q: s.q, dwell: s.dwell, feed: s.feed, rpm: s.rpm }, def.toolpath(s));
      s.toolChange = prevTool !== s.toolNo;
      s.first = k === 0; s.last = k === steps.length - 1;
      prevTool = s.toolNo;
      s.holes = P.orderHoles(s.holes, project.settings.pathOrder, pos);
      if (s.holes.length) pos = s.holes[s.holes.length - 1];
    });
    return { steps, info };
  }

  /* ---------------- [V0.5] 먼저 가공된 면 (깊이 기준면·시작면) ----------------
   * 완성 형상 기준: 다른 가공(포켓·평면·윤곽)의 바닥 안에 있는 구멍·포켓은 그 바닥에서부터 깊이를 잰다 (도면 치수 방식).
   * 시작면: 가공 순서상 그 위치가 이미 깎였으면 R점·진입을 그 면에서 시작한다 (빈 공간 공회전 방지).
   *   - 같은 그룹(같은 형상의 황삭·정삭·선가공 구멍)은 서로 기준이 되지 않는다.
   *   - 포함 판정: 구멍은 공구 원(반경 + 0.3mm)이, 포켓은 윤곽 전체가 영역 안에 있어야 함 (벽에 걸치면 원래 윗면 기준)
   */
  function regionPaths(rg, tool) {
    const G = P.GEOM;
    if (!rg.kind) return rg.shape === 'circle' ? [G.toPath(G.circlePoly(rg.cx, rg.cy, rg.dia / 2))] : [G.toPath(G.rrectPoly(rg.cx, rg.cy, rg.w, rg.h, rg.cr))];
    if (rg.kind === 'face') return [G.toPath([[rg.x0, rg.y0], [rg.x1, rg.y0], [rg.x1, rg.y1], [rg.x0, rg.y1]])];
    if (rg.kind === 'area') return [G.toPath(G.ccw(rg.outer))].concat(rg.islands.map(a => G.toPath(G.cw(a))));
    if (rg.kind === 'inside') return [G.toPath(G.ccw(rg.part))];
    // 바깥 윤곽: 부품 바깥 띠 (부품 ~ 가장 바깥 공구 끝)
    return G.offsetEx([G.toPath(G.ccw(rg.part))], rg.dMax + (tool ? tool.dia / 2 : 0)).map(e => e.outer).concat([G.toPath(G.cw(rg.part))]);
  }
  function surfaces(project, machine, ordered) {
    const G = P.GEOM, tm = toolMap(machine), st = project.stock;
    // 그룹별 밀링 영역 (위치마다), 상대 바닥(관통 포함)
    const feats = [];
    project.groups.forEach(g => {
      const mills = g.ops.filter(o => { const d = P.OPS.get(o.type); return d && d.regions && d.mill !== 'chamfer'; });
      if (!mills.length) return;
      const op = mills.reduce((a, b) => (P.opDepth(b, tm.get(b.toolNo), st).z < P.opDepth(a, tm.get(a.toolNo), st).z ? b : a));
      const def = P.OPS.get(op.type), tool = tm.get(op.toolNo) || null;
      g.holes.forEach(h => {
        if (!P.isNum(h.x) || !P.isNum(h.y)) return;
        const rg = def.regions(op, h, st, tool)[0], paths = regionPaths(rg, tool);
        const pl = paths.map(G.fromPath);
        feats.push({ g, h, rel: P.opDepth(op, tool, st).z, paths, pl, kind: def.mill, abs: null });
      });
    });
    const shapeOf = (i, h) => {
      const def = P.OPS.get(i.op.type);
      if (def.mill === 'face') return null;
      if (def.mill && i.op.shape) { const reg = P.GEOM.shapeRegion(i.op); return { poly: G.ccw(reg.outer).map(p => [p[0] + h.x, p[1] + h.y]) }; }
      const off = Array.isArray(i.op.at) && i.op.at.length ? i.op.at : [[0, 0]], r = (i.tool ? i.tool.dia / 2 : 1) + 0.3;
      return { disks: off.map(o => [h.x + o[0], h.y + o[1], r]) };
    };
    const inside = (f, sh) => {
      if (sh.disks) return sh.disks.every(d => G.inPaths(f.paths, d[0], d[1]) && G.distToPts(f.pl, d[0], d[1]) >= d[2]);
      const pts = sh.poly, n = pts.length;
      for (let k = 0; k < n; k++) {
        const a = pts[k], b = pts[(k + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]), m = Math.max(1, Math.ceil(L));
        for (let j = 0; j < m; j++) { const x = a[0] + (b[0] - a[0]) * j / m, y = a[1] + (b[1] - a[1]) * j / m; if (!G.inPaths(f.paths, x, y) || G.distToPts(f.pl, x, y) < 0.2) return false; }
      }
      return true;
    };
    // 기준면: 다른 그룹 영역 중 포함하는 가장 깊은 완성 바닥 (영역 자신의 바닥도 같은 규칙으로 절대값화, 반복 안정화)
    const refOf = (g, sh) => { let t = 0; if (!sh) return 0; feats.forEach(f => { if (f.g !== g && f.abs !== null && f.abs < t - 1e-9 && inside(f, sh)) t = f.abs; }); return t; };
    feats.forEach(f => { f.abs = f.rel; });
    for (let it = 0; it < 6; it++) {
      let changed = false;
      feats.forEach(f => {
        const own = ordered.find(i => i.g === f.g && P.OPS.get(i.op.type).mill);
        const sh = own ? shapeOf(own, f.h) : null, t = refOf(f.g, sh), a = r3(t + f.rel);
        if (Math.abs(a - f.abs) > 1e-9) { f.abs = a; changed = true; }
      });
      if (!changed) break;
    }
    // 시작면: 순서상 앞서 끝난(그 그룹의 공정이 하나 이상 지난) 다른 그룹 영역
    const pos = new Map(); ordered.forEach((i, k) => { if (!pos.has(i.g.id)) pos.set(i.g.id, []); pos.get(i.g.id).push(k); });
    const memo = new Map();
    return function (i, h) {
      const key = i.idx + '|' + h.id;
      if (memo.has(key)) return memo.get(key);
      const sh = shapeOf(i, h);
      let ref = 0, start = 0;
      if (sh) {
        ref = refOf(i.g, sh);
        const k = ordered.indexOf(i);
        feats.forEach(f => {
          if (f.g === i.g || !(f.abs < start - 1e-9)) return;
          const done = (pos.get(f.g.id) || []).filter(x => x < k);
          if (!done.length || !inside(f, sh)) return;
          // 그 그룹에서 지금까지 실제로 깎인 바닥 (황삭만 끝났으면 바닥 여유만큼 위)
          let floor = 0;
          done.forEach(x => { const o = ordered[x].op, t = ordered[x].tool, dd = P.opDepth(o, t, st), af = /Rough$|Semi$/.test(o.type) ? toNum(o.allowFloor, 0) : 0; floor = Math.min(floor, dd.z + af); });
          const fl = r3(f.abs - f.rel + floor); // 그 영역의 기준면 + 실제 깎인 상대 바닥
          if (fl < start) start = fl;
        });
        start = Math.max(start, ref); // 시작면은 완성 바닥보다 깊을 수 없음
      }
      const res = { ref: r3(ref), start: r3(start) };
      memo.set(key, res);
      return res;
    };
  }

  Object.assign(P, { localSurfaces: surfaces, defaultBundles, findToolBySpec, specMatches, specText, applyBundle, opsToBundle, checkBundleFit, buildPlan });
})(typeof globalThis !== 'undefined' ? globalThis : this);
