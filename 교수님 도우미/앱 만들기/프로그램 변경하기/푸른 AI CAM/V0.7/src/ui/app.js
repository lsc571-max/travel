/* =====================================================================
 * 푸른 AI CAM - [통합 화면] ui/app.js  (V0.4 화면 재설계)
 * 화면 구성 (산업용 CAM 표준 배치)
 *   머리글  : 프로젝트 이름 · 되돌리기 · 프로젝트/장비·공구/작업지시서 · 공유 · 설정 · [NC 저장]
 *   왼쪽    : 작업 목록 — 공통 정보(소재·원점/NC 설정)를 먼저, 그 아래 가공(구멍·탭·포켓) 순서
 *   가운데  : 2D 배치(위치 입력·순서) / 3D 시뮬레이션(실제 NC 해석 결과로 소재를 깎아 보여줌)
 *   오른쪽  : 선택한 항목의 속성 (간편 입력 → 자동 공정 → 깊이 단면도(Z값) → 위치)
 *   아래    : 상태 표시줄(검증·예상 시간·공구 수) + 검증 결과/G코드 서랍
 * 계산·G코드 생성·검증·시뮬레이션은 PCAM 엔진 모듈만 사용하고, 이 파일은 입력·표시·저장만 담당한다.
 * 모든 데이터는 이 브라우저의 localStorage 에만 저장된다 (외부 서버 전송 없음).
 * ===================================================================== */
