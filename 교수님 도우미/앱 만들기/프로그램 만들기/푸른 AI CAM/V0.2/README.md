# 푸른 AI CAM V0.2

소규모 기계가공 업체용 **FANUC 3축 머시닝센터 2.5축 홀 가공 CAM** — 설치 없는 단일 HTML 웹앱 (오프라인, 서버·AI API 비용 없음).
V0.2 는 V0.1 과 같은 기능을 **기능별 모듈 구조**로 다시 짜고, 독립 검증에서 나온 안전 결함 9건을 고친 버전이다.

- 실행 파일: [`pureun-ai-cam.html`](pureun-ai-cam.html) — 더블클릭하여 크롬/엣지로 실행
- 사용 방법: [`docs/사용방법.md`](docs/사용방법.md)
- 구현 기능: [`docs/기능설명.md`](docs/기능설명.md)
- **모듈 구조·연결 규칙**: [`docs/모듈구조.md`](docs/모듈구조.md)
- 테스트 결과·문제점: [`docs/테스트결과.md`](docs/테스트결과.md)
- 라이선스: [`docs/라이선스.md`](docs/라이선스.md)

> ⚠ 자동 검증은 실제 가공 안전을 보장하지 않습니다. 첫 가공은 반드시 드라이런·싱글 블록·시편 가공으로 작업자가 확인하세요. 실장비 검증 전 NC 파일은 `TEST_` 로 표시됩니다.

## 폴더 구성
```
V0.2/
├─ pureun-ai-cam.html   실행 파일 (빌드 결과, 모듈 21개를 단일 파일로 통합)
├─ version.json         웹 배포 시 최신 버전 확인용
├─ build.mjs            src/ → 단일 HTML 자동 통합 (순서: src/modules.json)
├─ src/                 기능별 소스 — 구조는 docs/모듈구조.md
│  ├─ engine/  ops/  process/  post/  verify/  ui/
│  ├─ modules.json  load-node.cjs  template.html  style.css
│  └─ vendor/           qrcode-generator 1.4.4 (MIT) + 라이선스
├─ tests/               단위·전후 비교·안전 수정·브라우저 통합 테스트
└─ docs/
```

## 개발자용 명령 (Node.js 18 이상)
```bash
node build.mjs                     # src/ 를 pureun-ai-cam.html 로 통합
node --test tests/*.test.cjs       # 엔진 단위 + 모듈화 전후 비교 + 안전 수정 테스트
node tests/e2e.cjs [스크린샷폴더]   # 브라우저 통합 테스트 (Playwright 필요)
```
- 전후 비교 테스트는 옆 폴더 `../V0.1/src/core.js` 를 사용한다 (V0.1 폴더가 없으면 건너뜀).
- 소스를 고친 뒤에는 반드시 빌드하고 세 가지 테스트를 모두 실행한다.
