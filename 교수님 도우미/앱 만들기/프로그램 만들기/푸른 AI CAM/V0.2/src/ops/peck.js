/* =====================================================================
 * 푸른 AI CAM - [가공 모듈] ops/peck.js
 * 역할: 고속 펙 드릴 (G73). 후퇴량 d 는 장비 파라미터 사용.
 * 의존: engine/common.js, ops/registry.js, ops/hole-common.js
 * 이 파일만 수정해도 다른 가공 모듈에는 영향이 없다 (공통 계산은 hole-common.js).
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM, H = P.HOLE;
  P.OPS.register(H.defineHoleOp({
    id: 'peck', label: '고속 펙 드릴', code: 'G73', ncName: 'PECK DRILL', stage: 2, role: 'drill', toolTypes: ['drill'],
    defaults: { depth: 10, r: 3 },
    ui: { q: true, dwell: false, thru: true, depthMode: true },
    validateAfter(ctx) { H.validateDrillBody(ctx); H.validatePeck(ctx); },
    toolpath: () => ({ kind: 'peck', spindle: 'cw' })
  }));
})(typeof globalThis !== 'undefined' ? globalThis : this);