(function () {
  'use strict';
  const C = window.PCAM;
  const CHANGELOG = [
    { v: 'V0.7', d: C.BUILD_DATE, items: ['간단히 보기: 처음에는 크기·깊이·위치만 — 옵션·깊이 단면도·자동 구성된 공정·고급 설정은 접힌 줄(현재 값 요약), 누르면 펼침', '[+ 가공 추가] 하나로 큰 아이콘 선택판, 왼쪽 위 [다음 할 일] 큰 버튼, 도구 막대·머리글은 자주 쓰는 것만(나머지는 ⋯)', '가공 아이콘 새로 그림(색 타일), 글씨 13px 이상·버튼 크기·색 대비 정리', '오류가 든 접힌 줄은 저절로 펼침, 설정의 [모두 펼쳐 보기]로 예전처럼', '가공 기능·NC 생성·검증은 V0.6 과 같음 (화면만 변경)'] },
    { v: 'V0.6', d: '2026-11-28', items: ['실가공 승인 범위: 가공 종류 × 앱 버전별 승인·이력, 승인 안 된 가공이 있으면 TEST', '첫 가공 모드(공정마다 M00·이송 낮춤), NC 해시·가공 기록(CSV), 작업지시서 배치도·좌표표·첫 가공 서명란', '공구 돌출 길이·홀더 간섭, 머신 Z 행정(G54 Z + H) 검사', '리머(H7, G85)·정밀 보링(G76/G86) 간편 입력, 공구별 재시작 블록, 장비 메모리 초과 시 공구별 분할 저장', '작업 순서 ✓ 오표시 수정, 입력칸 오류·바로 고치기, ⓘ 용어집·도움말(F1), 3D 처음부터·공정 자막, 모바일 머리글'] },
    { v: 'V0.5', d: '2026-11-27', items: ['이미 가공된 형상 인식(깊이 기준 자동): 포켓 안 구멍·포켓 안 포켓·평면 뒤 가공은 그 바닥부터 깊이, 깎인 높이에서 시작', '포켓 중삭(한 번에/단 깊이씩)·바닥 정삭·측벽 정삭 분리, 진입 방식(헬리컬·램프·선가공 구멍), 모서리 릴리프 구멍', '다각(정다각형) 형상, 측벽 구배·입구 R·바닥 R(계단 근사, 검증기 판정)', '2D 크기 손잡이·단면도, 머리글 아이콘·탭 끌어 옮기기, 좌우 패널 자리 바꾸기, 다음 할 일 안내', '안전 검토 반영: 사실상 수직 하강·모따기 공구 오용 차단, 검증기 고속화, NC 줄 수 감소, DXF 보강', '새 가공: 바깥·안쪽 윤곽(측면 여러 바퀴·관통 절단), 평면(페이스밀), 모따기(바깥·안쪽·구멍 입구), 자유 형상 포켓(섬·관통)', '도면(DXF) 불러오기: 원은 지름별 구멍·탭(기초 드릴 지름이면 탭 추천), 닫힌 선은 외곽·포켓·섬으로 자동 분류', '화면: 패널 경계 끌어서 크기 조절·접기(기억), 작업 목록에서 Ctrl+C/V/D·Delete·F2·Alt+↑↓·오른쪽 버튼 메뉴·끌어서 순서, 삭제 후 [되돌리기]', '2D 위치 복사·붙여넣기(마우스 위치), 검증기: 다각형 영역·모따기 공구·진입 검사 확장'] },
    { v: 'V0.4', d: '2026-11-27', items: ['화면 전면 재설계: 작업 목록(소재 → 원점·NC → 가공) · 속성 패널 · 상태 표시줄 · 검증/G코드 서랍', '포켓 가공 추가: 사각(코너 R)·원형, 헬리컬 진입, 황삭(여유)·정삭, 공구·절입 자동', '3D 가공 시뮬레이션: 실제 NC 해석 결과로 소재를 깎아 표시, 회전·확대, 재생·구간 이동, 현재 X·Y·Z 표시', '깊이 단면도: 초기점·R점·소재 윗면·공구 끝 Z값을 한 그림에', '예상 가공 시간(추정)·작업지시서 인쇄, 평 엔드밀 공구 관리'] },
    { v: 'V0.3', d: '2026-11-27', items: ['구멍·탭 간편 입력: 지름·깊이 또는 나사 규격·탭 깊이만 넣으면 센터 → 드릴(사이클 자동) → 탭 공정 자동 구성', '없는 공구는 [공구 추가] 한 번으로 등록, 공정 이름 자동 표시(T번호·직경·가공)', '탭 공정 앞 오버라이드 100% 안내 주석 출력'] },
    { v: 'V0.2', d: '2026-11-27', items: ['기능별 모듈 구조: 공통 엔진·가공 모듈·공정 관리·포스트프로세서·검증·저장·그래픽 분리', '안전 강화: 소재 관통 급속/G01 이동, 탭 기초 구멍·절삭 조건(수정 NC 포함), 좌표계, G94, M29 주축 정지 검사'] },
    { v: 'V0.1', d: '2026-11-27', items: ['최초 버전: FANUC 3축 2.5축 홀 가공(G81·G82·G73·G83·G84·M29 리지드 탭)', '홀 배열(개별·직선·사각·PCD), 공정 묶음, 공구·장비 관리, 11개 항목 자동 검증, 독립 NC 해석 검증'] }
  ];
  const KIND = {
    drill: { ico: 'i-drill', cls: 'k-drill', label: '구멍', color: '#2f6fed' },
    tap: { ico: 'i-tap', cls: 'k-tap', label: '탭', color: '#8b5cf6' },
    pocket: { ico: 'i-pocket', cls: 'k-pocket', label: '포켓', color: '#ee8a10' },
    contour: { ico: 'i-contour', cls: 'k-contour', label: '윤곽', color: '#0e8fa3' },
    face: { ico: 'i-face', cls: 'k-face', label: '평면', color: '#7f8a1f' },
    chamfer: { ico: 'i-chamfer', cls: 'k-chamfer', label: '모따기', color: '#b5279f' },
    ream: { ico: 'i-ream', cls: 'k-ream', label: '리머(H7)', color: '#2a9d4f' }, // [V0.6]
    bore: { ico: 'i-bore', cls: 'k-bore', label: '보링', color: '#c2553a' },
    custom: { ico: 'i-custom', cls: 'k-custom', label: '직접 구성', color: '#64748b' }
  };
  const OLD_COLOR = { chamfer: '#d6336c', face: '#5b7083', ream: '#1d7f8c', bore: '#6d5bd0' }; // V0.6 이하 기본 표시 색
  const SIM_RES = { l: 60000, m: 160000, h: 400000 };
  const TOOL_BAND = { center: '#14a37f', drill: '#2f6fed', tap: '#8b5cf6', endmill: '#ee8a10', facemill: '#5b7083', chamfer: '#d6336c', reamer: '#1d7f8c', boring: '#6d5bd0' };
  const MILL_KINDS = ['pocket', 'contour', 'face', 'chamfer'];
 const shapeTxt = sp => sp.shape === 'circle' ? '원형 Ø' + sp.dia : sp.shape === 'ngon' ? (sp.sides || 6) + '각 Ø' + sp.dia : sp.shape === 'poly' ? 'DXF 형상' + (sp.poly && sp.poly.name ? ' ' + sp.poly.name.replace(/^도면 /, '#') : '') : '사각 ' + sp.w + '×' + sp.h + (sp.cr > 0 ? ' R' + sp.cr : '');

  /* ---------------- [V0.6] 용어집 (처음 쓰는 분을 위한 풀이) ---------------- */
  const GLOSS = [
    ['R점', '구멍·포켓 가공에서 공구가 급속(G00)으로 내려오는 높이입니다. 소재 윗면 위 몇 mm. 여기부터는 절삭 이송으로 내려갑니다.'],
    ['초기점', '공구를 바꾼 뒤나 구멍 사이를 옮겨 다닐 때의 안전 높이(Z). 클램프·바이스보다 높아야 합니다. G98 이면 구멍마다 이 높이로 올라옵니다.'],
    ['복귀', 'G98 = 구멍 사이를 초기점 높이로 이동(안전), G99 = R점 높이로 이동(빠르지만 클램프·턱에 주의).'],
    ['깊이 기준', '자동 = 포켓 안 구멍처럼 다른 가공의 바닥 안에 있으면 그 바닥부터 깊이를 잽니다 (도면 치수 방식).'],
    ['관통 여유', '끝까지 뚫을 때 소재 아래로 더 내려가는 거리. 소재 아래 받침(패럴렐) 틈(하부 여유)보다 작아야 테이블을 깎지 않습니다.'],
    ['관통', '소재를 끝까지 뚫거나 잘라냅니다. 소재 아래에 받침(패럴렐)을 두고 하부 여유를 입력하세요.'],
    ['하부 여유', '소재 밑면과 테이블(바이스 바닥) 사이 틈. 관통 가공이 이 안에서만 내려가도록 검사합니다.'],
    ['센터 드릴', '드릴이 미끄러지지 않도록 구멍 자리를 먼저 살짝 찍는 공구(스팟 드릴).'],
    ['펙', 'G73·G83: 조금씩 들어갔다 빠지며 칩을 끊거나 배출하는 드릴 사이클. 깊은 구멍에 씁니다.'],
    ['사이클', '고정 사이클 — G81 일반 드릴, G73 고속 펙, G83 심공, G84 탭, G85 리머, G76 정밀 보링.'],
    ['탭 끝', '탭 공구 끝이 내려가는 깊이. 도면의 "완전 나사 깊이"보다 2~3 피치 더 깊게 잡습니다.'],
    ['리지드', '리지드 탭(M29): 주축 회전과 이송을 동기화해 홀더 없이 탭을 냅니다.'],
    ['직경부', '드릴 끝 원뿔을 뺀, 구멍이 완성 지름인 깊이. 도면 구멍 깊이는 보통 이 깊이입니다.'],
    ['경로 간격', '포켓에서 한 바퀴와 다음 바퀴 사이 거리(공구 지름의 %). 클수록 빠르지만 공구 부하가 큽니다 (40~50% 권장).'],
    ['줄 간격', '평면 가공에서 줄 사이 간격(공구 지름의 %). 페이스밀은 60~75%.'],
    ['절입', '한 번에 Z 로 깎아 내려가는 깊이. 0 이면 재질·공구로 자동 계산합니다.'],
    ['측벽', '벽 쪽에 남겨 두는 두께(여유). 황삭은 여유를 남기고 정삭이 마지막에 깎아 치수를 맞춥니다.'],
    ['바닥 남김', '바닥에 남겨 두는 두께(여유). 바닥 정삭이 마지막에 깎습니다.'],
    ['중삭', '황삭과 정삭 사이 단계. 여유를 고르게 줄여 정삭 부하를 일정하게 합니다. 한 번에 또는 정한 깊이씩.'],
    ['단 깊이', '측벽을 깎을 때 이 깊이씩 나눠 내려갑니다. 0 이면 한 번에 전체 높이를 깎습니다.'],
    ['진입', '깎이지 않은 소재로 엔드밀을 곧장 내리면 공구가 부러집니다. 헬리컬(돌면서), 램프(비스듬히), 선가공 구멍(드릴 구멍으로) 중 고릅니다.'],
    ['구배', '벽이 수직에서 기울어진 각도. 입구가 도면 치수이고 아래로 갈수록 좁아집니다. 평 엔드밀 계단으로 근사합니다.'],
    ['계단 높이', '구배·R 을 평 엔드밀로 깎을 때 한 계단 높이. 작을수록 매끈하지만 오래 걸립니다.'],
    ['입구 R', '포켓 윗 모서리를 둥글게 깎는 반지름.'],
    ['바닥 R', '포켓 바닥과 벽이 만나는 곳의 둥근 반지름.'],
    ['코너 R', '사각 모양의 네 모서리 둥글기. 공구 반경보다 작으면 공구 반경만큼 둥글게 남습니다 (모서리 릴리프 구멍으로 해결).'],
    ['맞변', '다각형의 평행한 두 변 사이 거리 (육각 렌치 크기처럼).'],
    ['꼭짓점 지름', '다각형 꼭짓점을 지나는 원의 지름.'],
    ['측면 제거 폭', '윤곽 바깥(또는 안쪽)에 남은 소재 폭. 여러 바퀴로 나눠 깎습니다.'],
    ['모따기 폭', 'C 모따기 크기 (C0.5 = 모서리를 0.5mm 깎음).'],
    ['날장', '공구의 유효 날 길이 = 깎을 수 있는 최대 깊이.'],
    ['돌출', '홀더(척) 끝에서 공구 끝까지 길이. 가공 깊이보다 길어야 홀더가 소재에 닿지 않습니다.'],
    ['홀더', '공구를 잡는 척·콜렛의 바깥 지름. 클램프 위를 지나갈 때 닿는지 검사합니다.'],
    ['H 측정', '장비에서 잰 공구 길이 보정값(H). G54 Z 와 함께 Z 행정(오버트래블)을 검사합니다.'],
    ['G54 Z', '장비 화면의 공작물 좌표계 Z 값(머신 좌표). 입력하면 공구가 Z 행정 밖으로 나가는지 검사합니다.'],
    ['Z 행정 하한', '장비 Z 축이 내려갈 수 있는 머신 좌표 한계 (예: −500).'],
    ['NC 메모리', '장비에 저장할 수 있는 프로그램 크기. 넘으면 공구별로 나눠 저장하거나 DNC 로 보냅니다.'],
    ['첫 가공', '공정마다 M00 으로 멈추고 이송을 낮춘 확인용 NC. 드라이런 → 싱글 블록 → 시편 순서로 확인합니다.'],
    ['재시작', '공구별 재시작 블록(N100, N200…). 공구가 부러지면 그 번호부터 다시 시작합니다.'],
    ['날 빼기', 'G76 보링: 바닥에서 주축을 정위치에 세운 뒤 날을 벽에서 Q 만큼 떼고 올라와 벽을 긁지 않습니다.'],
    ['완성 지름', '리머·보링으로 만든 최종 구멍 지름. H7 은 끼워맞춤 공차 등급입니다.'],
    ['공정 순서', '공구 교환 최소화 = 같은 공구를 모아 가공(빠름). 목록 순서 = 위에서부터 그대로.'],
    ['구멍 순서', '같은 공구로 여러 구멍을 뚫는 순서. 최단 거리가 보통 가장 빠릅니다.'],
    ['원점', '프로그램 X0 Y0 의 위치 (소재 왼쪽 아래 모서리 등). Z0 은 소재 윗면입니다.'],
    ['좌표계', 'G54~G59 공작물 좌표계. 장비에 원점 값을 입력한 번호와 같아야 합니다.']
  ];
  function glossFind(label) { const t = String(label).replace(/<[^>]*>/g, ''); return GLOSS.find(g => t.includes(g[0])) || null; }
  // 지금 그리는 가공의 오류·경고를 관련 입력칸에 연결 (칸 이름의 핵심 낱말로)
  let FLD = null;
  const FKEYS = [['깊이', /깊이|두께/], ['가로', /가로|크기|폭|소재 범위|벗어/], ['세로', /세로|크기|폭|소재 범위|벗어/], ['지름', /지름|직경|Ø/], ['코너 R', /코너 R/], ['공구', /공구|엔드밀|드릴|리머|보링 바|탭 M/], ['측벽', /측벽 여유|측벽/], ['바닥', /바닥 여유/], ['경로 간격', /경로 간격/], ['절입', /절입/], ['관통 여유', /관통 여유|하부 여유/], ['모따기 폭', /모따기/], ['구배', /구배/], ['계단', /계단/], ['입구 R', /입구 R/], ['바닥 R', /바닥 R/], ['진입', /진입|선가공|램프|헬리컬/], ['날 빼기', /G76|Q/]];
  const FSPEC = ['경로 간격', '절입', '관통 여유', '측벽', '바닥', '구배', '계단', '입구 R', '바닥 R', '코너 R', '모따기 폭', '날 빼기', '진입'];
  const bestKey = msg => { const ks = FKEYS.filter(x => x[1].test(msg)); return ((ks.find(x => FSPEC.includes(x[0])) || ks[0]) || [null])[0]; };
  function fieldIssue(label) {
    if (!FLD || !FLD.list.length) return null;
    if (FLD.off) return null; // [V0.7] 접혀 있는 [공정 상세 편집] 안쪽 칸은 오류를 가져가지 않음 (가져가면 화면에 안 보이게 됨)
    const t = String(label).replace(/<[^>]*>/g, ''), k = FKEYS.filter(x => t.includes(x[0])).sort((a, b) => b[0].length - a[0].length)[0]; // 이름표에 맞는 가장 긴 열쇠말
    if (!k) return null;
    const cands = FLD.list.filter(x => !FLD.used.has(x) && bestKey(x.msg) === k[0]); // [V0.7] 오류는 가장 구체적인 칸 하나에만 (예: '경로 간격' 오류가 '공구' 칸에 붙지 않게)
    if (!cands.length) return null;
    const i = cands.find(x => quickFix(x)) || cands.find(x => x.level === 'error') || cands[0]; // 바로 고칠 수 있는 것·오류 먼저
    FLD.used.add(i);
    return { level: i.level === 'error' ? 'err' : 'warn', msg: i.msg, fix: quickFix(i) };
  }
  // 바로 고치기 버튼 (흔한 오류)
  function quickFix(i) {
    const g = FLD && FLD.g, sp = g && g.spec; if (!sp) return '';
    const u = FLD.u, sz = P.stock.sz;
    if (/소재 두께.*이상|\[관통\]을 체크/.test(i.msg) && 'thru' in sp) return '<span class="qfix">' + u.btn('관통으로 바꾸기', () => mutate(() => { sp.thru = true; }), 'sm') + u.btn('깊이를 ' + uf(C.r3(sz - 1)) + '(두께−1)로', () => mutate(() => { if ('tapDepth' in sp && sp.kind === 'tap') sp.tapDepth = C.r3(sz - 1); else sp.depth = C.r3(sz - 1); }), 'sm') + '</span>';
    return '';
  }

  /* ---------------- 상태 ---------------- */
  let DB = null;           // 저장 데이터
  let P = null;            // 현재 프로젝트
  const S = {
    sel: { kind: 'stock', gid: null, hid: null },
    vmode: '2d', drawer: false, bottomTab: 'check', mpanel: 'view', mode: 'select',
    arrKind: 'single', arr: {}, bundleSel: null, pathStep: 0, showPath: true, showNC: false, sec: { on: false, y: 0 }, flow: { saved: '', viewed: '' }, // [V0.6] 확인(3D 본 NC 해시)·저장(저장한 NC 해시)
    view: { scale: 3, cx: 75, cy: 50, fitted: false },
    undo: [], redo: [],
    V: null, nc: { text: '', hits: [], cuts: [], blocked: '', verify: null, edited: false, editText: '', editVerify: null },
    admin: { authed: false, until: 0, clicks: [] },
    openSec: {}, keepOpen: {}, gz: new Map(), est: null, toolsTab: 'machine', dlgRefresh: null,
    sim: { speed: 10, res: 'm', showPaths: true, sig: '', stockSig: '', total: 0, tl: [], motions: [], t: 0 }
  };
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const uf = v => String(C.fmt(v)).replace(/\.$/, ''); // 화면 표시용 숫자 (NC 의 끝 소수점 제거)
  const fmtN = v => (C.isNum(v) ? String(C.r3(v)) : '');
  const ico = (id, cls) => '<svg' + (cls ? ' class="' + cls + '"' : '') + '><use href="#' + id + '"/></svg>';
  const mobile = () => window.innerWidth <= 900;
  const fmtSec = s => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60), r = s % 60; return m >= 60 ? Math.floor(m / 60) + '시간 ' + (m % 60) + '분' : (m ? m + '분 ' : '') + r + '초'; };
  const clock = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  /* ---------------- 저장소 ---------------- */
  const ST = window.PCAM_UI.createStorage(toast);
  const { DB_KEY, ADMIN_KEY, lsSet, freshDB, loadDB, adminRec, b64, unb64, pbkdf2, safeEq, pwRule } = ST;
  let saveTimer = null;
  function saveDB(now) {
    clearTimeout(saveTimer);
    const run = () => { if (P) DB.projects[P.id] = P; DB.currentProjectId = P ? P.id : null; lsSet(DB_KEY, JSON.stringify(DB)); };
    if (now) run(); else saveTimer = setTimeout(run, 300);
  }
  const machine = () => DB.machines.find(m => m.id === P.machineId) || DB.machines[0];

  /* ---------------- 바인딩 헬퍼 ---------------- */
  const binds = new Map(), acts = new Map();
  function clearScope(sc) { for (const k of [...binds.keys()]) if (k.startsWith(sc + ':')) binds.delete(k); for (const k of [...acts.keys()]) if (k.startsWith(sc + ':')) acts.delete(k); }
  function U(sc) {
    clearScope(sc); let n = 0;
    const key = () => sc + ':' + (++n);
    return {
      num(val, fn, a) { const k = key(); binds.set(k, el => { const raw = el.value.trim(); const v = parseFloat(raw); if (raw === '' || !isFinite(v)) { toast('숫자를 입력하세요.', 'err'); renderAll(); return; } fn(v); }); return '<input type="number" step="any" inputmode="decimal" data-k="' + k + '" value="' + esc(fmtN(val)) + '" ' + (a || '') + '>'; },
      // [V0.6] 비워 두면 null (선택 입력)
      optnum(val, fn, a) { const k = key(); binds.set(k, el => { const raw = el.value.trim(); if (raw === '') return fn(null); const v = parseFloat(raw); if (!isFinite(v)) { toast('숫자를 입력하거나 비워 두세요.', 'err'); renderAll(); return; } fn(v); }); return '<input type="number" step="any" inputmode="decimal" placeholder="미입력" data-k="' + k + '" value="' + (val === null || val === undefined ? '' : esc(fmtN(val))) + '" ' + (a || '') + '>'; },
      int(val, fn, a) { const k = key(); binds.set(k, el => { const v = el.value.trim() === '' ? NaN : Number(el.value); if (!Number.isInteger(v)) { toast('정수를 입력하세요.', 'err'); renderAll(); return; } fn(v); }); return '<input type="number" step="1" inputmode="numeric" data-k="' + k + '" value="' + esc(val) + '" ' + (a || '') + '>'; },
      text(val, fn, a) { const k = key(); binds.set(k, el => fn(el.value)); return '<input type="text" data-k="' + k + '" value="' + esc(val) + '" ' + (a || '') + '>'; },
      color(val, fn) { const k = key(); binds.set(k, el => fn(el.value)); return '<input type="color" data-k="' + k + '" value="' + esc(val) + '" title="표시 색상" aria-label="표시 색상">'; },
      select(val, opts, fn, a) { const k = key(); binds.set(k, el => fn(el.value)); return '<select data-k="' + k + '" ' + (a || '') + '>' + opts.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + (o[2] ? ' disabled' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>'; },
      check(val, fn, label, a) { const k = key(); binds.set(k, el => fn(el.checked)); return '<label class="chk"><input type="checkbox" data-k="' + k + '"' + (val ? ' checked' : '') + ' ' + (a || '') + '>' + esc(label) + '</label>'; },
      btn(label, fn, cls, a) { const k = key(); acts.set(k, fn); return '<button type="button" data-a="' + k + '" class="' + (cls || '') + '" ' + (a || '') + '>' + label + '</button>'; },
      act(fn) { const k = key(); acts.set(k, fn); return k; },
      // [V0.6] 이름 옆 ⓘ (눌러서 설명·용어 풀이), 이 칸과 관련된 오류·경고는 칸 아래에 바로 표시
      fld(label, inner, hint) {
        const term = glossFind(label), tip = [hint, term ? term[0] + ': ' + term[1] : ''].filter(Boolean).join('\n\n');
        const fi = fieldIssue(label);
        return '<label class="fld' + (fi ? ' f' + fi.level : '') + '"><span>' + label + (tip ? ' <button type="button" class="gi" data-tip="' + esc(tip) + '" aria-label="설명">ⓘ</button>' : '') + '</span>' + inner +
          (fi ? '<em class="fmsg">' + (fi.level === 'err' ? '✖ ' : '⚠ ') + esc(fi.msg.replace(/^\[[^\]]*\]\s*(공정 \d+ \([^)]*\)|[^:]{0,40}):\s*/, '')) + '</em>' + (fi.fix || '') : '') + '</label>';
      }
    };
  }
  // change 처리는 포커스 이동(Tab) 이후 실행하여 다음 입력칸 포커스를 유지
  document.addEventListener('change', e => { const el = e.target, k = el && el.dataset && el.dataset.k; if (k && binds.has(k)) { const fn = binds.get(k); setTimeout(() => fn(el), 0); } });
  document.addEventListener('click', e => { const sm = e.target.closest && e.target.closest('summary'), d = sm && sm.parentElement; if (!d || !d.dataset || !d.dataset.sec) return; if (d.dataset.forced) { e.preventDefault(); return; } S.openSec[d.dataset.sec] = !d.open; delete S.keepOpen[d.dataset.sec]; }, true); // [V0.7] 사람이 누른 것만 기억 (처음부터 펼친 줄·오류로 펼친 줄은 기억하지 않음)
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-a]'); if (b && acts.has(b.dataset.a) && !b.disabled) { e.preventDefault(); acts.get(b.dataset.a)(e, b); } });
  // [V0.7] ⋯ 펼침 메뉴는 바깥을 누르면 닫힘
  document.addEventListener('pointerdown', e => { document.querySelectorAll('details.pop[open]').forEach(d => { if (!d.contains(e.target)) { d.open = false; if (d.dataset.sec) S.openSec[d.dataset.sec] = false; } }); }, true);
  document.addEventListener('click', e => { if (S.addOpen && e.target.closest && !e.target.closest('.addpal, .addmain, .nextstep, .flow, dialog, #ctxmenu')) { S.addOpen = false; renderTree(); } }); // 선택판 바깥을 누르면 닫힘
  // 버튼이 아닌 선택 항목(작업 목록 등)도 키보드 Enter/Space 로 선택
  document.addEventListener('keydown', e => { const b = e.target; if ((e.key === 'Enter' || e.key === ' ') && b && b.getAttribute && b.getAttribute('role') === 'button' && b.tagName !== 'BUTTON' && b.dataset.a) { e.preventDefault(); b.click(); } });

  /* ---------------- 변경·되돌리기 ---------------- */
  function mutate(fn) {
    document.querySelectorAll('#toasts .toast.err').forEach(x => x.remove());
    S.undo.push(JSON.stringify(P)); if (S.undo.length > 50) S.undo.shift();
    S.redo = [];
    fn();
    regenSpecs();
    P.updatedAt = new Date().toISOString();
    saveDB();
    renderAll();
  }
  // 간편 입력 그룹은 소재·장비·입력이 바뀔 때마다 공정을 다시 구성
  function regenSpecs() { const m = machine(); P.groups.forEach(g => { if (g.spec) C.applyHoleSpec(g, m, P.stock); }); }
  function undo() { if (!S.undo.length) return; S.redo.push(JSON.stringify(P)); P = C.normalizeProject(JSON.parse(S.undo.pop())); regenSpecs(); saveDB(); renderAll(); toast('되돌렸습니다.'); }
  function redo() { if (!S.redo.length) return; S.undo.push(JSON.stringify(P)); P = C.normalizeProject(JSON.parse(S.redo.pop())); regenSpecs(); saveDB(); renderAll(); toast('다시 실행했습니다.'); }
  function dbChange(fn) { fn(); regenSpecs(); saveDB(); renderAll(); }

  /* ---------------- 알림 ---------------- */
  function toast(msg, kind, action) {
    if (kind === 'ok') document.querySelectorAll('#toasts .toast.err').forEach(x => x.remove()); // 해결된 오류 알림 정리
    const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg;
    if (action) { document.querySelectorAll('#toasts .toast.act').forEach(x => x.remove()); t.classList.add('act'); const b = document.createElement('button'); b.type = 'button'; b.textContent = action.label; b.onclick = () => { t.remove(); action.fn(); }; t.appendChild(b); }
    const box = $('#toasts'); box.appendChild(t); while (box.children.length > 3) box.firstChild.remove(); // 최대 3개
    setTimeout(() => t.remove(), action ? 9000 : kind === 'err' ? 8000 : 3500); // [V0.7] 주석 뒤에 붙어 실행되지 않던 줄 — 알림이 계속 남아 아래 줄을 가리던 문제
  }
  function beep() {
    if (!DB.settings.sound) return;
    try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(), g = a.createGain(); o.frequency.value = 440; o.type = 'square'; g.gain.value = 0.05; o.connect(g); g.connect(a.destination); o.start(); setTimeout(() => { o.stop(); a.close(); }, 250); } catch (e) { /* 소리 미지원 */ }
  }

  /* ---------------- 재계산 (검증·생성·독립 검증·시간 추정) ---------------- */
  function verifyCtx(m, extra) { return Object.assign({ stock: P.stock, machine: m, clamps: P.clamps, settings: P.settings, pockets: C.pocketRegions(P, m) }, extra); }
  function recompute() {
    const m = machine();
    S.V = C.validateProject(P, m);
    // [V0.6 검토] 날짜 줄은 마지막 수정 시각 → 같은 내용이면 NC 해시가 분마다 바뀌지 않음
    const ud = new Date(P.updatedAt), g = C.generateNC(P, m, S.V.plan, { date: isNaN(ud.getTime()) ? new Date() : ud });
    S.nc.text = g.text; S.nc.hits = g.hits; S.nc.cuts = g.cuts || []; S.nc.blocked = g.blocked || ''; S.nc.hash = g.hash || '';
    S.nc.verify = g.text ? C.verifyNC(g.text, verifyCtx(m, { expected: g.hits, expectedCuts: g.cuts || [] })) : null;
    // 재검증한 수정본도 소재·장비·클램프가 바뀌면 현재 조건으로 다시 검사 (이전 통과 결과 재사용 금지)
    if (S.nc.edited && S.nc.editVerify) S.nc.editVerify = C.verifyNC(S.nc.editText, verifyCtx(m, { expected: null }));
    // 그룹별 가장 깊은 공구 끝 Z (화면 표시용)
    // 그룹별 표시 이름표: 탭은 '탭 Z / 드릴 Z' 를 함께
    const tm = C.toolMap(m); S.gz = new Map(); S.gzLabel = new Map();
    P.groups.forEach(gr => {
      let z = null, tapZ = null;
      gr.ops.forEach(op => { const t = tm.get(op.toolNo); if (!t || !C.OP_TYPES[op.type] || !C.OP_TYPES[op.type].tools.includes(t.type)) return; const d = C.opDepth(op, t, P.stock); if (!d || !C.isNum(d.z)) return; if (z === null || d.z < z) z = d.z; if (t.type === 'tap') tapZ = d.z; });
      S.gz.set(gr.id, z);
      S.gzLabel.set(gr.id, z === null ? '' : tapZ !== null ? '탭 Z' + uf(tapZ) + ' / 드릴 Z' + uf(z) : (kindOf(gr) === 'pocket' ? '바닥 Z' : 'Z') + uf(z));
    });
    S.est = estimate(m);
  }
  // 시뮬레이션·시간 추정에 쓰는 NC 해석 결과 (수정본이면 재검증한 수정본만)
  function simSource() { return S.nc.edited ? S.nc.editVerify : S.nc.verify; }
  function estimate(m) {
    const vr = simSource(); if (!vr || !vr.motions || !vr.motions.length) return null;
    const tl = C.SIM.timeline(vr.motions, m);
    const runs = []; let cur = null;
    vr.motions.forEach((mv, i) => { if (!cur || cur.t !== mv.t) { cur = { t: mv.t, sec: 0 }; runs.push(cur); } cur.sec += tl[i].sec; });
    const cut = tl[tl.length - 1].t1, tc = runs.length * C.toNum(m.tcSec, 6);
    return { cut, tc, total: cut + tc, runs, changes: runs.length };
  }
  // [V0.6] 장비 승인 상태 표시 (가공 종류 × 버전)
  function approvalHTML(m) {
    const cur = (m.approvals || []).filter(a => a.ver === C.VERSION), old = (m.approvals || []).filter(a => a.ver !== C.VERSION);
    if (!cur.length) return '<span class="pill warn">' + C.VERSION + ' 미승인' + (old.length ? ' (이전 버전 승인 ' + old.length + '건은 무효)' : '') + ' — NC 는 "검증용(TEST)"</span><br>';
    return '<span class="pill ok">' + C.VERSION + ' 승인 ' + cur.length + '건</span><ul class="hist">' + cur.map(a => '<li>' + esc(a.kinds.map(k => (C.OPS.get(k) || {}).label || k).join(', ')) + ' <small>· ' + esc(a.by) + ' · ' + esc(a.at) + (a.hash ? ' · NC ' + esc(a.hash) : '') + (a.note ? ' · ' + esc(a.note) : '') + '</small></li>').join('') + '</ul>';
  }
  const isUnverified = i => i.cat === 11 && /실가공 검증 전/.test(i.msg);
  // 같은 내용의 G코드 오류·경고는 한 건으로 묶음 (여러 줄)
  function groupMsgs(list) { const m = new Map(); list.forEach(x => { const g = m.get(x.msg); if (g) g.lines.push(x.line); else m.set(x.msg, { msg: x.msg, lines: [x.line] }); }); return [...m.values()]; }
  function counts() {
    const iss = S.V ? S.V.issues : [];
    const e = iss.filter(i => i.level === 'error').length, w = iss.filter(i => i.level === 'warn' && !isUnverified(i)).length;
    const vr = S.nc.edited ? S.nc.editVerify : S.nc.verify;
    const uniq = a => new Set(a.map(x => x.msg)).size;
    return { e, w, ne: vr ? uniq(vr.errors) : 0, nw: vr ? uniq(vr.warnings) : 0, vr };
  }
  // NC 다운로드 가능 여부와 사유
  function downloadState() {
    const c = counts();
    if (S.nc.blocked) return { ok: false, why: S.nc.blocked };
    if (c.e) return { ok: false, why: '입력 오류 ' + c.e + '건' };
    if (S.nc.edited) {
      if (!S.nc.editVerify) return { ok: false, why: '수정한 G코드는 재검증이 필요합니다' };
      if (S.nc.editVerify.errors.length) return { ok: false, why: '수정한 G코드 검증 오류 ' + S.nc.editVerify.errors.length + '건' };
    } else {
      if (!S.nc.verify) return { ok: false, why: 'G코드가 없습니다' };
      if (S.nc.verify.errors.length) return { ok: false, why: 'NC 해석 검증 오류 ' + S.nc.verify.errors.length + '건' };
    }
    // [V0.6] 가공 종류 × 버전 승인. [V0.6 검토] 손으로 고친 NC 는 승인된 가공과 같다는 보장이 없으므로 항상 검증용(TEST)
    return { ok: true, test: S.nc.edited ? true : !C.approvalOf(machine(), S.V.plan).ok, editedTest: !!S.nc.edited };
  }

  /* ---------------- 전체 렌더 ---------------- */
  function renderAll() {
    const ae = document.activeElement, ak = ae && ae.dataset ? ae.dataset.k : null;
    recompute();
    renderTop(); renderTree(); renderProps(); renderVTools(); renderStatus(); renderBottom();
    if (S.vmode === '2d') drawView(); else update3D();
    if (S.dlgRefresh && $('#dlg').open) S.dlgRefresh();
    if (ak) { const el = document.querySelector('[data-k="' + ak + '"]'); if (el) el.focus(); }
  }
  function renderTop() {
    $('#verTag').textContent = C.VERSION;
    const pn = $('#projName'); if (document.activeElement !== pn) pn.value = P.name;
    $('#btnUndo').disabled = !S.undo.length; $('#btnRedo').disabled = !S.redo.length;
    const ds = downloadState(), b = $('#btnDownload');
    b.classList.toggle('blocked', !ds.ok); b.classList.toggle('test', ds.ok && !!ds.test);
    b.title = ds.ok ? (ds.test ? 'NC 저장 — 장비 실가공 검증 전이므로 "검증용(TEST)" 파일로 저장됩니다' : 'NC 파일 저장') : 'NC 생성 차단: ' + ds.why;
    b.setAttribute('aria-disabled', ds.ok ? 'false' : 'true');
    document.querySelectorAll('#bottomTabs button[data-tab]').forEach(x => x.classList.toggle('act', x.dataset.tab === S.bottomTab));
    document.querySelectorAll('#mnav button').forEach(x => x.classList.toggle('act', x.dataset.m === S.mpanel));
    document.querySelectorAll('.mpanel').forEach(x => x.classList.toggle('mact', x.id === S.mpanel));
    $('#app').classList.toggle('drawer-open', S.drawer);
    $('#tab2d').classList.toggle('act', S.vmode === '2d'); $('#tab3d').classList.toggle('act', S.vmode === '3d');
    $('#tab2d').setAttribute('aria-selected', S.vmode === '2d'); $('#tab3d').setAttribute('aria-selected', S.vmode === '3d');
    $('#canvasWrap').hidden = S.vmode !== '2d'; $('#v3wrap').hidden = S.vmode !== '3d';
    const c = counts(), bd = $('#chkBadge'), ne = c.e + c.ne;
    bd.className = 'badge ' + (ne ? 'err' : (c.w + c.nw ? 'warn' : 'ok'));
    bd.textContent = ne ? ne : (c.w + c.nw ? c.w + c.nw : '✓');
  }

  /* ---------------- 왼쪽: 작업 목록 ---------------- */
  const kindOf = g => (g.spec && KIND[g.spec.kind]) ? g.spec.kind : 'custom';
  const isFineThread = sp => !C.METRIC_COARSE.some(r => r[0] === sp.tapD && r[1] === sp.tapP);
  function groupSummary(g) {
    const sp = g.spec, n = g.holes.length;
    let s;
    if (!sp) s = g.ops.length ? g.ops.map(o => C.OP_TYPES[o.type] ? C.OP_TYPES[o.type].label : o.type).join('→') : '공정 없음';
    else if (sp.kind === 'tap') s = 'M' + sp.tapD + (isFineThread(sp) ? '×' + sp.tapP : '') + (sp.thru ? ' 관통' : ' 깊이 ' + sp.tapDepth);
    else if (sp.kind === 'pocket') s = shapeTxt(sp) + (sp.thru ? ' 관통' : ' 깊이 ' + sp.depth);
    else if (sp.kind === 'contour') s = shapeTxt(sp) + (sp.side === 'in' ? ' 안쪽' : ' 바깥') + (sp.thru ? ' 관통' : ' 깊이 ' + sp.depth);
    else if (sp.kind === 'face') return '소재 전체 · 깊이 ' + sp.depth;
    else if (sp.kind === 'chamfer') s = 'C' + sp.cw + ' ' + (sp.side === 'in' ? '안쪽' : '바깥') + ' · ' + shapeTxt(sp);
    else if (sp.kind === 'ream') s = 'Ø' + sp.dia + 'H7' + (sp.thru ? ' 관통' : ' 깊이 ' + sp.depth);
    else if (sp.kind === 'bore') s = '보링 Ø' + sp.dia + (sp.thru ? ' 관통' : ' 깊이 ' + sp.depth);
    else s = 'Ø' + sp.dia + (sp.thru ? ' 관통' : ' 깊이 ' + sp.depth);
    return s + ' · ' + n + '개';
  }
  function groupStatus(g) {
    const iss = S.V.issues.filter(i => i.ref && i.ref.gid === g.id);
    if (!g.ops.length || iss.some(i => i.level === 'error')) return 'err';
    if (!g.holes.length || iss.some(i => i.level === 'warn')) return 'warn';
    return 'ok';
  }
  const stIcon = s => '<span class="st ' + s + '" title="' + (s === 'ok' ? '문제 없음' : s === 'err' ? '오류 확인 필요' : '경고 확인') + '">' + ico(s === 'ok' ? 'i-check' : s === 'err' ? 'i-x' : 'i-warn') + '</span>';
  function flash(sel) { const el = $(sel); if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  function select(kind, gid) { const changed = S.sel.kind !== kind || S.sel.gid !== (gid || null); S.sel = { kind, gid: gid || null, hid: null }; S.kindOpen = false; S.addOpen = false; S.keepOpen = {}; if (mobile()) S.mpanel = 'right'; renderAll(); if (changed) $('#rightBody').scrollTop = 0; }
  function renderTree() {
    const u = U('tr'), m = machine(), st = P.stock, set = P.settings, dense = DENSE();
    const item = (sel, icon, cls, title, sub, status, fn, extra, color, gid) => '<div class="titem' + (sel ? ' sel' : '') + (gid ? '' : ' mini') + ' s-' + status + '" role="button" tabindex="0" aria-pressed="' + sel + '" data-a="' + u.act(fn) + '"' + (gid ? ' data-gid="' + esc(gid) + '" draggable="true" aria-label="' + esc(title) + ' (오른쪽 버튼: 메뉴, Delete: 삭제, Ctrl+C/V: 복사·붙여넣기)"' : ' data-node="' + (icon === 'i-nc' ? 'nc' : 'stock') + '"') + '>' + tile(icon, cls, null, gid ? '' : 'sm', color) + '<span class="tx"><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span>' + (extra || '') + stIcon(status) + '</div>';
    const okStock = st.sx > 0 && st.sy > 0 && st.sz > 0;
    // 작업 흐름 (① 소재 → ② 원점·NC → ③ 가공 → ④ 확인 → ⑤ NC 저장) — 단계별 상태 표시
    const ds = downloadState(), c = counts();
    const gst = P.groups.map(groupStatus);
    const zIss0 = S.V.issues.filter(i => i.cat === 10 && !i.ref);
    const openAdd = () => { S.addOpen = true; renderTree(); const b = document.querySelector('#tree .addpal .addbtn'); if (b) { b.focus({ preventScroll: true }); const pal = document.querySelector('#tree .addpal'); if (pal) pal.scrollIntoView({ block: 'end' }); } };
    // [V0.5] 단계마다 이름·설명·다음 할 일  /  [V0.7] 6번째 칸 = "다음 할 일" 버튼에 크게 쓰는 짧은 말
    const flow = [
      ['소재', '크기·재질', st.sx > 0 && st.sy > 0 && st.sz > 0 ? 'ok' : 'err', () => select('stock'), { err: '소재 크기(가로·세로·두께)와 재질을 입력하세요.' }, { err: '소재 크기 입력하기' }],
      ['원점·NC', '원점·번호', zIss0.some(i => i.level === 'error') ? 'err' : zIss0.some(i => i.level === 'warn') ? 'warn' : 'ok', () => select('nc'), { err: '원점·NC 출력 설정의 빨간 항목을 고치세요.', warn: '원점·NC 출력 설정의 경고를 확인하세요.' }, { err: '원점·NC 설정 고치기', warn: '원점·NC 경고 확인하기' }],
      ['가공' + (P.groups.length ? ' ' + P.groups.length : ''), '구멍·포켓…', !P.groups.length ? 'todo' : gst.includes('err') ? 'err' : gst.includes('warn') ? 'warn' : 'ok', () => { if (P.groups.length) select('group', (P.groups[gst.indexOf('err')] || P.groups[gst.indexOf('warn')] || P.groups[0]).id); else openAdd(); }, { todo: '아래 [+ 가공 추가]에서 구멍·탭·포켓… 을 고르거나 [도면 불러오기]로 가공을 추가하세요.', err: '빨간 ! 표시 가공을 눌러 오류를 고치세요.', warn: '노란 표시 가공의 경고를 확인하세요.' }, { todo: '가공 추가하기', err: '가공 오류 고치기', warn: P.groups.some(g => !g.holes.length) ? '위치 넣기' : '가공 경고 확인하기' }],
      // [V0.6] 확인 = 지금 NC 를 3D 로 본 뒤에만 ✓, 저장 = 지금 NC 를 저장한 뒤에만 ✓ (추가만 해도 ✓ 되던 문제 수정)
      ['확인', '3D·검사', !P.groups.length ? 'todo' : !ds.ok ? 'err' : S.flow.viewed !== S.nc.hash ? 'todo' : (c.w + c.nw) ? 'warn' : 'ok', () => { S.vmode = '3d'; openDrawer('check'); }, { todo: P.groups.length ? '[확인]을 눌러 3D 시뮬레이션으로 가공 모습을 보고 검사 결과를 확인하세요.' : '가공을 추가하면 3D 시뮬레이션과 검사 결과를 볼 수 있습니다.', err: '[확인]을 눌러 NC 를 막는 오류를 확인하세요.', warn: '[확인]을 눌러 3D 시뮬레이션과 경고를 확인하세요.' }, { todo: '3D로 확인하기', err: '오류 확인하기', warn: '경고 확인하기' }],
      ['NC 저장', '파일 받기', !ds.ok ? 'todo' : S.flow.saved === S.nc.hash ? 'ok' : 'todo', () => doDownload(), { todo: ds.ok ? '[NC 저장]을 눌러 파일을 받으세요 (첫 가공이면 [원점·NC 출력]에서 첫 가공 모드를 켜세요).' : '오류를 모두 고치면 NC 를 저장할 수 있습니다.' }, { todo: ds.ok ? 'NC 저장하기' : '오류 고치기' }]
    ];
    let h = '<ol class="flow" aria-label="작업 순서">' + flow.map((f, i) => '<li><button type="button" class="fl ' + f[2] + '" data-a="' + u.act(f[3]) + '" title="' + (i + 1) + '단계: ' + f[0] + ' (' + f[1] + ') — ' + ({ ok: '완료', warn: '경고 확인', err: '오류 — 눌러서 고치기', todo: '아직 안 함' })[f[2]] + '"><span class="n">' + (f[2] === 'ok' ? '✓' : f[2] === 'err' ? '!' : i + 1) + '</span><b>' + f[0] + '</b>' + (dense ? '<small>' + f[1] + '</small>' : '') + '</button></li>').join('') + '</ol>';
    const nx = flow.findIndex(f => f[2] !== 'ok'), nf = flow[nx];
    const hint = nf ? (nf[4][nf[2]] || nf[4].todo || nf[4].err || '') : '', verb = nf ? (nf[5][nf[2]] || nf[5].todo || nf[5].err || nf[0]) : '';
    h += nf ? '<button type="button" class="nextstep ' + nf[2] + '" data-a="' + u.act(nf[3]) + '" title="' + esc(hint) + '"><span class="n">' + (nx + 1) + '</span><span class="nt"><small>다음 할 일</small><b>' + esc(verb) + '</b>' + (dense ? '<em>' + esc(hint) + '</em>' : '') + '</span><i class="go" aria-hidden="true">›</i></button>'
      : '<div class="nextstep ok" title="저장한 NC 는 첫 가공 때 드라이런·싱글 블록으로 확인하세요."><span class="n">✓</span><span class="nt"><small>모든 단계 완료</small><b>첫 가공은 드라이런부터</b></span></div>';
    if (dense) h += '<div class="sect-t">공통 정보</div>';
    h += item(S.sel.kind === 'stock', 'i-stock', 'k-stock', '소재·고정', (C.MATERIALS[st.material] ? C.MATERIALS[st.material].label.split(' ')[0] : st.material) + ' ' + st.sx + '×' + st.sy + '×' + st.sz + (P.clamps.length ? ' · 클램프 ' + P.clamps.length : ''), okStock ? 'ok' : 'err', () => select('stock'));
    const zIss = S.V.issues.filter(i => i.cat === 10 && !i.ref);
    h += item(S.sel.kind === 'nc', 'i-nc', 'k-nc', '원점·NC 출력', set.wcs + ' · O' + String(P.programNo).padStart(4, '0') + ' · 초기점 Z' + set.initialZ, zIss.some(i => i.level === 'error') ? 'err' : zIss.some(i => i.level === 'warn') ? 'warn' : 'ok', () => select('nc'));
    h += '<div class="sect-t" title="위에서부터 순서대로 가공합니다. 끌어서 순서 바꾸기 · 오른쪽 버튼 메뉴 · Ctrl+C/V/D · Delete · F2 이름">가공' + (P.groups.length ? ' <small>' + P.groups.length + '개 · 위에서부터</small>' : '') + '</div>' + (dense && P.groups.length ? '<div class="treehint">끌어서 순서 · 오른쪽 버튼 메뉴 · Ctrl+C/V/D · Delete · F2 이름</div>' : '');
    if (dense && !P.groups.length) h += '<div class="note info">아래에서 가공을 추가하거나 도면(DXF)을 불러오세요. 공구와 조건은 자동으로 정해집니다.</div>';
    P.groups.forEach(g => {
      const k = KIND[kindOf(g)];
      const qa = '<span class="qa">' + (dense ? u.btn(ico('i-copy'), () => dupGroup(g), '', 'title="복제 (Ctrl+D)" aria-label="복제"') + u.btn(ico('i-trash'), () => delGroup(g), '', 'title="삭제 (Delete)" aria-label="삭제"') : '') + u.btn(ico('i-more'), (e, b) => { const r = b.getBoundingClientRect(); groupMenu(g, r.left, r.bottom + 4); }, 'more', 'title="메뉴: 복사·복제·이름·순서·삭제 (오른쪽 버튼·Shift+F10)" aria-label="메뉴" aria-haspopup="menu"') + '</span>';
      h += item(S.sel.kind === 'group' && S.sel.gid === g.id, k.ico, k.cls, g.name, groupSummary(g), groupStatus(g), () => select('group', g.id), qa, g.color, g.id);
    });
    // [V0.7] 추가 버튼 하나 → 누르면 큰 아이콘 선택판 (가공이 하나도 없을 때는 처음부터 펼침)
    const palOpen = dense || S.addOpen || !P.groups.length;
    const add = (kind, label, title) => u.btn('<span class="tile lg">' + ico(KIND[kind].ico) + '</span><span>' + label + '</span>', () => { S.addOpen = false; addGroup(kind); }, 'addbtn ' + KIND[kind].cls, 'title="' + title + '"');
    if (!dense && !P.groups.length) h += '<div class="addhead">추가할 가공을 고르세요</div>';
    else if (!dense) h += u.btn(ico('i-plus') + '<span>가공 추가</span>' + ico('i-chev', 'car' + (palOpen ? ' up' : '')), () => { if (S.addOpen) { S.addOpen = false; renderTree(); } else openAdd(); }, 'addmain' + (palOpen ? ' on' : ''), 'aria-expanded="' + palOpen + '" title="구멍·탭·포켓·윤곽·평면·모따기·리머·보링 추가, 도면(DXF) 불러오기"');
    if (palOpen) h += '<div class="addpal" role="group" aria-label="추가할 가공 고르기">' +
      add('drill', '구멍', '드릴 구멍 추가 (센터 → 드릴, 사이클 자동)') + add('tap', '탭', '나사(탭) 구멍 추가 (센터 → 기초 드릴 → 탭)') + add('pocket', '포켓', '사각·원형·도면 형상 포켓 (헬리컬 진입 → 황삭 → 정삭)') +
      add('contour', '윤곽', '부품 바깥(또는 안쪽) 윤곽 따라 깎기, 관통 절단 가능') + add('face', '평면', '소재 윗면 고르기 (페이스밀)') + add('chamfer', '모따기', '모서리 C 모따기 (바깥·안쪽·구멍 입구)') +
      add('ream', '리머(H7)', '정밀 구멍 H7: 센터 → 밑구멍 드릴 → 리머 G85') + add('bore', '보링', '정밀 보링: 센터 → 밑구멍 → G76 보링 바') +
      u.btn('<span class="tile lg">' + ico('i-dxf') + '</span><span>도면(DXF)</span>', () => { S.addOpen = false; renderTree(); importDXF(); }, 'dxfbtn', 'title="도면(DXF) 불러오기: CAD 에서 저장한 DXF 파일의 원·닫힌 선을 읽어 구멍·탭·윤곽·포켓을 자동으로 만듭니다"') + '</div>';
    // 요약 (간단히 보기: 한 줄 / 모두 펼쳐 보기: 예전처럼)
    const holes = P.groups.reduce((s, g) => s + g.holes.length, 0);
    const tools = new Set(S.V.plan.steps.map(s => s.toolNo));
    const appr = C.approvalOf(m, S.V.plan).ok;
    if (dense) h += '<div class="tsum">위치 <b>' + holes + '</b>개 · 공정 <b>' + S.V.plan.steps.length + '</b>단계 · 공구 <b>' + tools.size + '</b>개' +
      (S.est ? '<br>예상 가공 시간 <b>약 ' + fmtSec(S.est.total) + '</b> <small>(추정)</small>' : '') +
      '<br><small>장비: ' + esc(m.name) + (appr ? ' · 이 프로젝트 가공 모두 실가공 승인' : ' · 실가공 검증 전' + (m.approvals.length ? ' (일부 승인)' : '')) + '</small></div>';
    else if (P.groups.length) h += '<div class="tfoot" title="위치 ' + holes + '개 · 공정 ' + S.V.plan.steps.length + '단계 · 공구 ' + tools.size + '개 · 장비: ' + esc(m.name) + (appr ? ' (실가공 승인)' : ' (실가공 검증 전 — NC 는 검증용 TEST)') + '">공구 <b>' + tools.size + '</b>개' + (S.est ? ' · 약 <b>' + fmtSec(S.est.total) + '</b>' : '') + ' · ' + (appr ? '실가공 승인' : '<span class="testtag">TEST</span>') + '</div>';
    $('#tree').innerHTML = h;
  }
  /* ---------- [V0.5] 작업 목록 편집: 복사·붙여넣기·복제·삭제·순서 ---------- */
  // 붙여넣기 위치: +X, −X, +Y, −Y 10mm 중 모든 위치가 소재 안에 남는 첫 방향 (없으면 제자리 + 안내)
  function pasteOffset(g) {
    if (kindOf(g) === 'face') return { dx: 0, dy: 0, txt: '' };
    const r = C.stockRect(P.stock);
    for (const [dx, dy, t] of [[10, 0, 'X+10'], [-10, 0, 'X−10'], [0, 10, 'Y+10'], [0, -10, 'Y−10']]) if (g.holes.every(h => h.x + dx >= r.x0 && h.x + dx <= r.x1 && h.y + dy >= r.y0 && h.y + dy <= r.y1)) return { dx, dy, txt: t + 'mm 위치' };
    return { dx: 0, dy: 0, txt: '같은 위치 (옮길 자리가 없음 — 위치를 수정하세요)' };
  }
  function copyName(name) { const base = name.replace(/ \(\d+\)$/, ''); let k = 2; while (P.groups.some(g => g.name === base + ' (' + k + ')')) k++; return (base + ' (' + k + ')').slice(0, 40); }
  function cloneGroup(g, off) {
    const n = C.clone(g); n.id = C.uid('g'); n.name = copyName(g.name);
    n.holes = n.holes.map(h => ({ id: C.uid('h'), x: C.r3(h.x + off.dx), y: C.r3(h.y + off.dy) }));
    n.ops = n.ops.map(o => Object.assign(o, { id: C.uid('o') }));
    return n;
  }
  function insertGroup(n, after, msg) {
    const i = after ? P.groups.indexOf(after) + 1 : P.groups.length;
    mutate(() => { P.groups.splice(i, 0, n); S.sel = { kind: 'group', gid: n.id, hid: null }; });
    toast(msg, 'ok', { label: '되돌리기', fn: undo });
  }
  function dupGroup(g) { if (!g) return; const d = pasteOffset(g); insertGroup(cloneGroup(g, d), g, '"' + g.name + '" 복제' + (d.txt ? ' — ' + d.txt : '')); }
  function copyGroup(g) { if (!g) return; S.clip = { type: 'group', data: C.clone(g) }; toast('"' + g.name + '" 복사 — Ctrl+V 로 붙여넣기'); }
  function delGroup(g) {
    if (!g) return;
    if (!confirm('"' + g.name + '" (위치 ' + g.holes.length + '개, 공정 ' + g.ops.length + '개)를 삭제할까요?')) return;
    const i = P.groups.indexOf(g);
    mutate(() => { P.groups.splice(i, 1); const nx = P.groups[Math.min(i, P.groups.length - 1)]; S.sel = nx ? { kind: 'group', gid: nx.id, hid: null } : { kind: 'stock', gid: null, hid: null }; });
    toast('"' + g.name + '" 삭제', 'warn', { label: '되돌리기', fn: undo });
  }
  function moveGroup(g, d) {
    const i = P.groups.indexOf(g), j = i + d;
    if (!g || j < 0 || j >= P.groups.length) return;
    mutate(() => { P.groups.splice(j, 0, P.groups.splice(i, 1)[0]); });
  }
  function pasteClip() {
    const c = S.clip;
    if (!c) return toast('복사한 항목이 없습니다. 목록에서 가공을 고르고 Ctrl+C 를 누르세요.', 'err');
    if (c.type === 'group') { const d = pasteOffset(c.data); insertGroup(cloneGroup(c.data, d), curGroup(), '"' + c.data.name + '" 붙여넣기' + (d.txt ? ' — ' + d.txt : '')); return; }
    // 위치(구멍·형상 기준점) 붙여넣기: 2D 화면 위 마우스 위치, 없으면 X+10mm
    const g = curGroup() || P.groups.find(x => x.id === c.gid);
    if (!g) return toast('붙여넣을 가공을 목록에서 고르세요.', 'err');
    const at = S.cursorW || [C.r3(c.x + 10), C.r3(c.y)], hid = C.uid('h');
    mutate(() => { g.holes.push({ id: hid, x: at[0], y: at[1] }); S.sel = { kind: 'group', gid: g.id, hid }; });
    toast('위치 붙여넣기: X' + uf(at[0]) + ' Y' + uf(at[1]), 'ok', { label: '되돌리기', fn: undo });
  }
  // 오른쪽 버튼 메뉴
  function closeMenu() { const m = $('#ctxmenu'); if (m) m.remove(); }
  function openMenu(x, y, items) {
    closeMenu();
    const m = document.createElement('div'); m.id = 'ctxmenu'; m.className = 'ctxmenu'; m.setAttribute('role', 'menu');
    items.forEach(it => {
      if (it === '-') { m.appendChild(document.createElement('hr')); return; }
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.className = it.danger ? 'danger' : '';
      b.innerHTML = '<span>' + esc(it.label) + '</span>' + (it.key ? '<kbd>' + esc(it.key) + '</kbd>' : '');
      if (it.disabled) b.disabled = true;
      b.onclick = () => { closeMenu(); it.fn(); };
      m.appendChild(b);
    });
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, window.innerWidth - r.width - 6) + 'px'; m.style.top = Math.min(y, window.innerHeight - r.height - 6) + 'px';
    const first = m.querySelector('button:not(:disabled)'); if (first) first.focus();
    m.addEventListener('keydown', e => {
      const bs = [...m.querySelectorAll('button:not(:disabled)')], i = bs.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length].focus(); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(); }
    });
  }
  function groupMenu(g, x, y) {
    const i = P.groups.indexOf(g);
    openMenu(x, y, [
      { label: '속성 열기', fn: () => select('group', g.id) },
      '-',
      { label: '복사', key: 'Ctrl+C', fn: () => copyGroup(g) },
      { label: '붙여넣기', key: 'Ctrl+V', fn: pasteClip, disabled: !S.clip },
      { label: '복제', key: 'Ctrl+D', fn: () => dupGroup(g) },
      { label: '이름 바꾸기', key: 'F2', fn: () => renameGroup(g) },
      '-',
      { label: '위로', key: 'Alt+↑', fn: () => moveGroup(g, -1), disabled: i === 0 },
      { label: '아래로', key: 'Alt+↓', fn: () => moveGroup(g, 1), disabled: i === P.groups.length - 1 },
      '-',
      { label: '삭제', key: 'Delete', fn: () => delGroup(g), danger: true }
    ]);
  }
  // 이름 바꾸기: 작업 목록 안에서 바로 (Enter 저장, Esc 취소, 다른 곳 누르면 저장)
  function renameGroup(g) {
    if (!g) return;
    if (S.sel.gid !== g.id) select('group', g.id);
    const it = document.querySelector('#tree .titem[data-gid="' + g.id + '"]'), b = it && it.querySelector('.tx b');
    if (!b) return;
    const inp = document.createElement('input'); inp.type = 'text'; inp.value = g.name; inp.maxLength = 40; inp.className = 'rename'; inp.setAttribute('aria-label', '가공 이름');
    b.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const finish = save => { if (done) return; done = true; const v = inp.value.trim().slice(0, 40); if (save && v && v !== g.name) mutate(() => { g.name = v; }); else renderAll(); requestAnimationFrame(() => { const t = document.querySelector('#tree .titem[data-gid="' + g.id + '"]'); if (t) t.focus(); }); };
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    inp.addEventListener('click', e => e.stopPropagation());
    inp.addEventListener('blur', () => finish(true));
  }
  // 끌어서 순서 바꾸기 + 오른쪽 버튼 (작업 목록에 한 번만 연결)
  function initTreeEvents() {
    const tree = $('#tree');
    let dragId = null;
    tree.addEventListener('contextmenu', e => {
      const it = e.target.closest('.titem'); if (!it) return;
      e.preventDefault();
      if (it.dataset.gid) { const g = P.groups.find(x => x.id === it.dataset.gid); if (g) { if (S.sel.gid !== g.id) select('group', g.id); groupMenu(g, e.clientX, e.clientY); } }
      else openMenu(e.clientX, e.clientY, [{ label: '속성 열기', fn: () => select(it.dataset.node) }, { label: '붙여넣기', key: 'Ctrl+V', fn: pasteClip, disabled: !S.clip || S.clip.type !== 'group' }]);
    });
    tree.addEventListener('dragstart', e => { const it = e.target.closest('.titem[data-gid]'); if (!it) return; dragId = it.dataset.gid; it.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (x) { /* 일부 브라우저 */ } });
    const clear = () => tree.querySelectorAll('.drop-before,.drop-after,.dragging').forEach(x => x.classList.remove('drop-before', 'drop-after', 'dragging'));
    tree.addEventListener('dragover', e => {
      const it = e.target.closest('.titem[data-gid]'); if (!dragId || !it) return;
      e.preventDefault(); tree.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
      const r = it.getBoundingClientRect(); it.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    });
    tree.addEventListener('drop', e => {
      const it = e.target.closest('.titem[data-gid]'); if (!dragId || !it) return;
      e.preventDefault();
      const before = it.classList.contains('drop-before'), src = P.groups.find(g => g.id === dragId), dst = P.groups.find(g => g.id === it.dataset.gid);
      clear(); dragId = null;
      if (!src || !dst || src === dst) return;
      mutate(() => { P.groups.splice(P.groups.indexOf(src), 1); const j = P.groups.indexOf(dst) + (before ? 0 : 1); P.groups.splice(j, 0, src); });
    });
    tree.addEventListener('dragend', () => { clear(); dragId = null; });
    document.addEventListener('pointerdown', e => { if (!e.target.closest('#ctxmenu')) closeMenu(); });
    window.addEventListener('blur', closeMenu);
  }
  /* ---------- [V0.5] 패널 크기 조절·접기 ---------- */
  const LAYOUT0 = { wl: 288, wr: 384, hd: 0.4, lh: false, rh: false, sw: false };
  function layout() { return Object.assign({}, LAYOUT0, DB.settings.layout || {}); }
  function applyLayout() {
    const L = layout(), app = $('#app');
    // 숨긴 패널은 폭 0 (인라인 값이 클래스보다 우선하므로 여기서 0 으로)
    app.style.setProperty('--wl', (L.lh ? 0 : L.wl) + 'px'); app.style.setProperty('--wr', (L.rh ? 0 : L.wr) + 'px'); app.style.setProperty('--hd', Math.round(L.hd * 100) + 'vh');
    app.classList.toggle('lhide', !!L.lh); app.classList.toggle('rhide', !!L.rh); app.classList.toggle('swap', !!L.sw);
    $('#togSwap').classList.toggle('on', !!L.sw); $('#togSwap').setAttribute('aria-pressed', !!L.sw);
    $('#togL').classList.toggle('on', !!L.lh); $('#togR').classList.toggle('on', !!L.rh);
    $('#togL').setAttribute('aria-pressed', !!L.lh); $('#togR').setAttribute('aria-pressed', !!L.rh);
  }
  function setLayout(patch) { DB.settings.layout = Object.assign(layout(), patch); applyLayout(); saveDB(); }
  function initSplitters() {
    const app = $('#app');
    const lim = { wl: [200, 560], wr: [280, 680] };
    const setup = (id, key) => {
      const el = $(id);
      let start = null;
      el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); el.classList.add('drag'); document.body.classList.add('resizing'); if (key === 'hd') document.body.classList.add('rows'); start = { L: layout() }; e.preventDefault(); });
      el.addEventListener('pointermove', e => {
        if (!start) return;
        const r = app.getBoundingClientRect();
        const sw = !!start.L.sw; // 패널 자리를 바꿨으면 방향 반대
        if (key === 'wl') setLayoutLive({ wl: Math.round(Math.max(lim.wl[0], Math.min(lim.wl[1], sw ? r.right - e.clientX : e.clientX - r.left))) });
        else if (key === 'wr') setLayoutLive({ wr: Math.round(Math.max(lim.wr[0], Math.min(lim.wr[1], sw ? e.clientX - r.left : r.right - e.clientX))) });
        else { const px = r.bottom - 38 - e.clientY, max = r.height - 56 - 38 - 140; setLayoutLive({ hd: Math.max(120, Math.min(max, px)) / window.innerHeight }); }
      });
      const end = () => { if (!start) return; start = null; el.classList.remove('drag'); document.body.classList.remove('resizing', 'rows'); saveDB(); if (S.vmode === '2d') { S.view.fitted = false; drawView(); } };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
      el.addEventListener('dblclick', () => { const p0 = {}; p0[key] = LAYOUT0[key]; setLayout(p0); if (S.vmode === '2d') { S.view.fitted = false; drawView(); } });
      el.addEventListener('keydown', e => {
        const L = layout(), st = (e.shiftKey ? 48 : 16) * (L.sw && key !== 'hd' ? -1 : 1);
        let p0 = null;
        if (key === 'wl' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) p0 = { wl: Math.max(lim.wl[0], Math.min(lim.wl[1], L.wl + (e.key === 'ArrowRight' ? st : -st))) };
        if (key === 'wr' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) p0 = { wr: Math.max(lim.wr[0], Math.min(lim.wr[1], L.wr + (e.key === 'ArrowLeft' ? st : -st))) };
        if (key === 'hd' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) p0 = { hd: Math.max(0.15, Math.min(0.7, L.hd + (e.key === 'ArrowUp' ? 0.03 : -0.03))) };
        if (p0) { e.preventDefault(); setLayout(p0); }
      });
    };
    const setLayoutLive = patch => { DB.settings.layout = Object.assign(layout(), patch); applyLayout(); };
    setup('#splitL', 'wl'); setup('#splitR', 'wr'); setup('#splitB', 'hd');
    $('#togL').onclick = () => { setLayout({ lh: !layout().lh }); S.view.fitted = false; if (S.vmode === '2d') drawView(); };
    $('#togR').onclick = () => { setLayout({ rh: !layout().rh }); S.view.fitted = false; if (S.vmode === '2d') drawView(); };
    $('#togSwap').onclick = () => { setLayout({ sw: !layout().sw }); S.view.fitted = false; if (S.vmode === '2d') drawView(); toast(layout().sw ? '작업 목록을 오른쪽, 속성을 왼쪽으로 옮겼습니다.' : '패널을 기본 자리로 되돌렸습니다.', 'ok'); };
  }
  /* ---------- [V0.5] 끌어서 순서 바꾸기: 머리글 아이콘(묶음 사이 이동 가능)·화면 탭·서랍 탭 ----------
   * 순서는 브라우저에 저장 (DB.settings.order[key] = 묶음별 요소 id 목록). 설정의 [배치 초기화]로 되돌림
   */
  function sortable(key, containers, itemSel) {
    const ord = (DB.settings.order || {})[key];
    // 저장된 순서 적용 (모르는 id 는 건너뜀, 새로 생긴 요소는 원래 자리)
    if (Array.isArray(ord)) ord.forEach((ids, ci) => { const box = containers[ci]; if (!box || !Array.isArray(ids)) return; const anchor = [...box.children].find(el => !el.matches(itemSel)) && box.querySelector(':scope > .tspace'); ids.forEach(id => { const el = document.getElementById(id) || document.querySelector('[data-sid="' + id + '"]'); if (el && containers.includes(el.parentElement) && el.matches(itemSel)) box.insertBefore(el, anchor || null); }); });
    const idOf = el => el.id || el.dataset.sid;
    const save = () => { DB.settings.order = Object.assign({}, DB.settings.order, { [key]: containers.map(b => [...b.children].filter(el => el.matches(itemSel)).map(idOf)) }); saveDB(); };
    let dragEl = null;
    const clear = () => containers.forEach(b => b.querySelectorAll('.dropbefore,.dropafter').forEach(x => x.classList.remove('dropbefore', 'dropafter')));
    containers.forEach(box => {
      box.classList.add('sortable');
      [...box.children].filter(el => el.matches(itemSel)).forEach(el => {
        el.draggable = true;
        el.addEventListener('dragstart', e => { dragEl = el; el.classList.add('dragging'); document.body.classList.add('arranging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', idOf(el)); } catch (er) { void er; /* 일부 브라우저 */ } });
        el.addEventListener('dragend', () => { el.classList.remove('dragging'); document.body.classList.remove('arranging'); clear(); dragEl = null; });
      });
      box.addEventListener('dragover', e => {
        if (!dragEl || !containers.includes(dragEl.parentElement)) return;
        e.preventDefault(); clear();
        const t = e.target.closest(itemSel);
        if (t && t !== dragEl && t.parentElement === box) { const r = t.getBoundingClientRect(); t.classList.add(e.clientX < r.left + r.width / 2 ? 'dropbefore' : 'dropafter'); }
      });
      box.addEventListener('drop', e => {
        if (!dragEl) return; e.preventDefault();
        const t = e.target.closest(itemSel), tsp = box.querySelector(':scope > .tspace');
        if (t && t !== dragEl && t.parentElement === box) { const r = t.getBoundingClientRect(); box.insertBefore(dragEl, e.clientX < r.left + r.width / 2 ? t : t.nextSibling); }
        else if (!t) box.insertBefore(dragEl, tsp || null);
        clear(); save();
      });
    });
  }
  function initArrange() {
    sortable('hdr', [...document.querySelectorAll('#top .hgroup')], 'button');
    document.querySelectorAll('#bottomTabs > button[data-tab]').forEach(b => { b.dataset.sid = 'btab-' + b.dataset.tab; });
    sortable('vtabs', [document.querySelector('#view .vtabs')], 'button');
    sortable('btabs', [document.querySelector('#bottomTabs')], 'button[data-tab]');
  }
  // 새 간편 입력: 윤곽은 소재보다 사방 2mm 작은 부품(측면 2mm 제거), 모따기는 소재 바깥 모서리
  function newSpecFor(kind) {
    const st = P.stock;
    if (kind === 'pocket') return C.newPocketSpec();
    if (kind === 'contour') return C.newMillSpec('contour', { w: Math.max(1, st.sx - 4), h: Math.max(1, st.sy - 4), cr: 0, depth: C.r3(Math.min(10, st.sz / 2)), sideWidth: 2 });
    if (kind === 'chamfer') return C.newMillSpec('chamfer', { w: st.sx, h: st.sy, cr: 0, cw: 0.5 });
    if (kind === 'face') return C.newMillSpec('face', { depth: 0.5 });
    return C.newHoleSpec(kind);
  }
  function addGroup(kind) {
    mutate(() => {
      const label = KIND[kind].label;
      const n = C.newGroup(label + ' ' + (P.groups.filter(g => kindOf(g) === kind).length + 1), P.groups.length);
      n.color = KIND[kind].color;
      n.spec = newSpecFor(kind);
      if (MILL_KINDS.includes(kind)) { // 포켓·윤곽·평면·모따기는 바로 보이도록 소재 중앙에 하나 배치
        const r = C.stockRect(P.stock);
        n.holes.push({ id: C.uid('h'), x: C.r3((r.x0 + r.x1) / 2), y: C.r3((r.y0 + r.y1) / 2) });
      }
      P.groups.push(n); S.sel = { kind: 'group', gid: n.id, hid: null };
    });
    $('#rightBody').scrollTop = 0;
    if (mobile()) { S.mpanel = 'right'; renderAll(); }
  }

  /* ---------------- 오른쪽: 속성 ---------------- */
  function curGroup() { return P.groups.find(g => g.id === S.sel.gid) || null; }
  // [V0.7] 색 타일 위 아이콘 색: 바탕이 밝으면 검정, 어두우면 흰색 (대비 확보)
  function onColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return '#fff';
    const n = parseInt(m[1], 16), f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
    return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.0575) ? '#fff' : '#10151b'; // 검정 쪽은 실제 잉크(#10151b) 기준
  }
  const tile = (icon, cls, color, size, dot) => '<span class="tile ' + (size ? size + ' ' : '') + cls + '"' + (color ? ' style="--k:' + esc(color) + ';--on:' + onColor(color) + '"' : '') + '>' + ico(icon) + (dot ? '<i class="cdot" style="background:' + esc(dot) + '" title="2D 화면 표시 색"></i>' : '') + '</span>';
  function renderProps() {
    if (S.sel.kind === 'group' && !curGroup()) S.sel = { kind: 'stock', gid: null, hid: null };
    const u = U('rt');
    if (S.kindGid !== S.sel.gid) { S.kindOpen = false; S.kindGid = S.sel.gid; } // 다른 가공으로 넘어가면 선택판 닫기 (추가·삭제·되돌리기 포함)
    let head = '', body = '';
    if (S.sel.kind === 'group') {
      const g = curGroup(), k = KIND[kindOf(g)], i = P.groups.indexOf(g);
      head = tile(k.ico, k.cls, null, '', g.color) +
        u.text(g.name, v => mutate(() => { g.name = v.slice(0, 40) || '가공'; }), 'aria-label="가공 이름" maxlength="40"') +
        (DENSE() ? u.color(g.color, v => mutate(() => { g.color = v; })) +
          u.btn('↑', () => mutate(() => { if (i > 0) P.groups.splice(i - 1, 0, P.groups.splice(i, 1)[0]); }), 'ibtn sm', 'title="순서 위로" aria-label="순서 위로" ' + (i ? '' : 'disabled')) +
          u.btn('↓', () => mutate(() => { if (i < P.groups.length - 1) P.groups.splice(i + 1, 0, P.groups.splice(i, 1)[0]); }), 'ibtn sm', 'title="순서 아래로" aria-label="순서 아래로" ' + (i < P.groups.length - 1 ? '' : 'disabled'))
          : u.btn(ico('i-more'), (e, b) => { const r = b.getBoundingClientRect(); groupMenu(g, Math.max(8, r.right - 210), r.bottom + 4); }, 'ibtn sm more', 'title="메뉴: 복사·복제·순서 위/아래·삭제" aria-label="가공 메뉴" aria-haspopup="menu"')) +
        u.btn(ico('i-x'), () => delGroup(g), 'ibtn sm danger', 'title="삭제 (Delete)" aria-label="이 가공 삭제"');
      body = groupBody(u, g);
    } else if (S.sel.kind === 'nc') {
      head = tile('i-nc', 'k-nc') + '<b style="flex:1">원점·NC 출력 설정</b>';
      body = ncBody(u);
    } else {
      head = tile('i-stock', 'k-stock') + '<b style="flex:1">소재·고정</b>';
      body = stockBody(u);
    }
    $('#propHead').innerHTML = head;
    $('#rightBody').innerHTML = body;
  }
  /* [V0.7] 간단히 보기 — 접힌 줄(제목 + 현재 값 요약), 누르면 펼쳐짐
   *  - 오류가 든 구역은 저절로 펼쳐지고(닫아도 다시 펼침), 경고가 든 구역은 줄에 ! 표시
   *  - 설정의 [모두 펼쳐 보기]를 켜면 처음부터 모두 펼침 (예전 화면)
   *  - 같은 종류의 줄은 가공을 바꿔도 펼침 상태를 이어 감 (key 를 가공끼리 같이 씀)
   */
  const DENSE = () => !!DB.settings.dense;
  function acc(key, title, sum, body, defOpen) {
    if (!body) return '';
    const err = /class="fld ferr|class="note error/.test(body), warn = !err && /class="fld fwarn|class="note warn/.test(body);
    if (err) S.keepOpen[key] = true; // 오류를 고치는 순간 줄이 닫혀 입력하던 칸이 사라지지 않게 (다른 항목을 고르면 풀림)
    const open = err || (S.openSec[key] !== undefined ? S.openSec[key] : (!!S.keepOpen[key] || DENSE() || !!defOpen));
    return '<details class="sect2 acc' + (err ? ' haserr' : warn ? ' haswarn' : '') + '" data-sec="' + key + '"' + (err ? ' data-forced="1"' : '') + (open ? ' open' : '') + '><summary><span class="t">' + title + '</span>' +
      (err ? '<span class="am err" title="오류가 있어 펼쳤습니다">!</span>' : warn ? '<span class="am warn" title="경고가 있습니다 — 눌러서 확인">!</span>' : '') +
      '<span class="v">' + (sum || '') + '</span></summary><div class="accb">' + body + '</div></details>';
  }
  function stockBody(u) {
    const st = P.stock;
    const matOpts = Object.keys(C.MATERIALS).map(k => [k, C.MATERIALS[k].label]);
    let h = '<h3>소재</h3>';
    h += u.fld('재질', u.select(st.material, matOpts, v => mutate(() => { st.material = v; })), '재질에 따라 회전수·이송·절입이 자동 계산됩니다');
    h += '<div class="grid3" style="margin-top:8px">' +
      u.fld('가로 X (mm)', u.num(st.sx, v => mutate(() => { st.sx = v; }))) +
      u.fld('세로 Y (mm)', u.num(st.sy, v => mutate(() => { st.sy = v; }))) +
      u.fld('두께 Z (mm)', u.num(st.sz, v => mutate(() => { st.sz = v; }))) + '</div>';
    h += '<h3>공작물 원점</h3><div class="grid2">' +
      u.fld('원점 위치 (X0 Y0)', u.select(st.origin, Object.keys(C.ORIGIN_LABEL).map(k => [k, C.ORIGIN_LABEL[k]]), v => changeOrigin(v))) +
      u.fld('하부 여유 (패럴렐 틈, mm)', u.num(st.under, v => mutate(() => { st.under = v; })), '관통 가공 시 소재 아래로 들어갈 수 있는 깊이') + '</div>';
    h += '<div class="opinfo">Z0 = 소재 윗면입니다. 공구 길이 보정 후 소재 윗면에 Z0 을 맞추세요. 관통 가공이 하부 여유보다 깊으면 차단됩니다.</div>';
    let c = '';
    if (!P.clamps.length) c += '<small>클램프가 없습니다. 2D 화면의 [클램프] 도구(⋯ 안)로 드래그하거나 아래 버튼으로 추가하세요. 공구 경로가 클램프에 닿으면 차단됩니다.</small>';
    else {
      c += '<div class="tblwrap"><table class="tbl"><tr><th>#</th><th>X</th><th>Y</th><th>폭</th><th>길이</th><th>높이</th><th></th></tr>';
      P.clamps.forEach((cl, i) => {
        c += '<tr><td>' + (i + 1) + '</td><td>' + u.num(cl.x, v => mutate(() => { cl.x = v; })) + '</td><td>' + u.num(cl.y, v => mutate(() => { cl.y = v; })) + '</td><td>' + u.num(cl.w, v => mutate(() => { cl.w = v; })) + '</td><td>' + u.num(cl.h, v => mutate(() => { cl.h = v; })) + '</td><td>' + u.num(cl.height, v => mutate(() => { cl.height = v; })) + '</td><td>' + u.btn('✕', () => mutate(() => { P.clamps.splice(i, 1); }), 'sm danger', 'title="클램프 삭제" aria-label="클램프 삭제"') + '</td></tr>';
      });
      c += '</table></div><small>높이 = 소재 윗면(Z0) 기준 클램프 최고 높이. 초기점은 클램프보다 ' + C.CLAMP_MARGIN + 'mm 이상 높아야 합니다.</small>';
    }
    c += '<div class="row" style="margin-top:8px">' + u.btn(ico('i-plus') + '클램프 추가', () => mutate(() => { const r = C.stockRect(P.stock); P.clamps.push({ id: C.uid('c'), x: r.x0 - 10, y: (r.y0 + r.y1) / 2 - 10, w: 20, h: 20, height: 30 }); S.openSec.clamps = true; }), 'sm') + '</div>';
    h += '<div style="height:14px"></div>' + acc('clamps', '클램프·금지 영역', P.clamps.length ? P.clamps.length + '개' : '없음', c, P.clamps.length > 0);
    return h;
  }
  function ncBody(u) {
    const set = P.settings;
    let h = '<h3>프로그램</h3><div class="grid2">' +
      u.fld('프로그램 번호 O', u.int(P.programNo, v => mutate(() => { P.programNo = v; }), 'min="1" max="9999"')) +
      u.fld('공작물 좌표계', u.select(set.wcs, ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].map(x => [x, x]), v => mutate(() => { set.wcs = v; }))) + '</div>';
    h += '<h3>높이 (Z)</h3><div class="grid2">' +
      u.fld('초기점 Z (안전 높이, mm)', u.num(set.initialZ, v => mutate(() => { set.initialZ = v; })), '공구 교환 후 접근·구멍 사이 이동 높이 (클램프보다 높게)') +
      u.fld('구멍 사이 이동 높이', u.select(set.retract, [['G98', '초기점까지 올림 (G98, 안전)'], ['G99', 'R점까지만 올림 (G99, 빠름)']], v => mutate(() => { set.retract = v; }))) + '</div>';
    h += '<div class="opinfo">초기점 Z 와 R점은 다릅니다. <b>초기점</b>은 이동용 안전 높이, <b>R점</b>은 각 공정에서 절삭 이송을 시작하는 높이(소재 윗면 위 몇 mm)입니다. R점은 각 가공의 공정에서 정해집니다.</div><div style="height:14px"></div>';
    const ord = '<div class="grid2">' +
      u.fld('공정 순서', u.select(set.toolOrder, [['tool', '공구 교환 최소화'], ['group', '가공 목록 순서대로']], v => mutate(() => { set.toolOrder = v; }))) +
      u.fld('깊이 기준', u.select(set.depthRef === 'auto' ? 'auto' : 'top', [['auto', '먼저 가공된 바닥 기준 (자동, 권장)'], ['top', '항상 소재 윗면 Z0 기준']], v => mutate(() => { set.depthRef = v; })), set.depthRef === 'auto' ? '포켓 안 구멍·포켓 안 포켓·평면 뒤 가공은 그 바닥에서부터 깊이를 재고, 이미 깎인 높이에서 시작합니다 (빈 공간 공회전 없음)' : '모든 깊이를 원래 윗면(Z0)에서 잽니다 (V0.4 이전 방식)') +
      u.fld('구멍 순서', u.select(set.pathOrder, [['nearest', '최단 거리(근사)'], ['zigzag', '지그재그(행)'], ['input', '입력 순서']], v => mutate(() => { set.pathOrder = v; }))) + '</div>';
    h += acc('nc-order', '순서·깊이 기준', (set.toolOrder === 'tool' ? '교환 최소' : '목록 순서') + ' · ' + (set.depthRef === 'auto' ? '바닥 자동' : 'Z0 기준'), ord, false);
    const out = u.check(set.coolant, v => mutate(() => { set.coolant = v; }), '절삭유 M08/M09') + u.check(set.m01, v => mutate(() => { set.m01 = v; }), '공구 교환 전 선택 정지 M01') +
      u.check(set.seqNo, v => mutate(() => { set.seqNo = v; }), '시퀀스 번호(N) 출력' + (set.restart ? ' (재시작 블록을 쓰면 꺼짐)' : '')) +
      u.check(set.restart, v => mutate(() => { set.restart = v; }), '공구별 재시작 블록 (N100·N200… — 공구가 부러지면 그 공구부터 다시)');
    h += acc('nc-out', '출력 옵션', [set.coolant ? '절삭유' : '', set.m01 ? 'M01' : '', set.seqNo ? 'N번호' : '', set.restart ? '재시작 블록' : ''].filter(Boolean).join(' · ') || '없음', out, false);
    // [V0.6] 첫 가공 모드 · 머신 좌표
    const first = u.check(set.firstRun, v => mutate(() => { set.firstRun = v; }), '첫 가공 모드 — 공정마다 진입 전 M00 정지, 절삭 이송 낮춤') +
      (set.firstRun ? u.fld('첫 가공 절삭 이송 (%)', u.num(set.firstFeed, v => mutate(() => { set.firstFeed = Math.max(10, Math.min(100, Math.round(v))); }), 'min="10" max="100"'), '탭은 동기 이송이라 그대로 (오버라이드 100%)') : '') +
      '<div class="grid2">' + u.fld('G54 Z (머신 좌표, 선택)', u.optnum(set.g54Z, v => mutate(() => { set.g54Z = v === null ? null : Math.min(0, v); })), '장비의 공작물 좌표계 Z 값. 공구 H 측정값과 함께 Z 행정(오버트래블)을 검사') + '<span></span></div>' +
      '<small>첫 가공 순서: ① 첫 가공 모드 NC 로 Z를 띄운 드라이런 → ② 싱글 블록 → ③ 시편 가공·측정 → ④ 관리자가 그 가공 종류를 승인.</small>';
    h += acc('nc-first', '첫 가공 <small>(실장비 확인)</small>', set.firstRun ? '첫 가공 모드 켜짐 · 이송 ' + set.firstFeed + '%' : '꺼짐', first, !!set.firstRun);
    return h;
  }
  function changeOrigin(v) {
    const st = P.stock;
    if (v === st.origin) return;
    const a = C.stockRect(st), b = C.stockRect(Object.assign({}, st, { origin: v }));
    const hasItems = P.groups.some(g => g.holes.length) || P.clamps.length;
    const keep = hasItems ? confirm('원점을 바꿉니다.\n[확인] 구멍·포켓·클램프를 소재 위 같은 위치에 유지 (좌표 자동 변환)\n[취소] 좌표값 그대로 유지') : false;
    mutate(() => {
      st.origin = v;
      if (keep) {
        const dx = b.x0 - a.x0, dy = b.y0 - a.y0;
        P.groups.forEach(g => g.holes.forEach(hh => { hh.x = C.r3(hh.x + dx); hh.y = C.r3(hh.y + dy); }));
        P.clamps.forEach(c => { c.x = C.r3(c.x + dx); c.y = C.r3(c.y + dy); });
      }
      S.view.fitted = false;
    });
  }

  /* ---------------- 가공 그룹 속성 ---------------- */
  function groupBody(u, g) {
    FLD = { g, u, used: new Set(), list: S.V.issues.filter(i => i.ref && i.ref.gid === g.id && (i.level === 'error' || i.level === 'warn')) };
    try { return groupBody0(u, g); } finally { FLD = null; }
  }
  /* [V0.7] 순서: 가공 방법(칩) → 기본 치수 → (오류·없는 공구) → 위치 → 옵션 → 깊이 단면도 → 자동 구성된 공정 → 고급
   * 처음에는 기본 치수만 보이고, 나머지는 접힌 줄(현재 값 요약)로 둔다.
   */
  function groupBody0(u, g) {
    const mode = kindOf(g), dense = DENSE(), isMill = MILL_KINDS.includes(mode), k = KIND[mode];
    const grid = '<div class="kindgrid" role="radiogroup" aria-label="가공 방법">' +
      ['drill', 'tap', 'pocket', 'contour', 'face', 'chamfer', 'ream', 'bore', 'custom'].map(x => u.btn('<span class="tile">' + ico(KIND[x].ico) + '</span><span>' + (x === 'custom' ? '직접 구성' : KIND[x].label) + '</span>', () => { S.kindOpen = false; setGroupMode(g, x); renderProps(); }, (mode === x ? 'on ' : '') + KIND[x].cls, 'role="radio" aria-checked="' + (mode === x) + '"')).join('') + '</div>';
    let h = dense ? '<h3>가공 방법</h3>' + grid
      : '<div class="kindbar"><span class="kl">가공 방법</span>' + u.btn('<span class="tile sm ' + k.cls + '">' + ico(k.ico) + '</span><b>' + (mode === 'custom' ? '직접 구성' : k.label) + '</b>' + ico('i-chev', 'car' + (S.kindOpen ? ' up' : '')), () => { S.kindOpen = !S.kindOpen; renderProps(); }, 'kindchip' + (S.kindOpen ? ' on' : ''), 'aria-expanded="' + !!S.kindOpen + '" title="가공 방법 바꾸기 (구멍·탭·포켓…)"') + '</div>' + (S.kindOpen ? grid : '');
    const F = mode === 'pocket' ? pocketForm(u, g) : mode === 'contour' ? contourForm(u, g) : mode === 'face' ? faceForm(u, g) : mode === 'chamfer' ? chamferForm(u, g) : g.spec ? specForm(u, g) : null;
    // 위치가 하나뿐이면 기본 치수 바로 아래에서 X·Y 입력 (형상 가공은 대부분 한 곳)
    const single = g.holes.length === 1 && mode !== 'face', h1 = g.holes[0];
    const top = single && (dense || isMill) ? '<div class="grid2 toppos">' + u.fld((isMill ? '기준점(중심) ' : '위치 ') + 'X', u.num(h1.x, v => mutate(() => { h1.x = C.r3(v); }))) + u.fld((isMill ? '기준점(중심) ' : '위치 ') + 'Y', u.num(h1.y, v => mutate(() => { h1.y = C.r3(v); }))) + '</div>' : '';
    const gp = F ? genParts(u, g, F.res) : null;
    const MARK = '\u0001alerts\u0001'; // 오류·경고 자리 (아래 입력칸을 다 그린 뒤, 어느 칸에도 붙지 않은 것을 여기에 모아 보여 줌)
    if (F) h += '<div class="basic wiz">' + F.basic + top + '</div>' + MARK;
    else h += customForm(u, g) + top + MARK;
    // 위치 (구멍 가공: 처음부터 펼침 / 형상 가공: 한 곳이면 접힘)
    if (mode !== 'face') {
      let p = '<div class="subtabs">' + [['single', '개별'], ['line', '직선'], ['grid', '사각 배열'], ['pcd', '원형(PCD)']].map(x => u.btn(x[1], () => { S.arrKind = x[0]; renderProps(); }, 'sm' + (S.arrKind === x[0] ? ' on' : ''))).join('') + '</div>' + arrayForm(u, g);
      if (g.holes.length) {
        const lim = 300, z = S.gz.get(g.id);
        let tb = '<div class="tblwrap" style="margin-top:8px"><table class="tbl"><tr><th>#</th><th>X</th><th>Y</th><th title="가장 깊은 공구 끝">바닥 Z</th><th></th></tr>';
        g.holes.slice(0, lim).forEach((hh, i) => {
          tb += '<tr class="' + (S.sel.hid === hh.id ? 'sel' : '') + '"><td>' + u.btn(String(i + 1), () => { S.sel.hid = hh.id; renderAll(); }, 'sm', 'title="화면에서 선택"') + '</td><td>' + u.num(hh.x, v => mutate(() => { hh.x = C.r3(v); })) + '</td><td>' + u.num(hh.y, v => mutate(() => { hh.y = C.r3(v); })) + '</td><td class="num">' + (z === null || z === undefined ? '-' : uf(z)) + '</td><td>' + u.btn('✕', () => mutate(() => { g.holes.splice(i, 1); }), 'sm danger', 'title="삭제" aria-label="위치 삭제"') + '</td></tr>';
        });
        tb += '</table></div>' + (g.holes.length > lim ? '<small>처음 ' + lim + '개만 표시 (화면에서 선택·편집 가능)</small>' : '');
        tb += '<div class="row" style="margin-top:6px">' + u.btn('위치 전체 삭제', () => { if (confirm('위치 ' + g.holes.length + '개를 모두 삭제할까요?')) mutate(() => { g.holes = []; }); }, 'sm danger') + '</div>';
        // [V0.7] 위치가 많으면(4개 이상) 표는 한 줄로 접어 둠 — 화면에서 위치를 골랐으면 펼침
        const many = g.holes.length > 3 && !dense, lopen = S.openSec['pos-list'] !== undefined ? S.openSec['pos-list'] : !!S.sel.hid;
        p += many ? '<details class="sublist" data-sec="pos-list"' + (lopen ? ' open' : '') + '><summary>위치 목록 <b>' + g.holes.length + '</b>개 <small>(눌러서 보기·고치기)</small></summary>' + tb + '</details>' : tb;
      } else p += '<div class="note warn">위치가 없습니다. 위 입력란을 쓰거나 2D 화면의 [위치 추가] 도구로 클릭하세요.</div>';
      h += acc(isMill ? 'pos-m' : 'pos-h', isMill ? '위치 <small>(같은 모양을 여러 곳에)</small>' : '구멍 위치', g.holes.length + '개' + (single ? ' · X' + uf(h1.x) + ' Y' + uf(h1.y) : ''), p, isMill ? g.holes.length !== 1 : true);
    }
    if (F) h += acc('opt', '옵션', esc(F.optSum), F.opt, false);
    const rn = refNote(g), diag = depthDiagram(g), z = S.gz.get(g.id);
    h += acc('dd', '깊이 단면도 <small>(Z값)</small>', z === null || z === undefined ? '' : '바닥 Z' + uf(z), diag, false);
    const colorFld = dense ? '' : '<div class="grid2">' + u.fld('표시 색 (화면·목록)', u.color(g.color, v => mutate(() => { g.color = v; }))) + '<span></span></div>';
    if (F) {
      h += acc('gen', '자동 구성된 공정', esc(gp.sum), gp.rows, false);
      h += acc('adv', '고급 설정', esc(F.advSum), F.adv + gp.edit + colorFld, false);
    } else if (colorFld) h += acc('adv', '고급 설정', '', colorFld, false);
    // [V0.7] 접힌 줄 때문에 오류가 가려지지 않도록: 입력칸에 붙지 않은 이 가공의 오류·경고를 기본 치수 바로 아래에 모음
    const seen = new Set(), left = [];
    FLD.list.filter(i => !FLD.used.has(i)).sort((a, b) => (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1)).forEach(i => { const t = i.msg.replace(/^\[[^\]]*\]\s*(공정 \d+ \([^)]*\):\s*)?/, ''); if (!seen.has(t)) { seen.add(t); left.push({ level: i.level, t }); } });
    const usedMsg = [...FLD.used].map(i => i.msg);
    const hk = t => t.replace(/^\[[^\]]*\]\s*(공정 \d+ \([^)]*\):\s*)?/, '').replace(/[^가-힣]/g, '').slice(0, 10); // 숫자·단위를 뺀 앞 10글자로 같은 오류인지 판정
    const usedKey = usedMsg.map(hk);
    const notes = gp ? gp.noteList.filter(n => !usedMsg.some(m => m.includes(n.msg)) && !usedKey.includes(hk(n.msg))).map(n => n.html).join('') + gp.alerts : '';
    let al = notes ? '<div class="alerts">' + notes + '</div>' : '';
    if (left.length) al += '<div class="alerts">' + left.slice(0, 4).map(i => '<div class="note ' + i.level + '">' + (i.level === 'error' ? '✖ ' : '⚠ ') + esc(i.t) + '</div>').join('') +
      (left.length > 4 ? '<div class="row" style="margin-top:6px">' + u.btn('외 ' + (left.length - 4) + '건 — 검증 결과 열기', () => openDrawer('check'), 'sm') + '</div>' : '') + '</div>';
    return h.replace(MARK, () => al + rn); // 먼저 가공된 바닥 기준 안내(실제 끝 Z)는 항상 보임
  }
  function setGroupMode(g, mode) {
    const cur = kindOf(g);
    if (mode === cur) return;
    if (mode === 'custom') { mutate(() => { g.spec = null; }); return; }
    if (!g.spec && g.ops.length && !confirm('직접 구성한 공정 ' + g.ops.length + '개를 지우고 간편 입력으로 다시 구성할까요?')) return;
    if (mode === 'face' && g.holes.length > 1 && !confirm('평면 가공은 위치가 1개뿐입니다. 나머지 위치 ' + (g.holes.length - 1) + '개를 지울까요?')) return;
    mutate(() => {
      const old = g.spec;
      g.spec = newSpecFor(mode); if (g.color === KIND[cur].color || g.color === OLD_COLOR[cur]) g.color = KIND[mode].color;
      // 포켓·윤곽·모따기 사이 전환은 형상(모양·크기·도면 형상)을 그대로 이어받음
      if (old && ['pocket', 'contour', 'chamfer'].includes(old.kind) && ['pocket', 'contour', 'chamfer'].includes(mode)) ['shape', 'w', 'h', 'cr', 'dia', 'sides', 'rot', 'poly'].forEach(k => { if (old[k] !== undefined) g.spec[k] = C.clone(old[k]); });
      if (MILL_KINDS.includes(mode) && !g.holes.length) { const r = C.stockRect(P.stock); g.holes.push({ id: C.uid('h'), x: C.r3((r.x0 + r.x1) / 2), y: C.r3((r.y0 + r.y1) / 2) }); }
      if (mode === 'face' && g.holes.length > 1) g.holes = g.holes.slice(0, 1);
    });
  }
  // 자동 구성 결과를 나눠서 돌려줌: rows(공정 목록 + 참고 안내) / alerts(오류·경고·없는 공구 — 항상 보임) / sum(요약) / edit(공정 상세 편집)
  function genParts(u, g, res) {
    const m = machine(), tm = C.toolMap(m);
    let rows = DENSE() ? '<b>자동 구성된 공정</b>' : '', alerts = '', info = '';
    if (!g.ops.length) rows += '<div class="opinfo">공정이 없습니다.</div>';
    g.ops.forEach((op, i) => {
      const t = tm.get(op.toolNo), d = t ? C.opDepth(op, t, P.stock) : null, c = C.opConditions(op, t, P.stock.material, m);
      const col = t ? (TOOL_BAND[t.type] || '#64748b') : '#64748b';
      const extra = op.type === 'pocketRough' ? ' · 절입 ' + op.stepdown + ' · 간격 ' + op.stepover + '% · 벽 ' + op.allowWall + ' · 바닥 ' + op.allowFloor
        : op.type === 'contourRough' ? ' · 절입 ' + op.stepdown + ' · 벽 ' + op.allowWall + (op.sideWidth > 0 ? ' · 측면 ' + op.sideWidth : '')
          : op.type === 'pocketSemi' ? ' · ' + (op.semiStep > 0 ? op.semiStep + 'mm씩' : '한 번에') + ' · 벽 ' + op.allowWall + '→' + op.leaveWall + ' · 바닥 ' + op.allowFloor + '→' + op.leaveFloor
          : op.type === 'pocketFloor' ? ' · 바닥 ' + op.allowFloor + '→0 (벽 ' + op.allowWall + ' 유지)'
          : op.type === 'pocketWall' ? ' · 벽 ' + op.allowWall + '→0' + (op.wallStep > 0 ? ' · ' + op.wallStep + 'mm씩' : ' · 한 번에')
          : op.type === 'pocketProfile' ? ' · 구배 ' + op.draft + '° · 입구 R' + op.topR + ' · 바닥 R' + op.floorR + ' · 계단 ' + op.profStep
          : op.type === 'pocketFinish' || op.type === 'contourFinish' ? ' · 여유 0' : op.type === 'faceMill' ? ' · 절입 ' + op.stepdown + ' · 간격 ' + op.stepover + '%'
            : op.type === 'chamferMill' ? ' · C' + op.cw : (op.q && C.OPS.get(op.type).ui.q ? ' · Q' + op.q : '');
      rows += '<div class="genrow"><span class="num" style="background:' + col + ';color:' + onColor(col) + '">' + (i + 1) + '</span><span class="nm">' + esc(C.opLabel(op, m)) + '</span><small>' + (d ? '끝 Z' + uf(d.z) + ' · ' : '') + 'S' + c.rpm + ' F' + c.feed + extra + '</small></div>';
    });
    const noteList = []; // 오류·경고 안내 (입력칸 아래에 이미 같은 말이 붙었으면 groupBody0 에서 뺌)
    res.notes.forEach(n => { const s = '<div class="note ' + n.level + '">' + (n.level === 'error' ? '✖ ' : n.level === 'warn' ? '⚠ ' : 'ℹ ') + esc(n.msg) + '</div>'; if (n.level === 'info') info += s; else noteList.push({ msg: n.msg, html: s }); });
    res.missing.forEach(mm => {
      const lbl = mm.type === 'tap' ? '탭 M' + mm.dia + '×' + mm.pitch : mm.type === 'center' ? '센터 드릴' : mm.type === 'endmill' ? '평 엔드밀 Ø' + mm.dia : mm.type === 'facemill' ? '페이스밀 Ø' + mm.dia : mm.type === 'chamfer' ? '모따기 공구 Ø' + mm.dia + ' 90°' : '드릴 Ø' + mm.dia;
      alerts += '<div class="row" style="margin-top:6px">' + u.btn(ico('i-plus') + '공구 추가: ' + lbl, () => {
        let added = null;
        dbChange(() => { added = C.addMissingTool(m, mm); if (m.verified || m.approvals.length) { C.revoke(m, '공구 추가'); toast('장비 공구가 바뀌어 실가공 검증 승인이 해제되었습니다.', 'warn'); } });
        if (added) toast('T' + added.no + ' 공구를 추가했습니다. 날 길이·재질을 [장비·공구]에서 확인하세요.', 'ok');
      }, 'sm primary') + '</div>';
    });
    const tools = [...new Set(g.ops.map(o => o.toolNo))];
    const eopen = !!S.openSec['adv-' + g.id];
    if (FLD && !eopen) FLD.off = true;
    let cards; try { cards = opCards(u, g.ops, fn => { mutate(() => { fn(); g.spec = null; }); toast('직접 구성으로 전환했습니다.', 'warn'); }); } finally { if (FLD) FLD.off = false; }
    const edit = '<details class="adv" data-sec="adv-' + g.id + '"' + (eopen ? ' open' : '') + '><summary>공정 상세 편집</summary><small>여기서 바꾸면 이 가공은 "직접 구성"으로 전환됩니다.</small>' + cards + '</details>';
    return { rows: '<div class="gen">' + rows + info + '</div>', noteList, alerts, sum: g.ops.length ? g.ops.length + '단계 · ' + tools.map(t => 'T' + t).join(' ') : '공정 없음', edit };
  }
  /* ---------- [V0.7] 간편 입력 양식: 기본(항상 보임) / 옵션(한 번 눌러 펼침) / 고급 으로 나눠 돌려줌 ----------
   * { basic, opt, optSum, adv, advSum, res }  res = 자동 구성 결과 (공정·안내·없는 공구)
   */
  const thruFld = (u, sp, set, label) => '<div class="fld"><span>' + (label || '관통') + '</span><div class="row">' + u.check(sp.thru, set(v => { sp.thru = v; }), '끝까지 뚫기') + '</div></div>' +
    (sp.thru ? u.fld('관통 여유 (mm)', u.num(sp.brk, set(v => { sp.brk = v; })), '끝까지 뚫을 때 소재 아래로 더 내려가는 거리. 소재 아래 받침 틈(하부 여유)보다 작아야 합니다') : '');
  // 구멍 / 탭 / 리머 / 보링
  function specForm(u, g) {
    const sp = g.spec, m = machine();
    const set = fn => v => mutate(() => { fn(v); });
    let basic = '', opt = '', note = '';
    const cycSel = u.fld((sp.kind === 'drill' ? '' : '밑구멍 ') + '드릴 사이클', u.select(sp.cycle, [['auto', '자동 (깊이/지름 비율)'], ['drill', 'G81 일반'], ['peck', 'G73 고속 펙 (칩 끊기)'], ['deep', 'G83 심공 (완전 후퇴)']], set(v => { sp.cycle = v; })));
    const center = u.check(sp.center, set(v => { sp.center = v; }), '센터 드릴 먼저 (자리 표시)');
    if (sp.kind === 'tap') {
      const opts = C.threadList().map(t => [t.d + '|' + t.p, t.label]);
      const cur = sp.tapD + '|' + sp.tapP;
      if (!opts.some(o => o[0] === cur)) opts.unshift([cur, 'M' + sp.tapD + '×' + sp.tapP + ' (사용자)']);
      const rec = C.tapDrill(sp.tapD, sp.tapP);
      basic = '<div class="grid2">' + u.fld('나사 규격', u.select(cur, opts, v => mutate(() => { const a = v.split('|'); sp.tapD = parseFloat(a[0]); sp.tapP = parseFloat(a[1]); }))) +
        u.fld(sp.thru ? '탭 깊이 (관통)' : '탭 끝 깊이 (mm)', u.num(sp.tapDepth, set(v => { sp.tapDepth = v; }), sp.thru ? 'disabled' : ''), '탭 끝 기준 깊이입니다. 도면의 완전 나사 깊이가 기준이면 2~3피치(' + C.r3(2 * sp.tapP) + '~' + C.r3(3 * sp.tapP) + 'mm)를 더해 입력하세요.') + thruFld(u, sp, set) + '</div>';
      opt = center + '<div class="grid2">' + u.fld('탭 방식', u.select(sp.tapMode, [['auto', '자동' + (m.rigidTap ? ' (리지드)' : ' (일반)')], ['rigid', '리지드 탭 (M29)'], ['tap', '일반 탭 (홀더)']], set(v => { sp.tapMode = v; }))) + cycSel + '</div>';
      note = '피치 <b>' + sp.tapP + '</b> · 기초 드릴 추천 <b>Ø' + (rec ? rec.dia : '-') + '</b> · 탭 이송 F = S × ' + sp.tapP + ' (자동)';
    } else if (sp.kind === 'ream' || sp.kind === 'bore') {
      const ft = [...new Set(m.tools.filter(t => t.type === (sp.kind === 'ream' ? 'reamer' : 'boring')).map(t => t.dia))].sort((a, b) => a - b);
      basic = '<div class="grid2">' + u.fld(sp.kind === 'ream' ? '완성 지름 Ø (H7 등)' : '보링 지름 Ø (mm)', u.num(sp.dia, set(v => { sp.dia = v; }))) +
        u.fld(sp.thru ? '깊이 (관통)' : '깊이 (완성 지름 부분, mm)', u.num(sp.depth, set(v => { sp.depth = v; }), sp.thru ? 'disabled' : '')) + thruFld(u, sp, set) + '</div>';
      if (ft.length) basic += '<div class="chips"><small>보유 ' + (sp.kind === 'ream' ? '리머' : '보링 바') + '</small>' + ft.map(d => u.btn('Ø' + d, () => mutate(() => { sp.dia = d; }), 'sm chip' + (d === sp.dia ? ' on' : ''))).join('') + '</div>';
      opt = center + '<div class="grid2">' + (sp.kind === 'bore' && m.g76 !== false ? u.fld('G76 날 빼기 Q (mm)', u.num(sp.q, set(v => { sp.q = v; }))) : '') + cycSel + '</div>';
      note = sp.kind === 'ream'
        ? '순서: 센터 → 밑구멍 드릴(지름 −0.2~0.4) → <b>리머 G85</b> (이송으로 들어가고 이송으로 나옴). 첫 구멍은 핀 게이지로 확인하세요.'
        : '순서: 센터 → 밑구멍(드릴, 없으면 원형 포켓) → <b>' + (m.g76 !== false ? 'G76 정밀 보링</b>. 날을 떼는 방향은 장비 파라미터와 보링 바 날 방향을 맞추세요.' : 'G86 보링</b> (장비 G76 미지원 — 복귀 자국 주의)');
    } else {
      const drills = [...new Set(m.tools.filter(t => t.type === 'drill').map(t => t.dia))].sort((a, b) => a - b);
      basic = '<div class="grid2">' + u.fld('구멍 지름 Ø (mm)', u.num(sp.dia, set(v => { sp.dia = v; }))) +
        u.fld(sp.thru ? '깊이 (관통)' : '깊이 (mm)', u.num(sp.depth, set(v => { sp.depth = v; }), sp.thru ? 'disabled' : '')) + thruFld(u, sp, set) + '</div>';
      if (drills.length) basic += '<div class="chips"><small>보유 드릴</small>' + drills.map(d => u.btn('Ø' + d, () => mutate(() => { sp.dia = d; }), 'sm chip' + (d === sp.dia ? ' on' : ''))).join('') + '</div>';
      opt = center + '<div class="grid2">' + (sp.thru ? '' : u.fld('깊이 기준', u.select(sp.depthMode, [['full', '유효 깊이 (직경부)'], ['tip', '드릴 끝']], set(v => { sp.depthMode = v; })))) + cycSel + '</div>';
    }
    if (note) opt += '<div class="opinfo">' + note + '</div>';
    const optSum = (sp.center ? '센터 드릴' : '센터 없음') + (sp.kind === 'tap' ? ' · ' + (sp.tapMode === 'auto' ? (m.rigidTap ? '리지드' : '일반 탭') : sp.tapMode === 'rigid' ? '리지드' : '일반 탭') : '') + ' · 사이클 ' + (sp.cycle === 'auto' ? '자동' : C.OP_TYPES[sp.cycle].code);
    return { basic, opt, optSum, adv: '', advSum: '', res: C.planHoleSpec(sp, m, P.stock) };
  }
  // 포켓
  function pocketForm(u, g) {
    const sp = g.spec, m = machine();
    const set = fn => v => mutate(() => { fn(v); });
    const prof = sp.draft > 0 || sp.topR > 0 || sp.floorR > 0;
    const basic = shapeFields(u, sp, '포켓') + '<div class="grid2" style="margin-top:8px">' + u.fld(sp.thru ? '깊이 (관통: 두께 + 여유)' : '깊이 (mm)', u.num(sp.depth, set(v => { sp.depth = v; }), sp.thru ? 'disabled' : '')) + thruFld(u, sp, set) + '</div>';
    const ems = m.tools.filter(t => t.type === 'endmill').sort((a, b) => a.no - b.no);
    const entryTxt = sp.entry === 'drill' ? '선가공 구멍' : sp.entry === 'ramp' ? '램프' : m.helical === false ? '중심 수직' : '헬리컬';
    // 가공 단계: 칩을 누르면 켜고 끔 (황삭 → 중삭 → 정삭)
    const stg = (on, label, sub, fn, key) => u.btn(label + '<small>' + sub + '</small>', fn, 'stg' + (on ? ' on' : ''), 'role="switch" aria-checked="' + !!on + '" data-stg="' + key + '" title="눌러서 켜기/끄기"');
    const finTxt = !sp.finish ? '안 함' : prof ? '바닥 + 측벽 형상' : sp.finishMode === 'split' ? [sp.finishFloor !== false ? '바닥' : '', sp.finishWall !== false ? '측벽' : ''].filter(Boolean).join(' → ') || '선택 없음' : '한 번에';
    let opt = '<div class="grid2">' + u.fld('공구', u.select(sp.toolNo, [[0, '자동 선택 (권장)']].concat(ems.map(t => [t.no, C.toolLabel(t)])), set(v => { sp.toolNo = parseInt(v, 10) || 0; }))) +
      u.fld('진입 방식', u.select(sp.entry || 'helix', [['helix', '헬리컬 (돌면서 천천히, 권장)'], ['ramp', '램프 (경로 따라 3° 경사)'], ['drill', '선가공 구멍 (드릴 후 수직 진입)']], set(v => { sp.entry = v; })), sp.entry === 'drill' ? '진입점에 드릴 구멍을 먼저 뚫습니다 (센터 → 드릴 자동 추가)' : sp.entry === 'ramp' ? '좁은 포켓에서 헬리컬 공간이 없을 때' : '깎이지 않은 소재로 곧장 내려가지 않습니다') + '</div>' +
      '<div class="fld" style="margin-top:10px"><span>가공 단계 <small>(눌러서 켜고 끔)</small></span><div class="stages">' +
      stg(sp.rough, '① 황삭', '벽 ' + sp.allowWall + ' · 바닥 ' + sp.allowFloor + ' 남김', () => mutate(() => { sp.rough = !sp.rough; }), 'rough') + '<i class="arr">→</i>' +
      stg(sp.semi, '② 중삭', sp.semi ? (sp.semiStep > 0 ? sp.semiStep + 'mm씩' : '한 번에') : '안 함', () => mutate(() => { sp.semi = !sp.semi; }), 'semi') + '<i class="arr">→</i>' +
      stg(sp.finish, '③ 정삭', finTxt, () => mutate(() => { sp.finish = !sp.finish; }), 'finish') + '</div>' +
      (sp.finish && !prof ? '<div class="row wrap">' + u.select(sp.finishMode || 'both', [['split', '정삭: 바닥·측벽 따로'], ['both', '정삭: 바닥+측벽 한 번에']], set(v => { sp.finishMode = v; })) +
        (sp.finishMode === 'split' ? u.check(sp.finishFloor !== false, set(v => { sp.finishFloor = v; }), '바닥 정삭') + u.check(sp.finishWall !== false, set(v => { sp.finishWall = v; }), '측벽 정삭') : '') + '</div>' : '') + '</div>';
    const optSum = (sp.toolNo ? 'T' + sp.toolNo : '공구 자동') + ' · ' + entryTxt + ' · ' + [sp.rough ? '황삭' : '', sp.semi ? '중삭' : '', sp.finish ? '정삭' : ''].filter(Boolean).join('→');
    let adv = '<h4>절삭 설정</h4><div class="grid2">' +
      u.fld('경로 간격 (공구 지름 %)', u.num(sp.stepover, set(v => { sp.stepover = v; }), 'min="10" max="' + C.STEPOVER_MAX + '"'), '10~' + C.STEPOVER_MAX + '%. 클수록 빠르지만 공구 부하가 큽니다 (권장 40~50%)') +
      u.fld('1회 절입 (mm, 0=자동)', u.num(sp.stepdown, set(v => { sp.stepdown = v; })), '0 이면 재질·공구 지름으로 자동 계산') +
      u.fld('황삭 측벽 남김 (mm)', u.num(sp.allowWall, set(v => { sp.allowWall = v; })), '황삭 뒤 남길 벽 두께 (예 0.2)') +
      u.fld('황삭 바닥 남김 (mm)', u.num(sp.allowFloor, set(v => { sp.allowFloor = v; })), '황삭 뒤 남길 바닥 두께 (예 0.1)') + '</div>' +
      (sp.semi ? '<div class="grid3">' + u.fld('중삭 단 깊이 (mm)', u.num(sp.semiStep, set(v => { sp.semiStep = Math.max(0, v); })), '0 = 한 번에 (전체 높이), 0.5·1 = 그만큼씩 내려가며') + u.fld('중삭 측벽 남김', u.num(sp.semiWall, set(v => { sp.semiWall = v; }))) + u.fld('중삭 바닥 남김', u.num(sp.semiFloor, set(v => { sp.semiFloor = v; }))) + '</div>' : '') +
      (sp.finish && !prof && sp.finishMode === 'split' && sp.finishWall !== false ? '<div class="grid2">' + u.fld('측벽 정삭 단 깊이 (mm)', u.num(sp.wallStep, set(v => { sp.wallStep = Math.max(0, v); })), '0 = 한 번에, 깊은 포켓은 2~5mm 씩') + '<span></span></div>' : '') +
      (sp.shape === 'rect' ? u.check(!!sp.relief, set(v => { sp.relief = v; }), '모서리 릴리프 구멍 (코너 R 이 공구보다 작을 때 네 모서리를 드릴로 뚫어 직각 확보)') : '') +
      (sp.stepover > 50 ? '<div class="note warn">⚠ 경로 간격 ' + sp.stepover + '% — 공구 부하가 커집니다. 일반적으로 40~50% 를 권장합니다.</div>' : '');
    adv += '<h4>측벽 형상 <small>(구배 · 입구 R · 바닥 R)</small></h4><div class="grid2">' +
      u.fld('구배 (°)', u.num(sp.draft, set(v => { sp.draft = Math.max(0, Math.min(88.9, v)); }), 'min="0" max="89" step="0.5"'), '0 = 수직 벽. 입구가 도면 치수, 아래로 갈수록 좁아짐') +
      u.fld('계단 높이 (mm)', u.num(sp.profStep, set(v => { sp.profStep = v; }), 'step="0.05"'), '평 엔드밀로 이 높이씩 계단 근사 (작을수록 매끈, 느림)') +
      '<div class="fld"><span>입구 R (윗 모서리)</span><div class="row">' + u.check(sp.topR > 0, set(v => { sp.topR = v ? 1 : 0; }), '사용') + (sp.topR > 0 ? u.num(sp.topR, set(v => { sp.topR = Math.max(0, v); }), 'style="width:80px"') : '') + '</div></div>' +
      '<div class="fld"><span>바닥 R (아래 모서리)</span><div class="row">' + u.check(sp.floorR > 0, set(v => { sp.floorR = v ? 1 : 0; }), '사용') + (sp.floorR > 0 ? u.num(sp.floorR, set(v => { sp.floorR = Math.max(0, v); }), 'style="width:80px"') : '') + '</div></div></div>' +
      (prof ? '<div class="opinfo">구배·R 은 마지막 <b>측벽 형상</b> 공정이 위에서부터 계단식으로 깎습니다 (가장 안쪽 ' + uf(C.pocketProfInset(sp, sp.thru ? P.stock.sz + sp.brk : sp.depth)) + 'mm). 2D 화면의 [단면도]로 확인하세요.</div>' : '');
    const advSum = [sp.stepover + '%', prof ? '구배 ' + sp.draft + '° R' + sp.topR + '/' + sp.floorR : '', sp.relief ? '릴리프' : ''].filter(Boolean).join(' · ');
    return { basic, opt, optSum, adv, advSum, res: C.planPocketSpec(sp, m, P.stock) };
  }
  // 형상 입력 (사각·원형·도면 형상) — 포켓·윤곽·모따기 공용
  function shapeFields(u, sp, what) {
    const set = fn => v => mutate(() => { fn(v); });
    const shapes = [['rect', '사각'], ['circle', '원형'], ['ngon', '다각형']].concat(sp.poly ? [['poly', '도면 형상']] : []);
    let h = '<div class="seg" role="radiogroup" aria-label="' + what + ' 모양">' + shapes.map(x => u.btn(x[1], () => mutate(() => { sp.shape = x[0]; }), sp.shape === x[0] ? 'on' : '', 'role="radio" aria-checked="' + (sp.shape === x[0]) + '"')).join('') + '</div>';
    if (sp.shape === 'circle') h += '<div class="grid2" style="margin-top:8px">' + u.fld('지름 Ø (mm)', u.num(sp.dia, set(v => { sp.dia = v; }))) + '<span></span></div>';
    else if (sp.shape === 'ngon') {
      const n = Math.max(3, Math.min(24, Math.round(sp.sides || 6))), af = C.r3((sp.dia || 0) * Math.cos(Math.PI / n));
      h += '<div class="grid2" style="margin-top:8px">' + u.fld('변 수', u.num(n, set(v => { sp.sides = Math.max(3, Math.min(24, Math.round(v))); }), 'min="3" max="24" step="1"'), '3 삼각 · 5 오각 · 6 육각 · 8 팔각') +
        u.fld('꼭짓점 지름 (mm)', u.num(sp.dia, set(v => { sp.dia = v; })), '맞변 거리 = ' + uf(af) + 'mm') +
        u.fld('맞변 거리 (mm)', u.num(af, set(v => { sp.dia = C.r3(v / Math.cos(Math.PI / n)); })), '육각 렌치 크기처럼 평행한 두 변 사이') +
        u.fld('회전 (°)', u.num(sp.rot || 0, set(v => { sp.rot = v; }))) + u.fld('모서리 R (mm)', u.num(sp.cr, set(v => { sp.cr = Math.max(0, v); }))) + '<span></span></div>';
    }
    else if (sp.shape === 'poly' && sp.poly) {
      const bb = C.GEOM.bbox([sp.poly.outer]);
      h += '<div class="opinfo">도면에서 가져온 형상' + (sp.poly.name ? ' <b>' + esc(sp.poly.name) + '</b>' : '') + ' · 크기 ' + uf(C.r3(bb.x1 - bb.x0)) + ' × ' + uf(C.r3(bb.y1 - bb.y0)) + 'mm · 점 ' + sp.poly.outer.length + '개' + (sp.poly.islands.length ? ' · 섬 ' + sp.poly.islands.length + '개' : '') + '<br><small>모양을 바꾸려면 도면을 다시 불러오세요. 사각·원형으로 바꿔도 도면 형상은 남아 있습니다.</small></div>';
    } else h += '<div class="grid3" style="margin-top:8px">' + u.fld('가로 X (mm)', u.num(sp.w, set(v => { sp.w = v; }))) + u.fld('세로 Y (mm)', u.num(sp.h, set(v => { sp.h = v; }))) + u.fld('코너 R (mm)', u.num(sp.cr, set(v => { sp.cr = v; })), '모서리 둥글기') + '</div>';
    return h;
  }
  const toolSel = (u, sp, types, set) => { const m = machine(), ts = m.tools.filter(t => types.includes(t.type)).sort((a, b) => a.no - b.no); return u.fld('공구', u.select(sp.toolNo, [[0, '자동 선택 (권장)']].concat(ts.map(t => [t.no, C.toolLabel(t)])), set(v => { sp.toolNo = parseInt(v, 10) || 0; }))); };
  // 윤곽
  function contourForm(u, g) {
    const sp = g.spec, m = machine(), set = fn => v => mutate(() => { fn(v); });
    const basic = '<div class="seg" role="radiogroup" aria-label="윤곽 방향">' + [['out', '바깥 윤곽 (부품 외곽)'], ['in', '안쪽 윤곽 (구멍·창)']].map(x => u.btn(x[1], () => mutate(() => { sp.side = x[0]; }), sp.side === x[0] ? 'on' : '', 'role="radio" aria-checked="' + (sp.side === x[0]) + '"')).join('') + '</div><div style="height:8px"></div>' + shapeFields(u, sp, '윤곽') +
      '<div class="grid2" style="margin-top:8px">' + u.fld(sp.thru ? '깊이 (관통: 두께 + 여유)' : '깊이 (mm)', u.num(sp.depth, set(v => { sp.depth = v; }), sp.thru ? 'disabled' : '')) + thruFld(u, sp, set, '관통 (잘라내기)') + '</div>';
    const opt = '<div class="grid2">' + toolSel(u, sp, ['endmill'], set) + '<div class="fld"><span>가공</span><div class="row">' + u.check(sp.rough, set(v => { sp.rough = v; }), '황삭') + u.check(sp.finish, set(v => { sp.finish = v; }), '정삭') + '</div></div></div>' +
      '<div class="opinfo">방향: <b>' + (sp.side === 'in' ? '반시계' : '시계') + '</b> (하향 절삭) · 진입: 윤곽 ' + (sp.side === 'in' ? '안쪽' : '바깥') + ' 헬리컬 → 직선 접근 · 공구 반경 보정은 CAM 이 계산(G41/G42 미사용)</div>';
    const adv = '<h4>절삭 설정</h4><div class="grid2">' +
      u.fld('측면 제거 폭 (mm)', u.num(sp.sideWidth, set(v => { sp.sideWidth = v; })), '부품 바깥(안쪽)으로 남은 소재 폭. 0 이면 한 바퀴만') +
      u.fld('경로 간격 (공구 지름 %)', u.num(sp.stepover, set(v => { sp.stepover = v; }))) +
      u.fld('1회 절입 (mm, 0=자동)', u.num(sp.stepdown, set(v => { sp.stepdown = v; }))) +
      u.fld('측벽 남김 여유 (mm)', u.num(sp.allowWall, set(v => { sp.allowWall = v; }))) + '</div>';
    return { basic, opt, optSum: (sp.toolNo ? 'T' + sp.toolNo : '공구 자동') + ' · ' + [sp.rough ? '황삭' : '', sp.finish ? '정삭' : ''].filter(Boolean).join('→'), adv, advSum: sp.sideWidth > 0 ? '측면 ' + sp.sideWidth + 'mm 제거' : '한 바퀴', res: C.planMillSpec(sp, m, P.stock) };
  }
  // 평면
  function faceForm(u, g) {
    const sp = g.spec, m = machine(), set = fn => v => mutate(() => { fn(v); });
    const basic = '<div class="grid2">' + u.fld('깊이 (깎을 두께, mm)', u.num(sp.depth, set(v => { sp.depth = v; }))) + '<span></span></div>' +
      (P.settings.depthRef === 'auto' ? '<div class="opinfo">평면 후 윗면은 Z' + uf(-sp.depth) + '. 다른 가공은 <b>이 면에서부터</b> 깊이를 잽니다 (자동).</div>'
        : '<div class="note warn">평면 가공 후 윗면은 Z' + uf(-sp.depth) + ' 입니다. 다른 가공의 깊이는 <b>원래 윗면(Z0)</b> 기준이므로 평면 깊이를 더해서 입력하세요.</div>');
    const opt = '<div class="grid2">' + toolSel(u, sp, ['facemill', 'endmill'], set) + '<span></span></div>';
    const adv = '<h4>절삭 설정</h4><div class="grid2">' + u.fld('줄 간격 (공구 지름 %)', u.num(sp.stepover, set(v => { sp.stepover = v; })), '페이스밀 60~75% 권장') + u.fld('1회 절입 (mm, 0=자동)', u.num(sp.stepdown, set(v => { sp.stepdown = v; }))) +
      u.fld('가장자리 밖 여유 (mm)', u.num(sp.margin, set(v => { sp.margin = v; })), '줄 끝에서 공구가 소재 밖으로 완전히 빠지는 거리') + '</div>';
    return { basic, opt, optSum: sp.toolNo ? 'T' + sp.toolNo : '공구 자동', adv, advSum: '줄 간격 ' + sp.stepover + '%', res: C.planMillSpec(sp, m, P.stock) };
  }
  // 모따기
  function chamferForm(u, g) {
    const sp = g.spec, m = machine(), set = fn => v => mutate(() => { fn(v); });
    const basic = '<div class="seg" role="radiogroup" aria-label="모따기 위치">' + [['out', '바깥 모서리'], ['in', '안쪽 모서리 (포켓·구멍 입구)']].map(x => u.btn(x[1], () => mutate(() => { sp.side = x[0]; }), sp.side === x[0] ? 'on' : '', 'role="radio" aria-checked="' + (sp.side === x[0]) + '"')).join('') + '</div><div style="height:8px"></div>' + shapeFields(u, sp, '모따기') +
      '<div class="grid2" style="margin-top:8px">' + u.fld('모따기 폭 C (mm)', u.num(sp.cw, set(v => { sp.cw = v; }))) + '<span></span></div>';
    const opt = '<div class="grid2">' + toolSel(u, sp, ['chamfer'], set) + '<span></span></div>' +
      '<div class="opinfo">구멍 입구 모따기: 모양 [원형], 지름 = 구멍 지름, [안쪽 모서리]. 위치는 구멍과 같게 두고, 구멍 가공 뒤에 오도록 목록 아래에 두세요.</div>';
    const adv = '<h4>절삭 설정</h4><div class="grid2">' + u.fld('끝 여유 (mm)', u.num(sp.extra, set(v => { sp.extra = v; })), '공구 끝이 모따기 면보다 더 내려가는 거리 (끝 마모 방지)') + '<span></span></div>';
    return { basic, opt, optSum: sp.toolNo ? 'T' + sp.toolNo : '공구 자동', adv, advSum: '끝 여유 ' + sp.extra, res: C.planMillSpec(sp, m, P.stock) };
  }
  // 직접 구성 (공정 묶음·공정 카드)
  function customForm(u, g) {
    let h = '<div class="card wiz"><div class="row">' + u.select(S.applyB || '', [['', '공정 묶음 선택...']].concat(DB.bundles.map(b => [b.id, b.name])), v => { S.applyB = v; }) +
      u.btn('적용', () => {
        const b = DB.bundles.find(x => x.id === S.applyB); if (!b) return toast('묶음을 선택하세요.', 'err');
        if (g.ops.length && !confirm('현재 공정 ' + g.ops.length + '개를 "' + b.name + '" 묶음으로 바꿀까요?')) return;
        const r = C.applyBundle(b, machine());
        mutate(() => { g.ops = r.ops; });
        r.notes.forEach(n => toast(n, (n.includes('없습니다') || n.includes('제외')) ? 'err' : 'warn'));
      }, 'sm') +
      u.btn('현재 공정을 묶음으로 저장', () => {
        if (!g.ops.length) return toast('저장할 공정이 없습니다.', 'err');
        const name = prompt('공정 묶음 이름', g.name); if (!name) return;
        dbChange(() => { DB.bundles.push(C.opsToBundle(name, g.ops, machine())); }); toast('공정 묶음으로 저장했습니다.', 'ok');
      }, 'sm') + '</div>';
    h += '<small>위에서부터 순서대로 가공합니다.</small>' + opCards(u, g.ops, fn => mutate(fn)) + '</div>';
    return h;
  }

  /* ---------------- 깊이 단면도 (Z값을 한 그림에) ---------------- */
  // [V0.5] 먼저 가공된 바닥 안에 있는 위치: 깊이 기준면·시작면·실제 Z 안내
  function refNote(g) {
    if (P.settings.depthRef !== 'auto' || !S.V || !S.V.plan) return '';
    const rows = new Map();
    S.V.plan.steps.forEach(st => { if (!st.ref && !st.top) return; st.refs.forEach(rf => { if (rf.gid !== g.id) return; const op = g.ops.find(o => o.id === rf.opId); if (!op) return; const n = st.holes.filter(h => h.gid === g.id).length; const k = st.type + '|' + st.ref + '|' + st.top; if (!rows.has(k)) rows.set(k, { st, op, n }); }); });
    if (!rows.size) return '';
    let h = '<div class="note info"><b>먼저 가공된 바닥 기준</b> (깊이 기준: 자동)<ul class="reflist">';
    rows.forEach(({ st, n }) => { h += '<li>' + esc(C.OP_TYPES[st.type].label) + ' · 위치 ' + n + '개: 기준면 Z' + uf(st.ref || 0) + (st.top ? ' · 이미 깎인 면 Z' + uf(st.top) + ' 에서 시작' : '') + ' → 실제 끝 <b>Z' + uf(st.z) + '</b> · R점 Z' + uf(st.r) + '</li>'; });
    return h + '</ul><small>입력한 깊이는 그 바닥에서부터 잰 값입니다 (예: 포켓 10mm 안의 구멍 깊이 8 → 실제 Z' + '−18). [원점·NC 출력]의 깊이 기준에서 바꿀 수 있습니다.</small></div>';
  }
  function depthDiagram(g) {
    const m = machine(), tm = C.toolMap(m), st = P.stock, set = P.settings;
    const ops = g.ops.filter(op => { const t = tm.get(op.toolNo); return t && C.OP_TYPES[op.type] && C.OP_TYPES[op.type].tools.includes(t.type); });
    if (!ops.length) return '';
    const W = 360, H = 250, L = 18, R = 250, top = 22, mid = 104, bot = H - 30;
    const iz = C.toNum(set.initialZ, 50), under = C.toNum(st.under, 0), zb = -st.sz, zu = -(st.sz + under);
    const info = ops.map(op => { const t = tm.get(op.toolNo); return { op, t, d: C.opDepth(op, t, st) }; });
    const rMax = Math.max(1, ...ops.map(o => C.toNum(o.r, 3))) + 2;
    const deep = Math.max(st.sz + under, ...info.map(x => -x.d.z)) * 1.06;
    const dc = Math.min(deep, Math.max(1, ...info.map(x => -x.d.z)) * 1.25); // 가공 깊이 구간을 크게 (아래 나머지는 압축)
    const Y = z => {
      if (z >= 0) { const up = mid - top; if (z <= rMax || iz <= rMax) return mid - Math.min(z, Math.max(iz, rMax)) / rMax * up * 0.5; return mid - (0.5 + 0.5 * Math.min(1, (z - rMax) / Math.max(1e-6, iz - rMax))) * up; }
      const lo = bot - mid, f = dc < deep - 1e-6 ? 0.78 : 1;
      if (-z <= dc) return mid + (-z / dc) * lo * f;
      return mid + (f + (1 - f) * Math.min(1, (-z - dc) / Math.max(1e-6, deep - dc))) * lo;
    };
    const s = []; // svg 조각
    const txt = (x, y, t, st2, anchor, bold) => '<text x="' + (+x).toFixed(1) + '" y="' + (+y).toFixed(1) + '" font-size="12"' + (bold ? ' font-weight="650"' : '') + ' style="fill:' + (st2 || 'var(--text)') + '" text-anchor="' + (anchor || 'start') + '">' + esc(t) + '</text>';
    const right = []; // 오른쪽 기준선 이름표 (겹치지 않게 나중에 배치)
    const hline = (z, label, color, dash) => { const y = Y(z); s.push('<line x1="' + (L - 6) + '" x2="' + (R + 6) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" style="stroke:' + color + '" stroke-width="1.2" ' + (dash ? 'stroke-dasharray="4 3"' : '') + '/>'); right.push({ y, label, color }); };
    // 소재·하부 여유
    s.push('<rect x="' + L + '" y="' + Y(0).toFixed(1) + '" width="' + (R - L) + '" height="' + (Y(zb) - Y(0)).toFixed(1) + '" style="fill:var(--cv-stock);stroke:var(--cv-stock-line)" stroke-width="1"/>');
    if (under > 0) s.push('<rect x="' + L + '" y="' + Y(zb).toFixed(1) + '" width="' + (R - L) + '" height="' + (Y(zu) - Y(zb)).toFixed(1) + '" style="fill:none;stroke:var(--muted)" stroke-dasharray="2 2"/>');
    const millInfo = info.find(x => C.OPS.get(x.op.type).mill);
    if (millInfo) {
      // 밀링 단면: 포켓(가운데 파냄) / 바깥 윤곽(오른쪽 계단) / 안쪽 윤곽(가운데 관통) / 평면(윗면 얇게) / 모따기(모서리 삼각형)
      const kindM = C.OPS.get(millInfo.op.type).mill, side = millInfo.op.side;
      const rough = info.find(x => /Rough$/.test(x.op.type)), fin = info.find(x => /Finish$/.test(x.op.type));
      const main = rough || fin || millInfo, depth = -main.d.z, t = main.t;
      const col = kindM === 'contour' ? 'var(--c-contour)' : kindM === 'face' ? 'var(--c-face)' : kindM === 'chamfer' ? 'var(--c-chamfer)' : 'var(--c-pocket)';
      let wallX0 = L + 40, wallX1 = R - 40;
      if (kindM === 'contour' && side !== 'in') { wallX0 = R - 70; wallX1 = R; }
      if (kindM === 'face') { wallX0 = L; wallX1 = R; }
      if (kindM === 'chamfer') {
        const ex = side === 'in' ? L + 70 : R - 60, cwpx = 18;
        s.push('<path d="M' + (ex - (side === 'in' ? 0 : cwpx)) + ',' + Y(0).toFixed(1) + ' L' + (ex + (side === 'in' ? cwpx : 0)) + ',' + Y(0).toFixed(1) + ' L' + ex + ',' + Y(-depth).toFixed(1) + ' Z" style="fill:var(--surface);stroke:' + col + '" stroke-width="1.6"/>');
        s.push('<line x1="' + ex + '" x2="' + ex + '" y1="' + Y(-depth).toFixed(1) + '" y2="' + Y(zb).toFixed(1) + '" style="stroke:var(--cv-stock-line)" stroke-dasharray="2 2"/>');
        s.push(txt(ex + (side === 'in' ? cwpx + 6 : -cwpx - 6), Y(-depth) + 4, 'C' + uf(millInfo.op.cw) + ' · 공구 끝 Z' + uf(-depth), 'var(--text)', side === 'in' ? 'start' : 'end', true));
      } else {
        s.push('<rect x="' + wallX0 + '" y="' + Y(0).toFixed(1) + '" width="' + (wallX1 - wallX0) + '" height="' + (Y(-depth) - Y(0)).toFixed(1) + '" style="fill:var(--surface);stroke:' + col + '" stroke-width="1.6"/>');
        if (rough || kindM === 'face') {
          const op0 = (rough || main).op, af = C.toNum(op0.allowFloor, 0), ap = Math.max(0.01, C.toNum(op0.stepdown, 1)), rd = depth - af;
          const n = Math.max(1, Math.ceil(rd / ap - 1e-9));
          for (let k = 1; k <= n; k++) {
            const z = -rd * k / n, y = Y(z).toFixed(1);
            s.push('<line x1="' + wallX0 + '" x2="' + wallX1 + '" y1="' + y + '" y2="' + y + '" style="stroke:' + col + '" stroke-dasharray="3 3" opacity=".8"/>');
            if ((n <= 4 || k === n) && k < n && kindM !== 'face') s.push(txt(wallX0 + 8, +y - 3, k + '단 Z' + uf(z), 'var(--text2)'));
          }
        }
        const tw = Math.min(40, Math.max(10, t.dia * 2.2)), tx = kindM === 'contour' && side !== 'in' ? wallX0 + 6 : (wallX0 + wallX1) / 2 - tw / 2, ty = Y(-depth);
        s.push('<rect x="' + tx.toFixed(1) + '" y="' + (Y(rMax + 6)).toFixed(1) + '" width="' + tw.toFixed(1) + '" height="' + (ty - Y(rMax + 6)).toFixed(1) + '" rx="1.5" style="fill:' + col + '" opacity=".25"/>');
        s.push(txt(kindM === 'contour' && side !== 'in' ? wallX0 - 4 : (wallX0 + wallX1) / 2, Y(-depth) + 15, (kindM === 'face' ? '평면 후 윗면 Z' : '바닥 Z') + uf(-depth), 'var(--text)', kindM === 'contour' && side !== 'in' ? 'end' : 'middle', true));
      }
      s.push(txt(L + 4, Y(rMax + 6) - 4, 'T' + t.no + ' ' + C.toolLabel(t).replace(/^T\d+\s*/, ''), 'var(--text2)'));
    } else {
      // 구멍·탭: 공정마다 한 칸
      const n = info.length, colW = (R - L) / n;
      info.forEach((x, i) => {
        const cx = L + colW * (i + 0.5), w = Math.min(colW * 0.5, Math.max(7, x.t.dia * 2.4)), z = x.d.z, y0 = Y(0), yz = Y(z);
        const col = TOOL_BAND[x.t.type] || '#64748b';
        const tipH = (x.t.type === 'drill' || x.t.type === 'center') ? Math.min(14, Math.max(3, w / 2 / Math.tan(((x.t.angle || 118) / 2) * Math.PI / 180))) : 0;
        // 구멍(제거된 부분)
        const yStart = Math.min(y0, yz);
        let path = 'M' + (cx - w / 2).toFixed(1) + ',' + yStart.toFixed(1) + ' L' + (cx - w / 2).toFixed(1) + ',' + (yz - tipH).toFixed(1) + ' L' + cx.toFixed(1) + ',' + yz.toFixed(1) + ' L' + (cx + w / 2).toFixed(1) + ',' + (yz - tipH).toFixed(1) + ' L' + (cx + w / 2).toFixed(1) + ',' + yStart.toFixed(1) + ' Z';
        if (x.t.type === 'center') path = 'M' + (cx - w / 2).toFixed(1) + ',' + y0.toFixed(1) + ' L' + cx.toFixed(1) + ',' + yz.toFixed(1) + ' L' + (cx + w / 2).toFixed(1) + ',' + y0.toFixed(1) + ' Z';
        s.push('<path d="' + path + '" style="fill:var(--surface);stroke:' + col + '" stroke-width="1.6"/>');
        if (x.t.type === 'tap') for (let yy = y0 + 4; yy < yz - 2; yy += 4) s.push('<line x1="' + (cx - w / 2).toFixed(1) + '" x2="' + (cx + w / 2).toFixed(1) + '" y1="' + yy.toFixed(1) + '" y2="' + (yy + 2.5).toFixed(1) + '" style="stroke:' + col + '" stroke-width="1"/>');
        s.push(txt(cx + w / 2 + 3, yz + 4, 'Z' + uf(z), 'var(--text)', 'start', true));
        s.push(txt(cx, top - 6, (i + 1) + '. T' + x.t.no, 'var(--text2)', 'middle'));
      });
    }
    // 기준 높이 선
    hline(iz, '초기점 Z' + uf(iz), 'var(--info)', true);
    const rs = [...new Set(ops.map(o => C.toNum(o.r, 3)))].slice(0, 2);
    rs.forEach(r => hline(r, 'R점 Z' + uf(r), 'var(--warn)', true));
    hline(0, 'Z0 소재 윗면', 'var(--text)', false);
    hline(zb, '소재 밑면 Z' + uf(zb), 'var(--muted)', false);
    if (under > 0) hline(zu, '하부 여유 Z' + uf(zu), 'var(--muted)', true);
    // 이름표 겹침 방지: 위에서부터 최소 13px 간격
    right.sort((a, b) => a.y - b.y); let last = -1e9;
    right.forEach(r => { const y = Math.max(r.y + 4, last + 13); last = y; s.push('<rect x="' + (R + 9) + '" y="' + (y - 8) + '" width="3" height="10" style="fill:' + r.color + '"/>' + txt(R + 15, y, r.label)); });
    if (iz > rMax) { const y = (Y(rMax) + Y(iz)) / 2; s.push('<path d="M' + (L - 8) + ',' + (y + 3) + ' l6,-6 M' + (L - 8) + ',' + (y + 7) + ' l6,-6" style="stroke:var(--muted)" stroke-width="1"/>'); }
    return '<div class="depth"><div class="dt"><span>깊이 단면도 (Z값)</span><small>단위 mm · 축척 아님</small></div><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="깊이 단면도: 초기점, R점, 소재 윗면, 공구 끝 Z값">' + s.join('') + '</svg></div>';
  }

  /* ---------------- 공정 카드 (프로젝트·묶음 공용) ---------------- */
  function opCards(u, ops, commit, opts) {
    const m = machine(), tm = C.toolMap(m), st = P.stock;
    let h = '';
    ops.forEach((op, i) => {
      const t = tm.get(op.toolNo);
      const okTools = m.tools.filter(x => C.OP_TYPES[op.type].tools.includes(x.type)).sort((a, b) => a.no - b.no);
      const toolOpts = okTools.map(x => [x.no, C.toolLabel(x)]);
      if (!t || !C.OP_TYPES[op.type].tools.includes(t.type)) toolOpts.unshift([op.toolNo, 'T' + op.toolNo + ' (없음/맞지 않음)']);
      const set = fn => v => commit(() => fn(v));
      const isDr = C.isDrillOp(op.type), isTp = C.isTapOp(op.type), def = C.OPS.get(op.type); // 입력 항목은 가공 모듈의 ui 규격을 따름
      h += '<div class="card"><div class="head"><b>' + (i + 1) + '. ' + esc(C.OP_TYPES[op.type].label) + ' <small>' + esc(C.OP_TYPES[op.type].code) + '</small></b>' +
        u.btn('↑', () => commit(() => { if (i > 0) ops.splice(i - 1, 0, ops.splice(i, 1)[0]); }), 'sm', 'title="위로" ' + (i ? '' : 'disabled')) +
        u.btn('↓', () => commit(() => { if (i < ops.length - 1) ops.splice(i + 1, 0, ops.splice(i, 1)[0]); }), 'sm', 'title="아래로" ' + (i < ops.length - 1 ? '' : 'disabled')) +
        u.btn('✕', () => commit(() => { ops.splice(i, 1); }), 'sm danger', 'title="공정 삭제"') + '</div>';
      h += '<div class="grid2">' +
        u.fld('가공 방식', u.select(op.type, Object.keys(C.OP_TYPES).map(k => [k, C.OP_TYPES[k].label + ' (' + C.OP_TYPES[k].code + ')']), set(v => {
          const fresh = C.newOp(v, op.toolNo); Object.keys(fresh).forEach(k => { if (!(k in op) || k === 'type') op[k] = fresh[k]; });
          const ok = m.tools.filter(x => C.OP_TYPES[v].tools.includes(x.type));
          const cur = tm.get(op.toolNo); if (!cur || !C.OP_TYPES[v].tools.includes(cur.type)) { if (ok.length) op.toolNo = ok[0].no; }
          if (C.isTapOp(v) && op.r < 5) op.r = 5;
        }))) +
        u.fld('공구', u.select(op.toolNo, toolOpts, set(v => { op.toolNo = parseInt(v, 10); }))) + '</div>';
      if (def.ui.pocket) {
        h += '<div class="grid3" style="margin-top:4px">' + u.fld('모양', u.select(op.shape, [['rect', '사각'], ['circle', '원형']], set(v => { op.shape = v; }))) +
          (op.shape === 'circle' ? u.fld('지름 Ø', u.num(op.dia, set(v => { op.dia = v; }))) + '<span></span>' : u.fld('가로 X', u.num(op.w, set(v => { op.w = v; }))) + u.fld('세로 Y', u.num(op.h, set(v => { op.h = v; })))) +
          (op.shape === 'circle' ? '' : u.fld('코너 R', u.num(op.cr, set(v => { op.cr = v; })))) +
          u.fld('깊이 (mm)', u.num(op.depth, set(v => { op.depth = v; }))) + u.fld('R점 (상면 위)', u.num(op.r, set(v => { op.r = v; }))) +
          u.fld('경로 간격 %', u.num(op.stepover, set(v => { op.stepover = v; }))) + u.fld('1회 절입', u.num(op.stepdown, set(v => { op.stepdown = v; }))) +
          u.fld('측벽 여유', u.num(op.allowWall, set(v => { op.allowWall = v; }))) + u.fld('바닥 여유', u.num(op.allowFloor, set(v => { op.allowFloor = v; }))) + '</div>';
      } else {
        h += '<div class="grid3" style="margin-top:4px">' +
          u.fld(op.thru ? '깊이 (관통 자동)' : '깊이 (mm)', u.num(op.depth, set(v => { op.depth = v; }), op.thru ? 'disabled' : '')) +
          u.fld('R점 (상면 위)', u.num(op.r, set(v => { op.r = v; }))) +
          (def.ui.q ? u.fld('펙 Q (mm)', u.num(op.q, set(v => { op.q = v; }))) :
            (def.ui.dwell ? u.fld('드웰 P (ms, G82)', u.int(op.dwell, set(v => { op.dwell = v; }))) : '<span></span>')) + '</div>';
        if (def.ui.thru) {
          h += '<div class="row">' + u.check(op.thru, set(v => { op.thru = v; }), '관통') + (op.thru ? u.fld('관통 여유(mm)', u.num(op.brk, set(v => { op.brk = v; }), 'style="width:80px"')) : '') +
            (def.ui.depthMode && !op.thru ? u.select(op.depthMode, [['tip', '깊이 = 공구 끝'], ['full', '깊이 = 직경부(끝각 자동 추가)']], set(v => { op.depthMode = v; })) : '') + '</div>';
        }
      }
      const cnd = C.opConditions(op, t, st.material, m);
      h += '<div class="grid3" style="margin-top:4px;align-items:end">' + u.check(op.auto, set(v => { op.auto = v; if (!v) { op.rpm = cnd.rpm; op.feed = cnd.feed; } }), '자동 추천') +
        u.fld('회전수 S', op.auto ? '<input type="text" value="' + cnd.rpm + '" disabled>' : u.num(op.rpm, set(v => { op.rpm = v; }))) +
        u.fld(isTp ? '이송 F (=S×P)' : '이송 F (mm/min)', (op.auto || isTp) ? '<input type="text" value="' + cnd.feed + '" disabled>' : u.num(op.feed, set(v => { op.feed = v; }))) + '</div>';
      // 계산 정보
      let info = '';
      if (t && C.OP_TYPES[op.type].tools.includes(t.type)) {
        const d = C.opDepth(op, t, st);
        const vc = Math.PI * t.dia * cnd.rpm / 1000, ref = C.refConditions(op.type, t, st.material);
        info += '공구 끝 <b>Z' + uf(d.z) + '</b>';
        if (isDr) info += ' · 직경부 깊이 ' + d.full + ' · 끝각 길이 ' + d.tip;
        if (op.type === 'center') info += ' · 모따기 Ø' + C.r3(C.spotDiameter(t, d.depth));
        info += '<br>Vc ' + vc.toFixed(1) + ' m/min (참고 ' + ref.vc.toFixed(1) + ')';
        if (!isTp && cnd.rpm > 0) info += ' · f ' + C.r3(cnd.feed / cnd.rpm) + ' mm/rev (참고 ' + C.r3(ref.fpr) + ')';
        if (isTp) { const rd = C.tapDrill(t.dia, t.pitch); info += ' · F = ' + cnd.rpm + ' × ' + t.pitch + ' = <b>' + cnd.feed + '</b> (G94)' + (rd ? '<br>기초 드릴 추천 Ø' + rd.dia : ''); }
      } else info = '<span style="color:var(--err)">공구를 확인하세요.</span>';
      if (opts && opts.template && op.toolSpec) {
        const ok = t && t.type === op.toolSpec.type && Math.abs(t.dia - op.toolSpec.dia) < 1e-6;
        info += '<br>등록 공구 사양: ' + esc(C.specText(op.toolSpec)) + (ok ? '' : ' <span style="color:var(--warn)">(현재 장비 T' + op.toolNo + ' 와 다름 → 적용 시 사양 일치 공구로 자동 매칭)</span>');
      }
      h += '<div class="opinfo">' + info + '</div></div>';
    });
    h += '<div class="row">' + u.select('', [['', '+ 공정 추가...']].concat(Object.keys(C.OP_TYPES).map(k => [k, C.OP_TYPES[k].label + ' (' + C.OP_TYPES[k].code + ')'])).concat(C.OPS.planned().map(d => ['', d.label + ' (개발 예정)', true])), v => {
      if (!v) return; const ok = m.tools.filter(x => C.OP_TYPES[v].tools.includes(x.type));
      commit(() => { const o = C.newOp(v, ok.length ? ok[0].no : 1); if (opts && opts.template) { delete o.id; const tt = tm.get(o.toolNo); o.toolSpec = tt ? { type: tt.type, dia: tt.dia, pitch: tt.pitch || 0 } : null; } ops.push(o); });
    }) + '</div>';
    return h;
  }
  function arrayForm(u, g) {
    const k = S.arrKind, a = S.arr[k] = S.arr[k] || ({ single: { x: 10, y: 10 }, line: { x: 10, y: 10, pitch: 20, angle: 0, count: 5 }, grid: { x: 10, y: 10, px: 20, py: 20, nx: 4, ny: 3 }, pcd: { cx: 50, cy: 50, dia: 60, count: 6, start: 0 } })[k];
    const f = (lbl, key, int) => u.fld(lbl, (int ? u.int : u.num)(a[key], v => { a[key] = v; }));
    let h = '';
    if (k === 'single') h = '<div class="grid2">' + f('X', 'x') + f('Y', 'y') + '</div>';
    if (k === 'line') h = '<div class="grid3">' + f('시작 X', 'x') + f('시작 Y', 'y') + f('간격', 'pitch') + f('각도(°)', 'angle') + f('개수', 'count', 1) + '</div>';
    if (k === 'grid') h = '<div class="grid3">' + f('시작 X', 'x') + f('시작 Y', 'y') + '<span></span>' + f('X 간격', 'px') + f('Y 간격', 'py') + '<span></span>' + f('X 개수', 'nx', 1) + f('Y 개수', 'ny', 1) + '</div>';
    if (k === 'pcd') h = '<div class="grid3">' + f('중심 X', 'cx') + f('중심 Y', 'cy') + f('PCD 직경', 'dia') + f('개수', 'count', 1) + f('시작각(°)', 'start') + '</div>';
    h += '<div class="row" style="margin-top:6px">' + u.btn(ico('i-plus') + '위치 추가', () => {
      const e = C.checkArrayParams(k, a); if (e.length) return toast(e[0], 'err');
      const pts = k === 'single' ? [{ x: C.r3(a.x), y: C.r3(a.y) }] : k === 'line' ? C.genLine(a) : k === 'grid' ? C.genGrid(a) : C.genPCD(a);
      const total = P.groups.reduce((s, x) => s + x.holes.length, 0);
      if (total + pts.length > C.MAX_HOLES) return toast('프로젝트 위치 수는 최대 ' + C.MAX_HOLES + '개입니다.', 'err');
      mutate(() => { pts.forEach(p => g.holes.push({ id: C.uid('h'), x: p.x, y: p.y })); });
      toast(pts.length + '개 위치를 추가했습니다.', 'ok');
    }, 'primary sm') + '<small>좌표는 공작물 원점(' + esc(C.ORIGIN_LABEL[P.stock.origin]) + ') 기준</small></div>';
    return h;
  }

  /* ---------------- 상태 표시줄 ---------------- */
  function renderStatus() {
    const u = U('sb'), c = counts(), ds = downloadState(), m = machine(), ne = c.e + c.ne, nw = c.w + c.nw;
    let h = !P.groups.length ? '<span class="sb">' + ico('i-plus') + '가공을 추가하세요 (왼쪽 [+ 가공 추가])</span>'
      : u.btn(ico(ne ? 'i-x' : nw ? 'i-warn' : 'i-check') + (ne ? '오류 ' + ne + '건 — NC 차단' : nw ? '경고 ' + nw + '건' : '검증 통과'), () => openDrawer('check'), 'sb ' + (ne ? 'err' : nw ? 'warn' : 'ok'), 'title="검증 결과 보기"');
    if (ds.ok && ds.test) h += '<span class="pill warn" title="관리자가 실가공 검증을 승인하기 전까지 NC 파일은 TEST 로 표시됩니다">검증용(TEST)</span>';
    h += '<span class="sbsep"></span>';
    if (S.est) h += '<span class="sb" title="급속 ' + m.rapid + 'mm/min, 공구 교환 ' + m.tcSec + '초 기준 추정 (가감속·주축 가속 미반영). 장비 값은 [장비·공구]에서 수정">예상 시간 약 ' + fmtSec(S.est.total) + '</span><span class="sbsep"></span>';
    const tools = new Set(S.V.plan.steps.map(s => s.toolNo));
    h += '<span class="sb">공구 ' + tools.size + ' · 공정 ' + S.V.plan.steps.length + '</span>';
    h += '<span class="sbspace"></span>';
    h += u.btn('검증 결과', () => toggleDrawer('check'), 'sb' + (S.drawer && S.bottomTab === 'check' ? ' on' : ''));
    h += u.btn('G코드', () => toggleDrawer('code'), 'sb' + (S.drawer && S.bottomTab === 'code' ? ' on' : ''));
    $('#status').innerHTML = h;
  }
  function openDrawer(tab) { S.bottomTab = tab; if (mobile()) S.mpanel = 'bottom'; else { if (!S.drawer) S.view.fitted = false; S.drawer = true; } renderAll(); }
  function toggleDrawer(tab) { if (mobile()) return openDrawer(tab); const was = S.drawer; if (S.drawer && S.bottomTab === tab) S.drawer = false; else { S.drawer = true; S.bottomTab = tab; } if (was !== S.drawer) S.view.fitted = false; renderAll(); }

  /* ---------------- 서랍: 검증 결과·G코드 ---------------- */
  function renderBottom() {
    const el = $('#bottomBody');
    if (!S.drawer && !(mobile() && S.mpanel === 'bottom')) { if (el.innerHTML) { el.innerHTML = ''; U('bc'); U('cd'); } return; }
    if (S.bottomTab === 'check') el.innerHTML = bottomCheck(); else { el.innerHTML = bottomCode(); bindCode(); }
  }
  // [V0.6] 같은 원인(앞의 '[그룹] 공정 n (이름):' 만 다른) 오류·경고는 한 건으로 묶고 '외 n곳' 표시
  function groupIss(list) {
    const m = new Map();
    list.forEach(i => { const core = i.msg.replace(/^\[[^\]]*\]\s*(공정 \d+ \([^)]*\)|[^:]{0,40}):\s*/, ''); const g = m.get(core); if (g) g.n++; else m.set(core, { msg: i.msg, ref: i.ref, n: 1 }); });
    return [...m.values()].map(g => ({ msg: g.n > 1 ? g.msg + ' (같은 내용 외 ' + (g.n - 1) + '곳)' : g.msg, ref: g.ref }));
  }
  function bottomCheck() {
    U('bc'); // 이 영역의 이전 핸들러 정리
    const c = counts(), ds = downloadState(), iss = S.V.issues;
    let h = '';
    if (!ds.ok) h += '<div class="banner err">' + ico('i-x') + 'NC 파일 생성 차단 — ' + esc(String(ds.why).replace(/\.$/, '')) + (P.groups.length ? '. 아래 항목을 누르면 고칠 곳으로 이동합니다.' : '') + '</div>';
    else if (ds.test || c.w || c.nw) h += '<div class="banner warn">' + ico('i-warn') + 'NC 저장 가능' + (ds.test ? ' — <u>검증용(TEST)</u> 표시: 장비 실가공 검증 전' : '') + (c.w + c.nw ? ' · 경고 ' + (c.w + c.nw) + '건 확인' : '') + '</div>';
    else h += '<div class="banner ok">' + ico('i-check') + '모든 자동 검증 통과 — NC 저장 가능</div>';
    const vr0 = c.vr, todo = [];
    groupIss(iss.filter(i => i.level === 'error')).forEach(i => todo.push({ lv: 'err', msg: i.msg, a: regActBc(i.ref) }));
    const lineTxt = g => 'G코드 ' + (g.lines.length > 1 ? g.lines.length + '곳(' + g.lines[0] + '행 등): ' : (g.lines[0] ? g.lines[0] + '행: ' : ''));
    if (vr0) groupMsgs(vr0.errors).forEach(g => todo.push({ lv: 'err', msg: lineTxt(g) + g.msg, a: regActLine(g.lines[0]) }));
    groupIss(iss.filter(i => i.level === 'warn' && !isUnverified(i))).forEach(i => todo.push({ lv: 'warn', msg: i.msg, a: regActBc(i.ref) }));
    if (vr0) groupMsgs(vr0.warnings).forEach(g => todo.push({ lv: 'warn', msg: lineTxt(g) + g.msg, a: regActLine(g.lines[0]) }));
    if (!P.groups.length) todo.length = 0;
    h += '<div class="todo"><b>' + (todo.length ? '확인할 내용 ' + todo.length + '건' : (P.groups.length ? '확인할 내용 없음' : '아직 가공이 없습니다 — 왼쪽 [+ 가공 추가]에서 가공을 고르세요.')) + '</b>' + (todo.length ? '<ul>' + todo.slice(0, 60).map(t => '<li class="' + t.lv + '" data-a="' + t.a + '" role="button" tabindex="0">' + (t.lv === 'err' ? '✖ ' : '⚠ ') + esc(t.msg) + '</li>').join('') + '</ul>' + (todo.length > 60 ? '<small>그 외 ' + (todo.length - 60) + '건은 아래 상세에서 확인</small>' : '') : '') + '</div>';
    h += '<details class="sect2" data-sec="chkdetail"' + (S.openSec.chkdetail ? ' open' : '') + '><summary>검증 상세 (11개 항목 · 독립 NC 해석 · 5단계 절차)</summary>';
    h += '<div class="chkcols"><div><b>모델 검증 (11개 항목)</b>';
    C.CHECKS.forEach(ck => {
      const li = iss.filter(i => i.cat === ck.id);
      const e = li.filter(i => i.level === 'error').length, w = li.filter(i => i.level === 'warn').length;
      const ic = e ? '<span class="ic err">✖</span>' : w ? '<span class="ic warn">⚠</span>' : '<span class="ic ok">✔</span>';
      h += '<details class="citem"' + (e || w ? ' open' : '') + '><summary>' + ic + '<span class="nm">' + ck.id + '. ' + esc(ck.name) + '</span>' + (e ? '<span class="pill err">오류 ' + e + '</span>' : '') + (w ? '<span class="pill warn">경고 ' + w + '</span>' : '') + (!e && !w ? '<span class="pill ok">통과</span>' : '') + '</summary>';
      if (li.length) h += '<ul>' + li.map(i => '<li class="' + i.level + '" data-a="' + regActBc(i.ref) + '">' + (i.level === 'error' ? '오류: ' : i.level === 'warn' ? '경고: ' : '참고: ') + esc(i.msg) + '</li>').join('') + '</ul>';
      h += '</details>';
    });
    h += '</div><div><b>독립 NC 해석 검증</b>';
    const vr = c.vr;
    if (S.nc.blocked) h += '<div class="citem" style="padding:6px 8px"><span class="ic err">✖</span> ' + esc(S.nc.blocked) + '</div>';
    else if (S.nc.edited && !S.nc.editVerify) h += '<div class="citem" style="padding:6px 8px"><span class="ic warn">⚠</span> G코드가 수정되었습니다. [G코드] 탭에서 "수정본 재검증"을 실행하세요.</div>';
    else if (vr) {
      h += '<details class="citem" open><summary>' + (vr.errors.length ? '<span class="ic err">✖</span>' : vr.warnings.length ? '<span class="ic warn">⚠</span>' : '<span class="ic ok">✔</span>') + '<span class="nm">' + (S.nc.edited ? '수정한 G코드' : '생성된 G코드') + ' 문법·경로 시뮬레이션</span>' + (vr.errors.length ? '<span class="pill err">오류 ' + vr.errors.length + '</span>' : '') + (vr.warnings.length ? '<span class="pill warn">경고 ' + vr.warnings.length + '</span>' : '') + '</summary><ul>' +
        vr.errors.map(x => '<li class="err" data-a="' + regActLine(x.line) + '">' + (x.line ? x.line + '행: ' : '') + esc(x.msg) + '</li>').join('') +
        vr.warnings.map(x => '<li class="warn" data-a="' + regActLine(x.line) + '">' + (x.line ? x.line + '행: ' : '') + esc(x.msg) + '</li>').join('') +
        '<li class="info">해석된 구멍 ' + vr.hits.length + '개 · 절삭 이동 ' + (vr.cuts ? vr.cuts.length : 0) + '개' + (vr.match === true ? ' · 생성기 계산과 100% 일치 (교차 검증)' : vr.match === false ? ' · 생성기 계산과 불일치' : ' · 수정본은 교차 검증 대상 아님') + '</li></ul></details>';
    }
    const m = machine();
    const st = (ok, label, detail) => '<div class="stage"><span class="ic ' + (ok === true ? 'ok">✔' : ok === false ? 'err">✖' : 'warn">⚠') + '</span><div><b>' + label + '</b><br><small>' + detail + '</small></div></div>';
    h += '<b style="display:block;margin-top:10px">5단계 검증 절차</b>' +
      st(true, '① 코드 알고리즘', '계산식·생성기 자동 테스트 (개발 단계 수행, 테스트 결과 문서 참조)') +
      st(vr ? !vr.errors.some(x => /해석|소수점|주소|코드|형식|괄호|원호/.test(x.msg)) : false, '② NC 문법', 'FANUC 주소·소수점·지원 코드·원호(I·J) 검사') +
      st(vr ? !vr.errors.some(x => /충돌|범위|경로|급속|하강|바닥|과삭|포켓/.test(x.msg)) : false, '③ 이동 경로', '모달 상태 시뮬레이션: 소재·클램프·하부 충돌, 포켓 벽·바닥 과삭') +
      st(c.e === 0, '④ 입력값 한계', '좌표·깊이·조건·장비 한계 (모델 검증 11항목)') +
      (() => { const ap = C.approvalOf(m, S.V.plan); return st(ap.ok ? true : null, '⑤ 실장비 테스트', ap.ok ? '이 프로젝트의 가공 종류가 모두 ' + C.VERSION + ' 에서 승인됨' : '미승인 가공: ' + esc(ap.missing.map(k => (C.OPS.get(k) || {}).label || k).join(', ')) + ' — [첫 가공 모드]로 드라이런·싱글 블록·시편 가공 후 관리자 승인'); })();
    h += '</div></div></details>';
    h += '<p><small>자동 검증과 3D 시뮬레이션은 실제 가공 안전을 보장하지 않습니다. 최초 가공은 반드시 작업자가 공회전·싱글 블록으로 확인하세요.</small></p>';
    return h;
  }
  function regActBc(ref) {
    const k = 'bc:r' + Math.random().toString(36).slice(2, 9);
    acts.set(k, () => {
      if (!ref) { select('stock'); return; }
      if (ref.gid) S.sel = { kind: 'group', gid: ref.gid, hid: ref.hid || null };
      if (mobile()) S.mpanel = ref.hid ? 'view' : 'right';
      if (ref.hid) S.vmode = '2d';
      renderAll(); $('#rightBody').scrollTop = 0; flash('#right');
    });
    return k;
  }
  function regActLine(line) { const k = 'bc:l' + Math.random().toString(36).slice(2, 9); acts.set(k, () => { S.bottomTab = 'code'; renderAll(); gotoLine(line); }); return k; }
  function gotoLine(line) {
    const ta = $('#ncText'); if (!ta || !line) return;
    const lines = ta.value.split('\n'); let pos = 0; for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    ta.focus(); ta.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
    ta.scrollTop = Math.max(0, (line - 4) * 18.6);
  }
  function bottomCode() {
    const u = U('cd'), ds = downloadState();
    const text = S.nc.edited ? S.nc.editText : S.nc.text;
    let h = '<div class="codebar">' +
      u.btn('⟳ 다시 생성', () => { if (S.nc.edited && !confirm('수정한 내용이 사라지고 현재 설정으로 다시 생성합니다.')) return; S.nc.edited = false; S.nc.editText = ''; S.nc.editVerify = null; renderAll(); toast('G코드를 다시 생성했습니다.'); }, 'sm') +
      u.btn('⧉ 복사', () => { const st = downloadState(); if (!st.ok) { beep(); return toast('복사 차단: ' + st.why + ' (검증을 통과한 G코드만 복사할 수 있습니다)', 'err'); } copyText(text); }, 'sm', ds.ok ? '' : 'aria-disabled="true" title="검증 통과 후 복사 가능"') +
      u.btn(S.nc.edited ? '✎ 편집 중' : '✎ 직접 수정', () => {
        if (!S.nc.text) return toast('먼저 오류를 해결하여 G코드를 생성하세요.', 'err');
        if (!S.nc.edited) { if (!confirm('G코드를 직접 수정하면 기존 검증 결과가 무효화되고, 저장 전에 재검증이 필요합니다.\n계속할까요?')) return; S.nc.edited = true; S.nc.editText = S.nc.text; S.nc.editVerify = null; renderAll(); }
      }, 'sm' + (S.nc.edited ? ' on' : '')) +
      (S.nc.edited ? u.btn('✔ 수정본 재검증', () => { reverify(); }, 'sm primary') : '') +
      u.btn(ico('i-save') + 'NC 저장', () => doDownload(), ds.ok ? 'sm primary' : 'sm') +
      '<small>' + (S.nc.edited ? (S.nc.editVerify ? (S.nc.editVerify.errors.length ? '<span style="color:var(--err)">재검증 오류 ' + S.nc.editVerify.errors.length + '건</span>' : '<span style="color:var(--ok)">재검증 통과</span>') : '<span style="color:var(--warn)">수정됨 · 재검증 필요</span>') : (S.nc.blocked ? esc(S.nc.blocked) : (text.split('\n').length + '줄 · 설정 변경 시 자동 갱신 · 줄을 누르면 3D 시뮬레이션이 그 위치로 이동'))) + '</small></div>';
    h += '<div class="codewrap"><div class="gutter" id="ncGutter"></div><textarea id="ncText" spellcheck="false" aria-label="G코드" ' + (S.nc.edited ? 'class="edited"' : 'readonly') + '>' + esc(text) + '</textarea></div>';
    return h;
  }
  function bindCode() {
    const ta = $('#ncText'), gu = $('#ncGutter'); if (!ta) return;
    const upd = () => { const n = ta.value.split('\n').length; let s = ''; for (let i = 1; i <= n; i++) s += i + '\n'; gu.textContent = s; };
    upd();
    ta.addEventListener('scroll', () => { gu.scrollTop = ta.scrollTop; });
    ta.addEventListener('input', () => { if (!S.nc.edited) return; S.nc.editText = ta.value; if (S.nc.editVerify) { S.nc.editVerify = null; renderTop(); renderStatus(); } upd(); const sm = ta.parentElement.previousElementSibling.querySelector('small'); if (sm) sm.innerHTML = '<span style="color:var(--warn)">수정됨 · 재검증 필요</span>'; });
    // 검증을 통과하지 못한 G코드는 직접 선택해 복사하는 것도 막음 (복사 버튼과 같은 기준)
    ta.addEventListener('copy', e => { if (S.nc.edited) return; const st = downloadState(); if (!st.ok) { e.preventDefault(); beep(); toast('복사 차단: ' + st.why + ' (검증을 통과한 G코드만 복사할 수 있습니다)', 'err'); } });
    ta.addEventListener('cut', e => { if (!S.nc.edited && !downloadState().ok) e.preventDefault(); });
    // G코드 줄 → 3D 시뮬레이션 위치 (생성된 코드 기준)
    ta.addEventListener('click', () => {
      if (S.nc.edited || !V3 || !V3.ok || !S.sim.motions.length) return;
      const ln = ta.value.slice(0, ta.selectionStart).split('\n').length;
      const i = S.sim.motions.findIndex(mv => mv.line >= ln);
      if (i < 0) return;
      if (S.vmode !== '3d') { S.vmode = '3d'; renderAll(); }
      V3.pause(); V3.seek(S.sim.tl[i].t1);
    });
  }
  function reverify() {
    S.nc.editVerify = C.verifyNC(S.nc.editText, verifyCtx(machine(), { expected: null }));
    renderAll();
    const e = S.nc.editVerify.errors.length;
    toast(e ? '재검증 오류 ' + e + '건 — 저장 차단' : '재검증 통과', e ? 'err' : 'ok');
    if (e) beep();
  }

  /* ---------------- 다운로드·파일 ---------------- */
  function downloadText(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function pickFile(accept, cb) {
    // 문서에 붙여 두어야 파일 선택 전에 사라지지 않음 (브라우저 정리 대상 방지)
    const old = $('#filePick'); if (old) old.remove();
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.id = 'filePick'; i.hidden = true;
    document.body.appendChild(i);
    i.onchange = () => {
      const f = i.files[0]; i.remove(); if (!f) return;
      if (f.size > 5 * 1024 * 1024) return toast('파일이 너무 큽니다 (5MB 이하).', 'err');
      const r = new FileReader();
      r.onload = () => { try { cb(String(r.result)); } catch (e) { toast('파일을 읽을 수 없습니다: ' + e.message, 'err'); } };
      r.readAsText(f);
    };
    i.click();
  }
  function copyText(t) {
    if (!t) return toast('복사할 내용이 없습니다.', 'err');
    const done = () => toast('클립보드에 복사했습니다.', 'ok');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(done, fallback); else fallback();
    function fallback() { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('복사 실패: 직접 선택하여 복사하세요.', 'err'); } ta.remove(); }
  }
  function ncFileName(ds) { return (ds.test ? 'TEST_' : '') + 'O' + String(P.programNo).padStart(4, '0') + '_' + (C.ncText(P.name, 20).replace(/[^A-Z0-9_-]+/g, '_') || 'PROGRAM') + (S.nc.edited ? '_EDIT' : '') + '.nc'; }
  // [V0.6] 가공 기록 추가 (지우지 않음)
  function addRecord(r) {
    DB.records = (DB.records || []).concat([Object.assign({ at: new Date().toISOString().slice(0, 16).replace('T', ' '), project: P.name, machine: machine().name }, r)]).slice(-3000);
    saveDB();
  }
  // 수정한 NC 는 해시를 다시 계산해 넣음
  function withHash(text, tag) {
    const L = text.split(/\r?\n/).filter(l => !/^\(NC HASH /.test(l)), h = C.ncHash(L.join('\n')), oi = L.findIndex(l => /^\s*O\d/.test(l));
    L.splice(oi >= 0 ? oi + 1 : 1, 0, '(NC HASH ' + h + ' - ' + tag + ')');
    return { text: L.join('\n'), hash: h };
  }
  function doDownload() {
    const ds = downloadState();
    if (!ds.ok) { beep(); toast('NC 생성 차단: ' + ds.why, 'err'); openDrawer('check'); return; }
    let text = S.nc.edited ? S.nc.editText : S.nc.text, hash = S.nc.hash;
    if (S.nc.edited) {
      if (!/USER EDITED/.test(text)) {
        const L = text.split(/\r?\n/), oi = L.findIndex(l => /^\s*O\d/.test(l));
        L.splice(oi >= 0 ? oi + 1 : 1, 0, '(USER EDITED - REVERIFIED ' + new Date().toISOString().slice(0, 10) + ')');
        text = L.join('\n');
      }
      // TEST 표시 줄이 지워졌으면 다시 넣음 (파일 이름 TEST_ 와 내용 일치)
      if (!/\(\*\*\* TEST ONLY/.test(text)) { const L = text.split(/\r?\n/), oi = L.findIndex(l => /^\s*O\d/.test(l)); L.splice(oi >= 0 ? oi + 1 : 1, 0, '(*** TEST ONLY - USER EDITED NC ***)'); text = L.join('\n'); }
      const w = withHash(text, 'USER EDITED'); text = w.text; hash = w.hash;
    }
    const m = machine(), kb = Math.ceil(text.length / 1024), tooBig = m.memKB > 0 && kb > m.memKB;
    const nTools = (S.V.plan.steps || []).filter(s => s.toolChange).length;
    const checks = ['공구 길이 보정(H)·공작물 좌표계(' + P.settings.wcs + ') 값을 장비에 입력·확인', 'Z를 띄운 드라이런(공회전)과 싱글 블록으로 첫 가공 확인 예정', '클램프·지그 위치와 소재 하부 여유 확인' + (/G84/.test(text) ? ' · 탭 가공 시 오버라이드 100%' : '')];
    const chkOk = () => { if ([...document.querySelectorAll('#dlg .ncChk')].some(x => !x.checked)) { beep(); toast('가공 전 점검 항목을 모두 확인하세요.', 'err'); return false; } return true; };
    const fileName = () => { let name = [...($('#ncFileName').value || '')].filter(ch => ch.charCodeAt(0) >= 32).join('').trim().replace(/[\\/:*?"<>|]+/g, '_') || ncFileName(ds); if (!/\.(nc|txt|tap|ncc|eia)$/i.test(name)) name += '.nc'; if (ds.test && !/^TEST_/.test(name)) name = 'TEST_' + name; return name; };
    const kinds = [...new Set((S.V.plan.steps || []).map(s => s.type))].join(',');
    openDlg('NC 저장', () => (ds.test ? '<div class="banner warn">' + ico('i-warn') + (ds.editedTest ? '손으로 고친 NC 는 항상 <b>검증용(TEST)</b> 입니다.' : '실가공 검증 전 가공이 있어 <b>검증용(TEST)</b> 파일입니다.') + ' 파일 이름에 TEST_ 가 붙고 내용에도 TEST 표시가 들어갑니다.</div>' : '') +
      (tooBig ? '<div class="banner warn">' + ico('i-warn') + 'NC 크기 ' + kb + 'KB 가 장비 메모리 ' + m.memKB + 'KB 보다 큽니다. <b>공구별로 나눠 저장</b>하거나 DNC(외부 운전)로 보내세요.</div>' : '') +
      (P.settings.firstRun ? '<div class="note info">첫 가공 모드 NC 입니다: 공정마다 M00 정지, 절삭 이송 ' + P.settings.firstFeed + '%.</div>' : '') +
      '<label class="fld"><span>파일 이름</span><input type="text" id="ncFileName" value="' + esc(ncFileName(ds)) + '" maxlength="80"></label>' +
      '<p><b>가공 전 점검</b> <small>(모두 확인해야 저장됩니다)</small></p>' + checks.map((c, i) => '<label class="chk"><input type="checkbox" class="ncChk" id="ncChk' + i + '"> ' + esc(c) + '</label>').join('') +
      '<p><small>' + (text.split('\n').length) + '줄 · ' + kb + 'KB · NC 해시 <b>' + esc(hash || '-') + '</b> · ' + (S.est ? '예상 가공 시간 약 ' + fmtSec(S.est.total) + ' (추정) · ' : '') + '자동 검증은 실제 가공 안전을 보장하지 않습니다. 저장하면 [가공 기록]에 남습니다.</small></p>',
    u => u.btn('취소', () => closeDlg(), '') +
      (nTools > 1 && !S.nc.edited ? u.btn('공구별로 나눠 저장 (' + nTools + '개)', () => { if (!chkOk()) return; saveSplit(ds, fileName()); }, tooBig ? 'primary' : '', 'title="공구마다 따로 된 NC 프로그램(O번호 +1씩). 각 파일은 앞 파일이 깎은 상태를 이어받아 따로 검증합니다."') : '') +
      u.btn(ico('i-save') + '저장', () => {
        if (!chkOk()) return;
        const name = fileName();
        downloadText(name, text.replace(/\r?\n/g, '\r\n') + '\r\n', 'text/plain');
        addRecord({ kind: 'save', file: name, hash, test: !!ds.test, lines: text.split('\n').length, kinds });
        S.flow.saved = hash; closeDlg(); toast(name + ' 저장 · 가공 기록에 남김', 'ok'); renderAll();
      }, tooBig ? '' : 'primary'));
  }
  // [V0.6] 공구별 분할 저장: 각 파일을 따로 만들고, 앞 파일 상태를 이어받아 독립 검증기로 다시 검사 → 하나라도 오류면 저장 안 함
  function saveSplit(ds, baseName) {
    const m = machine(), parts = C.planByTool(S.V.plan), out = [];
    let carry = null;
    for (let k = 0; k < parts.length; k++) {
      const p2 = Object.assign({}, P, { programNo: P.programNo + k });
      if (p2.programNo > 9999) { beep(); return toast('프로그램 번호가 9999 를 넘습니다. O번호를 줄이세요.', 'err'); }
      if (p2.programNo >= 8000 && P.programNo < 8000 && !confirm('나눠 저장하면 O' + p2.programNo + ' 처럼 8000번대(장비 보호 영역)가 됩니다. 계속할까요?')) return;
      const g = C.generateNC(p2, m, parts[k], { date: new Date(P.updatedAt), forceTest: !!ds.test, part: { k: k + 1, n: parts.length, after: k ? P.programNo + k - 1 : 0 } });
      const v = C.verifyNC(g.text, verifyCtx(m, { expected: g.hits, expectedCuts: g.cuts || [], carryIn: carry }));
      if (v.errors.length || !v.match) { beep(); return toast('공구별 파일 ' + (k + 1) + ' 검증 실패: ' + (v.errors[0] ? v.errors[0].msg : '경로 불일치') + ' — 저장하지 않았습니다.', 'err'); }
      carry = v.carry;
      const t = parts[k].steps[0].tool;
      out.push({ name: baseName.replace(/(\.[a-z]+)$/i, '') + '_' + String(k + 1).padStart(2, '0') + '_T' + String(t.no).padStart(2, '0') + '.nc', text: g.text, hash: g.hash, lines: g.lines, o: p2.programNo });
    }
    out.forEach((f, k) => setTimeout(() => { downloadText(f.name, f.text.replace(/\r?\n/g, '\r\n') + '\r\n', 'text/plain'); addRecord({ kind: 'save', file: f.name + ' (O' + f.o + ')', hash: f.hash, test: !!ds.test, lines: f.lines, kinds: [...new Set(parts[k].steps.map(s => s.type))].join(',') }); }, k * 450));
    S.flow.saved = S.nc.hash; closeDlg();
    toast('공구별 NC ' + out.length + '개를 저장합니다 (O' + P.programNo + '~O' + (P.programNo + out.length - 1) + '). 브라우저가 여러 파일 받기를 물으면 허용하세요.', 'ok');
    setTimeout(renderAll, out.length * 450 + 100);
  }
  // [V0.6] 가공 기록 보기·결과 입력·CSV 내보내기
  function openRecords() {
    S.recSel = S.recSel || null;
    openDlg('가공 기록', u => {
      const rs = (DB.records || []).slice().reverse();
      let h = '<p><small>NC 저장과 작업 결과가 지워지지 않고 쌓입니다 (최근 3000건). NC 해시로 어떤 파일로 가공했는지 확인합니다. 해시는 파일 맨 위 <code>(NC HASH …)</code> 줄에 있습니다.</small></p>';
      h += '<div class="sect"><b>작업 결과 추가</b><div class="grid3"><label class="fld"><span>NC 해시</span><input type="text" id="rcHash" maxlength="12" value="' + esc(S.nc.hash || '') + '"></label><label class="fld"><span>작업자</span><input type="text" id="rcBy" maxlength="40"></label><label class="fld"><span>결과</span><select id="rcRes"><option>정상</option><option>치수 불량</option><option>중단</option><option>충돌·사고</option></select></label></div><label class="fld"><span>측정·메모 (H/G54 값, 측정값, 이상 내용)</span><input type="text" id="rcNote" maxlength="300"></label>' +
        u.btn('기록 추가', () => { const by = $('#rcBy').value.trim(); if (!by) return toast('작업자를 입력하세요.', 'err'); addRecord({ kind: 'result', hash: $('#rcHash').value.trim().toUpperCase(), by, result: $('#rcRes').value, note: $('#rcNote').value.trim() }); openRecords(); toast('작업 결과를 기록했습니다.', 'ok'); }, 'sm primary') + '</div>';
      h += '<div class="row">' + u.btn('CSV 로 내보내기', () => {
        const q = v => '"' + String(v === undefined ? '' : v).replace(/"/g, '""') + '"';
        const csv = '\ufeff' + ['일시,종류,프로젝트,장비,파일,NC 해시,TEST,줄 수,가공 종류,작업자,결과,메모'].concat((DB.records || []).map(r => [r.at, r.kind === 'save' ? 'NC 저장' : '작업 결과', r.project, r.machine, r.file, r.hash, r.test ? 'TEST' : '', r.lines || '', r.kinds, r.by, r.result, r.note].map(q).join(','))).join('\r\n');
        downloadText('가공기록_' + new Date().toISOString().slice(0, 10) + '.csv', csv, 'text/csv');
      }, 'sm') + '</div>';
      h += '<div class="tblwrap"><table class="tbl"><tr><th>일시</th><th>종류</th><th>프로젝트 · 파일</th><th>NC 해시</th><th>결과·메모</th></tr>' + (rs.length ? rs.slice(0, 200).map(r => '<tr><td><small>' + esc(r.at) + '</small></td><td>' + (r.kind === 'save' ? 'NC 저장' + (r.test ? ' <span class="pill warn">TEST</span>' : '') : '작업 결과') + '</td><td>' + esc(r.project) + '<br><small>' + esc(r.file || '') + '</small></td><td><code>' + esc(r.hash) + '</code></td><td>' + esc(r.result || '') + (r.by ? ' <small>· ' + esc(r.by) + '</small>' : '') + (r.note ? '<br><small>' + esc(r.note) + '</small>' : '') + '</td></tr>').join('') : '<tr><td colspan="5"><small>아직 기록이 없습니다.</small></td></tr>') + '</table></div>';
      return h;
    }, u => u.btn('닫기', () => closeDlg(), 'primary'));
  }

  /* ---------------- 가운데: 2D/3D 도구 ---------------- */
  function setVMode(v) { if (S.vmode === v) return; if (v === '2d' && V3 && V3.ok) V3.pause(); S.vmode = v; if (mobile()) S.mpanel = 'view'; renderAll(); }
  // [V0.7] 자주 쓰는 도구만 한 줄에, 나머지는 ⋯ 안에 (설정의 [모두 펼쳐 보기]를 켜면 예전처럼 모두 밖에)
  const popMenu = (key, label, title, body) => '<details class="pop" data-sec="' + key + '"' + (S.openSec[key] ? ' open' : '') + '><summary class="sm" title="' + title + '" aria-label="' + title + '">' + label + '</summary><div class="popbody">' + body + '</div></details>';
  function renderVTools() {
    const u = U('vt'), dense = DENSE();
    if (S.vmode === '3d') {
      const views = [['iso', '등각'], ['top', '위'], ['front', '앞'], ['side', '옆']].map(v => u.btn(v[1], () => { if (V3 && V3.ok) V3.view(v[0]); }, 'sm', 'title="' + v[1] + ' 보기"')).join('');
      const paths = u.check(S.sim.showPaths, v => { S.sim.showPaths = v; if (V3 && V3.ok) V3.setShowPaths(v); }, '공구 경로');
      const res = u.select(S.sim.res, [['l', '해상도: 낮음(빠름)'], ['m', '해상도: 보통'], ['h', '해상도: 높음(느림)']], v => { S.sim.res = v; update3D(true); }, 'title="시뮬레이션 격자 해상도"');
      const sect = u.btn('단면 보기', () => { S.sim.section = !S.sim.section; applySection(); renderVTools(); }, 'sm' + (S.sim.section ? ' on' : ''), 'title="선택한 가공의 첫 위치(없으면 소재 중앙)에서 앞쪽을 잘라 구멍·포켓 깊이를 옆에서 봅니다" aria-pressed="' + !!S.sim.section + '"');
      $('#vtools').innerHTML = dense ? views + '<span class="sep"></span>' + paths + res + '<span class="sep"></span>' + sect
        : '<span class="bgrp">' + views + '</span><span class="sep"></span>' + sect + popMenu('vpop3', ico('i-more'), '더 보기: 공구 경로 표시 · 해상도', paths + u.fld('시뮬레이션 해상도', res));
      $('#viewHint').textContent = '';
      return;
    }
    const gs = DB.settings.grid;
    const stepOpts = [[0, '전체 경로']].concat((S.V.plan.steps || []).map(s => [s.idx, s.idx + '. ' + C.OP_TYPES[s.type].label + ' T' + s.toolNo + ' (' + s.holes.length + ')']));
    if (S.pathStep > S.V.plan.steps.length) S.pathStep = 0;
    const bSel = u.btn('선택', () => setMode('select'), 'sm' + (S.mode === 'select' ? ' on' : ''), 'title="선택·이동 (빈 곳 드래그 = 화면 이동)"');
    const bAdd = u.btn(ico('i-plus') + '위치 추가', () => setMode('add'), 'sm' + (S.mode === 'add' ? ' on' : ''), 'title="클릭/터치한 위치에 구멍·포켓 추가"');
    const bClamp = u.btn('클램프', () => { S.openSec.vpop = false; setMode(!dense && S.mode === 'clamp' ? 'select' : 'clamp'); }, 'sm' + (S.mode === 'clamp' ? ' on' : ''), 'title="드래그하여 클램프 영역 추가"');
    const bDel = u.btn(ico('i-x'), () => deleteSelectedHole(), 'sm', 'title="선택한 위치 삭제 (Delete)" aria-label="선택한 위치 삭제" ' + (S.sel.hid ? '' : 'disabled'));
    const bZoom = u.btn('－', () => zoom(0.8), 'sm', 'title="축소" aria-label="축소"') + u.btn('＋', () => zoom(1.25), 'sm', 'title="확대" aria-label="확대"');
    const bFit = u.btn('맞춤', () => { fitView(); drawView(); }, 'sm', 'title="전체 보기"');
    const bSec = u.btn('단면도', () => toggleSection(), 'sm' + (S.sec.on ? ' on' : ''), 'title="가공 결과를 가로선(A–A)에서 잘라 아래에 보여 줍니다. 선을 끌어 위치를 바꿉니다." aria-pressed="' + !!S.sec.on + '"');
    const selStep = u.select(S.pathStep, stepOpts, v => { S.pathStep = parseInt(v, 10); drawView(); }, 'title="순서를 표시할 공정" aria-label="순서를 표시할 공정"');
    const disp = u.check(gs.show, v => dbChange(() => { gs.show = v; }), '격자') +
      u.check(gs.snap, v => dbChange(() => { gs.snap = v; }), '스냅 (격자에 맞춤)') +
      u.fld('격자·스냅 간격', u.select(gs.step, [[0.5, '0.5'], [1, '1'], [2, '2'], [2.5, '2.5'], [5, '5'], [10, '10']].map(x => [x[0], x[1] + 'mm']), v => dbChange(() => { gs.step = parseFloat(v); }))) +
      u.check(S.showPath, v => { S.showPath = v; drawView(); }, '가공 순서 경로') +
      u.check(S.showNC, v => { S.showNC = v; drawView(); }, 'NC 해석 결과 겹쳐 보기');
    $('#vtools').innerHTML = dense
      ? bSel + bAdd + bClamp + bDel + '<span class="sep"></span><span class="bgrp">' + bZoom + bFit + '</span><span class="sep"></span>' + bSec + '<span class="sep"></span>' + selStep + popMenu('vpop', '표시 ▾', '표시 옵션', disp)
      : bSel + bAdd + (S.mode === 'clamp' ? bClamp : '') + (S.sel.hid ? bDel : '') + '<span class="sep"></span>' + bFit + bSec +
        popMenu('vpop', ico('i-more'), '더 보기: 클램프 · 확대/축소 · 공정 순서 · 격자·스냅', '<div class="row">' + (S.mode === 'clamp' ? '' : bClamp) + '<span class="bgrp">' + bZoom + '</span></div>' + u.fld('순서를 표시할 공정', selStep) + disp);
    const g = curGroup();
    const hint = { select: dense ? '클릭=선택 · 드래그=이동 · □ 손잡이 끌기=크기 조절 · 빈 곳 드래그=화면 이동 · 휠/두 손가락=확대' : '', add: g ? '클릭/터치 위치에 [' + g.name + '] 추가' : '먼저 왼쪽 목록에서 가공을 선택하세요', clamp: '드래그하여 클램프 영역 지정 (높이 기본 30mm) — 끝나면 [선택]' };
    const vh = $('#viewHint'); vh.textContent = hint[S.mode]; vh.hidden = !hint[S.mode];
  }
  function setMode(m) { S.mode = m; renderVTools(); drawView(); }
  // [V0.5] 2D 단면도 켜기/끄기: 단면선은 선택한 위치(없으면 소재 가운데) 높이에서 시작
  function toggleSection() {
    S.sec.on = !S.sec.on;
    if (S.sec.on) { const g = curGroup(), h = g && g.holes.find(q => q.id === S.sel.hid) || (g && g.holes[0]); const r = C.stockRect(P.stock); S.sec.y = h ? h.y : C.r3((r.y0 + r.y1) / 2); }
    renderVTools(); drawView();
  }
  function deleteSelectedHole() {
    const g = curGroup(); if (!g || !S.sel.hid) return;
    const i = g.holes.findIndex(h => h.id === S.sel.hid); if (i < 0) return;
    mutate(() => { g.holes.splice(i, 1); S.sel.hid = null; });
  }

  /* ---------------- 2D 그래픽 ---------------- */
  const G = window.PCAM_UI.createGraphics(() => ({ P, S, DB, drag, machine }));
  const w2s = G.w2s, s2w = G.s2w, fitView = G.fit, zoom = G.zoom, drawView = G.draw;
  function snap(v) { const gs = DB.settings.grid; return gs.snap ? C.r3(Math.round(v / gs.step) * gs.step) : C.r3(v); }
  // 크기 끌기: 화면 확대에 맞춰 0.1·0.5·1mm 단위
  function snapSize(v) { const u = S.view.scale > 8 ? 0.1 : S.view.scale > 2 ? 0.5 : 1; return C.r3(Math.round(v / u) * u); }
  function hitHole(px, py) {
    const tm = C.toolMap(machine()); let best = null, bd = Infinity;
    P.groups.forEach(g => {
      const ext = G.extentOf(g, tm);
      g.holes.forEach(h => {
        const [sx, sy] = w2s(h.x, h.y); const dist = Math.hypot(sx - px, sy - py);
        const inside = ext.rect ? (Math.abs(sx - px) <= Math.max(10, ext.w / 2 * S.view.scale) && Math.abs(sy - py) <= Math.max(10, ext.h / 2 * S.view.scale)) : dist <= Math.max(10, ext.d / 2 * S.view.scale);
        if (inside && dist < bd) { bd = dist; best = { g, h }; }
      });
    });
    return best;
  }
  let drag = null; const ptrs = new Map(); let pinch = null;
  function initCanvas() {
    const c = $('#cv');
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => { e.preventDefault(); const r = c.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      ptrs.set(e.pointerId, { x: px, y: py });
      if (ptrs.size === 2) { const [p1, p2] = [...ptrs.values()]; pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2 }; drag = null; return; }
      const w0 = s2w(px, py);
      if (e.button === 1 || e.button === 2) { drag = { kind: 'pan', sx: px, sy: py, cx: S.view.cx, cy: S.view.cy }; return; }
      if (S.mode === 'select') {
        // [V0.5] 크기 손잡이 → 끌어서 크기 조절 / 단면선 → 끌어서 이동
        const hd = G.handles().find(q => { const [qx, qy] = w2s(q.x, q.y); return Math.abs(qx - px) <= 8 && Math.abs(qy - py) <= 8; });
        if (hd) { drag = { kind: 'resize', id: hd.id, g: hd.g, h: hd.h, sp: hd.sp, dims: { shape: hd.sp.shape, w: hd.sp.w, h: hd.sp.h, cr: hd.sp.cr, dia: hd.sp.dia, sides: hd.sp.sides, rot: hd.sp.rot } }; return; }
        if (S.sec && S.sec.on && Math.abs(w2s(0, S.sec.y)[1] - py) <= 6) { drag = { kind: 'sec' }; return; }
        const hit = hitHole(px, py);
        if (hit) { S.sel = { kind: 'group', gid: hit.g.id, hid: hit.h.id }; drag = { kind: 'move', g: hit.g, h: hit.h, sx: px, sy: py, ox: hit.h.x, oy: hit.h.y, moved: false }; renderAll(); return; }
        drag = { kind: 'pan', sx: px, sy: py, cx: S.view.cx, cy: S.view.cy, click: true };
      } else if (S.mode === 'add') drag = { kind: 'add', sx: px, sy: py, w0 };
      else if (S.mode === 'clamp') drag = { kind: 'clamp', sx: px, sy: py, w0: [snap(w0[0]), snap(w0[1])], cur: null };
    });
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const [wx, wy] = s2w(px, py);
      const hit = !drag ? hitHole(px, py) : null, z = hit ? S.gz.get(hit.g.id) : null;
      S.cursorW = [snap(wx), snap(wy)];
      $('#cursorPos').textContent = 'X ' + uf(snap(wx)) + '  Y ' + uf(snap(wy)) + (DB.settings.grid.snap ? ' (스냅)' : '') + (hit ? '  ·  ' + hit.g.name + (z !== null && z !== undefined ? '  ' + S.gzLabel.get(hit.g.id) : '') : '');
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: px, y: py });
      if (pinch && ptrs.size === 2) {
        const [p1, p2] = [...ptrs.values()]; const d = Math.hypot(p1.x - p2.x, p1.y - p2.y), mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        S.view.cx -= (mx - pinch.mx) / S.view.scale; S.view.cy += (my - pinch.my) / S.view.scale;
        if (pinch.d > 0) zoom(d / pinch.d, mx, my); else drawView();
        pinch = { d, mx, my }; return;
      }
      if (!drag) return;
      if (drag.kind === 'pan') { if (Math.hypot(px - drag.sx, py - drag.sy) > 3) drag.click = false; S.view.cx = drag.cx - (px - drag.sx) / S.view.scale; S.view.cy = drag.cy + (py - drag.sy) / S.view.scale; drawView(); }
      else if (drag.kind === 'move') {
        if (!drag.moved && Math.hypot(px - drag.sx, py - drag.sy) < 5) return;
        drag.moved = true; drag.h.x = snap(wx); drag.h.y = snap(wy); drawView();
      } else if (drag.kind === 'clamp') { drag.cur = [snap(wx), snap(wy)]; drawView(); }
      else if (drag.kind === 'resize') {
        const dm = drag.dims, q = v => Math.max(1, snapSize(v));
        if (dm.shape === 'rect') { if (drag.id !== 'h') dm.w = q(2 * Math.abs(wx - drag.h.x)); if (drag.id !== 'w') dm.h = q(2 * Math.abs(wy - drag.h.y)); dm.cr = Math.min(dm.cr, Math.min(dm.w, dm.h) / 2); }
        else dm.dia = q(2 * Math.hypot(wx - drag.h.x, wy - drag.h.y));
        drawView();
      } else if (drag.kind === 'sec') { S.sec.y = snap(wy); drawView(); }
    });
    const end = e => {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (!drag) return;
      const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const d = drag; drag = null;
      if (d.kind === 'resize') {
        const dm = d.dims, sp = d.sp;
        if (dm.w !== sp.w || dm.h !== sp.h || dm.dia !== sp.dia) { mutate(() => { if (sp.shape === 'rect') { sp.w = dm.w; sp.h = dm.h; sp.cr = dm.cr; } else sp.dia = dm.dia; }); toast((sp.shape === 'rect' ? '크기 ' + uf(dm.w) + ' × ' + uf(dm.h) : '지름 Ø' + uf(dm.dia)) + ' 로 바꿨습니다. 공구·경로를 다시 계산했습니다.', 'ok'); }
        else drawView();
        return;
      }
      if (d.kind === 'sec') { saveDB(); drawView(); return; }
      if (d.kind === 'move' && d.moved) {
        const nx = d.h.x, ny = d.h.y; d.h.x = d.ox; d.h.y = d.oy;
        mutate(() => { d.h.x = nx; d.h.y = ny; });
      } else if (d.kind === 'pan' && d.click && e.type === 'pointerup') { if (S.sel.hid) { S.sel.hid = null; renderAll(); } }
      else if (d.kind === 'add' && e.type === 'pointerup' && Math.hypot(px - d.sx, py - d.sy) < 6) {
        const g = curGroup();
        if (!g) { toast('먼저 왼쪽 목록에서 가공(구멍·탭·포켓)을 선택하거나 추가하세요.', 'err'); return; }
        const total = P.groups.reduce((s, x) => s + x.holes.length, 0);
        if (total >= C.MAX_HOLES) return toast('위치 수 한계 초과', 'err');
        const hid = C.uid('h');
        mutate(() => { g.holes.push({ id: hid, x: snap(d.w0[0]), y: snap(d.w0[1]) }); S.sel.hid = hid; });
      } else if (d.kind === 'clamp' && d.cur) {
        const w = d.cur[0] - d.w0[0], hh = d.cur[1] - d.w0[1];
        if (Math.abs(w) < 1 || Math.abs(hh) < 1) { drawView(); return; }
        mutate(() => { P.clamps.push({ id: C.uid('c'), x: Math.min(d.w0[0], d.cur[0]), y: Math.min(d.w0[1], d.cur[1]), w: Math.abs(w), h: Math.abs(hh), height: 30 }); S.sel = { kind: 'stock', gid: null, hid: null }; });
        toast('클램프를 추가했습니다. 높이는 [소재·고정]에서 수정하세요.', 'ok');
      } else drawView();
    };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { $('#cursorPos').textContent = ''; S.cursorW = null; });
    window.addEventListener('resize', () => { if (S.vmode === '2d') drawView(); });
    if (window.ResizeObserver) new ResizeObserver(() => { if (S.vmode === '2d') drawView(); }).observe($('#canvasWrap'));
  }

  /* ---------------- 3D 시뮬레이션 ---------------- */
  let V3 = null, hudRaf = 0, lastProg = null, scrubbing = false;
  function ensure3D() {
    if (V3) return V3;
    V3 = window.PCAM_UI.createView3D($('#v3host'), {
      onHover: hv => { const el = $('#hudHover'); if (el) el.innerHTML = hv ? '마우스 위치 <span class="xyz">X ' + uf(C.r3(hv.x)) + ' · Y ' + uf(C.r3(hv.y)) + ' · <b>Z ' + uf(C.r3(hv.z)) + '</b></span>' : '소재 위에 마우스를 올리면 X·Y·Z 표시'; },
      onProgress: p => { lastProg = p; if (!hudRaf) hudRaf = requestAnimationFrame(() => { hudRaf = 0; updateHUD(lastProg); }); },
      onState: st => { const b = $('#simPlay'); if (b) { b.innerHTML = ico(st === 'play' ? 'i-pause' : 'i-play'); b.title = st === 'play' ? '일시정지 (Space)' : '재생 (Space)'; b.setAttribute('aria-label', b.title); } }
    });
    if (V3.ok) V3.setTheme(document.documentElement.dataset.theme);
    return V3;
  }
  function update3D(force) {
    if (S.vmode !== '3d') return;
    const v = ensure3D();
    if (!v.ok) { $('#simbar').innerHTML = ''; $('#hud3').innerHTML = ''; return; }
    const src = simSource(), motions = src && src.motions ? src.motions : [];
    const sig = JSON.stringify([S.nc.edited ? S.nc.editText : S.nc.text, motions.length, P.stock, P.clamps, S.sim.res, machine().tools, machine().rapid]);
    if (!force && sig === S.sim.sig) return;
    const stockSig = JSON.stringify(P.stock), keep = S.sim.stockSig === stockSig;
    S.sim.sig = sig; S.sim.stockSig = stockSig; S.sim.motions = motions;
    v.resize();
    renderHUD(src);
    const r = v.load({ stock: P.stock, motions, tools: C.toolMap(machine()), clamps: P.clamps, machine: machine(), maxCells: SIM_RES[S.sim.res], zClip: C.toNum(P.settings.initialZ, 50) }, keep);
    applySection();
    S.sim.total = r.total; S.sim.tl = r.timeline;
    v.setSpeed(S.sim.speed); v.setShowPaths(S.sim.showPaths);
    renderSimbar();
    // [V0.6] 새 NC 를 처음 열면 '가공 전(소재)' 상태에서 시작 → 재생을 눌러 처음부터 봄. 확인 단계 ✓ 표시
    if (S.flow.viewed !== S.nc.hash) { S.flow.viewed = S.nc.hash; try { v.seek(0); } catch (e) { /* 일부 환경 */ } const rg = $('#simRange'); if (rg) rg.value = 0; setTimeout(renderTree, 0); }
    updateHUD(lastProg);
  }
  // 단면 위치: 선택한 가공의 선택 위치 → 첫 위치 → 소재 중앙 (Y)
  function applySection() {
    if (!V3 || !V3.ok) return;
    if (!S.sim.section) { V3.setSection(null); return; }
    const g = curGroup(), h = g ? (g.holes.find(x => x.id === S.sel.hid) || g.holes[0]) : null, r = C.stockRect(P.stock);
    V3.setSection(h ? h.y : (r.y0 + r.y1) / 2);
  }
  // [V0.6] 공정 경계 눈금 (마우스를 올리면 공정 이름)
  function opTicks(tl, mo, total) {
    let h = '', prev = null;
    mo.forEach((m, i) => { const c = opCaption(m.line); if (c && c !== prev) { if (prev !== null) h += '<i class="tick" style="left:' + (tl[i].t0 / total * 100).toFixed(3) + '%" title="' + esc(c) + '"></i>'; prev = c; } });
    return h;
  }
  function renderSimbar() {
    const tl = S.sim.tl, mo = S.sim.motions, total = S.sim.total || 1;
    let bands = '';
    if (tl.length) {
      const tm = C.toolMap(machine()); let i = 0;
      while (i < mo.length) {
        const t = mo[i].t, t0 = tl[i].t0; let j = i; while (j < mo.length && mo[j].t === t) j++;
        const tool = tm.get(t), w = (tl[j - 1].t1 - t0) / total * 100;
        bands += '<span style="width:' + w.toFixed(3) + '%;background:' + (tool ? TOOL_BAND[tool.type] || '#64748b' : '#64748b') + '" title="' + (tool ? esc(C.toolLabel(tool)) : 'T' + t) + '">' + (w > 7 ? '<em>T' + t + '</em>' : '') + '</span>';
        i = j;
      }
    }
    $('#simbar').innerHTML =
      '<button class="ibtn" id="simPrev" title="이전 공구로" aria-label="이전 공구로">' + ico('i-prev') + '</button>' +
      '<button class="play" id="simPlay" title="재생 (Space)" aria-label="재생">' + ico('i-play') + '</button>' +
      '<button class="ibtn" id="simNext" title="다음 공구로" aria-label="다음 공구로">' + ico('i-next') + '</button>' +
      '<button class="ibtn" id="simEnd" title="가공 완료 상태" aria-label="가공 완료 상태로">' + ico('i-end') + '</button>' +
      '<div class="tline"><div class="bands">' + bands + '</div>' + opTicks(tl, mo, total) + '<input type="range" id="simRange" min="0" max="1000" step="1" value="1000" aria-label="시뮬레이션 시간 위치"></div>' +
      '<span class="time" id="simTime" title="절삭·이동 시간 (공구 교환 시간은 상태 표시줄 예상 시간에 포함)">' + clock(total) + ' / ' + clock(total) + '</span>' + (S.est ? '<small class="time" title="공구 교환 ' + S.est.changes + '회 × ' + machine().tcSec + '초">+교환 ' + Math.round(S.est.tc) + '초</small>' : '') +
      '<select id="simSpeed" title="재생 속도" aria-label="재생 속도">' + [1, 2, 5, 10, 25, 50, 100].map(s => '<option value="' + s + '"' + (s === S.sim.speed ? ' selected' : '') + '>' + s + '×</option>').join('') + '</select>';
    $('#simPlay').onclick = () => { if (V3.isPlaying()) V3.pause(); else V3.play(); };
    $('#simPrev').onclick = () => { V3.pause(); V3.stepOp(-1); };
    $('#simNext').onclick = () => { V3.pause(); V3.stepOp(1); };
    $('#simEnd').onclick = () => V3.finish();
    $('#simSpeed').onchange = e => { S.sim.speed = parseFloat(e.target.value); V3.setSpeed(S.sim.speed); };
    const rg = $('#simRange');
    rg.addEventListener('pointerdown', () => { scrubbing = true; V3.pause(); });
    let seekRaf = 0; rg.addEventListener('input', () => { if (!seekRaf) seekRaf = requestAnimationFrame(() => { seekRaf = 0; V3.seek(S.sim.total * rg.value / 1000); }); });
    const stop = () => { scrubbing = false; }; rg.addEventListener('pointerup', stop); rg.addEventListener('change', stop);
  }
  function renderHUD(src) {
    const err = src && src.errors && src.errors.length;
    const leg = [['센터', 'var(--c-center)'], ['드릴', 'var(--c-drill)'], ['탭', 'var(--c-tap)'], ['엔드밀(포켓·윤곽)', 'var(--c-pocket)'], ['평면', 'rgb(158,184,204)'], ['모따기', 'rgb(230,77,140)'], ['관통', '#22262c']].map(x => '<span><i style="background:' + x[1] + '"></i>' + x[0] + '</span>').join('');
    let msg = '';
    if (!src) msg = '<div class="box" style="color:var(--warn)">' + (S.nc.edited ? '수정한 G코드는 재검증 후 시뮬레이션됩니다.' : '표시할 G코드가 없습니다 — ' + esc(S.nc.blocked || '가공을 추가하세요')) + '</div>';
    else if (err) msg = '<div class="box" style="color:var(--err)">✖ NC 검증 오류 ' + err + '건 — 시뮬레이션은 참고용입니다</div>';
    $('#hud3').innerHTML = msg +
      '<div class="box" id="hudTool"><b>공구 없음</b><div class="xyz"><b>X -</b><b>Y -</b><b>Z -</b></div><small>-</small></div>' +
      '<div class="box aux"><div class="legend">' + leg + '</div><div class="assume" title="실제 NC 를 독립 해석한 이동으로 소재 높이맵(격자 ' + C.r3(Math.sqrt((P.stock.sx * P.stock.sy) / SIM_RES[S.sim.res])) + 'mm 내외)을 깎습니다. 홀더 간섭·가감속·나사산 모양은 반영하지 않습니다.">ⓘ 높이맵 근사 시뮬레이션 · 깊을수록 어둡게</div><div id="hudHover" class="assume">소재 위에 마우스를 올리면 X·Y·Z 표시</div></div>';
  }
  let capSrc = '', capArr = [];
  function opCaption(line) {
    const text = S.nc.edited ? S.nc.editText : S.nc.text;
    if (text !== capSrc) {
      capSrc = text; capArr = [];
      const steps = (S.V && S.V.plan && S.V.plan.steps) || [];
      let cur = '';
      text.split('\n').forEach((l, i) => { const mm = /^\(OP(\d+) /.exec(l); if (mm) { const st = steps.find(x => x.idx === +mm[1]); cur = mm[1] + '번 공정 · ' + (st ? C.OP_TYPES[st.type].label : l.slice(1, 40)); } capArr[i + 1] = cur; });
    }
    return capArr[line] || '';
  }
  function updateHUD(p) {
    if (!p) return;
    const rg = $('#simRange'), tt = $('#simTime'), el = $('#hudTool');
    if (rg && !scrubbing) rg.value = Math.round(p.total ? p.t / p.total * 1000 : 1000);
    if (tt) tt.textContent = clock(p.t) + ' / ' + clock(p.total);
    if (!el) return;
    if (!p.at) { el.innerHTML = '<b>대기</b>'; return; }
    const m = p.at.m, t = p.tool, pt = p.at.p;
    const what = m.k === 'rapid' ? 'G00 급속 이동' : m.k === 'drill' ? (m.code || '') + ' 사이클 절삭' : m.k === 'arc' ? (m.ccw ? 'G03' : 'G02') + ' 원호 절삭' : 'G01 직선 절삭';
    // [V0.6] 지금 어느 공정인지 자막 (G코드의 (OPn …) 주석 기준)
    const op = opCaption(m.line);
    el.innerHTML = (op ? '<div class="opcap">' + esc(op) + '</div>' : '') + '<b>' + (t ? esc(C.toolLabel(t)) : 'T' + m.t) + '</b>' +
      '<div class="xyz"><b>X ' + uf(C.r3(pt.x)) + '</b><b>Y ' + uf(C.r3(pt.y)) + '</b><b>Z ' + uf(C.r3(pt.z)) + '</b></div>' +
      '<small>' + what + (m.k !== 'rapid' && m.f ? ' · F' + m.f : '') + ' · G코드 ' + m.line + '행 · ' + Math.round(p.total ? p.t / p.total * 100 : 100) + '%</small>';
  }

  /* ---------------- 대화상자 ---------------- */
  function openDlg(title, body, foot, opts) {
    const d = $(opts && opts.second ? '#dlg2' : '#dlg');
    if (!(opts && opts.second)) S.dlgRefresh = opts && opts.refresh ? opts.refresh : null;
    d.dataset.admin = '';
    const sc = opts && opts.second ? 'd2' : 'd1';
    // 다시 그릴 때 스크롤 위치 유지
    const keep = d.open ? [...d.querySelectorAll('.dbody, .tblwrap')].map(x => x.scrollTop) : null;
    const u = U(sc);
    const extra = opts && opts.head ? opts.head(u) : '';
    d.querySelector('div').innerHTML = '<div class="dhead">' + extra + '<h2>' + esc(title) + '</h2>' + u.btn(ico('i-x'), () => closeDlg(d), 'ibtn sm', 'aria-label="닫기"') + '</div><div class="dbody">' + (typeof body === 'function' ? body(u) : body) + '</div>' + (foot ? '<div class="dfoot">' + foot(u) + '</div>' : '');
    if (keep) [...d.querySelectorAll('.dbody, .tblwrap')].forEach((x, i) => { if (keep[i] !== undefined) x.scrollTop = keep[i]; });
    if (!d.open) d.showModal();
    d.onclose = () => { if (!(opts && opts.second)) S.dlgRefresh = null; if (opts && opts.onClose) opts.onClose(); };
    return d;
  }
  function closeDlg(d) { (d || $('#dlg')).close(); }

  /* ---------------- 장비·공구·공정 묶음 (대화상자) ---------------- */
  function openTools() {
    openDlg('장비·공구', u => '<div class="subtabs">' + [['machine', '장비·공구 목록'], ['bundle', '공정 묶음 (프리셋)']].map(t => u.btn(t[1], () => { S.toolsTab = t[0]; openTools(); }, 'sm' + (S.toolsTab === t[0] ? ' on' : ''))).join('') + '</div>' +
      (S.toolsTab === 'machine' ? machineBody(u) : bundleBody(u)), null, { refresh: openTools });
  }
  function machineBody(u) {
    const m = machine();
    let h = '<h3>장비 선택</h3><div class="row">' +
      u.select(m.id, DB.machines.map(x => [x.id, x.name + (x.approvals.length ? ' ✔' : '')]), v => mutate(() => { P.machineId = v; })) +
      u.btn('+ 새 장비', () => { const n = C.defaultMachine(); n.name = '새 장비 ' + (DB.machines.length + 1); DB.machines.push(n); mutate(() => { P.machineId = n.id; }); }, 'sm') +
      u.btn('복제', () => { const n = C.clone(m); n.id = C.uid('m'); n.name = m.name + ' 복사'; C.revoke(n); n.history = []; DB.machines.push(n); mutate(() => { P.machineId = n.id; }); }, 'sm') +
      u.btn('삭제', () => {
        if (DB.machines.length < 2) return toast('장비는 최소 1대 필요합니다.', 'err');
        const used = Object.values(DB.projects).filter(p => p.machineId === m.id && p.id !== P.id).length;
        if (!confirm('"' + m.name + '" 장비를 삭제할까요?' + (used ? '\n다른 프로젝트 ' + used + '개가 이 장비를 사용 중입니다.' : ''))) return;
        DB.machines = DB.machines.filter(x => x !== m); mutate(() => { P.machineId = DB.machines[0].id; });
      }, 'sm danger') +
      u.btn('적합성 확인', () => openFitReport(), 'sm', 'title="현재 장비·소재로 모든 공정 묶음 점검"') + '</div>';
    h += '<div class="sect"><b>실가공 검증 상태</b> ' + approvalHTML(m) + '<small>검증 상태 변경은 관리자 설정(설정 창의 ⚙ 아이콘)에서만 가능합니다.</small></div>';
    const dm = (fn) => v => dbChange(() => { fn(v); if (m.verified || m.approvals.length) { C.revoke(m, '장비 설정 변경'); toast('장비 설정이 바뀌어 실가공 검증 상태가 해제되었습니다.', 'warn'); } });
    h += '<h3>장비 설정</h3>' + u.fld('장비 이름', u.text(m.name, dm(v => { m.name = v.slice(0, 60) || '장비'; })));
    h += '<div class="grid3" style="margin-top:6px">' +
      u.fld('X 행정', u.num(m.travel.x, dm(v => { m.travel.x = v; }))) + u.fld('Y 행정', u.num(m.travel.y, dm(v => { m.travel.y = v; }))) + u.fld('Z 행정', u.num(m.travel.z, dm(v => { m.travel.z = v; }))) +
      u.fld('최대 회전수', u.num(m.maxRpm, dm(v => { m.maxRpm = v; }))) + u.fld('탭 최대 회전수', u.num(m.maxTapRpm, dm(v => { m.maxTapRpm = v; }))) + u.fld('최대 절삭 이송', u.num(m.maxFeed, dm(v => { m.maxFeed = v; }))) +
      u.fld('매거진 공구 수', u.int(m.magazine, dm(v => { m.magazine = v; }))) + u.fld('급속 이송 (시간 추정용)', u.num(m.rapid, v => dbChange(() => { m.rapid = Math.min(100000, Math.max(1000, v)); }))) + u.fld('공구 교환 시간 (초)', u.num(m.tcSec, v => dbChange(() => { m.tcSec = Math.min(120, Math.max(0, v)); }))) +
      u.fld('제어기 (포스트프로세서)', u.select(m.control, C.POST.all().map(x => [x.id, x.label, x.status !== 'ready']), dm(v => { if (C.POST.get(v)) m.control = v; }))) + '</div>';
    h += u.check(m.rigidTap, dm(v => { m.rigidTap = v; }), '리지드 탭(M29) 지원') + u.check(m.rigidM03, dm(v => { m.rigidM03 = v; }), '리지드 탭 전에 S__ M03 출력 (장비 파라미터에 따름)') + u.check(m.endY, dm(v => { m.endY = v; }), '종료 시 Y축 원점 복귀 (G91 G28 Y0.)') + u.check(m.helical, dm(v => { m.helical = v; }), '헬리컬 보간 지원 (포켓 진입 G03 + Z)') +
      u.check(m.g76 !== false, dm(v => { m.g76 = v; }), 'G76 정밀 보링 지원 (주축 정위치 · Q 날 빼기)') +
      '<div class="grid3" style="margin-top:6px">' + u.fld('Z 행정 하한 (머신 좌표)', u.num(m.zMin, dm(v => { m.zMin = Math.min(0, v); })), 'G54 Z·H 를 입력하면 최저점이 이 안인지 검사') + u.fld('NC 메모리 (KB, 0=모름)', u.num(m.memKB || 0, v => dbChange(() => { m.memKB = Math.max(0, v); })), '넘으면 공구별 나눠 저장 안내') + '<span></span></div>';

    h += '<h3>공구 목록 <small>(' + m.tools.length + '개)</small></h3><div class="tblwrap"><table class="tbl"><tr><th>T</th><th>종류</th><th>직경(mm)</th><th title="드릴: 선단각 · 탭: 피치 · 엔드밀: 날 수 · 리머: 앞 모따기 길이">각(°)/피치/날수/안내부</th><th>재질</th><th title="유효 날 길이(가공 가능한 최대 깊이)">날장(mm)</th><th title="홀더 끝에서 공구 끝까지 길이 (0 = 미입력 → 홀더 간섭 검사 생략)">돌출(mm)</th><th title="홀더(척) 바깥 지름 (클램프 간섭 검사)">홀더Ø</th><th title="장비에서 측정한 공구 길이 보정값 H (머신 Z 행정 검사)">H 측정</th><th></th></tr>';
    m.tools.slice().sort((a, b) => a.no - b.no).forEach(t => {
      h += '<tr><td style="width:56px">' + u.int(t.no, dm(v => { t.no = v; })) + '</td><td>' + u.select(t.type, Object.keys(C.TOOL_TYPES).map(k => [k, C.TOOL_TYPES[k]]), dm(v => { const n = C.normalizeTool(Object.assign({}, t, { type: v })); Object.keys(t).forEach(k => delete t[k]); Object.assign(t, n); })) + '</td>' +
        '<td>' + u.num(t.dia, dm(v => { t.dia = v; })) + '</td>' +
        '<td>' + (t.type === 'reamer' ? u.num(t.lead, dm(v => { t.lead = Math.max(0.1, Math.min(5, v)); }), 'title="리머 앞 모따기(안내부) 길이(mm) — 공구 끝 깊이에 더해짐"') : t.type === 'boring' ? '<small>-</small>' : t.type === 'tap' ? u.num(t.pitch, dm(v => { t.pitch = v; }), 'title="피치(mm)"') : t.type === 'endmill' ? u.int(t.z, dm(v => { t.z = Math.max(1, Math.min(12, v)); }), 'title="날 수"') : u.num(t.angle, dm(v => { t.angle = v; }), 'title="선단각(°)"')) + '</td>' +
        '<td>' + u.select(t.mat, [['HSS', 'HSS'], ['CARBIDE', '초경']], dm(v => { t.mat = v; })) + '</td>' +
        '<td>' + u.num(t.flute, dm(v => { t.flute = v; }), 'title="유효 날 길이(mm)"') + '</td>' +
        '<td>' + u.num(t.stick || 0, dm(v => { t.stick = Math.max(0, v); }), 'title="돌출 길이(mm), 0 = 미입력"') + '</td><td>' + u.num(t.holderDia || 0, dm(v => { t.holderDia = Math.max(0, v); }), 'title="홀더 지름(mm)"') + '</td><td>' + u.num(t.hVal || 0, v => dbChange(() => { t.hVal = Math.max(0, v); }), 'title="H 측정값(mm)"') + '</td>' +
        '<td>' + u.btn('✕', () => { if (confirm('T' + t.no + ' 공구를 삭제할까요?')) dm(() => { m.tools.splice(m.tools.indexOf(t), 1); })(); }, 'sm danger', 'aria-label="공구 삭제"') + '</td></tr>';
    });
    h += '</table></div><div class="row" style="margin-top:6px">' + u.btn('+ 드릴', () => addTool('drill'), 'sm') + u.btn('+ 탭', () => addTool('tap'), 'sm') + u.btn('+ 센터 드릴', () => addTool('center'), 'sm') + u.btn('+ 평 엔드밀', () => addTool('endmill'), 'sm') + u.btn('+ 리머', () => addTool('reamer'), 'sm') + u.btn('+ 보링 바', () => addTool('boring'), 'sm') + '</div>';
    h += '<small>직경: 탭은 호칭경(M8 → 8), 보링 바는 맞춰 둔 완성 지름. 날장: 가공 가능한 최대 깊이. <b>돌출</b>·<b>홀더Ø</b>를 넣으면 홀더가 소재·클램프에 닿는지 검사하고, <b>H 측정</b>과 [원점·NC 출력]의 G54 Z 를 넣으면 Z 행정을 검사합니다.</small>';
    S.tdc = S.tdc || { d: 8, p: 1.25 };
    const rec = C.tapDrill(S.tdc.d, S.tdc.p);
    h += '<h3>미터 나사 기초 드릴 추천</h3><div class="grid3">' +
      u.fld('호칭경 M', u.num(S.tdc.d, v => { S.tdc.d = v; const c = C.METRIC_COARSE.find(r => r[0] === v); if (c) S.tdc.p = c[1]; openTools(); })) +
      u.fld('피치', u.num(S.tdc.p, v => { S.tdc.p = v; openTools(); })) +
      '<div class="fld"><span>추천 드릴</span><b style="font-size:1.2em">' + (rec ? 'Ø' + rec.dia : '-') + '</b></div></div>' +
      '<small>' + (rec ? esc(rec.name + ' ' + rec.kind + ' · 절삭 탭 기준 (D − P). 전조(롤) 탭은 별도 표 사용') : '호칭경을 입력하세요') + '</small>';
    return h;
    function addTool(type) {
      const used = new Set(m.tools.map(t => t.no)); let no = 1; while (used.has(no)) no++;
      const base = { no, type, dia: type === 'tap' ? 6 : type === 'endmill' ? 6 : 5, pitch: 1, angle: type === 'center' ? 90 : 118, flute: type === 'center' ? 10 : type === 'endmill' ? 15 : 40, z: 3, mat: type === 'endmill' ? 'CARBIDE' : 'HSS', name: '' };
      dbChange(() => { m.tools.push(C.normalizeTool(base)); C.revoke(m, '공구 추가'); });
    }
  }
  function bundleBody(u) {
    let h = '<p><small>자주 쓰는 공정 순서를 저장해 두고 "직접 구성" 가공에 적용합니다.</small></p>';
    DB.bundles.forEach((b, i) => {
      h += '<div class="card' + (S.bundleSel === b.id ? ' sel' : '') + '"><div class="head"><b>' + esc(b.name) + '</b>' +
        u.btn('편집', () => { S.bundleSel = S.bundleSel === b.id ? null : b.id; openTools(); }, 'sm') +
        u.btn('↑', () => dbChange(() => { if (i > 0) DB.bundles.splice(i - 1, 0, DB.bundles.splice(i, 1)[0]); }), 'sm', i ? '' : 'disabled') +
        u.btn('↓', () => dbChange(() => { if (i < DB.bundles.length - 1) DB.bundles.splice(i + 1, 0, DB.bundles.splice(i, 1)[0]); }), 'sm', i < DB.bundles.length - 1 ? '' : 'disabled') + '</div>' +
        '<small>' + esc(b.desc || b.ops.map(o => C.OP_TYPES[o.type].label).join(' → ')) + '</small>';
      if (S.bundleSel === b.id) {
        h += '<hr>' + u.fld('이름', u.text(b.name, v => dbChange(() => { b.name = v.slice(0, 60) || '공정 묶음'; }))) +
          u.fld('설명', u.text(b.desc, v => dbChange(() => { b.desc = v.slice(0, 200); }))) +
          opCards(u, b.ops, fn => dbChange(fn), { template: true }) +
          '<div class="row end">' + u.btn('복제', () => dbChange(() => { const n = C.normalizeBundle(C.clone(b)); n.id = C.uid('b'); n.name = b.name + ' 복사'; DB.bundles.splice(i + 1, 0, n); }), 'sm') +
          u.btn('삭제', () => { if (confirm('"' + b.name + '" 묶음을 삭제할까요?')) dbChange(() => { DB.bundles.splice(i, 1); S.bundleSel = null; }); }, 'sm danger') + '</div>';
      }
      h += '</div>';
    });
    h += '<div class="row" style="margin-top:6px">' +
      u.btn('+ 새 묶음', () => dbChange(() => { const n = C.normalizeBundle({ name: '새 공정 묶음', ops: [] }); DB.bundles.push(n); S.bundleSel = n.id; }), 'sm') +
      u.btn('적합성 확인', () => openFitReport(), 'sm') +
      u.btn('내보내기', () => downloadText('pureun-cam-bundles.json', JSON.stringify({ type: 'pcam-bundles', version: C.VERSION, bundles: DB.bundles }, null, 1), 'application/json'), 'sm') +
      u.btn('가져오기', () => pickFile('.json', txt => {
        const d = JSON.parse(txt); const arr = Array.isArray(d) ? d : d.bundles;
        if (!Array.isArray(arr)) throw new Error('공정 묶음 파일이 아닙니다.');
        dbChange(() => { arr.slice(0, 200).forEach(b => { const n = C.normalizeBundle(b); n.id = C.uid('b'); if (n.importWarnings) { toast(n.importWarnings[0], 'err'); delete n.importWarnings; } DB.bundles.push(n); }); });
        toast(arr.length + '개 공정 묶음을 가져왔습니다.', 'ok');
      }), 'sm') + '</div>';
    h += '<small>묶음의 공구는 번호와 사양(종류·직경·피치)을 함께 저장합니다. 장비가 바뀌면 사양이 같은 공구로 자동 매칭하고, 없으면 경고합니다.</small>';
    return h;
  }
  function openFitReport() {
    const m = machine();
    let h = '<p>장비 <b>' + esc(m.name) + '</b>, 재질 <b>' + esc(C.MATERIALS[P.stock.material].label) + '</b>, 두께 ' + P.stock.sz + 'mm 기준</p>';
    DB.bundles.forEach(b => {
      const r = C.checkBundleFit(b, m, P.stock);
      h += '<div class="sect"><b>' + (r.ok ? '<span class="pill ok">적합</span> ' : '<span class="pill err">확인 필요</span> ') + esc(b.name) + '</b>';
      r.notes.forEach(n => { h += '<div><small>• ' + esc(n) + '</small></div>'; });
      r.issues.forEach(i => { h += '<div style="color:var(--' + (i.level === 'error' ? 'err' : 'warn') + ')"><small>• ' + esc(i.msg.replace('[적합성 확인] ', '')) + '</small></div>'; });
      if (r.ok && !r.notes.length && !r.issues.length) h += '<small>문제 없음</small>';
      h += '</div>';
    });
    if (!DB.bundles.length) h += '<p>등록된 공정 묶음이 없습니다.</p>';
    const cur = S.V.issues.filter(i => [4, 5, 6, 7, 8, 9].includes(i.cat) && i.level !== 'info');
    h += '<h3>현재 프로젝트 공정</h3>' + (cur.length ? cur.map(i => '<div style="color:var(--' + (i.level === 'error' ? 'err' : 'warn') + ')"><small>• ' + esc(i.msg) + '</small></div>').join('') : '<small>문제 없음</small>');
    openDlg('적합성 확인 (소재·장비 변경 점검)', h, null, { second: true });
  }

  /* ---------------- [V0.5] 도면(DXF) 불러오기 ---------------- */
  const DXF_ACT = { contour: ['바깥 윤곽', 'var(--c-contour)'], pocket: ['포켓', 'var(--c-pocket)'], inner: ['안쪽 윤곽(관통 창)', '#0b6f80'], island: ['섬 (남김)', '#7c8a99'], none: ['사용 안 함', '#b7c0ca'] };
  const HOLE_ACT = { drill: ['구멍(드릴)', 'var(--c-drill)'], tap: ['탭', 'var(--c-tap)'], cpocket: ['원형 포켓', 'var(--c-pocket)'], outline: ['외곽 윤곽 (부품 바깥)', 'var(--c-contour)'], none: ['사용 안 함', '#b7c0ca'] };
  function importDXF() { pickFile('.dxf,.DXF', txt => openDXF(txt)); }
  // 지름이 보통 나사 기초 드릴과 같으면 탭으로 추천
  function tapFor(dia) { for (const r of C.METRIC_COARSE) { const t = C.tapDrill(r[0], r[1]); if (t && Math.abs(t.dia - dia) <= 0.051) return { d: r[0], p: r[1] }; } return null; }
  function openDXF(txt) {
    const res = C.DXF.parse(txt);
    if (res.error) return toast(res.error, 'err');
    if (!res.loops.length && !res.circles.length) return toast('도면에서 닫힌 윤곽이나 원을 찾지 못했습니다.', 'err');
    const cls = C.DXF.classify(res), sz = P.stock.sz;
    const st = { res, cls, fit: true, margin: 2, items: cls.items.map((it, k) => ({ act: it.depth === 0 ? (k === 0 && cls.items.length > 1 ? 'contour' : (cls.items.length === 1 ? 'contour' : 'pocket')) : it.depth % 2 === 1 ? 'pocket' : 'island', depth: C.r3(it.depth === 0 ? Math.min(10, sz / 2) : Math.min(5, sz / 2)) })),
      holes: cls.holes.map(hg => {
        const tp = tapFor(hg.dia);
        // [V0.5 검토] 큰 원 하나가 다른 원·윤곽을 모두 감싸면 부품 외곽(둥근 플랜지 등) → 외곽 윤곽 추천
        const c = hg.pts[0], R = hg.dia / 2, inC = p => Math.hypot(p[0] - c[0], p[1] - c[1]) < R - 1e-6;
        const others = res.circles.filter(o => Math.abs(o.r * 2 - hg.dia) > 1e-6 || o.cx !== c[0] || o.cy !== c[1]);
        const wraps = hg.pts.length === 1 && hg.dia > 20 && (others.length || cls.items.length) && others.every(o => inC([o.cx, o.cy])) && cls.items.every(it => it.pts.every(inC));
        return { act: wraps ? 'outline' : hg.dia > 20 ? 'cpocket' : tp ? 'tap' : 'drill', tap: tp, depth: C.r3(wraps ? Math.min(10, sz / 2) : Math.min(10, sz - 1)) };
      }) };
    // 바깥 윤곽 안에 들어 있는 1단계 윤곽만 포켓, 바깥 윤곽이 없으면 맨 바깥도 포켓
    S.dxf = st;
    openDXFDlg();
  }
  function dxfPreview(st) {
    const all = st.cls.items.map(i => i.pts).concat(st.res.circles.map(c => [[c.cx - c.r, c.cy - c.r], [c.cx + c.r, c.cy + c.r]]));
    const bb = C.GEOM.bbox(all), w = Math.max(1, bb.x1 - bb.x0), h = Math.max(1, bb.y1 - bb.y0), pad = Math.max(w, h) * 0.04;
    const vb = (bb.x0 - pad) + ' ' + (-bb.y1 - pad) + ' ' + (w + 2 * pad) + ' ' + (h + 2 * pad);
    let svg = '<svg class="dxfprev" viewBox="' + vb + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="도면 미리보기">';
    st.cls.items.forEach((it, k) => { const a = DXF_ACT[st.items[k].act]; svg += '<path d="M' + it.pts.map(p => p[0].toFixed(3) + ',' + (-p[1]).toFixed(3)).join(' L') + ' Z" style="fill:' + a[1] + ';fill-opacity:' + (st.items[k].act === 'none' ? 0 : 0.16) + ';stroke:' + a[1] + '" stroke-width="1.6"/>'; });
    st.cls.holes.forEach((hg, k) => { const a = HOLE_ACT[st.holes[k].act]; hg.pts.forEach(p => { svg += '<circle cx="' + p[0].toFixed(3) + '" cy="' + (-p[1]).toFixed(3) + '" r="' + (hg.dia / 2).toFixed(3) + '" style="fill:' + a[1] + ';fill-opacity:.25;stroke:' + a[1] + '" vector-effect="non-scaling-stroke" stroke-width="1.6"/>'; }); });
    return svg + '</svg>';
  }
  function openDXFDlg() {
    const st = S.dxf; if (!st) return;
    const all = st.cls.items.map(i => i.pts).concat(st.res.circles.map(c => [[c.cx - c.r, c.cy - c.r], [c.cx + c.r, c.cy + c.r]]));
    const bb = C.GEOM.bbox(all);
    openDlg('도면(DXF) 불러오기', u => {
      let h = '<div class="dxfgrid"><div>' + dxfPreview(st) + '<div class="chips">' + Object.keys(DXF_ACT).filter(k => k !== 'none').map(k => '<span><i class="swatch" style="background:' + DXF_ACT[k][1] + '"></i>' + DXF_ACT[k][0] + '</span>').join('') + '<span><i class="swatch" style="background:var(--c-drill)"></i>구멍</span><span><i class="swatch" style="background:var(--c-tap)"></i>탭</span></div>';
      h += '<small>단위: ' + esc(st.res.units) + (st.res.scale !== 1 ? ' (×' + st.res.scale + ' 로 mm 환산)' : '') + ' · 도면 범위 ' + uf(C.r3(bb.x1 - bb.x0)) + ' × ' + uf(C.r3(bb.y1 - bb.y0)) + 'mm · 닫힌 윤곽 ' + st.cls.items.length + '개 · 원 ' + st.res.circles.length + '개</small>';
      st.res.warnings.forEach(w => { h += '<div class="note warn">⚠ ' + esc(w) + '</div>'; });
      h += '<div class="sect"><b>소재·원점</b>' + u.check(st.fit, v => { st.fit = v; openDXFDlg(); }, '소재 크기를 도면 범위 + 여유로 맞추고, 원점을 왼쪽 아래(LL)로') +
        (st.fit ? u.fld('도면 둘레 소재 여유 (mm)', u.num(st.margin, v => { st.margin = Math.max(0, v); openDXFDlg(); })) : '<small>도면 좌표를 그대로 씁니다 (현재 원점 ' + esc(C.ORIGIN_LABEL[P.stock.origin]) + ' 기준).</small>') +
        u.fld('소재 두께 (mm)', u.num(st.sz === undefined ? P.stock.sz : st.sz, v => { st.sz = Math.max(0.1, v); })) +
        (P.groups.length ? '<div class="note warn">현재 프로젝트에 가공 ' + P.groups.length + '개가 있습니다. 도면 가공은 뒤에 추가되고' + (st.fit ? ' 소재 크기·원점이 바뀝니다' : '') + '. 새 도면이면 먼저 [프로젝트] → 새 프로젝트를 만드세요.</div>' : '') + '</div></div><div>';
      if (st.cls.holes.length) {
        h += '<b>원 (지름별 묶음)</b><div class="tblwrap"><table class="tbl"><tr><th>지름</th><th>개수</th><th>가공</th><th>깊이</th></tr>';
        st.cls.holes.forEach((hg, k) => {
          const a = st.holes[k], opts = [['drill', '구멍(드릴) Ø' + hg.dia]].concat(a.tap ? [['tap', '탭 M' + a.tap.d + (a.tap.p ? '' : '')]] : []).concat([['cpocket', '원형 포켓'], ['outline', '외곽 윤곽'], ['none', '사용 안 함']]);
          h += '<tr><td><i class="swatch" style="background:' + HOLE_ACT[a.act][1] + '"></i>Ø' + hg.dia + '</td><td>' + hg.pts.length + '</td><td>' + u.select(a.act, opts, v => { a.act = v; openDXFDlg(); }) + '</td><td>' + u.num(a.depth, v => { a.depth = v; }) + '</td></tr>';
        });
        h += '</table></div><small>지름이 나사 기초 드릴과 같으면 탭을 추천합니다 (예: Ø6.8 → M8).</small>';
      }
      if (st.cls.items.length) {
        h += '<b style="display:block;margin-top:10px">닫힌 윤곽</b><div class="tblwrap"><table class="tbl"><tr><th>#</th><th>크기</th><th>가공</th><th>깊이</th></tr>';
        st.cls.items.forEach((it, k) => {
          const a = st.items[k];
          h += '<tr><td><i class="swatch" style="background:' + DXF_ACT[a.act][1] + '"></i>' + (k + 1) + (it.depth ? ' <small>(' + it.depth + '단 안쪽)</small>' : '') + '</td><td>' + uf(C.r3(it.bb.x1 - it.bb.x0)) + '×' + uf(C.r3(it.bb.y1 - it.bb.y0)) + '</td><td>' + u.select(a.act, Object.keys(DXF_ACT).map(x => [x, DXF_ACT[x][0]]), v => { a.act = v; openDXFDlg(); }) + '</td><td>' + (a.act === 'island' || a.act === 'none' ? '-' : u.num(a.depth, v => { a.depth = v; })) + '</td></tr>';
        });
        h += '</table></div><small>섬 = 바로 바깥 포켓에서 깎지 않고 남길 부분. 깊이가 소재 두께 이상이면 만든 뒤 [관통]을 체크하세요.</small>';
      }
      return h + '</div></div>';
    }, u => u.btn('취소', () => { closeDlg(); S.dxf = null; }, '') + u.btn(ico('i-plus') + '가공 만들기', () => createFromDXF(), 'primary'), { refresh: openDXFDlg });
  }
  function createFromDXF() {
    const st = S.dxf; if (!st) return;
    const all = st.cls.items.map(i => i.pts).concat(st.res.circles.map(c => [[c.cx - c.r, c.cy - c.r], [c.cx + c.r, c.cy + c.r]]));
    const bb = C.GEOM.bbox(all);
    let dx = 0, dy = 0;
    mutate(() => {
      if (st.sz !== undefined) P.stock.sz = C.r3(st.sz);
      if (st.fit) {
        P.stock.sx = C.r3(bb.x1 - bb.x0 + 2 * st.margin); P.stock.sy = C.r3(bb.y1 - bb.y0 + 2 * st.margin); P.stock.origin = 'LL';
        dx = -bb.x0 + st.margin; dy = -bb.y0 + st.margin; S.view.fitted = false;
      }
      const made = [];
      const mk = (kind, name, spec, pts) => { const g = C.newGroup(name, P.groups.length); g.color = KIND[kind].color; g.spec = spec; pts.forEach(p => g.holes.push({ id: C.uid('h'), x: C.r3(p[0] + dx), y: C.r3(p[1] + dy) })); P.groups.push(g); made.push(g); };
      // 원
      st.cls.holes.forEach((hg, k) => {
        const a = st.holes[k];
        if (a.act === 'drill') mk('drill', '구멍 Ø' + hg.dia, C.newHoleSpec('drill', { dia: hg.dia, depth: a.depth }), hg.pts);
        else if (a.act === 'tap' && a.tap) mk('tap', '탭 M' + a.tap.d, C.newHoleSpec('tap', { tapD: a.tap.d, tapP: a.tap.p, tapDepth: a.depth }), hg.pts);
        else if (a.act === 'cpocket') mk('pocket', '원형 포켓 Ø' + hg.dia, C.newPocketSpec({ shape: 'circle', dia: hg.dia, depth: a.depth }), hg.pts);
        else if (a.act === 'outline') mk('contour', '외곽 Ø' + hg.dia, C.newMillSpec('contour', { shape: 'circle', dia: hg.dia, side: 'out', depth: a.depth }), hg.pts);
      });
      // 닫힌 윤곽: 형상은 기준점(범위 중심) 상대 좌표
      st.cls.items.forEach((it, k) => {
        const a = st.items[k]; if (a.act === 'none' || a.act === 'island') return;
        const cx = (it.bb.x0 + it.bb.x1) / 2, cy = (it.bb.y0 + it.bb.y1) / 2, rel = pts => pts.map(p => [C.r3(p[0] - cx), C.r3(p[1] - cy)]);
        const islands = a.act === 'pocket' ? st.cls.items.filter((o, j) => st.items[j].act === 'island' && o.parent === it).map(o => rel(o.pts)) : [];
        const poly = { outer: rel(it.pts), islands, name: '도면 ' + (k + 1) };
        if (a.act === 'pocket') mk('pocket', '포켓 ' + (k + 1) + (islands.length ? ' (섬 ' + islands.length + ')' : ''), C.newPocketSpec({ shape: 'poly', poly, depth: a.depth }), [[cx, cy]]);
        else mk('contour', (a.act === 'contour' ? '외곽 윤곽 ' : '안쪽 윤곽 ') + (k + 1), C.newMillSpec('contour', { shape: 'poly', poly, side: a.act === 'contour' ? 'out' : 'in', depth: a.depth, sideWidth: a.act === 'contour' && st.fit ? Math.max(0, st.margin) : 0 }), [[cx, cy]]);
      });
      // 바깥 윤곽은 맨 뒤로 (구멍·포켓을 먼저 깎고 마지막에 외곽)
      P.groups.sort((a, b) => (kindOf(a) === 'contour' && a.spec.side === 'out' ? 1 : 0) - (kindOf(b) === 'contour' && b.spec.side === 'out' ? 1 : 0));
      if (made.length) S.sel = { kind: 'group', gid: made[0].id, hid: null };
    });
    closeDlg(); S.dxf = null;
    toast('도면에서 가공을 만들었습니다. 각 가공의 깊이·공구를 확인하세요.', 'ok', { label: '되돌리기', fn: undo });
  }

  /* ---------------- 작업지시서 (셋업시트) ---------------- */
  function sheetHTML() {
    const m = machine(), st = P.stock, set = P.settings, ds = downloadState(), tm = C.toolMap(m), c = counts();
    const steps = S.V.plan.steps, used = [];
    steps.forEach(s => { if (!used.includes(s.toolNo)) used.push(s.toolNo); });
    const runSec = new Map(); if (S.est) S.est.runs.forEach(r => runSec.set(r.t, (runSec.get(r.t) || 0) + r.sec));
    let h = '<div class="sheet"><div class="sh-head"><div><h1>작업지시서 (셋업시트)</h1><div>' + esc(P.name) + ' · O' + String(P.programNo).padStart(4, '0') + ' · ' + new Date().toISOString().slice(0, 10) + '</div></div>' +
      '<div class="sh-badge ' + (ds.ok ? (ds.test ? 'warn' : 'ok') : 'err') + '">' + (ds.ok ? (ds.test ? '검증용(TEST) — 실가공 검증 전' : '검증 통과') : 'NC 생성 차단: ' + esc(ds.why)) + '</div></div>';
    h += '<table class="sh-t"><tr><th>장비</th><td>' + esc(m.name) + ' (' + esc(m.control) + ')</td><th>NC 파일</th><td>' + esc(ds.ok ? ncFileName(ds) : '-') + '</td></tr>' +
      '<tr><th>소재</th><td>' + esc(C.MATERIALS[st.material] ? C.MATERIALS[st.material].label : st.material) + ' · ' + st.sx + ' × ' + st.sy + ' × ' + st.sz + ' mm</td><th>원점</th><td>' + esc(C.ORIGIN_LABEL[st.origin]) + ' · Z0 = 소재 윗면 · ' + esc(set.wcs) + '</td></tr>' +
      '<tr><th>초기점</th><td>Z' + set.initialZ + ' (' + (set.retract === 'G98' ? 'G98 초기점 복귀' : 'G99 R점 복귀') + ')</td><th>하부 여유</th><td>' + C.toNum(st.under, 0) + ' mm</td></tr>' +
      '<tr><th>예상 시간</th><td>' + (S.est ? '약 ' + fmtSec(S.est.total) + ' (절삭·이동 ' + fmtSec(S.est.cut) + ' + 공구 교환 ' + S.est.changes + '회)' : '-') + '</td><th>클램프</th><td>' + (P.clamps.length ? P.clamps.map((cl, i) => '#' + (i + 1) + ' X' + cl.x + ' Y' + cl.y + ' ' + cl.w + '×' + cl.h + ' H' + cl.height).join('<br>') : '없음') + '</td></tr>';
    h += '<tr><th>NC 해시</th><td colspan="3"><b>' + (S.nc.edited ? '수정본 — 저장할 때 다시 계산 (가공 기록 참고)' : esc(S.nc.hash || '-')) + '</b> <small>(NC 파일 맨 위 (NC HASH …) 줄과 같아야 이 지시서의 파일입니다)</small>' + (set.firstRun ? ' · <b>첫 가공 모드</b> (공정마다 M00, 이송 ' + set.firstFeed + '%)' : '') + (set.restart ? ' · 공구별 재시작 블록 N100…' : '') + '</td></tr>';
    h += '</table>' + sheetLayout();
    h += '<h2>공구표</h2><table class="sh-t"><tr><th>T</th><th>공구</th><th>날장</th><th>돌출</th><th>재질</th><th>사용 공정</th><th>시간(추정)</th><th>H 장비값</th><th>확인</th></tr>';
    used.forEach(no => {
      const t = tm.get(no), ss = steps.filter(s => s.toolNo === no);
      h += '<tr><td>T' + String(no).padStart(2, '0') + '</td><td>' + (t ? esc(C.toolLabel(t).replace(/^T\d+\s*/, '')) : '없음') + '</td><td>' + (t ? t.flute : '-') + '</td><td>' + (t && t.stick ? t.stick + (t.holderDia ? ' / Ø' + t.holderDia : '') : '<small>미입력</small>') + '</td><td>' + (t ? (t.mat === 'CARBIDE' ? '초경' : 'HSS') : '-') + '</td><td>' + ss.map(s => esc(C.OP_TYPES[s.type].label)).join(', ') + '</td><td>' + (runSec.has(no) ? fmtSec(runSec.get(no)) : '-') + '</td><td>' + (t && t.hVal ? t.hVal + ' <small>(측정값)</small>' : '') + '</td><td class="box"></td></tr>';
    });
    h += '</table><h2>가공 순서</h2><table class="sh-t"><tr><th>#</th><th>공정</th><th>공구</th><th>개수</th><th>R점 Z</th><th>공구 끝 Z</th><th>S</th><th>F</th></tr>';
    steps.forEach(s => {
      h += '<tr><td>' + s.idx + '</td><td>' + esc(C.OP_TYPES[s.type].label) + ' <small>' + esc(C.OP_TYPES[s.type].code) + '</small></td><td>T' + String(s.toolNo).padStart(2, '0') + '</td><td>' + s.holes.length + '</td><td>' + (C.isNum(s.r) ? 'Z' + uf(s.r) : '-') + '</td><td>' + (C.isNum(s.z) ? 'Z' + uf(s.z) : '-') + '</td><td>' + s.rpm + '</td><td>' + s.feed + '</td></tr>';
    });
    h += '</table>';
    const warns = S.V.issues.filter(i => i.level !== 'info' && !(i.cat === 11 && /실가공 검증 전/.test(i.msg))).slice(0, 20);
    if (warns.length || (c.vr && c.vr.warnings.length)) h += '<h2>확인 사항</h2><ul>' + warns.map(i => '<li>' + (i.level === 'error' ? '[오류] ' : '[경고] ') + esc(i.msg) + '</li>').join('') + (c.vr ? c.vr.warnings.slice(0, 10).map(x => '<li>[G코드 ' + x.line + '행] ' + esc(x.msg) + '</li>').join('') : '') + '</ul>';
    h += '<h2>가공 전 점검</h2><ul class="sh-check"><li>공구 길이 보정(H)·공작물 좌표계(' + esc(set.wcs) + ') 입력</li><li>Z를 띄운 드라이런(공회전) 확인</li><li>싱글 블록으로 첫 구멍·포켓 진입 확인</li><li>클램프·지그 위치, 소재 하부 여유 확인</li><li>탭 가공 시 이송·주축 오버라이드 100%</li></ul>';
    // [V0.6] 첫 가공 확인 서명란 (드라이런 → 싱글 블록 → 시편 측정)
    h += '<h2>첫 가공 확인</h2><table class="sh-t"><tr><th>단계</th><th>내용</th><th>결과</th><th>확인자 · 시각</th></tr>' +
      [['① 드라이런', 'Z 를 띄우고(또는 첫 가공 모드 M00 마다) 경로·클램프 확인'], ['② 싱글 블록', '공구 교환·H·' + set.wcs + '·첫 진입 확인'], ['③ 시편 가공', '위치·깊이·치수(게이지) 측정 → 가공 기록에 결과 입력']].map(r => '<tr><td>' + r[0] + '</td><td>' + esc(r[1]) + '</td><td class="box"></td><td></td></tr>').join('') + '</table>';
    h += '<table class="sh-t sh-sign"><tr><th>작성</th><td></td><th>확인</th><td></td><th>작업자</th><td></td></tr></table>';
    h += '<p class="sh-foot">푸른 AI CAM ' + C.VERSION + ' · 예상 시간은 급속 ' + m.rapid + 'mm/min, 공구 교환 ' + m.tcSec + '초 기준 추정치입니다 (가감속 미반영). 자동 검증은 실제 가공 안전을 보장하지 않습니다.</p></div>';
    return h;
  }
  // [V0.6] 작업지시서 배치도(소재·원점·클램프·가공 위치 번호) + 좌표표
  function sheetLayout() {
    const st = P.stock, r = C.stockRect(st), W = 640, pad = 28, tm = C.toolMap(machine());
    const sc = Math.min((W - 2 * pad) / Math.max(1, r.x1 - r.x0), 300 / Math.max(1, r.y1 - r.y0)), H = (r.y1 - r.y0) * sc + 2 * pad;
    const X = x => pad + (x - r.x0) * sc, Y = y => H - pad - (y - r.y0) * sc;
    let svg = '<svg class="sh-lay" viewBox="0 0 ' + W + ' ' + H.toFixed(0) + '" width="100%" role="img" aria-label="배치도">';
    svg += '<rect x="' + X(r.x0) + '" y="' + Y(r.y1) + '" width="' + ((r.x1 - r.x0) * sc).toFixed(1) + '" height="' + ((r.y1 - r.y0) * sc).toFixed(1) + '" fill="#eef2f6" stroke="#5c6b7a" stroke-width="1.2"/>';
    P.clamps.forEach((c, i) => { svg += '<rect x="' + X(Math.min(c.x, c.x + c.w)).toFixed(1) + '" y="' + Y(Math.max(c.y, c.y + c.h)).toFixed(1) + '" width="' + (Math.abs(c.w) * sc).toFixed(1) + '" height="' + (Math.abs(c.h) * sc).toFixed(1) + '" fill="#f4d9bf" stroke="#c46a12" stroke-dasharray="4 2"/><text x="' + X(c.x).toFixed(1) + '" y="' + (Y(Math.max(c.y, c.y + c.h)) - 3).toFixed(1) + '" font-size="10" fill="#9a4d06">클램프' + (i + 1) + '</text>'; });
    const rows = []; let n = 0;
    P.groups.forEach(g => {
      const e = G.extentOf(g, tm);
      g.holes.forEach(hh => {
        if (!C.isNum(hh.x) || !C.isNum(hh.y)) return;
        n++; rows.push([n, g.name, hh.x, hh.y, S.gzLabel ? S.gzLabel.get(g.id) : '']);
        if (e.face) return;
        if (e.pocket && e.rect) svg += '<rect x="' + (X(hh.x - e.w / 2)).toFixed(1) + '" y="' + (Y(hh.y + e.h / 2)).toFixed(1) + '" width="' + (e.w * sc).toFixed(1) + '" height="' + (e.h * sc).toFixed(1) + '" rx="' + (Math.min(e.cr || 0, e.w / 2, e.h / 2) * sc).toFixed(1) + '" fill="none" stroke="' + g.color + '" stroke-width="1.2"/>';
        else svg += '<circle cx="' + X(hh.x).toFixed(1) + '" cy="' + Y(hh.y).toFixed(1) + '" r="' + Math.max(2.5, (e.d || 3) / 2 * sc).toFixed(1) + '" fill="none" stroke="' + g.color + '" stroke-width="1.2"/>';
        svg += '<text x="' + (X(hh.x) + 4).toFixed(1) + '" y="' + (Y(hh.y) - 4).toFixed(1) + '" font-size="10" font-weight="700" fill="#1f2937">' + n + '</text>';
      });
    });
    svg += '<path d="M' + X(0) + ',' + Y(0) + 'h28M' + X(0) + ',' + Y(0) + 'v-28" stroke="#d62728" stroke-width="2"/><circle cx="' + X(0) + '" cy="' + Y(0) + '" r="3.5" fill="#111"/><text x="' + (X(0) + 5) + '" y="' + (Y(0) + 13) + '" font-size="10">' + esc(P.settings.wcs) + ' 원점</text></svg>';
    let h = '<h2>배치도 · 좌표표</h2><div class="sh-lwrap">' + svg + '</div>';
    if (rows.length) h += '<table class="sh-t sh-coord"><tr><th>#</th><th>가공</th><th>X</th><th>Y</th><th>깊이</th></tr>' + rows.slice(0, 120).map(r2 => '<tr><td>' + r2[0] + '</td><td>' + esc(r2[1]) + '</td><td>' + uf(r2[2]) + '</td><td>' + uf(r2[3]) + '</td><td>' + esc(r2[4] || '') + '</td></tr>').join('') + '</table>' + (rows.length > 120 ? '<small>처음 120개만 표시</small>' : '');
    return h;
  }
  function openSheet() {
    openDlg('작업지시서 (셋업시트)', () => sheetHTML(), u => u.btn(ico('i-print') + '인쇄', () => {
      let pa = $('#printArea'); if (!pa) { pa = document.createElement('div'); pa.id = 'printArea'; document.body.appendChild(pa); }
      pa.innerHTML = sheetHTML(); window.print();
    }, 'primary') + u.btn('닫기', () => closeDlg(), ''), { refresh: openSheet });
  }

  /* ---------------- 프로젝트 관리 ---------------- */
  function openProjects() {
    openDlg('프로젝트', u => {
      const list = Object.values(DB.projects).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      let h = '<div class="row">' + u.btn('+ 새 프로젝트', () => { const n = C.newProject(machine()); DB.projects[n.id] = n; switchProject(n.id); closeDlg(); }, 'primary sm') +
        u.btn('현재 프로젝트 파일로 내보내기', () => exportProject(), 'sm') +
        u.btn('프로젝트 파일 가져오기', () => pickFile('.json', importProject), 'sm') + '</div>';
      h += '<table class="tbl" style="margin-top:8px"><tr><th>이름</th><th>위치</th><th>수정</th><th></th></tr>';
      list.forEach(p => {
        const n = p.groups.reduce((s, g) => s + g.holes.length, 0);
        h += '<tr class="' + (p.id === P.id ? 'sel' : '') + '"><td>' + esc(p.name) + '</td><td>' + n + '</td><td><small>' + esc(String(p.updatedAt).slice(0, 16).replace('T', ' ')) + '</small></td><td style="white-space:nowrap">' +
          u.btn('열기', () => { switchProject(p.id); closeDlg(); }, 'sm', p.id === P.id ? 'disabled' : '') +
          u.btn('복제', () => { const c = C.normalizeProject(C.clone(p)); c.id = C.uid('p'); c.name = p.name + ' 복사'; c.updatedAt = new Date().toISOString(); DB.projects[c.id] = c; saveDB(true); openProjects(); }, 'sm') +
          u.btn('삭제', () => { if (Object.keys(DB.projects).length < 2) return toast('프로젝트는 최소 1개 필요합니다.', 'err'); if (!confirm('"' + p.name + '" 프로젝트를 삭제할까요? 되돌릴 수 없습니다.')) return; delete DB.projects[p.id]; if (p.id === P.id) switchProject(Object.keys(DB.projects)[0]); else saveDB(true); openProjects(); }, 'sm danger') + '</td></tr>';
      });
      h += '</table><p><small>모든 프로젝트는 이 PC 브라우저에만 자동 저장됩니다. 브라우저 데이터 삭제에 대비해 파일로 내보내거나 설정 → 전체 백업을 하세요.</small></p>';
      return h;
    });
  }
  function switchProject(id) {
    saveDB(true);
    P = DB.projects[id]; DB.currentProjectId = id;
    if (!DB.machines.find(m => m.id === P.machineId)) P.machineId = DB.machines[0].id;
    regenSpecs(); // 다른 프로젝트에서 장비·공구가 바뀌었을 수 있음
    S.undo = []; S.redo = []; S.sel = { kind: 'stock', gid: null, hid: null }; S.view.fitted = false; S.pathStep = 0;
    S.nc.edited = false; S.nc.editText = ''; S.nc.editVerify = null; S.sim.sig = ''; S.sim.stockSig = '';
    saveDB(true); renderAll();
  }
  function exportProject() {
    const m = machine();
    const data = { type: 'pcam-project', version: C.VERSION, exportedAt: new Date().toISOString(), project: P, machine: Object.assign(C.clone(m), { verified: false, approvals: [] }) };
    downloadText((P.name.replace(/[\\/:*?"<>|]+/g, '_') || 'project') + '.pcam.json', JSON.stringify(data, null, 1), 'application/json');
  }
  function importProject(txt) {
    const d = JSON.parse(txt);
    if (!d || d.type !== 'pcam-project' || !d.project) throw new Error('푸른 AI CAM 프로젝트 파일이 아닙니다.');
    const p = C.normalizeProject(d.project); p.id = C.uid('p'); p.updatedAt = new Date().toISOString();
    if (p.importWarnings) { p.importWarnings.forEach(w => toast(w, 'err')); delete p.importWarnings; }
    if (d.machine) {
      const m = C.normalizeMachine(d.machine); C.revoke(m, '다른 곳에서 가져옴');
      const ex = DB.machines.find(x => x.id === m.id);
      if (!ex) { DB.machines.push(m); toast('장비 "' + m.name + '" 를 추가했습니다 (실가공 검증 상태는 관리자 재승인 필요).', 'warn'); }
      p.machineId = m.id;
    }
    if (!DB.machines.find(x => x.id === p.machineId)) p.machineId = DB.machines[0].id;
    DB.projects[p.id] = p; switchProject(p.id); closeDlg(); toast('프로젝트를 가져왔습니다.', 'ok');
  }

  /* ---------------- 일반 설정 ---------------- */
  function applyTheme() {
    const t = DB.settings.theme;
    const dark = t === 'dark' || (t === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.fs = DB.settings.fs || 'm';
    if (DB.settings.dense) document.documentElement.dataset.dense = '1'; else delete document.documentElement.dataset.dense; // [V0.7] 모두 펼쳐 보기
    if (V3 && V3.ok) V3.setTheme(dark ? 'dark' : 'light');
  }
  // [V0.6] 도움말: 처음 사용 순서 · 용어집(검색) · 안전 수칙 · 단축키
  function openHelp() {
    S.helpQ = S.helpQ || '';
    openDlg('도움말 · 용어집', u => {
      let h = '<div class="help"><h3>처음 사용 순서</h3><ol class="howto">' +
        '<li><b>소재</b>: 왼쪽 [소재·고정]에서 크기·재질·클램프를 넣습니다.</li>' +
        '<li><b>원점·NC</b>: 원점 위치(G54), 초기점, 첫 가공 모드를 정합니다.</li>' +
        '<li><b>가공 추가</b>: [+ 가공 추가]를 누르고 구멍·탭·포켓… 또는 도면(DXF)을 고릅니다. 크기·깊이만 넣으면 공구와 조건이 자동으로 정해집니다. 더 바꿀 것은 아래 접힌 줄(옵션·고급 설정)을 누르세요.</li>' +
        '<li><b>위치</b>: 2D 화면에서 [위치 추가]로 찍거나 표에 X·Y 를 넣습니다. 포켓은 □ 손잡이로 크기를 끌어 바꿉니다.</li>' +
        '<li><b>확인</b>: 아래 [검증 결과]의 빨간 항목을 눌러 고치고, [3D 시뮬레이션]으로 처음부터 재생해 봅니다.</li>' +
        '<li><b>NC 저장</b>: 가공 전 점검을 체크하고 저장합니다. 처음 쓰는 장비·가공은 <b>첫 가공 모드</b>로 드라이런 → 싱글 블록 → 시편 순서로 확인하세요.</li></ol>' +
        '<h3>용어집</h3>' + u.text(S.helpQ, v => { S.helpQ = v; openHelp(); }, 'placeholder="찾을 낱말 (예: R점, 구배, 날장)"') +
        '<dl class="gloss">' + GLOSS.filter(g => !S.helpQ || g[0].includes(S.helpQ) || g[1].includes(S.helpQ)).map(g => '<dt>' + esc(g[0]) + '</dt><dd>' + esc(g[1]) + '</dd>').join('') + '</dl>' +
        '<h3>안전 수칙</h3><ul><li>자동 검증·3D 시뮬레이션은 실제 가공 안전을 보장하지 않습니다.</li><li>장비에 넣기 전 H(공구 길이)·G54 값, 클램프 위치, 하부 여유를 확인하세요.</li><li>TEST 표시 NC 는 실장비 승인 전 파일입니다. 관리자가 가공 종류별로 승인해야 TEST 가 사라집니다.</li><li>가공 기록에 결과(정상·불량·충돌)를 남기면 같은 사고를 막을 수 있습니다.</li></ul>' +
        '<h3>단축키</h3><p><small>F1 도움말 · Ctrl+Z/Y 되돌리기 · Ctrl+C/V/D 복사·붙여넣기·복제 · Delete 삭제 · F2 이름 · Alt+↑↓ 순서 · Space 3D 재생</small></p></div>';
      return h;
    }, u => u.btn('닫기', () => closeDlg(), 'primary'));
  }
  // ⓘ 설명 풍선
  function showTip(b) {
    closeTip();
    const d = document.createElement('div'); d.className = 'tippop'; d.id = 'tippop'; d.setAttribute('role', 'tooltip');
    d.textContent = b.dataset.tip; document.body.appendChild(d);
    const r = b.getBoundingClientRect(), w = Math.min(320, window.innerWidth - 16);
    d.style.width = w + 'px'; d.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left - 20)) + 'px';
    const below = r.bottom + 6 + d.offsetHeight < window.innerHeight; d.style.top = (below ? r.bottom + 6 : r.top - 6 - d.offsetHeight) + 'px';
  }
  function closeTip() { const t = $('#tippop'); if (t) t.remove(); }
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('.gi'); if (b) { e.preventDefault(); e.stopPropagation(); if ($('#tippop') && $('#tippop').textContent === b.dataset.tip) closeTip(); else showTip(b); return; } if (!e.target.closest || !e.target.closest('#tippop')) closeTip(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'F1') { e.preventDefault(); openHelp(); } if (e.key === 'Escape') closeTip(); });
  function openSettings() {
    S.admin.clicks = [];
    openDlg('설정', u => {
      const s = DB.settings;
      let h = '<div class="sect"><b>화면</b><div class="grid2">' +
        u.fld('테마', u.select(s.theme, [['system', '시스템 설정 따름'], ['light', '밝게'], ['dark', '어둡게']], v => { s.theme = v; applyTheme(); saveDB(); drawView(); })) +
        u.fld('글자 크기', u.select(s.fs, [['s', '작게'], ['m', '보통'], ['l', '크게']], v => { s.fs = v; applyTheme(); saveDB(); drawView(); })) + '</div>' +
        u.check(!!s.dense, v => { s.dense = v; S.openSec = {}; S.addOpen = false; S.kindOpen = false; applyTheme(); saveDB(); renderAll(); }, '모두 펼쳐 보기 (전문가용) — 접힌 항목과 ⋯ 안의 버튼을 처음부터 모두 표시') +
        '<div class="row" style="margin-top:8px">' + u.btn(ico('i-swap') + (layout().sw ? '패널 기본 자리로' : '왼쪽·오른쪽 패널 바꾸기'), () => { $('#togSwap').click(); closeDlg(); }, 'sm') + u.btn('화면 배치 초기화', () => { DB.settings.layout = null; DB.settings.order = null; saveDB(); location.reload(); }, 'sm', 'title="패널 크기·자리, 머리글 아이콘·탭 순서를 처음대로"') + '</div>' +
        '<small>머리글 아이콘과 화면·서랍 탭은 <b>끌어서</b> 원하는 순서·묶음으로 옮길 수 있습니다. 패널 경계를 끌면 크기가 바뀝니다.</small></div>';
      h += '<div class="sect"><b>소리·언어</b>' + u.check(s.sound, v => { s.sound = v; saveDB(); if (v) beep(); }, 'NC 생성 차단·검증 오류 시 경고음') +
        '<small>화면은 한국어, NC 파일 주석은 장비 호환을 위해 영문(ASCII)으로 출력됩니다.</small></div>';
      h += '<div class="sect"><b>공유·버전</b><div class="row">' + u.btn(ico('i-share') + '공유 링크·QR코드', () => openShare(), 'sm') + u.btn('업그레이드 / 버전 정보', () => openVersion(), 'sm') + u.btn('가공 기록 (' + (DB.records || []).length + ')', () => openRecords(), 'sm', 'title="NC 저장·작업 결과 기록 (NC 해시로 추적)"') + u.btn('도움말·용어집', () => openHelp(), 'sm') + '</div>' +
        '<small class="ver">푸른 AI CAM ' + C.VERSION + ' (' + C.BUILD_DATE + ')</small></div>';
      h += '<div class="sect"><b>데이터 백업·복원</b><div class="row">' +
        u.btn('전체 백업 (JSON)', () => backupAll(), 'sm') + u.btn('백업 복원', () => pickFile('.json', restoreAll), 'sm') + '</div>' +
        '<small>프로젝트·공정 묶음·공구·장비 설정을 한 파일로 저장합니다. 인증 정보는 백업에 포함되지 않습니다.</small></div>';
      h += '<div class="sect"><b>오픈소스 구성 요소</b><small>three.js r149 (MIT, 3D 표시) · qrcode-generator 1.4.4 (MIT, QR코드). 라이선스 전문은 HTML 파일 안에 포함되어 있습니다.</small></div>';
      h += '<p><small>데이터는 이 브라우저(localStorage)에만 저장되며 외부 서버로 전송되지 않습니다.</small></p>';
      return h;
    }, null, { head: u => u.btn('⚙', () => adminGearClick(), 'gear', 'id="gsGear" title="설정" aria-label="설정 아이콘"') });
  }
  // 숨겨진 관리자: 최초 입력부터 3초 이내 5회 연속 클릭/터치/Enter
  function adminGearClick() {
    const now = Date.now(), c = S.admin.clicks;
    if (!c.length || now - c[0] > 3000) { c.length = 0; }
    c.push(now);
    if (c.length >= 5) { c.length = 0; openAdminAuth(); }
  }
  function backupAll() {
    const data = { type: 'pcam-backup', version: C.VERSION, exportedAt: new Date().toISOString(), db: Object.assign({}, DB, { projects: Object.assign({}, DB.projects, { [P.id]: P }) }) };
    downloadText('pureun-cam-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data), 'application/json');
    toast('전체 백업 파일을 저장했습니다.', 'ok');
  }
  function restoreAll(txt) {
    const d = JSON.parse(txt);
    if (!d || d.type !== 'pcam-backup' || !d.db || !Array.isArray(d.db.machines)) throw new Error('푸른 AI CAM 백업 파일이 아닙니다.');
    if (!confirm('현재 브라우저의 모든 데이터를 백업 파일 내용으로 바꿉니다. 계속할까요?\n(복원 전 현재 데이터를 자동 백업합니다)')) return;
    backupAll();
    const nd = { schema: 1, machines: d.db.machines.map(C.normalizeMachine), bundles: (d.db.bundles || []).map(b => { const n = C.normalizeBundle(b); if (n.importWarnings) { toast(n.importWarnings[0], 'err'); delete n.importWarnings; } return n; }), projects: {}, settings: Object.assign({}, DB.settings, d.db.settings || {}) };
    nd.machines.forEach(m => { C.revoke(m, '백업 복원'); });
    Object.values(d.db.projects || {}).forEach(p => { const n = C.normalizeProject(p); if (n.importWarnings) { toast('[' + n.name + '] ' + n.importWarnings[0], 'err'); delete n.importWarnings; } nd.projects[n.id] = n; });
    if (!nd.machines.length) throw new Error('장비 정보가 없습니다.');
    if (!Object.keys(nd.projects).length) { const n = C.newProject(nd.machines[0]); nd.projects[n.id] = n; }
    Object.values(nd.projects).forEach(p => { if (!nd.machines.find(m => m.id === p.machineId)) p.machineId = nd.machines[0].id; });
    nd.currentProjectId = nd.projects[d.db.currentProjectId] ? d.db.currentProjectId : Object.keys(nd.projects)[0];
    DB = nd; P = DB.projects[DB.currentProjectId]; regenSpecs();
    S.undo = []; S.redo = []; S.view.fitted = false; S.nc.edited = false; S.sim.sig = '';
    saveDB(true); closeDlg(); applyTheme(); applyLayout(); renderAll();
    toast('복원했습니다. 장비 실가공 검증 상태는 관리자 재승인이 필요합니다.', 'warn');
  }

  /* ---------------- 공유·QR ---------------- */
  function shareURL() { return /^https?:$/.test(location.protocol) ? location.href.split('#')[0].split('?')[0] : null; }
  function openShare() {
    const url = shareURL();
    openDlg('앱 공유', u => {
      if (!url) return '<p>현재 <b>로컬 파일</b>(' + esc(location.protocol) + ')로 실행 중이라 다른 기기에서 접속할 수 있는 공유 주소가 없습니다.</p><p><small>웹 서버(예: GitHub Pages, Firebase Hosting)에 배포한 뒤 그 주소에서 열면 링크·QR코드 공유가 가능합니다. 지금은 HTML 파일 자체를 USB·메일로 전달하세요.</small></p>' +
        '<p><small>공유에는 앱 주소만 포함되며 프로젝트 데이터·인증 정보는 포함되지 않습니다.</small></p>';
      return '<div class="qrbox"><canvas id="qrCanvas" aria-label="앱 주소 QR코드"></canvas><input type="text" readonly value="' + esc(url) + '" style="width:100%"><div class="row">' +
        u.btn('링크 복사', () => copyText(url), 'sm') + (navigator.share ? u.btn('공유하기', () => navigator.share({ title: '푸른 AI CAM', url }).catch(() => { }), 'sm') : '') +
        u.btn('QR 이미지 저장', () => { const c = $('#qrCanvas'); c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'pureun-ai-cam-qr.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }); }, 'sm') + '</div>' +
        '<small>앱 주소만 공유됩니다. 프로젝트 데이터·인증 정보는 포함되지 않습니다.</small></div>';
    }, null, { second: !!$('#dlg').open });
    if (url) drawQR($('#qrCanvas'), url);
  }
  function drawQR(c, text) {
    try {
      const q = window.qrcode(0, 'M'); q.addData(text, 'Byte'); q.make();
      const n = q.getModuleCount(), cell = 8, quiet = 4, size = (n + quiet * 2) * cell;
      c.width = size; c.height = size;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, size, size); x.fillStyle = '#000';
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) x.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
    } catch (e) { toast('QR코드 생성 실패: ' + e.message, 'err'); }
  }

  /* ---------------- 버전·업그레이드 ---------------- */
  function openVersion() {
    openDlg('버전 정보·업그레이드', () => {
      let h = '<div class="grid2"><div class="fld"><span>현재 버전</span><b>' + C.VERSION + ' (' + C.BUILD_DATE + ')</b></div><div class="fld"><span>최신 버전</span><b id="latestVer">' + (shareURL() ? '확인 중…' : '확인 불가 (로컬 파일)') + '</b></div></div>';
      h += '<h3>변경 내역</h3>' + CHANGELOG.map(c => '<div class="sect"><b>' + c.v + ' · ' + c.d + '</b><ul>' + c.items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul></div>').join('');
      h += '<h3>업데이트 방법</h3><ul><li>웹 배포판: 새 버전이 배포되면 페이지를 새로 고침하면 적용됩니다.</li><li>로컬 HTML 파일: 새 버전 HTML 파일로 교체하세요. 같은 브라우저에서 열면 저장 데이터가 유지됩니다.</li><li>업데이트 전에 <b>설정 → 전체 백업</b>을 권장합니다. 문제가 생기면 이전 HTML 파일과 백업으로 복구할 수 있습니다.</li></ul><p><small>자동 업데이트 기능은 없습니다.</small></p>';
      return h;
    }, null, { second: !!$('#dlg').open });
    if (shareURL()) {
      fetch('version.json?ts=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject(r.status)).then(j => {
        const el = $('#latestVer'); if (!el) return;
        el.textContent = String(j.version || '?') + (j.version === C.VERSION ? ' (최신)' : ' — 새 버전이 있습니다. 새로 고침하세요.');
      }).catch(() => { const el = $('#latestVer'); if (el) el.textContent = '확인 실패 (version.json 없음)'; });
    }
  }

  /* ---------------- 관리자 인증·설정 ---------------- */
  // 관리자 해시 도구는 저장 모듈(ui/storage.js)
  function openAdminAuth() {
    if (!window.crypto || !crypto.subtle) return toast('이 브라우저 환경에서는 안전한 암호화 기능을 쓸 수 없어 관리자 설정을 열 수 없습니다 (https 또는 로컬 파일로 실행).', 'err');
    const rec = adminRec();
    if (!rec) {
      openDlg('관리자 비밀번호 등록', u => '<p>이 기기(브라우저)에서 처음 관리자 설정을 엽니다. 관리자 비밀번호를 등록하세요.</p><div class="grid2">' +
        '<label class="fld"><span>새 비밀번호 (8자 이상, 영문+숫자)</span><input type="password" id="apw1" autocomplete="new-password"></label>' +
        '<label class="fld"><span>비밀번호 확인</span><input type="password" id="apw2" autocomplete="new-password"></label></div>' +
        '<p><small>비밀번호 원문은 저장하지 않고 PBKDF2-SHA256 해시만 이 브라우저에 저장합니다. 기기별로 따로 등록되며 동기화되지 않습니다. 브라우저 저장소는 PC 사용자 계정 보안에 의존합니다.</small></p>',
        u => u.btn('등록', async () => {
          const a = $('#apw1').value, b = $('#apw2').value;
          if (!pwRule(a)) return toast('8자 이상, 영문과 숫자를 포함하세요.', 'err');
          if (a !== b) return toast('비밀번호 확인이 일치하지 않습니다.', 'err');
          const salt = crypto.getRandomValues(new Uint8Array(16)), iter = 150000;
          const hash = await pbkdf2(a, salt, iter);
          lsSet(ADMIN_KEY, JSON.stringify({ v: 1, salt: b64(salt), iter, hash, fails: 0, lockUntil: 0 }));
          toast('관리자 비밀번호를 등록했습니다.', 'ok'); startAdmin();
        }, 'primary'), { second: true });
      return;
    }
    const lockLeft = () => Math.max(0, (rec.lockUntil || 0) - Date.now());
    openDlg('관리자 인증', u => (lockLeft() ? '<p style="color:var(--err)">인증 실패가 반복되어 잠겨 있습니다. ' + Math.ceil(lockLeft() / 60000) + '분 후 다시 시도하세요.</p>' : '') +
      '<label class="fld"><span>관리자 비밀번호</span><input type="password" id="apw" autocomplete="current-password"></label>' +
      '<p><small>5회 실패 시 5분간 잠깁니다. ' + (rec.fails ? '현재 실패 ' + rec.fails + '회' : '') + '</small></p>' +
      '<details><summary><small>비밀번호를 잊으셨나요?</small></summary><p><small>재설정하면 관리자 비밀번호가 삭제되고, 보안을 위해 모든 장비의 실가공 검증 승인도 해제됩니다.</small></p>' +
      u.btn('비밀번호 재설정', () => {
        if (prompt('재설정하려면 "재설정" 을 입력하세요.') !== '재설정') return;
        try { localStorage.removeItem(ADMIN_KEY); } catch (e) { /* 저장소 접근 불가 */ }
        DB.machines.forEach(m => { C.revoke(m, '관리자 전체 해제'); });
        saveDB(true); closeDlg($('#dlg2')); renderAll(); toast('관리자 비밀번호를 재설정했습니다. 다시 등록하세요.', 'warn');
      }, 'sm danger') + '</details>',
      u => u.btn('확인', async () => {
        const r = adminRec(); if (!r) return;
        if (Math.max(0, (r.lockUntil || 0) - Date.now())) return toast('잠금 중입니다.', 'err');
        const pw = $('#apw').value; if (!pw) return;
        const hash = await pbkdf2(pw, unb64(r.salt), r.iter);
        if (safeEq(hash, r.hash)) { r.fails = 0; r.lockUntil = 0; lsSet(ADMIN_KEY, JSON.stringify(r)); startAdmin(); }
        else {
          r.fails = (r.fails || 0) + 1;
          if (r.fails >= 5) { r.fails = 0; r.lockUntil = Date.now() + 5 * 60000; toast('5회 실패 — 5분간 잠깁니다.', 'err'); }
          else toast('비밀번호가 틀렸습니다 (' + r.fails + '/5).', 'err');
          lsSet(ADMIN_KEY, JSON.stringify(r)); beep(); openAdminAuth();
        }
      }, 'primary'), { second: true });
    setTimeout(() => { const i = $('#apw'); if (i) { i.focus(); i.onkeydown = e => { if (e.key === 'Enter') $('#dlg2 .dfoot button').click(); }; } }, 50);
  }
  let adminTimer = null;
  function startAdmin() {
    S.admin.authed = true; S.admin.until = Date.now() + 10 * 60000;
    clearTimeout(adminTimer); adminTimer = setTimeout(endAdmin, 10 * 60000);
    openAdminPanel();
  }
  function endAdmin() { S.admin.authed = false; clearTimeout(adminTimer); const d = $('#dlg2'); if (d.open && d.dataset.admin === '1') d.close(); }
  function openAdminPanel() {
    if (!S.admin.authed || Date.now() > S.admin.until) { S.admin.authed = false; return openAdminAuth(); }
    const d = openDlg('관리자 설정', u => {
      let h = '<div class="adm"><b>⚠ 관리자 모드</b> <small>창을 닫거나 10분이 지나면 자동 종료되며 다시 인증해야 합니다.</small></div>';
      h += '<h3>장비 실가공 검증 승인 <small>(가공 종류 × 앱 버전 ' + esc(C.VERSION) + ')</small></h3><p><small>실제 머시닝센터에서 <b>그 가공 종류를</b> 시편으로 깎아 확인한 것만 승인하세요. 승인되지 않은 가공이 하나라도 있으면 NC 는 "검증용(TEST)"입니다. 버전이 바뀌거나 장비·공구 설정을 바꾸면 승인은 다시 받아야 합니다. 승인·해제 이력은 지워지지 않습니다.</small></p>';
      const used = [...new Set((S.V.plan.steps || []).map(st => st.type))];
      DB.machines.forEach(m => {
        const id = m.id.replace(/[^a-z0-9]/gi, ''), ap = C.approvalOf(m, S.V.plan);
        h += '<div class="sect"><b>' + esc(m.name) + '</b> ' + approvalHTML(m);
        if (m.approvals.length) h += u.btn('모든 승인 해제', () => { C.revoke(m, '관리자 해제'); saveDB(true); renderAll(); openAdminPanel(); }, 'sm danger');
        const kinds = C.OPS.ready().map(d => d.id).filter(k => k !== 'pocket');
        h += '<details' + (ap.ok ? '' : ' open') + '><summary>새 승인 추가</summary><div class="apkinds">' + kinds.map(k => '<label class="chk"><input type="checkbox" class="apk' + id + '" value="' + esc(k) + '"' + (used.includes(k) && !ap.approved.includes(k) ? ' checked' : '') + '>' + esc((C.OPS.get(k) || {}).label || k) + (used.includes(k) ? ' <small>(이 프로젝트)</small>' : '') + '</label>').join('') + '</div>' +
          '<label class="chk"><input type="checkbox" id="vc1' + id + '">[첫 가공 모드] NC 로 Z를 띄운 드라이런(공회전) 경로 확인</label><label class="chk"><input type="checkbox" id="vc2' + id + '">싱글 블록 운전으로 공구 교환·H·G54·사이클 확인</label><label class="chk"><input type="checkbox" id="vc3' + id + '">시편 실가공 후 위치·깊이·치수(게이지) 측정 확인</label>' +
          '<div class="grid2"><label class="fld"><span>확인자</span><input type="text" id="vby' + id + '" maxlength="40"></label><label class="fld"><span>시편 NC 해시</span><input type="text" id="vha' + id + '" maxlength="12" value="' + esc(S.nc.hash || '') + '"></label></div><label class="fld"><span>측정 결과·메모</span><input type="text" id="vno' + id + '" maxlength="300" placeholder="예: Ø6H7 게이지 통과, 포켓 깊이 10.01"></label>' +
          u.btn('선택한 가공 승인', () => {
            const sel = [...document.querySelectorAll('.apk' + id)].filter(x => x.checked).map(x => x.value);
            if (!sel.length) return toast('승인할 가공 종류를 고르세요.', 'err');
            if (![1, 2, 3].every(k => $('#vc' + k + id).checked)) return toast('세 가지 실장비 시험을 모두 확인하세요.', 'err');
            const by = $('#vby' + id).value.trim(); if (!by) return toast('확인자를 입력하세요.', 'err');
            const at = new Date().toISOString().slice(0, 16).replace('T', ' '), note = $('#vno' + id).value.trim(), hash = $('#vha' + id).value.trim().toUpperCase();
            m.approvals.push(C.normApproval({ kinds: sel, ver: C.VERSION, hash, by, at, note }));
            m.verified = true; m.verifiedBy = by; m.verifiedAt = at.slice(0, 10); m.verifyNote = note;
            m.history = (m.history || []).concat([{ at, what: '승인 (' + C.VERSION + '): ' + sel.map(k => (C.OPS.get(k) || {}).label || k).join(', ') + (hash ? ' · NC ' + hash : '') + (note ? ' · ' + note : ''), by }]).slice(-500);
            saveDB(true); renderAll(); openAdminPanel(); toast('선택한 가공을 승인했습니다.', 'ok');
          }, 'sm primary') + '</details>';
        if (m.history && m.history.length) h += '<details><summary>승인·해제 이력 (' + m.history.length + ')</summary><ul class="hist">' + m.history.slice().reverse().slice(0, 30).map(x => '<li><small>' + esc(x.at) + '</small> ' + esc(x.what) + (x.by ? ' <small>· ' + esc(x.by) + '</small>' : '') + '</li>').join('') + '</ul></details>';
        h += '</div>';
      });
      h += '<h3>관리자 비밀번호 변경</h3><div class="grid3"><label class="fld"><span>현재 비밀번호</span><input type="password" id="cpw0" autocomplete="current-password"></label><label class="fld"><span>새 비밀번호</span><input type="password" id="cpw1" autocomplete="new-password"></label><label class="fld"><span>새 비밀번호 확인</span><input type="password" id="cpw2" autocomplete="new-password"></label></div>' +
        u.btn('비밀번호 변경', async () => {
          const r = adminRec(), a = $('#cpw1').value;
          if (!safeEq(await pbkdf2($('#cpw0').value, unb64(r.salt), r.iter), r.hash)) return toast('현재 비밀번호가 틀렸습니다.', 'err');
          if (!pwRule(a)) return toast('8자 이상, 영문과 숫자를 포함하세요.', 'err');
          if (a !== $('#cpw2').value) return toast('새 비밀번호 확인이 일치하지 않습니다.', 'err');
          const salt = crypto.getRandomValues(new Uint8Array(16));
          lsSet(ADMIN_KEY, JSON.stringify({ v: 1, salt: b64(salt), iter: r.iter, hash: await pbkdf2(a, salt, r.iter), fails: 0, lockUntil: 0 }));
          ['cpw0', 'cpw1', 'cpw2'].forEach(k => { $('#' + k).value = ''; }); toast('비밀번호를 변경했습니다.', 'ok');
        }, 'sm');
      h += '<h3>데이터 초기화</h3><p><small>이 브라우저의 모든 프로젝트·장비·공정 묶음을 지우고 초기 상태로 되돌립니다 (자동 백업 후 진행).</small></p>' +
        u.btn('전체 데이터 초기화', () => {
          if (prompt('초기화하려면 "초기화" 를 입력하세요.') !== '초기화') return;
          backupAll(); DB = freshDB(); P = DB.projects[DB.currentProjectId]; S.undo = []; S.redo = []; S.view.fitted = false; S.nc.edited = false; S.sim.sig = '';
          saveDB(true); renderAll(); endAdmin(); toast('초기화했습니다.', 'warn');
        }, 'sm danger');
      return h;
    }, null, { second: true, onClose: () => { S.admin.authed = false; clearTimeout(adminTimer); } });
    d.dataset.admin = '1';
  }

  /* ---------------- 시작 ---------------- */
  function init() {
    DB = loadDB();
    P = DB.projects[DB.currentProjectId] || Object.values(DB.projects)[0];
    if (!P) { const n = C.newProject(DB.machines[0]); DB.projects[n.id] = n; P = n; }
    if (!DB.machines.find(m => m.id === P.machineId)) P.machineId = DB.machines[0].id;
    regenSpecs(); // 저장된 간편 입력 그룹을 현재 장비·소재 기준으로 다시 구성
    applyTheme();
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); drawView(); });
    $('#projName').addEventListener('change', e => mutate(() => { P.name = e.target.value.slice(0, 60) || '프로젝트'; }));
    $('#btnProjects').onclick = openProjects;
    $('#btnTools').onclick = openTools;
    $('#btnSheet').onclick = openSheet;
    $('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo;
    $('#btnDownload').onclick = doDownload;
    $('#btnShare').onclick = openShare;
    $('#btnSettings').onclick = openSettings;
    $('#btnHelp').onclick = openHelp;
    $('#btnMore').onclick = () => {
      if (DENSE()) { const t = $('#top'), on = !t.classList.contains('more'); t.classList.toggle('more', on); $('#btnMore').setAttribute('aria-expanded', on); return; }
      const r = $('#btnMore').getBoundingClientRect(), go = id => () => $('#' + id).click();
      const extra = [{ label: '작업지시서 인쇄', fn: go('btnSheet') }, { label: '공유 링크·QR코드', fn: go('btnShare') }, { label: document.documentElement.dataset.theme === 'dark' ? '밝게 보기' : '어둡게 보기', fn: go('btnTheme') }];
      // 휴대폰은 머리글 버튼이 모두 숨어 있으므로 전부 메뉴에
      openMenu(Math.max(8, r.right - 220), r.bottom + 6, mobile() ? [{ label: '되돌리기', fn: undo, disabled: !S.undo.length }, { label: '다시 하기', fn: redo, disabled: !S.redo.length }, '-', { label: '프로젝트', fn: go('btnProjects') }, { label: '장비·공구', fn: go('btnTools') }].concat(extra, ['-', { label: '도움말·용어집', fn: go('btnHelp') }, { label: '설정', fn: go('btnSettings') }]) : extra);
    };
    $('#btnTheme').onclick = () => { DB.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(); saveDB(); renderAll(); };
    $('#tab2d').onclick = () => setVMode('2d'); $('#tab3d').onclick = () => setVMode('3d');
    $('#drawerClose').onclick = () => { S.drawer = false; S.view.fitted = false; renderAll(); };
    document.querySelectorAll('#bottomTabs button[data-tab]').forEach(b => b.onclick = () => { S.bottomTab = b.dataset.tab; renderAll(); });
    document.querySelectorAll('#mnav button').forEach(b => b.onclick = () => { S.mpanel = b.dataset.m; renderAll(); });
    document.addEventListener('keydown', e => {
      const tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      const dlg = document.querySelector('dialog[open]');
      if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (!typing && !dlg && (e.key === 'Delete' || e.key === 'Backspace') && S.sel.hid && S.vmode === '2d' && !e.target.closest('#tree')) { e.preventDefault(); deleteSelectedHole(); }
      // [V0.5] 작업 목록 편집 단축키 (입력 칸·대화상자 밖)
      else if (!typing && !dlg && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !(window.getSelection && String(window.getSelection()))) {
        if (S.sel.hid && S.vmode === '2d' && !e.target.closest('#tree')) { const g = curGroup(), h = g && g.holes.find(x => x.id === S.sel.hid); if (h) { e.preventDefault(); S.clip = { type: 'hole', gid: g.id, x: h.x, y: h.y }; toast('위치 복사 — 2D 화면에서 붙일 곳에 마우스를 두고 Ctrl+V'); } }
        else if (S.sel.kind === 'group') { e.preventDefault(); copyGroup(curGroup()); }
      }
      else if (!typing && !dlg && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteClip(); }
      else if (!typing && !dlg && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); if (S.sel.kind === 'group') dupGroup(curGroup()); }
      else if (!typing && !dlg && (e.key === 'Delete' || e.key === 'Backspace') && S.sel.kind === 'group') { e.preventDefault(); delGroup(curGroup()); }
      else if (!typing && !dlg && e.key === 'F2' && S.sel.kind === 'group') { e.preventDefault(); renameGroup(curGroup()); }
      else if (!typing && !dlg && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && S.sel.kind === 'group') { e.preventDefault(); const it = $('#tree .titem.sel'), r = it ? it.getBoundingClientRect() : { left: 100, bottom: 200 }; groupMenu(curGroup(), r.left + 40, r.bottom - 8); }
      else if (!typing && !dlg && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && S.sel.kind === 'group') { e.preventDefault(); moveGroup(curGroup(), e.key === 'ArrowUp' ? -1 : 1); requestAnimationFrame(() => { const it = $('#tree .titem.sel'); if (it) it.focus(); }); }
      else if (!typing && !dlg && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target.closest && e.target.closest('#tree')) {
        const items = [...document.querySelectorAll('#tree .titem')], i = items.indexOf(e.target.closest('.titem')), nx = items[i + (e.key === 'ArrowUp' ? -1 : 1)];
        if (nx) { e.preventDefault(); nx.click(); requestAnimationFrame(() => { const all = [...document.querySelectorAll('#tree .titem')]; if (all[i + (e.key === 'ArrowUp' ? -1 : 1)]) all[i + (e.key === 'ArrowUp' ? -1 : 1)].focus(); }); }
      }
      else if (e.key === 'Escape') {
        closeMenu();
        const pops = document.querySelectorAll('details.pop[open]'); pops.forEach(d => { d.open = false; if (d.dataset.sec) S.openSec[d.dataset.sec] = false; });
        if (S.addOpen) { S.addOpen = false; renderTree(); }
        if (S.kindOpen) { S.kindOpen = false; renderProps(); }
        if (!typing && S.mode !== 'select') setMode('select');
      }
      else if (!typing && !dlg && e.key === ' ' && S.vmode === '3d' && V3 && V3.ok && !(e.target.getAttribute && e.target.getAttribute('role') === 'button') && e.target.tagName !== 'BUTTON') { e.preventDefault(); if (V3.isPlaying()) V3.pause(); else V3.play(); }
      else if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); openAdminAuth(); } // 접근성용 대체 관리자 진입 (비밀번호 필요)
    });
    window.addEventListener('beforeunload', () => saveDB(true));
    window.addEventListener('afterprint', () => { const pa = $('#printArea'); if (pa) pa.innerHTML = ''; });
    initCanvas(); initTreeEvents(); initSplitters(); initArrange(); applyLayout();
    // 처음 실행(가공 없음)에는 소재부터, 가공이 있으면 첫 가공을 선택
    if (P.groups.length) S.sel = { kind: 'group', gid: P.groups[0].id, hid: null };
    renderAll();
    requestAnimationFrame(() => { S.view.fitted = false; drawView(); });
  }
  window.addEventListener('DOMContentLoaded', init);
  window.__PCAM_UI__ = { setDense(v) { DB.settings.dense = !!v; S.openSec = {}; S.addOpen = false; S.kindOpen = false; applyTheme(); renderAll(); }, get P() { return P; }, get S() { return S; }, get DB() { return DB; }, get V3() { return V3; }, renderAll, downloadState, setVMode, openDXF, mutate, G };
})();
