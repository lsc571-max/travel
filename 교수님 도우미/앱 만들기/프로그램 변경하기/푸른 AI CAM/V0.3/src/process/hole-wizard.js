/* =====================================================================
 * 푸른 AI CAM - [공정 관리: 구멍·탭 간편 입력] process/hole-wizard.js
 * 역할: 사용자가 "구멍 지름·깊이" 또는 "나사 규격(M8 등)·탭 깊이"만 입력하면
 *       센터 → 드릴(사이클 자동) → 탭 공정을 계산 규칙으로 구성한다.
 *       결과는 일반 공정(ops)이므로 계획·포스트·검증 모듈은 그대로 쓴다.
 * 규칙 (모두 결정적 계산, AI 미사용)
 *   - 기초 드릴: 미터 나사 표 추천값. 없으면 허용 범위(D−1.25P ~ D−0.5P) 안에서 가장 가까운 보유 드릴
 *   - 막힌 탭의 드릴 직경부 깊이 = 탭 깊이 + max(3P, 2mm) → 0.5mm 단위 올림
 *   - 드릴 사이클 자동: 직경부 깊이/직경 ≤ 3 → G81, ≤ 5 → G73, 그 이상 → G83
 *   - 펙 Q = 공구 직경 (0.5mm 단위, 최소 0.5)
 *   - 센터 드릴: 모따기 직경 = 구멍(또는 나사) 직경 + 0.4, 공구 직경의 90% 이내
 *   - 탭 R점 = max(5, 3P) (올림), 드릴 R점 = 3
 * 의존: engine/*, ops/*
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  const { toNum, r3, toolMap, tapDrill } = P;
  const EPSD = 1e-3;
  const ceilTo = (v, s) => Math.ceil(v / s - 1e-9) * s;
  const roundTo = (v, s) => Math.round(v / s) * s;

  // 간편 입력 기본값
  function newHoleSpec(kind, extra) {
    const s = kind === 'tap'
      ? { kind: 'tap', tapD: 8, tapP: 1.25, tapDepth: 12, thru: false, brk: 1, center: true, cycle: 'auto', tapMode: 'auto' }
      : { kind: 'drill', dia: 6.6, depth: 10, depthMode: 'full', thru: false, brk: 1, center: true, cycle: 'auto' };
    return Object.assign(s, extra || {});
  }
  function normalizeHoleSpec(s) {
    if (!s || (s.kind !== 'drill' && s.kind !== 'tap')) return null;
    const d = newHoleSpec(s.kind);
    const o = { kind: s.kind };
    Object.keys(d).forEach(k => {
      if (k === 'kind') return;
      if (typeof d[k] === 'number') o[k] = toNum(s[k], d[k]);
      else if (typeof d[k] === 'boolean') o[k] = typeof s[k] === 'boolean' ? s[k] : d[k];
      else o[k] = typeof s[k] === 'string' ? s[k] : d[k];
    });
    if (!['auto', 'drill', 'peck', 'deep'].includes(o.cycle)) o.cycle = 'auto';
    if (o.kind === 'tap' && !['auto', 'rigid', 'tap'].includes(o.tapMode)) o.tapMode = 'auto';
    if (o.kind === 'drill' && o.depthMode !== 'tip') o.depthMode = 'full';
    return o;
  }

  const findDrill = (m, dia) => (m.tools || []).filter(t => t.type === 'drill' && Math.abs(t.dia - dia) < EPSD).sort((a, b) => a.no - b.no)[0] || null;
  const findTap = (m, d, p) => (m.tools || []).filter(t => t.type === 'tap' && Math.abs(t.dia - d) < EPSD && Math.abs((t.pitch || 0) - p) < EPSD).sort((a, b) => a.no - b.no)[0] || null;
  const findCenter = m => (m.tools || []).filter(t => t.type === 'center').sort((a, b) => a.no - b.no)[0] || null;

  // 깊이/직경 비로 드릴 사이클 선택
  function autoCycle(full, dia) {
    const ratio = full / dia;
    return ratio <= 3 + 1e-9 ? 'drill' : ratio <= 5 + 1e-9 ? 'peck' : 'deep';
  }

  // 간편 입력 → 공정 목록. missing = 장비에 없는 공구(추가 필요)
  function planHoleSpec(spec, machine, stock) {
    spec = normalizeHoleSpec(spec);
    const notes = [], missing = [], ops = [];
    if (!spec) return { ops, notes: [{ level: 'error', msg: '구멍 가공 입력이 올바르지 않습니다.' }], missing, spec };
    const sz = toNum(stock && stock.sz, 0);
    let holeDia, drillDia, drillFull, drillThru = !!spec.thru, tapTool = null;

    if (spec.kind === 'tap') {
      if (!(spec.tapD > 0 && spec.tapP > 0)) return { ops, notes: [{ level: 'error', msg: '나사 규격(호칭경·피치)을 입력하세요.' }], missing, spec };
      if (!spec.thru && !(spec.tapDepth > 0)) notes.push({ level: 'error', msg: '탭 깊이를 입력하세요.' });
      const rec = tapDrill(spec.tapD, spec.tapP);
      holeDia = spec.tapD;
      drillDia = rec ? rec.dia : r3(spec.tapD - spec.tapP);
      let dt = findDrill(machine, drillDia);
      if (!dt) {
        const lo = spec.tapD - 1.25 * spec.tapP, hi = spec.tapD - 0.5 * spec.tapP;
        const alt = (machine.tools || []).filter(t => t.type === 'drill' && t.dia >= lo - EPSD && t.dia < hi - EPSD)
          .sort((a, b) => Math.abs(a.dia - drillDia) - Math.abs(b.dia - drillDia) || a.no - b.no)[0];
        if (alt) { notes.push({ level: 'warn', msg: '추천 기초 드릴 Ø' + drillDia + ' 이(가) 없어 보유 드릴 T' + alt.no + ' Ø' + alt.dia + ' 을(를) 사용합니다.' }); dt = alt; drillDia = alt.dia; }
        else missing.push({ type: 'drill', dia: drillDia, why: 'M' + spec.tapD + ' 기초 드릴' });
      }
      tapTool = findTap(machine, spec.tapD, spec.tapP);
      if (!tapTool) missing.push({ type: 'tap', dia: spec.tapD, pitch: spec.tapP, why: 'M' + spec.tapD + '×' + spec.tapP + ' 탭' });
      drillFull = drillThru ? null : ceilTo(toNum(spec.tapDepth, 0) + Math.max(3 * spec.tapP, 2), 0.5);
      spec._drillTool = dt;
    } else {
      if (!(spec.dia > 0)) return { ops, notes: [{ level: 'error', msg: '구멍 지름을 입력하세요.' }], missing, spec };
      if (!spec.thru && !(spec.depth > 0)) notes.push({ level: 'error', msg: '구멍 깊이를 입력하세요.' });
      holeDia = drillDia = spec.dia;
      const dt = findDrill(machine, drillDia);
      if (!dt) missing.push({ type: 'drill', dia: drillDia, why: 'Ø' + drillDia + ' 구멍' });
      drillFull = drillThru ? null : toNum(spec.depth, 0);
      spec._drillTool = dt;
    }
    const dt = spec._drillTool;
    delete spec._drillTool;

    // 1. 센터 드릴
    if (spec.center) {
      const ct = findCenter(machine);
      if (!ct) missing.push({ type: 'center', dia: 6, why: '센터 드릴' });
      else {
        const ang = toNum(ct.angle, 90);
        const chamfer = Math.min(holeDia + 0.4, ct.dia * 0.9);
        const depth = Math.max(0.1, Math.floor((chamfer / 2) / Math.tan(ang / 2 * Math.PI / 180) * 10) / 10);
        ops.push(P.newOp('center', ct.no, { depth, r: 3 }));
      }
    }
    // 2. 드릴 (사이클 자동)
    if (dt) {
      const full = drillThru ? sz + toNum(spec.brk, 1) : drillFull;
      let cyc = spec.cycle === 'auto' ? autoCycle(full, dt.dia) : spec.cycle;
      const q = Math.max(0.5, roundTo(dt.dia, 0.5));
      const extra = { r: 3, q, auto: true };
      if (drillThru) Object.assign(extra, { thru: true, brk: toNum(spec.brk, 1), depth: 10 });
      else if (spec.kind === 'drill' && spec.depthMode === 'tip') Object.assign(extra, { depth: drillFull, depthMode: 'tip' });
      else Object.assign(extra, { depth: drillFull, depthMode: 'full' });
      ops.push(P.newOp(cyc, dt.no, extra));
      // 바로 고칠 수 있게 깊이 문제를 미리 안내 (최종 판단은 검증 모듈)
      const tip = P.tipLength(dt), under = toNum(stock && stock.under, 0);
      if (drillThru) {
        const need = r3(toNum(spec.brk, 1) + tip);
        if (under < need - 1e-6) notes.push({ level: 'error', msg: '관통 가공에는 소재 아래 여유(패럴렐 틈)가 최소 ' + need + 'mm 필요합니다 (현재 ' + under + 'mm, 드릴 끝각 ' + r3(tip) + ' + 관통 여유 ' + toNum(spec.brk, 1) + '). [소재·가공]에서 하부 여유를 확인하세요.' });
      } else {
        const tipZ = extra.depthMode === 'tip' ? drillFull : drillFull + tip;
        if (tipZ > sz + under + 1e-6) notes.push({ level: 'error', msg: '드릴 끝 깊이 ' + r3(tipZ) + 'mm 가 소재 두께 ' + sz + 'mm + 하부 여유 ' + under + 'mm 를 넘습니다. 깊이를 줄이거나 "관통"을 선택하세요.' });
        else if (tipZ > sz + 1e-6) notes.push({ level: 'warn', msg: '드릴 끝이 소재 바닥을 뚫고 나갑니다 (깊이 ' + r3(tipZ) + ' > 두께 ' + sz + '). 관통이면 "관통"을 선택하세요.' });
      }
      if (spec.cycle === 'auto') notes.push({ level: 'info', msg: '드릴 사이클 자동: 깊이/직경 ' + r3(full / dt.dia) + ' → ' + P.OP_TYPES[cyc].label + ' (' + P.OP_TYPES[cyc].code + ')' });
    }
    // 3. 탭
    if (spec.kind === 'tap' && tapTool) {
      const type = spec.tapMode === 'auto' ? (machine.rigidTap ? 'rigid' : 'tap') : spec.tapMode;
      const r = Math.max(5, ceilTo(3 * spec.tapP, 0.5));
      const extra = { r, auto: true };
      if (spec.thru) Object.assign(extra, { thru: true, brk: toNum(spec.brk, 1), depth: 10 });
      else Object.assign(extra, { depth: toNum(spec.tapDepth, 0) });
      ops.push(P.newOp(type, tapTool.no, extra));
      if (type === 'tap') notes.push({ level: 'info', msg: '일반 탭(G84): 텐션·컴프레션 탭 홀더가 필요합니다.' });
    }
    missing.forEach(mm => notes.push({ level: 'error', msg: '장비 공구 목록에 ' + (mm.type === 'tap' ? '탭 M' + mm.dia + '×' + mm.pitch : mm.type === 'center' ? '센터 드릴' : '드릴 Ø' + mm.dia) + ' 이(가) 없습니다 (' + mm.why + '). [공구 추가]를 누르세요.' }));
    return { ops, notes, missing, spec };
  }

  // 그룹에 간편 입력 적용 (공정을 다시 구성)
  function applyHoleSpec(group, machine, stock) {
    if (!group.spec) return null;
    const res = planHoleSpec(group.spec, machine, stock);
    group.spec = res.spec;
    group.ops = res.ops;
    return res;
  }

  // 없는 공구를 장비에 추가 (빈 T번호 사용). 반환: 추가된 공구
  function addMissingTool(machine, miss) {
    const used = new Set((machine.tools || []).map(t => t.no));
    let no = 1; while (used.has(no)) no++;
    let t;
    if (miss.type === 'tap') t = { no, type: 'tap', name: '탭', dia: miss.dia, pitch: miss.pitch, mat: 'HSS', flute: Math.max(20, Math.round(miss.dia * 3.5)) };
    else if (miss.type === 'center') t = { no, type: 'center', name: '스팟 드릴', dia: 6, angle: 90, mat: 'CARBIDE', flute: 10 };
    else t = { no, type: 'drill', name: '드릴', dia: miss.dia, angle: 118, mat: 'HSS', flute: Math.max(20, Math.round(miss.dia * 10)) };
    machine.tools.push(P.normalizeTool(t));
    return machine.tools[machine.tools.length - 1];
  }

  // 공정 표시 이름 (예: T05 Ø6.8 고속 펙 드릴 G73)
  function opLabel(op, machine) {
    const t = toolMap(machine).get(op.toolNo), def = P.OPS.get(op.type);
    const nm = def ? def.label : op.type, code = def ? def.code : '';
    if (!t) return 'T' + String(op.toolNo).padStart(2, '0') + ' (공구 없음) ' + nm;
    const size = t.type === 'tap' ? 'M' + t.dia + '×' + t.pitch : 'Ø' + t.dia;
    return 'T' + String(t.no).padStart(2, '0') + ' ' + size + ' ' + nm + ' ' + code;
  }

  // 나사 규격 목록 (화면 선택용): 보통 나사 + 가는 나사
  function threadList() {
    const out = P.METRIC_COARSE.map(r => ({ d: r[0], p: r[1], label: 'M' + r[0] + (Number.isInteger(r[0]) ? '' : '') + ' (P' + r[1] + ')', fine: false }));
    P.METRIC_FINE.slice().sort((a, b) => a[0] - b[0] || b[1] - a[1]).forEach(r => out.push({ d: r[0], p: r[1], label: 'M' + r[0] + '×' + r[1] + ' (가는 나사)', fine: true }));
    return out;
  }

  Object.assign(P, { newHoleSpec, normalizeHoleSpec, planHoleSpec, applyHoleSpec, addMissingTool, opLabel, threadList, autoCycle });
})(typeof globalThis !== 'undefined' ? globalThis : this);
