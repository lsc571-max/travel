/* =====================================================================
 * 푸른 AI CAM - [가공 모듈] ops/deep.js
 * 역할: 심공 드릴 (G83). 매 펙마다 R점 복귀.
 * 의존: engine/common.js, ops/registry.js, ops/hole-common.js
 * 이 파일만 수정해도 다른 가공 모듈에는 영향이 없다 (공통 계산은 hole-common.js).
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM, H = P.HOLE;
  P.OPS.register(H.defineHoleOp({
    id: 'deep', label: '심공 드릴', code: 'G83', ncName: 'DEEP DRILL', stage: 2, role: 'drill', toolTypes: ['drill'],
    defaults: { depth: 10, r: 3 },
    ui: { q: true, dwell: false, thru: true, depthMode: true },
    validateAfter(ctx) { H.validateDrillBody(ctx); H.validatePeck(ctx); },
    toolpath: () => ({ kind: 'deep', spindle: 'cw' })
  }));
})(typeof globalThis !== 'undefined' ? globalThis : this);
