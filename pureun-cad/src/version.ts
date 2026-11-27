// 앱 버전 정보 (프로젝트 버전 체계: V0 → V1 → V2 …)
export const APP_NAME = '푸른캐드';
export const APP_VERSION = 'V0';
export const BUILD_DATE = '2026-11-27';
export const CHANGES: { v: string; date: string; items: string[] }[] = [
  {
    v: 'V0',
    date: '2026-11-27',
    items: [
      '최초 버전: 2D 작도(LINE·CIRCLE·ARC·PLINE·RECTANG·TEXT), 수정(MOVE·COPY·ROTATE·TRIM·OFFSET·ERASE·UNDO·REDO)',
      '치수(선형·정렬·지름·반지름), 측정(DIST·ID·LIST), 레이어 관리, 동일 지름 원 일괄 변경',
      'DXF 열기(R12~최신 ASCII)·저장(R12), 미지원 객체 보존/경고, 자동 저장(IndexedDB), 오프라인 동작',
    ],
  },
];
