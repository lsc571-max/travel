// 할 일 데이터 계층: Google 할 일 전체 목록을 받아 메모리와 이 기기(localStorage)에 사본을 둔다.
// 원본은 항상 Google 할 일. 연결을 끊으면 사본도 지운다 (store.clearAll 에서 함께 호출).
import { hasTasksAccess } from './auth';
import { safeStorage } from './settings';
import * as api from './tasksApi';
import { fromGoogleTask, sortTasks, type GTaskList, type TaskItem } from './taskModel';

const CACHE_KEY = 'pc.tasks';
const FRESH_MS = 5 * 60 * 1000;

let lists: GTaskList[] = [];
const tasks = new Map<string, TaskItem>();
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
let inflightGen = -1;
let generation = 0;
const listeners: (() => void)[] = [];

export let lastError: string | null = null;

export function onChange(l: () => void) { listeners.push(l); }
const emit = () => listeners.forEach((l) => l());

function save() {
  safeStorage.setItem(CACHE_KEY, JSON.stringify({ lists, tasks: [...tasks.values()] }));
}

export function loadCache() {
  try {
    const raw = JSON.parse(safeStorage.getItem(CACHE_KEY) ?? 'null');
    if (raw && Array.isArray(raw.tasks)) {
      lists = Array.isArray(raw.lists) ? raw.lists : [];
      tasks.clear();
      (raw.tasks as TaskItem[]).forEach((t) => { if (t && t.key) tasks.set(t.key, t); });
      emit();
    }
  } catch { /* 사본이 깨져 있으면 무시하고 새로 받는다 */ }
}

export function getLists(): GTaskList[] { return lists; }
export function get(key: string): TaskItem | undefined { return tasks.get(key); }
export function all(): TaskItem[] { return [...tasks.values()].sort(sortTasks); }

/** 마감일이 [from, to) 안에 있는 할 일 ('YYYY-MM-DD' 비교) */
export function dueBetween(from: string, to: string): TaskItem[] {
  return [...tasks.values()].filter((t) => t.due && t.due >= from && t.due < to);
}

/** 할 일 전체를 최신으로 (5분 안에 받았으면 다시 받지 않음) */
export async function ensure(force = false): Promise<void> {
  if (!hasTasksAccess()) return;
  if (!force && Date.now() - fetchedAt < FRESH_MS) return;
  if (inflight && inflightGen === generation) return inflight;
  const gen = generation;
  inflightGen = gen;
  const p: Promise<void> = fetchAll(gen).finally(() => {
    if (inflight === p) inflight = null;
    emit();
  });
  inflight = p;
  return p;
}

async function fetchAll(gen: number): Promise<void> {
  try {
    const ls = await api.listTaskLists();
    const results = await Promise.all(ls.map(async (l) => ({ l, items: await api.listTasks(l.id) })));
    if (gen !== generation) return; // 그 사이 저장·연결 끊기 등으로 무효화됨
    lists = ls;
    tasks.clear();
    for (const { l, items } of results) {
      items.map((t) => fromGoogleTask(t, l)).forEach((t) => { if (t) tasks.set(t.key, t); });
    }
    fetchedAt = Date.now();
    lastError = null;
    save();
  } catch (e) {
    if (gen === generation) lastError = e instanceof Error ? e.message : String(e);
    throw e;
  }
}

/** 저장 직후 화면에 바로 반영 */
export function upsertLocal(t: TaskItem) { tasks.set(t.key, t); save(); emit(); }
export function removeLocal(key: string) { tasks.delete(key); save(); emit(); }

export function invalidate() { fetchedAt = 0; generation++; }

export function clearAll() {
  generation++;
  lists = [];
  tasks.clear();
  fetchedAt = 0;
  lastError = null;
  safeStorage.removeItem(CACHE_KEY);
  emit();
}
