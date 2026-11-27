/* =====================================================================
 * 푸른 AI CAM - [공통 엔진: 프로젝트] engine/project.js
 * 역할: 프로젝트·공정·공정 묶음 데이터 정규화(외부 JSON 방어), 그룹 대표 직경
 * 의존: engine/common.js, ops/registry.js
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  const { uid, toNum, MATERIALS, ORIGIN_LABEL, GROUP_COLORS, MAX_HOLES, newProject, newOp } = P;
  const isSpot = t => { const d = P.OPS.get(t); return !!d && d.role === 'spot'; };

  // 지원하지 않는 가공 방식은 다른 가공으로 바꾸지 않는다 → null (호출하는 쪽에서 제외·경고)
  function normalizeOp(o) {
    if (!P.OPS.get(o && o.type)) return null;
    const type = o.type;
    const n = newOp(type, Math.round(toNum(o && o.toolNo, 1)));
    if (o && typeof o.id === 'string') n.id = o.id;
    ['depth', 'brk', 'r', 'q', 'dwell', 'rpm', 'feed'].forEach(k => { n[k] = toNum(o && o[k], n[k]); });
    n.depthMode = o && o.depthMode === 'full' ? 'full' : 'tip';
    n.thru = !!(o && o.thru); n.auto = !(o && o.auto === false);
    if (o && o.toolSpec) n.toolSpec = { type: String(o.toolSpec.type), dia: toNum(o.toolSpec.dia, 0), pitch: toNum(o.toolSpec.pitch, 0) };
    return n;
  }
  function normalizeProject(p) {
    const d = newProject(null);
    p = p || {};
    const s = p.stock || {}, st = p.settings || {};
    // 지원하지 않는 가공 방식(개발 예정·상위 버전 파일)은 다른 가공으로 바꾸지 않고 제외 + 경고
    const dropped = [];
    const keepOp = (o, g) => { if (P.OPS.get(o && o.type)) return true; dropped.push('[' + String((g && g.name) || '그룹').slice(0, 40) + '] ' + String(o && o.type).slice(0, 30)); return false; };
    const out = {
      schema: 1, id: typeof p.id === 'string' ? p.id : uid('p'), name: String(p.name || d.name).slice(0, 60),
      programNo: Math.round(toNum(p.programNo, 1)), createdAt: String(p.createdAt || d.createdAt), updatedAt: String(p.updatedAt || d.updatedAt),
      machineId: typeof p.machineId === 'string' ? p.machineId : null,
      stock: { material: MATERIALS[s.material] ? s.material : 'S45C', sx: toNum(s.sx, 150), sy: toNum(s.sy, 100), sz: toNum(s.sz, 20), origin: ORIGIN_LABEL[s.origin] ? s.origin : 'LL', under: toNum(s.under, 0) },
      settings: {
        initialZ: toNum(st.initialZ, 50), retract: st.retract === 'G99' ? 'G99' : 'G98', wcs: /^G5[4-9]$/.test(st.wcs) ? st.wcs : 'G54',
        coolant: st.coolant !== false, m01: st.m01 !== false, seqNo: !!st.seqNo, toolOrder: st.toolOrder === 'group' ? 'group' : 'tool',
        pathOrder: ['input', 'nearest', 'zigzag'].includes(st.pathOrder) ? st.pathOrder : 'nearest'
      },
      clamps: Array.isArray(p.clamps) ? p.clamps.slice(0, 50).map(c => ({ id: typeof c.id === 'string' ? c.id : uid('c'), x: toNum(c.x, 0), y: toNum(c.y, 0), w: toNum(c.w, 10), h: toNum(c.h, 10), height: toNum(c.height, 30) })) : [],
      groups: Array.isArray(p.groups) ? p.groups.slice(0, 200).map((g, i) => ({
        id: typeof g.id === 'string' ? g.id : uid('g'), name: String(g.name || '홀 그룹').slice(0, 40),
        color: /^#[0-9a-fA-F]{6}$/.test(g.color) ? g.color : GROUP_COLORS[i % GROUP_COLORS.length],
        holes: Array.isArray(g.holes) ? g.holes.slice(0, MAX_HOLES).map(h => ({ id: typeof h.id === 'string' ? h.id : uid('h'), x: toNum(h.x, NaN), y: toNum(h.y, NaN) })) : [],
        ops: Array.isArray(g.ops) ? g.ops.slice(0, 20).filter(o => keepOp(o, g)).map(normalizeOp) : []
      })) : []
    };
    if (dropped.length) out.importWarnings = ['지원하지 않는 가공 방식이라 제외한 공정 ' + dropped.length + '개: ' + dropped.slice(0, 5).join(', ')];
    return out;
  }
  function normalizeBundle(b) {
    b = b || {};
    const src = Array.isArray(b.ops) ? b.ops.slice(0, 20) : [];
    const ops = src.map(normalizeOp).filter(Boolean).map(n => { delete n.id; return n; });
    const out = { id: typeof b.id === 'string' ? b.id : uid('b'), name: String(b.name || '공정 묶음').slice(0, 60), desc: String(b.desc || '').slice(0, 200), ops };
    if (ops.length < src.length) out.importWarnings = ['공정 묶음 "' + out.name + '": 지원하지 않는 가공 방식 ' + (src.length - ops.length) + '개 제외'];
    return out;
  }


  // 그룹 대표 홀 직경 (센터 드릴 제외 최대 공구 직경, 없으면 전체 최대)
  function holeDiaForGroup(group, tools) {
    let d = 0;
    group.ops.forEach(op => { const t = tools.get(op.toolNo); if (t && t.dia > d && !isSpot(op.type)) d = t.dia; });
    if (!d) group.ops.forEach(op => { const t = tools.get(op.toolNo); if (t && t.dia > d) d = t.dia; });
    return d;
  }

  Object.assign(P, { normalizeOp, normalizeProject, normalizeBundle, holeDiaForGroup });
})(typeof globalThis !== 'undefined' ? globalThis : this);
