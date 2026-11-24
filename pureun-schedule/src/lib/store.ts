// 일정 데이터 계층: 화면에 필요한 기간만 Google에서 불러오고, 메모리·IndexedDB에 사본을 둔다.
import { HOLIDAY_CALENDAR_ID, PRIMARY_CALENDAR_ID } from '../config';
import * as api from './calendarApi';
import * as cache from './cache';
import { fromGoogle, overlaps, type CalEvent } from './eventModel';
import { getSettings } from './settings';

const events = new Map<string, CalEvent>();
const fetched: { cal: string; min: number; max: number; at: number }[] = [];
const inflight = new Map<string, Promise<void>>();
const listeners: (() => void)[] = [];
const FRESH_MS = 5 * 60 * 1000;
let generation = 0; // invalidate() 이전에 시작된 응답은 버린다

export let lastError: string | null = null;
export let holidayError = false;

export function onChange(l: () => void) { listeners.push(l); }
const emit = () => listeners.forEach((l) => l());

export async function loadCache() {
  const all = await cache.loadAll();
  all.forEach((e) => events.set(e.key, e));
  emit();
}

function calendars(): { id: string; readOnly: boolean }[] {
  const cals = [{ id: PRIMARY_CALENDAR_ID, readOnly: false }];
  if (getSettings().showHolidays) cals.push({ id: HOLIDAY_CALENDAR_ID, readOnly: true });
  return cals;
}

export function inRange(min: Date, max: Date): CalEvent[] {
  const a = min.getTime(), b = max.getTime();
  const visible = new Set(calendars().map((c) => c.id));
  return [...events.values()].filter((e) => visible.has(e.calendarId) && overlaps(e, a, b));
}

export function get(key: string): CalEvent | undefined { return events.get(key); }

function covered(cal: string, a: number, b: number): boolean {
  return fetched.some((f) => f.cal === cal && f.min <= a && f.max >= b && Date.now() - f.at < FRESH_MS);
}

async function fetchOne(cal: string, readOnly: boolean, min: Date, max: Date) {
  const gen = generation;
  const items = await api.listEvents(cal, min, max);
  if (gen !== generation) return; // 그 사이 저장 등으로 무효화됨 → 오래된 결과로 덮어쓰지 않음
  const a = min.getTime(), b = max.getTime();
  const removed: string[] = [];
  for (const [k, e] of events) {
    if (e.calendarId === cal && overlaps(e, a, b)) { events.delete(k); removed.push(k); }
  }
  const fresh = items.map((g) => fromGoogle(g, cal, readOnly)).filter((e): e is CalEvent => !!e);
  fresh.forEach((e) => events.set(e.key, e));
  fetched.push({ cal, min: a, max: b, at: Date.now() });
  if (fetched.length > 50) fetched.splice(0, fetched.length - 50);
  await cache.replace(removed, fresh);
}

/** 기간 [min,max)의 일정이 최신이 되도록 보장 (5분 안에 받은 기간은 다시 받지 않음) */
export async function ensure(min: Date, max: Date, force = false): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const c of calendars()) {
    if (!force && covered(c.id, min.getTime(), max.getTime())) continue;
    const key = `${generation}|${c.id}|${min.getTime()}|${max.getTime()}`;
    let p = inflight.get(key);
    if (!p) {
      p = fetchOne(c.id, c.readOnly, min, max)
        .then(() => { if (c.id === HOLIDAY_CALENDAR_ID) holidayError = false; })
        .catch((e: unknown) => {
          if (c.id === HOLIDAY_CALENDAR_ID && !(e instanceof api.ApiError && (e.status === 401 || e.status === 0))) {
            holidayError = true; // 공휴일을 못 불러와도 내 일정은 계속 표시
            return;
          }
          throw e;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    jobs.push(p);
  }
  if (!jobs.length) return;
  try {
    await Promise.all(jobs);
    lastError = null;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    emit();
  }
}

/** 저장 직후 화면 즉시 반영 */
export async function upsertLocal(e: CalEvent) {
  events.set(e.key, e);
  await cache.replace([], [e]);
  emit();
}

export async function removeLocal(pred: (e: CalEvent) => boolean) {
  const keys = [...events.values()].filter(pred).map((e) => e.key);
  keys.forEach((k) => events.delete(k));
  await cache.replace(keys, []);
  emit();
}

/** 다음 ensure에서 다시 받도록 기록 무효화 */
export function invalidate() { fetched.length = 0; generation++; }

export async function clearAll() {
  generation++;
  events.clear();
  fetched.length = 0;
  await cache.clearAll();
  emit();
}
