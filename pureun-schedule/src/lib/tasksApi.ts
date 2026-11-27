// Google 할 일(Tasks) REST 호출. 수정은 바뀐 칸만 PATCH로 보내 다른 기기의 변경을 덮어쓰지 않게 한다.
import { TASKS_API } from '../config';
import { ApiError, googleCall, TASK_MESSAGES } from './calendarApi';
import type { GTask, GTaskList } from './taskModel';

const call = <T>(method: string, path: string, opts: { params?: Record<string, string>; body?: unknown } = {}) =>
  googleCall<T>(TASKS_API, 'Google 할 일', TASK_MESSAGES, method, path, opts);
const enc = encodeURIComponent;

export async function listTaskLists(): Promise<GTaskList[]> {
  const out: GTaskList[] = [];
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const params: Record<string, string> = { maxResults: '100' };
    if (pageToken) params.pageToken = pageToken;
    const r = await call<{ items?: GTaskList[]; nextPageToken?: string }>('GET', '/users/@me/lists', { params });
    out.push(...(r.items ?? []));
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return out;
}

/** 목록 하나의 할 일 (완료 항목 포함, "완료 지우기"로 숨긴 항목 제외) */
export async function listTasks(listId: string): Promise<GTask[]> {
  const out: GTask[] = [];
  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const params: Record<string, string> = { maxResults: '100', showCompleted: 'true', showHidden: 'false' };
    if (pageToken) params.pageToken = pageToken;
    const r = await call<{ items?: GTask[]; nextPageToken?: string }>('GET', `/lists/${enc(listId)}/tasks`, { params });
    out.push(...(r.items ?? []));
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return out;
}

export const insertTask = (listId: string, body: Partial<GTask>) =>
  call<GTask>('POST', `/lists/${enc(listId)}/tasks`, { body });

export const patchTask = (listId: string, id: string, body: Record<string, unknown>) =>
  call<GTask>('PATCH', `/lists/${enc(listId)}/tasks/${enc(id)}`, { body });

export async function deleteTask(listId: string, id: string): Promise<void> {
  try {
    await call<void>('DELETE', `/lists/${enc(listId)}/tasks/${enc(id)}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 410)) return; // 이미 삭제됨
    throw e;
  }
}
