# 푸른캐드 (Pureun CAD) — 기계설계·가공용 2D CAD 웹앱

AutoCAD에 익숙한 사용자를 위한 독자적인 2D CAD입니다. 소규모 기계가공 업체·설계 실무자가 설치·구독 없이 도면을 작성·수정하고 DXF로 CAM에 넘길 수 있도록 만들었습니다.

- 현재 버전: **V1** (2026-11-27) — 변경 기록은 [VERSIONS.md](VERSIONS.md)
- 실행 환경: PC 웹 브라우저(Chrome·Edge 최신 권장). 인터넷 없이 핵심 기능 동작, 도면은 외부로 전송하지 않음
- AI·유료 API·서버 사용 없음 → 운영 비용 0원(정적 파일 호스팅)

## 빠른 실행

```bash
cd pureun-cad
npm install
npm run build      # 타입 검사 + 배포용 빌드(dist/)
npm run preview    # http://localhost:4173 에서 실행
# 개발 모드: npm run dev
```

`dist/` 폴더를 GitHub Pages·Firebase Hosting 등 정적 호스팅에 올리면 그대로 동작합니다(`base: './'`로 하위 경로 배포 가능).

## 검사·시험

| 명령 | 내용 |
|---|---|
| `npm run typecheck` | TypeScript 타입 검사 |
| `npm run lint` | ESLint |
| `npm run knip` | 미사용 코드·의존성 검사 |
| `npm test` | Vitest 단위 시험 (기하·TRIM·OFFSET·DXF 왕복·실무 도면, ezdxf 감사 포함) |
| `npm run e2e` | Playwright 화면 시험 (빌드 후 실행, 실제 마우스·키보드 조작) |
| `npm run perf` | 1천/1만/5만 객체 성능 측정 |
| `python3 tests/fixtures/make_fixtures.py` | ezdxf로 실무형 시험 도면 재생성 |

- e2e·perf는 Playwright(Chromium)가 설치된 환경이 필요합니다(이 저장소 의존성에는 넣지 않음). ezdxf 감사는 `pip install ezdxf`가 있을 때만 실행됩니다.

## 문서 (제출물)

| # | 제출물 | 위치 |
|---|---|---|
| 1 | 실행 프로그램(웹앱 빌드) | `npm run build` → `dist/` |
| 2 | 전체 소스코드 | `src/`, `public/`, 설정 파일 |
| 3 | 자료조사 보고서(공식 도움말·커뮤니티·DXF) | [docs/01-자료조사보고서.md](docs/01-자료조사보고서.md) |
| 4 | 불편 사항 분석·개선 기준 | 같은 문서 3장·7장·8장 |
| 5 | 오픈소스 라이선스 검토 | 같은 문서 4장, [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) |
| 6 | 프로그램 구조 설명서 | [docs/02-구조설명서.md](docs/02-구조설명서.md) |
| 7 | 사용자 매뉴얼(명령어·단축키) | [docs/03-사용자매뉴얼.md](docs/03-사용자매뉴얼.md) |
| 8 | 시험 계획·결과(5단계 검증) | [docs/04-시험결과보고서.md](docs/04-시험결과보고서.md) |
| 9 | 성능 측정 결과 | 같은 문서 4장 |
| 10 | 실무 시험 도면·DXF 호환성 결과 | `tests/fixtures/`, 같은 문서 3장 |
| 11 | 버전·변경 기록·복원 기준 | [VERSIONS.md](VERSIONS.md) |
| 12 | 남은 문제·2단계 개발 방향 | 같은 시험 결과 보고서 6장 |

## 라이선스

푸른캐드 소스는 별도 라이선스를 정하기 전까지 저작자 소유입니다(상업 판매 고려). 포함된 오픈소스(React, rbush, quickselect, qrcode-generator)는 MIT/ISC이며 고지문은 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 있습니다. GPL 계열 CAD(LibreCAD·QCAD) 코드는 사용하지 않았습니다.
