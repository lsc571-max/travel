# 푸른 교수 일정관리 (V1.2)

구글 캘린더·구글 할 일과 연동되는 개인 일정관리 웹앱(PWA). PC·스마트폰·태블릿에서 같은 일정과 할 일을 봅니다.

- 배포 주소: https://pureun-schedule.web.app
- 일정 원본: Google Calendar, 할 일 원본: Google Tasks (앱은 화면용 사본만 기기에 보관)
- 서버 없음, 비밀키 없음, 운영비 0원 (개인 사용 기준)
- 처음 설정: [docs/GOOGLE_CLOUD_SETUP.md](docs/GOOGLE_CLOUD_SETUP.md)
- 변경 기록: [CHANGELOG.md](CHANGELOG.md)

## 개발 명령
```
npm install          # 의존성 설치
npm run dev          # 개발 서버 (http://localhost:5173)
npm test             # 단위 테스트
npm run build        # 배포용 빌드 (dist/)
npm run e2e          # 브라우저 기능 테스트 (빌드 후, Playwright 필요)
```
클라이언트 ID를 앱에 기본 포함하려면 빌드 전에 `.env.local` 파일에 `VITE_GOOGLE_CLIENT_ID=...` 를 넣습니다 (공개 식별자이며 비밀이 아님. 클라이언트 secret은 절대 넣지 마세요).

## 구조
```
src/config.ts          앱 이름·버전·권한 범위
src/lib/auth.ts        Google 로그인 (토큰 메모리 보관)
src/lib/calendarApi.ts Calendar API 호출, etag 충돌 방지
src/lib/store.ts       기간별 불러오기·캐시
src/lib/cache.ts       IndexedDB 사본
src/lib/eventModel.ts  일정 ↔ 양식 변환, 반복 규칙
src/lib/taskModel.ts   할 일 ↔ 양식 변환, 마감일(날짜만), 정렬
src/lib/tasksApi.ts    Tasks API 호출 (수정은 바뀐 칸만 PATCH)
src/lib/tasksStore.ts  할 일 불러오기·사본(localStorage)
src/lib/adminCore.ts   5회 클릭·관리자 비밀번호(PBKDF2)
src/lib/settings.ts    일반 설정
src/ui/*               편집기·관리자·공유·버전 화면
public/sw.js           오프라인용 서비스워커 (구글 요청은 저장 안 함)
firebase.json          배포 설정·보안 헤더(CSP) — vite preview·브라우저 시험에도 같은 헤더 적용
```
