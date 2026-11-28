/* =====================================================================
 * 푸른 AI CAM - [가공 모듈] ops/ream.js  (V0.6)
 * 역할: 리머 가공 (G85: 이송으로 들어가고 이송으로 나옴 → 급속 복귀로 구멍 벽을 긁지 않음). H7 등 정밀 구멍.
 *   밑구멍: 같은 그룹 앞 공정에 지름 (D − 0.6) ~ (D − 0.05) 드릴, 직경부 깊이 ≥ 리머 깊이
 *   깊이: 직경부(완성 지름) 깊이 기준, 공구 끝 = 직경부 + 앞 모따기(안내부) 길이
 * 의존: engine/common.js, ops/registry.js, ops/hole-common.js
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM, H = P.HOLE;
  const { r3, EPS } = P;
  // 같은 그룹 앞 공정 중 밑구멍(드릴) 찾기 (위치 오프셋 at 이 같아야 함)
  function preHoles(ctx) {
    const { op, oi, ops, tm, st } = ctx;
    const key = o => JSON.stringify(Array.isArray(o.at) && o.at.length ? o.at : [[0, 0]]);
    return ops.slice(0, oi).filter(o => { const d = P.OPS.get(o.type); return d && d.role === 'drill' && key(o) === key(op); })
      .map(o => { const t = tm.get(o.toolNo); return t ? { o, t, d: P.opDepth(o, t, st) } : null; }).filter(Boolean);
  }
  P.OPS.register(H.defineHoleOp({
    id: 'ream', label: '리머', code: 'G85', ncName: 'REAM', stage: 2.5, role: 'ream', toolTypes: ['reamer'],
    defaults: { depth: 10, r: 3, depthMode: 'full' },
    ui: { q: false, dwell: false, thru: true, depthMode: true },
    validateAfter(ctx) {
      const { tool, d, on, add } = ctx, D = tool.dia;
      const pre = preHoles(ctx), good = pre.filter(p => p.t.dia >= D - 0.6 - EPS && p.t.dia <= D - 0.05 + EPS);
      if (!good.length) add('error', 5, on + ': 리머 Ø' + D + ' 앞에 밑구멍 드릴(Ø' + r3(D - 0.6) + '~Ø' + r3(D - 0.05) + ', 권장 Ø' + r3(D - (D <= 10 ? 0.2 : D <= 20 ? 0.3 : 0.4)) + ')이 없습니다. 리머 여유가 너무 크거나 작으면 구멍이 망가집니다.');
      else if (!good.some(p => p.d.full >= d.full - EPS || (p.o.thru && ctx.op.thru))) add('error', 8, on + ': 밑구멍 드릴의 직경부 깊이가 리머 깊이 ' + d.full + 'mm 보다 얕습니다 (리머가 막힌 바닥에 닿음).');
      if (d.full / D > 4) add('warn', 9, on + ': 깊이/지름 비 ' + r3(d.full / D) + ' — 긴 리머 가공은 칩 배출·진직도를 확인하세요.');
      if (ctx.c.rpm > 0) add('info', 7, on + ': G85 리머 — 이송으로 들어가고 이송으로 나옵니다 (벽 긁힘 방지). 공차 ' + (tool.tol || 'H7') + ' 는 공구·조건에 달려 있으니 첫 구멍을 게이지로 확인하세요.', true);
    },
    toolpath: () => ({ kind: 'ream', spindle: 'cw' })
  }));
  P.REAM = Object.freeze({ preHoles });
})(typeof globalThis !== 'undefined' ? globalThis : this);
