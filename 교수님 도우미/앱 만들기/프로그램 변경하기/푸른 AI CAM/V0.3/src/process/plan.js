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
    ordered.forEach(i => {
      const def = P.OPS.get(i.op.type);
      const d = P.opDepth(i.op, i.tool, project.stock);
      const c = P.opConditions(i.op, i.tool, project.stock.material, machine);
      const params = {
        type: i.op.type, toolNo: i.op.toolNo, z: d.z, r: r3(toNum(i.op.r, 3)),
        q: def.ui.q ? r3(toNum(i.op.q, 0)) : 0,
        dwell: def.ui.dwell ? Math.round(toNum(i.op.dwell, 0)) : 0,
        rpm: c.rpm, feed: c.feed
      };
      const key = JSON.stringify(params);
      const holes = i.g.holes.map(h => ({ x: h.x, y: h.y, gid: i.g.id, hid: h.id }));
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

  Object.assign(P, { defaultBundles, findToolBySpec, specMatches, specText, applyBundle, opsToBundle, checkBundleFit, buildPlan });
})(typeof globalThis !== 'undefined' ? globalThis : this);
