// 앱 버전 정보 (프로젝트 버전 체계: V0 → V1 → V2 …)
export const APP_NAME = '푸른캐드';
export const APP_VERSION = 'V1';
export const BUILD_DATE = '2026-11-27';
export const CHANGES: { v: string; date: string; items: string[] }[] = [
  {
    v: 'V1',
    date: '2026-11-27',
    items: [
      '사용성: 그립 편집(선택 후 파란 점 끌기), 동적 입력 툴팁(F12), 극좌표 추적(F10), 명령 자동완성·한글 명령명, 오른쪽 클릭 바로가기 메뉴, 두 번 클릭 문자 편집, 사용자 별칭(acad.pgp 형식)',
      '편집 명령: MIRROR, SCALE, EXTEND, FILLET, CHAMFER, BREAK, JOIN, EXPLODE(블록 참조 포함), ARRAY(원형·직사각형)',
      '가공: OVERKILL(중복·겹친 선 정리), CAMCHECK(열린 윤곽·길이 0·중복 검사)',
      'V0 독립 검토 지적 12건 수정(닫힌 폴리선 TRIM, 한글 저장, 실행취소 묶음, 레이어 대소문자 잠금, 자기교차 OFFSET 등)',
    ],
  },
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
