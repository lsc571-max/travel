/* =====================================================================
 * 푸른 AI CAM - [가공 모듈] ops/drill.js
 * 역할: 일반 드릴 (G81, 드웰 입력 시 G82). 깊이/직경 비가 크면 G83 권장.
 * 의존: engine/common.js, ops/registry.js, ops/hole-common.js
 * 이 파일만 수정해도 다른 가공 모듈에는 영향이 없다 (공통 계산은 hole-common.js).
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM, H = P.HOLE;
  P.OPS.register(H.defineHoleOp({
    id: 'drill', label: '일반 드릴', code: 'G81', ncName: 'DRILL', stage: 2, role: 'drill', toolTypes: ['drill'],
    defaults: { depth: 10, r: 3 },
    ui: { q: false, dwell: true, thru: true, depthMode: true },
    validateAfter(ctx) {
      H.validateDrillBody(ctx);
      const ratio = ctx.d.full / ctx.tool.dia;
      if (ratio > 4) ctx.add('warn', 9, ctx.on + ': 깊이/직경 비 ' + P.r3(ratio) + ' → 칩 배출을 위해 G83(심공) 사용을 권장합니다.');
      H.validateDwell(ctx);
    },
    toolpath: s => ({ kind: s.dwell > 0 ? 'drillDwell' : 'drill', spindle: 'cw' })
  }));
})(typeof globalThis !== 'undefined' ? globalThis : this);
