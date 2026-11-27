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
    return Object.assign({ kind: 'pocket', shape: 'rect', w: 40, h: 30, cr: 5, dia: 30, depth: 5, rough: true, finish: true, toolNo: 0, stepover: 50, stepdown: 0, allowWall: 0.2, allowFloor: 0.1 }, extra || {});
  }
  function normalizePocketSpec(s) {
    const d = newPocketSpec(), o = { kind: 'pocket' };
    Object.keys(d).forEach(k => {
      if (k === 'kind') return;
      if (typeof d[k] === 'number') o[k] = toNum(s[k], d[k]);
      else if (typeof d[k] === 'boolean') o[k] = typeof s[k] === 'boolean' ? s[k] : d[k];
      else o[k] = s[k] === 'circle' ? 'circle' : 'rect';
    });
    o.toolNo = Math.max(0, Math.round(o.toolNo));
    return o;
  }

  function planPocketSpec(spec, machine, stock) {
    spec = normalizePocketSpec(spec);
    const notes = [], missing = [], ops = [];
    const geo = { shape: spec.shape, w: spec.w, h: spec.h, cr: spec.cr, dia: spec.dia };
    const mw = P.pocketMinWidth(geo);
    if (!(mw > 0)) return { ops, notes: [{ level: 'error', msg: '포켓 크기를 입력하세요.' }], missing, spec };
    if (!(spec.depth > 0)) return { ops, notes: [{ level: 'error', msg: '포켓 깊이를 입력하세요.' }], missing, spec };
    if (!spec.rough && !spec.finish) return { ops, notes: [{ level: 'error', msg: '황삭 또는 정삭을 하나 이상 선택하세요.' }], missing, spec };
    if (spec.finish && !spec.rough) notes.push({ level: 'error', msg: '정삭만으로는 포켓을 팔 수 없습니다. 황삭도 선택하세요.' });
    const sz = toNum(stock && stock.sz, 0);
    if (spec.depth >= sz) notes.push({ level: 'error', msg: '포켓 깊이 ' + spec.depth + 'mm 가 소재 두께 ' + sz + 'mm 이상입니다 (관통 포켓은 지원하지 않음).' });

    // 공구 선택
    const ems = (machine.tools || []).filter(t => t.type === 'endmill').sort((a, b) => b.dia - a.dia || a.no - b.no);
    let tool = null;
    if (spec.toolNo > 0) {
      tool = toolMap(machine).get(spec.toolNo) || null;
      if (!tool || tool.type !== 'endmill') { notes.push({ level: 'error', msg: 'T' + spec.toolNo + ' 은(는) 평 엔드밀이 아닙니다. 공구를 다시 고르세요.' }); tool = null; }
    } else {
      const fitW = t => t.dia <= 0.75 * mw + 1e-9 && 2 * (t.dia / 2 + spec.allowWall) < mw - 1e-6;
      const fitR = t => spec.shape !== 'rect' || spec.cr <= 0 || t.dia / 2 <= spec.cr + 1e-9;
      tool = ems.find(t => fitW(t) && fitR(t)) || null;
      if (!tool) {
        tool = ems.find(fitW) || null;
        if (tool && spec.shape === 'rect' && spec.cr > 0) notes.push({ level: 'warn', msg: '코너 R' + spec.cr + ' 보다 작은 엔드밀이 없어 T' + tool.no + ' Ø' + tool.dia + ' 를 씁니다. 모서리는 R' + r3(tool.dia / 2) + ' 로 남습니다.' });
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
      const base = Object.assign({ depth: spec.depth, r: 3 }, geo);
      if (spec.rough) ops.push(P.newOp('pocketRough', tool.no, Object.assign({}, base, { stepover: spec.stepover, stepdown: ap, allowWall: spec.allowWall, allowFloor: spec.allowFloor, auto: true })));
      if (spec.finish) ops.push(P.newOp('pocketFinish', tool.no, Object.assign({}, base, { stepover: 40, stepdown: ap, allowWall: spec.allowWall, allowFloor: spec.allowFloor, auto: true })));
      const levels = Math.max(1, Math.ceil((spec.depth - spec.allowFloor) / ap - 1e-9));
      notes.push({ level: 'info', msg: 'T' + tool.no + ' Ø' + tool.dia + ' 엔드밀, 1회 절입 ' + ap + 'mm × ' + levels + '단' + (spec.finish ? ' + 정삭' : '') + (spec.stepdown > 0 ? '' : ' (재질 기준 자동)') });
      if (tool.flute > 0 && spec.depth > tool.flute) notes.push({ level: 'error', msg: 'T' + tool.no + ' 날 길이 ' + tool.flute + 'mm 보다 포켓이 깊습니다 (' + spec.depth + 'mm). 긴 엔드밀이 필요합니다.' });
      if (machine.helical === false) notes.push({ level: 'warn', msg: '장비가 헬리컬 보간을 지원하지 않아 중심 수직 진입합니다 (중심 절삭 엔드밀 필요).' });
    }
    missing.forEach(mm => notes.push({ level: 'error', msg: '포켓에 맞는 평 엔드밀(Ø' + mm.dia + ' 이하)이 장비에 없습니다. [공구 추가]를 누르세요.' }));
    return { ops, notes, missing, spec };
  }

  Object.assign(P, { newPocketSpec, normalizePocketSpec, planPocketSpec });
})(typeof globalThis !== 'undefined' ? globalThis : this);
