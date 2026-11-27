/* =====================================================================
 * 푸른 AI CAM - [공정 관리: 윤곽·평면·모따기 간편 입력] process/mill-wizard.js  (V0.5)
 * 역할: 모양·깊이만 입력하면 공구·절입·황삭/정삭 공정을 구성한다 (결정적 계산).
 *   윤곽: 공구 = 날 길이가 깊이 이상인 엔드밀 중 (바깥) 가장 큰 것 / (안쪽) 폭의 75% 이하 중 가장 큰 것
 *   평면: 공구 = 가장 큰 페이스밀, 없으면 가장 큰 엔드밀. 절입 자동 = 페이스밀 1mm(알루미늄 2mm), 엔드밀 0.3D
 *   모따기: 공구 = 모따기 공구 중 필요한 반경을 만족하는 가장 작은 것
 * 의존: engine/*, ops/contour.js, ops/face.js, ops/chamfer.js, process/pocket-wizard.js(AP_FACTOR)
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  const { toNum, r3, toolMap } = P;
  const DEF = {
    contour: { kind: 'contour', shape: 'rect', w: 60, h: 40, cr: 0, dia: 40, poly: null, side: 'out', depth: 5, thru: false, brk: 1, rough: true, finish: true, toolNo: 0, stepdown: 0, allowWall: 0.2, sideWidth: 0, stepover: 50 },
    face: { kind: 'face', depth: 0.5, toolNo: 0, stepdown: 0, stepover: 70, margin: 2 },
    chamfer: { kind: 'chamfer', shape: 'rect', w: 60, h: 40, cr: 0, dia: 10, poly: null, side: 'out', cw: 0.5, extra: 0.3, toolNo: 0 }
  };
  function newMillSpec(kind, extra) { return Object.assign(P.clone(DEF[kind]), extra || {}); }
  function normalizeMillSpec(s) {
    const d = DEF[s && s.kind]; if (!d) return null;
    const o = { kind: s.kind };
    Object.keys(d).forEach(k => {
      if (k === 'kind') return;
      if (typeof d[k] === 'number') o[k] = toNum(s[k], d[k]);
      else if (typeof d[k] === 'boolean') o[k] = typeof s[k] === 'boolean' ? s[k] : d[k];
      else if (k === 'shape') o.shape = ['rect', 'circle', 'poly'].includes(s.shape) ? s.shape : 'rect';
      else if (k === 'side') o.side = s.side === 'in' ? 'in' : 'out';
      else if (k === 'poly') o.poly = P.normPoly(s.poly);
    });
    if (o.shape === 'poly' && !o.poly) o.shape = 'rect';
    o.toolNo = Math.max(0, Math.round(o.toolNo || 0));
    return o;
  }
  const geoOf = sp => ({ shape: sp.shape, w: sp.w, h: sp.h, cr: sp.cr, dia: sp.dia, poly: sp.shape === 'poly' ? sp.poly : null, side: sp.side });

  function pickTool(machine, sp, notes, types, fit, want) {
    if (sp.toolNo > 0) {
      const t = toolMap(machine).get(sp.toolNo);
      if (!t || !types.includes(t.type)) { notes.push({ level: 'error', msg: 'T' + sp.toolNo + ' 은(는) 이 가공에 쓸 수 없는 공구입니다. 공구를 다시 고르세요.' }); return null; }
      return t;
    }
    const list = (machine.tools || []).filter(t => types.includes(t.type) && t.dia > 0);
    return fit(list) || null;
  }

  function planContour(sp, machine, stock) {
    const notes = [], missing = [], ops = [];
    if (!sp.rough && !sp.finish) return { ops, notes: [{ level: 'error', msg: '황삭 또는 정삭을 하나 이상 선택하세요.' }], missing, spec: sp };
    if (sp.finish && !sp.rough) notes.push({ level: 'error', msg: '정삭만으로는 윤곽을 깎을 수 없습니다. 황삭도 선택하세요.' });
    const sz = toNum(stock && stock.sz, 0), depth = sp.thru ? sz + sp.brk : sp.depth;
    if (!(depth > 0)) return { ops, notes: [{ level: 'error', msg: '윤곽 깊이를 입력하세요.' }], missing, spec: sp };
    const geo = geoOf(sp), mw = P.pocketMinWidth(geo);
    const tool = pickTool(machine, sp, notes, ['endmill'], list => {
      let c = list.filter(t => !(t.flute > 0) || t.flute >= depth - 1e-9);
      if (sp.side === 'in') c = c.filter(t => t.dia <= 0.75 * mw + 1e-9 && t.dia + 2 * sp.allowWall < mw - 0.25);
      else c = c.filter(t => t.dia <= 12 + 1e-9); // 바깥 윤곽: 너무 큰 공구는 피함 (일반 머시닝 기준)
      c.sort((a, b) => b.dia - a.dia || a.no - b.no);
      return c[0];
    });
    if (!tool && !sp.toolNo) {
      const want = sp.side === 'in' ? Math.max(1, Math.min(10, Math.floor(0.6 * mw))) : 10;
      missing.push({ type: 'endmill', dia: want, why: '윤곽 깊이 ' + r3(depth) + 'mm' });
      notes.push({ level: 'error', msg: '윤곽에 맞는 평 엔드밀(Ø' + want + ', 날 길이 ' + Math.ceil(depth) + 'mm 이상)이 없습니다. [공구 추가]를 누르세요.' });
    }
    if (tool) {
      const f = (P.AP_FACTOR || {})[stock && stock.material] || 0.3;
      let ap = sp.stepdown > 0 ? sp.stepdown : Math.max(0.1, Math.floor(tool.dia * f * 10) / 10);
      if (sp.stepdown <= 0 && tool.flute > 0) ap = Math.min(ap, Math.floor(tool.flute * 0.9 * 10) / 10);
      const base = Object.assign({ depth: sp.depth, thru: sp.thru, brk: sp.brk, r: 3 }, geo);
      if (sp.rough) ops.push(P.newOp('contourRough', tool.no, Object.assign({}, base, { stepover: sp.stepover, stepdown: ap, allowWall: sp.allowWall, sideWidth: sp.sideWidth, auto: true })));
      if (sp.finish) ops.push(P.newOp('contourFinish', tool.no, Object.assign({}, base, { stepover: 40, stepdown: ap, allowWall: sp.allowWall, sideWidth: 0, auto: true })));
      const lv = Math.max(1, Math.ceil(depth / ap - 1e-9));
      notes.push({ level: 'info', msg: 'T' + tool.no + ' Ø' + tool.dia + ' 엔드밀, ' + (sp.side === 'in' ? '안쪽' : '바깥') + ' 윤곽, 1회 절입 ' + ap + 'mm × ' + lv + '단' + (sp.sideWidth > 0 && sp.rough ? ', 측면 ' + sp.sideWidth + 'mm 제거' : '') + (sp.finish ? ' + 정삭' : '') + (sp.thru ? ' · 관통' : '') });
      if (tool.flute > 0 && depth > tool.flute) notes.push({ level: 'error', msg: 'T' + tool.no + ' 날 길이 ' + tool.flute + 'mm 보다 윤곽이 깊습니다.' });
    }
    return { ops, notes, missing, spec: sp };
  }

  function planFace(sp, machine, stock) {
    const notes = [], missing = [], ops = [];
    if (!(sp.depth > 0)) return { ops, notes: [{ level: 'error', msg: '평면 깊이를 입력하세요.' }], missing, spec: sp };
    const tool = pickTool(machine, sp, notes, ['facemill', 'endmill'], list => {
      const fm = list.filter(t => t.type === 'facemill').sort((a, b) => b.dia - a.dia)[0];
      return fm || list.filter(t => t.type === 'endmill').sort((a, b) => b.dia - a.dia)[0];
    });
    if (!tool && !sp.toolNo) { missing.push({ type: 'facemill', dia: 50, why: '평면 가공' }); notes.push({ level: 'error', msg: '평면 가공용 페이스밀(또는 엔드밀)이 없습니다. [공구 추가]를 누르세요.' }); }
    if (tool) {
      const al = stock && (stock.material === 'AL6061' || stock.material === 'C3604');
      let ap = sp.stepdown > 0 ? sp.stepdown : (tool.type === 'facemill' ? (al ? 2 : 1) : Math.max(0.1, Math.floor(tool.dia * 0.3 * 10) / 10));
      ap = Math.min(ap, Math.max(0.05, sp.depth));
      if (tool.flute > 0) ap = Math.min(ap, Math.floor(tool.flute * 0.9 * 100) / 100);
      ops.push(P.newOp('faceMill', tool.no, { depth: sp.depth, stepdown: ap, stepover: sp.stepover, margin: sp.margin, r: 3, auto: true }));
      notes.push({ level: 'info', msg: 'T' + tool.no + ' ' + (tool.type === 'facemill' ? '페이스밀' : '엔드밀') + ' Ø' + tool.dia + ', 깊이 ' + sp.depth + 'mm (1회 ' + ap + 'mm), 줄 간격 ' + sp.stepover + '%. 평면 후 윗면은 Z' + r3(-sp.depth) + ' 입니다.' });
      if (tool.type === 'endmill') notes.push({ level: 'warn', msg: '페이스밀이 없어 엔드밀로 평면 가공합니다 (시간이 오래 걸림).' });
    }
    return { ops, notes, missing, spec: sp };
  }

  function planChamfer(sp, machine, stock) {
    const notes = [], missing = [], ops = [];
    if (!(sp.cw > 0)) return { ops, notes: [{ level: 'error', msg: '모따기 폭을 입력하세요.' }], missing, spec: sp };
    const geo = geoOf(sp);
    const tool = pickTool(machine, sp, notes, ['chamfer'], list => list.filter(t => P.chamferGeom({ cw: sp.cw, extra: sp.extra }, t).need <= t.dia / 2 + 1e-9).sort((a, b) => Math.abs(a.angle - 90) - Math.abs(b.angle - 90) || a.dia - b.dia)[0]);
    if (!tool && !sp.toolNo) { const want = Math.max(6, Math.ceil(2 * (sp.cw + 1))); missing.push({ type: 'chamfer', dia: want, why: '모따기 C' + sp.cw }); notes.push({ level: 'error', msg: '모따기 C' + sp.cw + ' 에 맞는 모따기 공구(Ø' + want + ' 90°)가 없습니다. [공구 추가]를 누르세요.' }); }
    if (tool) {
      ops.push(P.newOp('chamferMill', tool.no, Object.assign({ cw: sp.cw, extra: sp.extra, r: 3, auto: true }, geo)));
      const g = P.chamferGeom({ cw: sp.cw, extra: sp.extra }, tool);
      notes.push({ level: 'info', msg: 'T' + tool.no + ' 모따기 Ø' + tool.dia + ' ' + tool.angle + '°, C' + sp.cw + ' · 공구 끝 Z' + r3(-g.depth) + ' (' + (sp.side === 'in' ? '안쪽' : '바깥') + ' 모서리)' });
    }
    return { ops, notes, missing, spec: sp };
  }
  function planMillSpec(spec, machine, stock) {
    const sp = normalizeMillSpec(spec);
    if (!sp) return { ops: [], notes: [{ level: 'error', msg: '알 수 없는 가공입니다.' }], missing: [], spec };
    return sp.kind === 'contour' ? planContour(sp, machine, stock) : sp.kind === 'face' ? planFace(sp, machine, stock) : planChamfer(sp, machine, stock);
  }
  Object.assign(P, { newMillSpec, normalizeMillSpec, planMillSpec, MILL_SPEC_KINDS: Object.keys(DEF) });
})(typeof globalThis !== 'undefined' ? globalThis : this);
