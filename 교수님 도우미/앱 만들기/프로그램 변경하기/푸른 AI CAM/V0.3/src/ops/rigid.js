/* =====================================================================
 * 푸른 AI CAM - [가공 모듈] ops/rigid.js
 * 역할: 리지드 탭 (M29 S__ + G84). 장비 리지드 탭 지원·탭 최대 회전수 검증. F = S × P (G94).
 * 의존: engine/common.js, ops/registry.js, ops/hole-common.js
 * 이 파일만 수정해도 다른 가공 모듈에는 영향이 없다 (공통 계산은 hole-common.js).
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM, H = P.HOLE, T = P.TAP;
  P.OPS.register(H.defineHoleOp({
    id: 'rigid', label: '리지드 탭', code: 'M29+G84', ncName: 'RIGID TAP', stage: 3, role: 'tap', rigid: true, toolTypes: ['tap'],
    defaults: { depth: 10, r: 5 },
    ui: { q: false, dwell: false, thru: true, depthMode: false, feedFromPitch: true },
    validateBefore(ctx) {
      const { machine, c, on, add } = ctx;
      T.validatePitch(ctx);
      if (!machine.rigidTap) add('error', 7, on + ': 장비가 리지드 탭(M29)을 지원하지 않도록 설정되어 있습니다.');
      if (c.rpm > (machine.maxTapRpm || machine.maxRpm)) add('error', 7, on + ': 리지드 탭 회전수 S' + c.rpm + ' 이(가) 장비 탭 최대 회전수 ' + machine.maxTapRpm + ' 을 초과합니다.');
    },
    validateAfter: T.validatePilot,
    toolpath: () => ({ kind: 'rigidTap', spindle: 'rigid' })
  }));
})(typeof globalThis !== 'undefined' ? globalThis : this);
