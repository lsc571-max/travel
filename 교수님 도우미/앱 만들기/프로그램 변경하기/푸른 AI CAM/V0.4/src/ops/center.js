/* =====================================================================
 * 푸른 AI CAM - [가공 모듈] ops/center.js
 * 역할: 센터/스팟 드릴 (G81, 드웰 입력 시 G82). 모따기 직경 검증.
 * 의존: engine/common.js, ops/registry.js, ops/hole-common.js
 * 이 파일만 수정해도 다른 가공 모듈에는 영향이 없다 (공통 계산은 hole-common.js).
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM, H = P.HOLE;
  P.OPS.register(H.defineHoleOp({
    id: 'center', label: '센터 드릴', code: 'G81', ncName: 'CENTER DRILL', stage: 1, role: 'spot', toolTypes: ['center'],
    defaults: { depth: 2.5, r: 3 },
    ui: { q: false, dwell: true, thru: false, depthMode: false },
    validateBefore(ctx) {
      const { tool, d, on, add } = ctx;
      const sd = P.spotDiameter(tool, d.depth);
      if (sd > tool.dia + P.EPS) add('error', 8, on + ': 깊이 ' + d.depth + ' 에서 필요한 모따기 Ø' + P.r3(sd) + ' 가 공구 직경 Ø' + tool.dia + ' 보다 큽니다.');
    },
    validateAfter: H.validateDwell,
    toolpath: s => ({ kind: s.dwell > 0 ? 'drillDwell' : 'drill', spindle: 'cw' })
  }));
})(typeof globalThis !== 'undefined' ? globalThis : this);
