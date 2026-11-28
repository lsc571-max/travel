/* =====================================================================
 * 푸른 AI CAM - [가공 모듈] ops/bore.js  (V0.6)
 * 역할: 정밀 보링 (G76: 바닥에서 주축 정위치 정지 → Q 만큼 날을 벽에서 떼고 급속 복귀 → 벽 긁힘 없음).
 *       장비가 G76(주축 정위치)을 지원하지 않으면 G86 (주축 정지 후 급속 복귀 — 복귀 자국이 남을 수 있음).
 *   보링 바 지름 = 완성 지름 (조절식 보링 헤드를 그 지름에 맞춰 둔 것으로 봄)
 *   밑구멍: 같은 그룹 앞 공정의 드릴(Ø D−3 ~ D−0.1) 또는 원형 포켓(같은 범위), 깊이 ≥ 보링 깊이
 * 의존: engine/common.js, ops/registry.js, ops/hole-common.js, ops/ream.js(preHoles)
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM, H = P.HOLE;
  const { toNum, r3, EPS } = P;
  function boreDepth(op, tool, st) {
    const depth = op.thru && st ? toNum(st.sz, 0) + Math.max(0, toNum(op.brk, 1)) : toNum(op.depth, 0);
    return { depth: r3(depth), full: r3(depth), tip: 0, z: r3(-depth) };
  }
  P.OPS.register(H.defineHoleOp({
    id: 'bore', label: '정밀 보링', code: 'G76', ncName: 'FINE BORE', stage: 2.6, role: 'bore', toolTypes: ['boring'],
    defaults: { depth: 10, r: 3, q: 0.2 },
    depth: boreDepth,
    ui: { q: true, dwell: false, thru: true, depthMode: false },
    validateAfter(ctx) {
      const { op, oi, ops, tool, tm, d, st, on, add, machine } = ctx, D = tool.dia;
      const key = o => JSON.stringify(Array.isArray(o.at) && o.at.length ? o.at : [[0, 0]]);
      const ok = ops.slice(0, oi).some(o => {
        const def = P.OPS.get(o.type), t = tm.get(o.toolNo); if (!def || !t || key(o) !== key(op)) return false;
        if (def.role === 'drill') return t.dia >= D - 3 - EPS && t.dia <= D - 0.1 + EPS && (P.opDepth(o, t, st).full >= d.full - EPS || (o.thru && op.thru));
        if (def.mill === 'pocket' && o.shape === 'circle') return o.dia >= D - 3 - EPS && o.dia <= D - 0.1 + EPS && (P.pocketDepth(o, st) >= d.depth - EPS);
        return false;
      });
      if (!ok) add('error', 5, on + ': 보링 Ø' + D + ' 앞에 밑구멍(드릴 또는 원형 포켓 Ø' + r3(D - 3) + '~Ø' + r3(D - 0.1) + ', 보링 깊이 이상)이 없습니다. 한 번에 깎는 양이 크면 보링 바가 떨립니다.');
      const q = toNum(op.q, 0);
      if (machine.g76 !== false) {
        if (!(q >= 0.05)) add('error', 9, on + ': G76 날 빼기 거리 Q 는 0.05mm 이상이어야 합니다.');
        else if (q > 0.5 + EPS) add('error', 9, on + ': G76 Q ' + q + 'mm 가 너무 큽니다 (0.5mm 이하, 보링 바가 반대쪽 벽에 닿을 수 있음).');
        add('info', 7, on + ': G76 — 바닥에서 주축 정위치 후 Q' + q + 'mm 만큼 날을 벽에서 떼고 나옵니다. 떼는 방향은 장비 파라미터(FANUC 5101 RD1·RD2)와 보링 바 날 방향을 반드시 맞추세요.', true);
      } else add('warn', 7, on + ': 장비가 G76(주축 정위치)을 지원하지 않아 G86 으로 보링합니다 — 주축 정지 후 급속 복귀하므로 벽에 복귀 자국이 남을 수 있습니다.');
      if (d.full / D > 5) add('warn', 9, on + ': 깊이/지름 비 ' + r3(d.full / D) + ' — 보링 바 떨림에 주의하세요.');
    },
    toolpath: () => ({ kind: 'bore', spindle: 'cw' })
  }));
})(typeof globalThis !== 'undefined' ? globalThis : this);
