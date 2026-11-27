/* =====================================================================
 * 푸른 AI CAM - [가공 모듈] ops/planned.js
 * 역할: 개발 예정 가공 모듈 목록 (선택 불가, 계산·G코드 없음). 구현 시 별도 파일로 옮기고 status 를 'ready' 로.
 * 의존: engine/common.js, ops/registry.js, ops/hole-common.js
 * 이 파일만 수정해도 다른 가공 모듈에는 영향이 없다 (공통 계산은 hole-common.js).
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  [
    { id: 'face', label: '평면 가공', family: 'mill', plan: '페이스 밀 지그재그/한방향 경로, 절입 깊이 분할' },
    { id: 'contour', label: '외곽 윤곽 가공', family: 'mill', plan: '공구 반경 보정(G41/G42) 또는 오프셋 경로, 어프로치/리트랙트' }
  ].forEach(d => P.OPS.register(Object.assign({ status: 'planned' }, d)));
})(typeof globalThis !== 'undefined' ? globalThis : this);
