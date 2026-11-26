# 인계서 — 푸른 교수 일정관리 V1 → V1.1 (Google Cloud 설정·배포)

작성일: 2026-11-26 · 이전 세션: 클라우드 세션(브라우저 조작 불가로 PC 세션에 인계)

## 1. 지금까지 상태
- 앱: 「푸른 교수 일정관리」 — 구글 캘린더 연동 개인 일정관리 PWA (1단계 V1 완성)
- 소스: GitHub `lsc571-max/travel` 저장소, 브랜치 `ccr-fda01442-hyxykt`, 폴더 `pureun-schedule/`
  - 같은 저장소 루트의 여행 통역 앱 파일(index.html 등)은 이 작업과 무관 — **수정 금지**
- 검증: 단위 테스트 20개(Vitest), 브라우저 테스트 30개(Playwright, 가짜 Google 서버) 모두 통과, npm audit 0건
- Google Drive: `교수님 도우미 / 앱 만들기 / 프로그램 만들기 / 푸른 교수 일정관리 /`
  - `V0/` 개발 구상서, `V1/` 소스 ZIP·설정 안내서
- **아직 안 된 것**: Google Cloud 프로젝트·OAuth 클라이언트 생성, Firebase 배포, 실제 구글 계정 테스트

## 2. 사용자 결정 사항 (변경 금지)
- **새 Google Cloud 프로젝트를 따로 만든다** (기존 Gemini/여행 통역 프로젝트와 섞지 않음)
- 프로젝트 이름/ID: `pureun-schedule` (ID가 이미 쓰이면 구글 제안 ID 사용, 이후 모든 주소에 그 ID 반영)
- OAuth 게시 상태: **테스트**, 테스트 사용자: 본인 Gmail
- 캘린더: 기본 캘린더 + 대한민국 공휴일
- 카테고리 색: 개인 파랑(7)·학교 초록(10)·회의 노랑(5)·출장 빨강(11)

## 3. 할 일 (순서대로)
### A. PC 준비
```
git clone https://github.com/lsc571-max/travel.git
cd travel && git checkout ccr-fda01442-hyxykt
cd pureun-schedule && npm install
npm test            # 20 passed 확인
```
※ Node.js LTS 필요. 이미 클론이 있으면 `git fetch origin ccr-fda01442-hyxykt` 후 체크아웃.

### B. Google Cloud 콘솔 (사용자의 로그인된 크롬에서, 화면 조작)
상세 안내: `pureun-schedule/docs/GOOGLE_CLOUD_SETUP.md`
1. https://console.cloud.google.com → 새 프로젝트 `pureun-schedule` (결제 연결 안 함)
2. API 및 서비스 → 라이브러리 → **Google Calendar API 사용**
3. Google 인증 플랫폼 → 시작하기: 앱 이름 「푸른 교수 일정관리」, 지원 이메일·연락처 = 사용자 Gmail, 대상 **외부**
   - 대상(Audience): 게시 상태 **테스트** 유지, 테스트 사용자에 사용자 Gmail 추가
   - 데이터 액세스: 범위 `https://www.googleapis.com/auth/calendar.events` **하나만** 추가
4. 클라이언트 → 클라이언트 만들기: **웹 애플리케이션**, 이름 「일정관리 웹앱」
   - 승인된 JavaScript 원본: `https://pureun-schedule.web.app`, `https://pureun-schedule.firebaseapp.com`, `http://localhost:5173`, `http://localhost:4173`
   - 리디렉션 URI: 비움
   - 생성된 **클라이언트 ID**만 사용. **클라이언트 보안 비밀번호(secret)는 사용·저장·커밋 금지**
- 콘솔 결제·권한·삭제 등 되돌리기 어려운 조작은 사용자 확인 후 진행

### C. 앱에 클라이언트 ID 넣고 V1.1 만들기
1. `pureun-schedule/.env.production` 생성: `VITE_GOOGLE_CLIENT_ID=<클라이언트 ID>` (공개 식별자라 커밋 가능)
2. 버전 올리기 (모두 `V1.1`, 날짜 갱신):
   - `src/config.ts` 의 `APP_VERSION`, `APP_BUILD_DATE`
   - `public/version.json` (version, date, changes에 "클라이언트 ID 기본 포함, Firebase 배포" 추가)
   - `public/sw.js` 의 `VERSION` (서비스워커 업데이트 감지에 필요)
   - `CHANGELOG.md` 에 V1.1 항목 (변경·검증·복원 기준)
3. `npm test && npm run build && npm run e2e` → 모두 통과 확인
   - e2e는 Playwright 필요: 없으면 `npx playwright install chromium` (사용자 확인 후)
4. 로컬 실제 테스트: `npm run preview -- --port 4173` → 브라우저에서 「구글 연결」 → 실제 일정 표시·등록·수정·삭제·공휴일 표시 확인
   - 테스트 일정은 제목에 `[테스트]`를 붙여 만들고 끝나면 삭제 (사용자의 기존 일정은 건드리지 않음)

### D. Firebase Hosting 배포
1. https://console.firebase.google.com → 프로젝트 추가 → **기존 Google Cloud 프로젝트 `pureun-schedule`** 선택, 애널리틱스 끔, Spark(무료) 유지
2. `pureun-schedule/` 폴더에서:
   ```
   npx firebase-tools login
   npx firebase-tools deploy --only hosting --project pureun-schedule
   ```
   (`firebase.json` 은 이미 있음: dist 배포, CSP 등 보안 헤더 포함)
3. 배포 주소 `https://pureun-schedule.web.app` 에서 다시 확인: 로그인, 일정 CRUD, 공유 QR, 버전 화면(V1.1), 휴대폰 「홈 화면에 추가」
4. 개발자도구 콘솔에 CSP 위반 오류가 없는지 확인

### E. 저장·보고
- git: `pureun-schedule/` 변경만 커밋 → `ccr-fda01442-hyxykt` 브랜치에 push (`.env.production` 포함 가능, secret 절대 금지)
- Google Drive `푸른 교수 일정관리/V1.1/` 폴더 생성 → 소스 ZIP(node_modules·dist·test-results 제외) 업로드 → 크기 확인
- 최종 보고: 버전, 배포 주소, 테스트 결과, 미검증 항목, 비용(예상 월 0원)

## 4. 사용자 작업 원칙 (요약)
원본 보호·최소 변경, 이전 버전(V0·V1) 수정 금지, 무료 도구 우선, 비밀정보(secret·토큰·비밀번호) 저장·공개 금지,
실제 확인한 결과만 보고, 5대 검증(정확성·완성도·일관성·사용성·안정성) 결과와 미검증 항목 명시, 결과 보고는 한국어.

## 5. 알려진 미검증·주의
- 공휴일 캘린더 ID `ko.south_korea#holiday@group.v.calendar.google.com` 가 `calendar.events` 권한으로 조회되는지 실제 확인 필요 (실패해도 내 일정은 정상, 상단에 안내 표시)
- 반복 일정 「전체」 날짜·시간 변경 시 개별 수정된 회차를 Google이 어떻게 처리하는지 실제 확인 필요
- 테스트 상태 OAuth는 일정 기간마다 재동의가 필요할 수 있음
- 앱 구조·명령: `pureun-schedule/README.md`
