// Google Calendar REST 호출. 수정·삭제는 etag(If-Match)로 다른 기기의 변경을 덮어쓰지 않게 한다.
import { CALENDAR_API } from '../config';
import { getToken, invalidateToken } from './auth';
import type { GEvent } from './eventModel';
import { countApiCall } from './settings';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const MESSAGES: Record<number, string> = {
  401: 'Google 연결이 만료되었습니다. 다시 연결해 주세요.',
  403: '이 작업에 대한 권한이 없거나 사용 한도를 넘었습니다.',
  404: '일정을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.',
  410: '일정이 이미 삭제되었습니다.',
  412: '다른 기기에서 먼저 수정된 일정입니다.',
  429: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
};

async function call<T>(method: string, path: string, opts: { params?: Record<string, string>; body?: unknown; etag?: string } = {}): Promise<T> {
  const t = getToken();
  if (!t) throw new ApiError(MESSAGES[401], 401);
  const url = new URL(CALENDAR_API + path);
  Object.entries(opts.params ?? {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const headers: Record<string, string> = { Authorization: `Bearer ${t}` };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.etag) headers['If-Match'] = opts.etag;
  countApiCall();
  let res: Response;
  try {
    res = await fetch(url.toString(), { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new ApiError('인터넷에 연결할 수 없습니다.', 0);
  }
  if (res.status === 401) invalidateToken();
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message ?? ''; } catch { /* 본문 없음 */ }
    // 오류 메시지에 토큰 등 비밀정보가 섞이지 않도록 서버 메시지는 짧게만 덧붙인다
    const base = MESSAGES[res.status] ?? `Google 캘린더 오류 (${res.status})`;
    throw new ApiError(detail && !MESSAGES[res.status] ? `${base}: ${detail.slice(0, 120)}` : base, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const enc = encodeURIComponent;

export async function listEvents(calendarId: string, timeMin: Date, timeMax: Date): Promise<GEvent[]> {
  const out: GEvent[] = [];
  let pageToken = '';
  for (let page = 0; page < 10; page++) { // 무한 반복 방지
    const params: Record<string, string> = {
      timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '2500',
    };
    if (pageToken) params.pageToken = pageToken;
    const r = await call<{ items?: GEvent[]; nextPageToken?: string }>('GET', `/calendars/${enc(calendarId)}/events`, { params });
    out.push(...(r.items ?? []));
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return out;
}

export const getEvent = (calendarId: string, id: string) =>
  call<GEvent>('GET', `/calendars/${enc(calendarId)}/events/${enc(id)}`);

export const insertEvent = (calendarId: string, body: Partial<GEvent>) =>
  call<GEvent>('POST', `/calendars/${enc(calendarId)}/events`, { body });

export const updateEvent = (calendarId: string, id: string, body: GEvent, etag?: string) =>
  call<GEvent>('PUT', `/calendars/${enc(calendarId)}/events/${enc(id)}`, { body, etag });

export async function deleteEvent(calendarId: string, id: string, etag?: string): Promise<void> {
  try {
    await call<void>('DELETE', `/calendars/${enc(calendarId)}/events/${enc(id)}`, { etag });
  } catch (e) {
    if (e instanceof ApiError && e.status === 410) return; // 이미 삭제됨
    throw e;
  }
}

/** 연결 테스트: 기본 캘린더의 일정 1건 조회 */
export async function testConnection(): Promise<void> {
  const now = new Date();
  await call('GET', '/calendars/primary/events', { params: { maxResults: '1', timeMin: now.toISOString() } });
}

/** 기본 캘린더 이름(보통 계정 이메일) — 기기 주인 계정 확인용. 원문은 저장하지 않고 해시만 비교한다. */
export async function primaryCalendarName(): Promise<string> {
  const r = await call<{ summary?: string }>('GET', '/calendars/primary/events', { params: { maxResults: '1', timeMin: new Date().toISOString() } });
  return (r.summary ?? '').trim().toLowerCase();
}
