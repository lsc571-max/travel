// Google 할 일(Tasks) 자료 변환. 화면·저장 방식과 무관한 순수 함수만 둔다 (단위 테스트 대상).
// 주의: Google 할 일의 마감은 "날짜"만 저장된다 (시간은 API로 주고받을 수 없음).
//       due 값은 그 날짜의 UTC 자정(예: 2026-11-27T00:00:00.000Z)이므로 현지 시간대로 바꾸지 않고 앞 10자리만 쓴다.
import { daysBetween } from './dates';

export interface GTaskList { id: string; title?: string }
export interface GTask {
  id: string;
  etag?: string;
  title?: string;
  notes?: string;
  status?: 'needsAction' | 'completed';
  due?: string;
  completed?: string;
  deleted?: boolean;
  hidden?: boolean;
  parent?: string;
  position?: string;
  updated?: string;
}

export interface TaskItem {
  key: string; // listId|taskId
  id: string;
  listId: string;
  listTitle: string;
  title: string;
  notes: string;
  due: string; // 'YYYY-MM-DD' 또는 ''
  done: boolean;
  completedAt: string; // ISO 또는 ''
  parent: string;
  position: string;
}

export interface TaskForm { title: string; notes: string; due: string; done: boolean; listId: string }

export const taskKey = (listId: string, id: string) => `${listId}|${id}`;

/** Google due → 'YYYY-MM-DD' (시간대 변환 없이 날짜 부분만) */
export function dueToDate(due: string | undefined): string {
  return due && /^\d{4}-\d{2}-\d{2}/.test(due) ? due.slice(0, 10) : '';
}

/** 'YYYY-MM-DD' → Google due. 빈 값이면 null (마감일 지우기) */
export function dateToDue(date: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00.000Z` : null;
}

export function fromGoogleTask(t: GTask, list: GTaskList): TaskItem | null {
  if (!t || !t.id || t.deleted) return null;
  if (t.hidden && t.status === 'completed') return null; // "완료된 할 일 지우기"로 숨긴 항목
  return {
    key: taskKey(list.id, t.id),
    id: t.id,
    listId: list.id,
    listTitle: list.title ?? '',
    title: (t.title ?? '').trim(),
    notes: t.notes ?? '',
    due: dueToDate(t.due),
    done: t.status === 'completed',
    completedAt: t.completed ?? '',
    parent: t.parent ?? '',
    position: t.position ?? '',
  };
}

export function validateTaskForm(f: TaskForm): string | null {
  if (!f.title.trim()) return '할 일 제목을 입력해 주세요.';
  if (f.title.trim().length > 1024) return '제목이 너무 깁니다.';
  if (f.notes.length > 8192) return '메모가 너무 깁니다.';
  if (f.due && !/^\d{4}-\d{2}-\d{2}$/.test(f.due)) return '마감일 형식이 맞지 않습니다.';
  return null;
}

/** 새로 만들 때 보낼 내용 */
export function newTaskBody(f: TaskForm): Partial<GTask> {
  const body: Partial<GTask> = { title: f.title.trim(), notes: f.notes, status: f.done ? 'completed' : 'needsAction' };
  const due = dateToDue(f.due);
  if (due) body.due = due;
  return body;
}

/** 수정할 때 바뀐 칸만 보낸다 (다른 기기에서 바꾼 칸을 덮어쓰지 않도록). 바뀐 것이 없으면 빈 객체 */
export function taskPatch(before: TaskItem, f: TaskForm): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (f.title.trim() !== before.title) p.title = f.title.trim();
  if (f.notes !== before.notes) p.notes = f.notes;
  if (f.due !== before.due) p.due = dateToDue(f.due);
  if (f.done !== before.done) Object.assign(p, completionPatch(f.done));
  return p;
}

export function completionPatch(done: boolean): Record<string, unknown> {
  return done ? { status: 'completed' } : { status: 'needsAction', completed: null };
}

/** 할 일 목록 정렬: 안 한 일 먼저 → 마감일 빠른 순(마감 없음은 뒤) → 목록 안 순서 */
export function sortTasks(a: TaskItem, b: TaskItem): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.due !== b.due) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
}

/** 마감 상태 글자: 지남 / 오늘 / 내일 / M월 D일 */
export function dueLabel(due: string, today: string): { text: string; overdue: boolean } {
  if (!due) return { text: '마감일 없음', overdue: false };
  const [, m, d] = due.split('-').map(Number);
  const diff = daysBetween(today, due);
  if (diff < 0) return { text: `${m}월 ${d}일 (지남)`, overdue: true };
  if (diff === 0) return { text: '오늘까지', overdue: false };
  if (diff === 1) return { text: '내일까지', overdue: false };
  return { text: `${m}월 ${d}일까지`, overdue: false };
}
