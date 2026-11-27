/* =====================================================================
 * 푸른 AI CAM - [가공 모듈] ops/planned.js
 * 역할: 개발 예정 가공 모듈 목록 (선택 불가, 계산·G코드 없음). 구현 시 별도 파일로 옮기고 status 를 'ready' 로.
 *   V0.5 에서 평면(face.js)·윤곽(contour.js)·모따기(chamfer.js)를 구현하여 목록에서 뺐다.
 * 의존: engine/common.js, ops/registry.js
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  [
    { id: 'threadMill', label: '나사 밀링', family: 'mill', plan: '헬리컬 보간으로 큰 나사 가공 (탭 대신)' },
    { id: 'engrave', label: '문자 각인', family: 'mill', plan: '글꼴 윤곽을 따라 V 공구로 새김' }
  ].forEach(d => P.OPS.register(Object.assign({ status: 'planned' }, d)));
})(typeof globalThis !== 'undefined' ? globalThis : this);
