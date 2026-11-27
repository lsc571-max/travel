// 앱 전역 상수. 비밀정보는 여기에 두지 않는다 (OAuth 클라이언트 ID는 공개 식별자).
export const APP_NAME = '푸른 교수 일정관리';
export const APP_VERSION = 'V1.2';
export const APP_BUILD_DATE = '2026-11-27';

// 최소 권한: 일정 읽기·쓰기 + 할 일 읽기·쓰기 (캘린더 목록·Drive 권한은 요청하지 않음)
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
export const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
export const SCOPES = `${CALENDAR_SCOPE} ${TASKS_SCOPE}`;

export const PRIMARY_CALENDAR_ID = 'primary';
export const HOLIDAY_CALENDAR_ID = 'ko.south_korea#holiday@group.v.calendar.google.com';

// 빌드 시 넣을 수 있는 기본 클라이언트 ID (없으면 관리자 설정에서 입력)
export const BUILD_CLIENT_ID: string = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';

export const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
export const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
export const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';
export const CREDENTIALS_PAGE = 'https://console.cloud.google.com/apis/credentials';
export const DAILY_QUOTA = 1_000_000;
