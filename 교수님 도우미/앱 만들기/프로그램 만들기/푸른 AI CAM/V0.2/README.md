# 푸른 AI CAM V0.1

소규모 기계가공 업체용 **FANUC 3축 머시닝센터 2.5축 홀 가공 CAM** — 설치 없는 단일 HTML 웹앱 (오프라인, 서버·AI API 비용 없음).

- 실행 파일: [`pureun-ai-cam.html`](pureun-ai-cam.html) — 더블클릭하여 크롬/엣지로 실행
- 사용 방법: [`docs/사용방법.md`](docs/사용방법.md)
- 구현 기능: [`docs/기능설명.md`](docs/기능설명.md)
- 테스트 결과·문제점: [`docs/테스트결과.md`](docs/테스트결과.md)
- 라이선스: [`docs/라이선스.md`](docs/라이선스.md)

> ⚠ 자동 검증은 실제 가공 안전을 보장하지 않습니다. 첫 가공은 반드시 드라이런·싱글 블록·시편 가공으로 작업자가 확인하세요.

## 폴더 구성
```
V0.1/
├─ pureun-ai-cam.html     실행 파일 (빌드 결과, 단일 파일)
├─ version.json           웹 배포 시 최신 버전 확인용
├─ build.mjs              src/ → 단일 HTML 빌드
├─ src/
│  ├─ core.js             계산 엔진: 깊이·조건·배열·검증(11항목)·G코드 생성·독립 NC 검증기
│  ├─ ui.js               화면: 입력·그래픽·저장·설정·관리자·공유
│  ├─ style.css, template.html
│  └─ vendor/             qrcode-generator 1.4.4 (MIT) + 라이선스
├─ tests/
│  ├─ core.test.cjs       계산 엔진 단위 테스트 (57개)
│  └─ e2e.cjs             브라우저 통합 테스트 (57개)
└─ docs/                  사용 방법·기능 설명·테스트 결과·라이선스
```

## 개발자용 명령 (Node.js 18 이상)
```bash
node build.mjs                    # src/ 를 pureun-ai-cam.html 로 빌드
node --test tests/                # 계산 엔진 단위 테스트
node tests/e2e.cjs [스크린샷폴더]  # 브라우저 통합 테스트 (Playwright 필요)
```
소스를 수정한 뒤에는 반드시 `node build.mjs` 로 HTML 을 다시 만들고 두 테스트를 모두 실행하세요.
