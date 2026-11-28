/* =====================================================================
 * 푸른 AI CAM - [가공 모듈] ops/tap.js
 * 역할: 일반 탭 (G84, S M03 후 실행, 텐션·컴프레션 홀더). F = S × P (G94).
 * 의존: engine/common.js, ops/registry.js, ops/hole-common.js
 * 이 파일만 수정해도 다른 가공 모듈에는 영향이 없다 (공통 계산은 hole-common.js).
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM, H = P.HOLE, T = P.TAP;
  P.OPS.register(H.defineHoleOp({
    id: 'tap', label: '일반 탭', code: 'G84', ncName: 'TAP', stage: 3, role: 'tap', toolTypes: ['tap'],
    defaults: { depth: 10, r: 5 },
    ui: { q: false, dwell: false, thru: true, depthMode: false, feedFromPitch: true },
    validateBefore(ctx) {
      T.validatePitch(ctx);
      ctx.add('info', 7, ctx.on + ': 일반 탭(G84)은 텐션·컴프레션 탭 홀더가 필요합니다. F = S × P = ' + ctx.c.rpm + ' × ' + ctx.tool.pitch + ' = ' + ctx.c.feed, true);
    },
    validateAfter: T.validatePilot,
    toolpath: () => ({ kind: 'tap', spindle: 'cw' })
  }));
})(typeof globalThis !== 'undefined' ? globalThis : this);
