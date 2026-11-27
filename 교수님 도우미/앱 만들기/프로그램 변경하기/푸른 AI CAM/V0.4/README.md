# 푸른 AI CAM V0.4

소규모 기계가공 업체용 **FANUC 3축 머시닝센터 2.5축 CAM (구멍·탭·포켓)**. 설치 없는 단일 HTML 웹앱으로, 오프라인에서 동작하고 서버·AI API 비용이 없다.

V0.4 는 V0.3 을 바탕으로 한 **프로그램 변경** 버전이다 (2단계). 주요 변경은 다음과 같다.
- **화면 전면 재설계**: 작업 목록 → 속성 → 2D/3D → 상태 표시줄 구조. 산업용 CAM 배치와 오픈소스 CAM 분석 결과를 반영했다.
- **포켓 가공 추가**: 사각(코너 R)·원형 포켓. 헬리컬 진입 후 황삭·정삭한다.
- **3D 가공 시뮬레이션**: 실제 NC 해석 결과로 소재를 깎아 보여 준다. 회전·확대·재생할 수 있고, 현재 X·Y·Z 를 표시한다.
- **Z값 표시**: 깊이 단면도, 2D 바닥 Z, 위치 표, 3D HUD 에서 확인한다.
- **작업지시서 인쇄**와 **예상 가공 시간(추정)**.

## 관련 폴더
- 변경 전 버전: `../V0.3/` (보존, 수정하지 않음)
- 검증 보고서: `교수님 도우미/앱 만들기/프로그램 검증하기/푸른 AI CAM/V0.4_검증보고서.md`

## 실행 파일과 문서
- 실행 파일: [`pureun-ai-cam.html`](pureun-ai-cam.html). 더블클릭해 크롬이나 엣지로 연다.
- 사용 방법: [`docs/사용방법.md`](docs/사용방법.md)
- 구현 기능: [`docs/기능설명.md`](docs/기능설명.md)
- 모듈 구조·연결 규칙: [`docs/모듈구조.md`](docs/모듈구조.md)
- 오픈소스 CAM·커뮤니티 분석과 반영 내역: [`docs/오픈소스CAM_참고분석.md`](docs/오픈소스CAM_참고분석.md)
- 테스트 결과: [`docs/테스트결과.md`](docs/테스트결과.md)
- 라이선스: [`docs/라이선스.md`](docs/라이선스.md)

> ⚠ 자동 검증과 3D 시뮬레이션은 실제 가공 안전을 보장하지 않습니다.
> - 첫 가공은 반드시 드라이런·싱글 블록·시편 가공으로 작업자가 확인하세요.
> - 실장비 검증 전 NC 파일은 `TEST_` 로 표시됩니다.

## 폴더 구성
```
V0.4/
├─ pureun-ai-cam.html   실행 파일 (빌드 결과, 약 960KB — 이 중 three.js 600KB)
├─ version.json         웹 배포 시 최신 버전 확인용
├─ build.mjs            src/ → 단일 HTML 자동 통합 (순서: src/modules.json)
├─ src/                 기능별 소스 — 구조는 docs/모듈구조.md
│  ├─ engine/  ops/  process/  post/  verify/  sim/  ui/
│  ├─ modules.json  load-node.cjs  template.html  style.css
│  └─ vendor/           qrcode-generator 1.4.4 (MIT), three.js r149 (MIT) + 라이선스
├─ tests/               단위·전후 비교·포켓·브라우저 통합 테스트
└─ docs/
```

## 개발자용 명령 (Node.js 18 이상)
```bash
node build.mjs                     # src/ 를 pureun-ai-cam.html 로 통합
node --test tests/*.test.cjs       # 엔진 단위 + 전후 비교(V0.1·V0.2·V0.3) + 포켓 테스트
node tests/e2e.cjs [스크린샷폴더]   # 브라우저 통합 테스트 (Playwright 필요, WebGL 은 소프트웨어 렌더링)
```
- 전후 비교 테스트는 `프로그램 만들기/푸른 AI CAM/V0.1`, `V0.2` 폴더와 `../V0.3` 폴더를 사용한다. 폴더가 없으면 건너뛴다.
- 소스를 고친 뒤에는 반드시 빌드하고 세 가지 테스트를 모두 실행한다.
