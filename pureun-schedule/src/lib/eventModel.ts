// Google 일정 ↔ 앱 일정 ↔ 편집 양식 변환. 화면과 무관한 순수 함수만 둔다 (단위 테스트 대상).
import {
  addDays, daysBetween, localDateTime, parseDateStr, toDateStr, toTimeStr, untilToDateStr, untilUtc, weekdayCode,
} from './dates';

export interface GDateTime { date?: string; dateTime?: string; timeZone?: string }
export interface GReminders { useDefault: boolean; overrides?: { method: string; minutes: number }[] }
export interface GEvent {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  start: GDateTime;
  end: GDateTime;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GDateTime;
  reminders?: GReminders;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  htmlLink?: string;
  [k: string]: unknown;
}

export type Importance = 0 | 1 | 2;

export interface CalEvent {
  key: string; // calendarId|id
  id: string;
  calendarId: string;
  etag?: string;
  title: string;
  allDay: boolean;
  start: string; // 종일: YYYY-MM-DD, 시간: ISO
  end: string; // 종일: 마지막 날 다음날(구글 규칙), 시간: ISO
  location?: string;
  description?: string;
  colorId?: string;
  category?: string;
  importance: Importance;
  recurringEventId?: string;
  isRecurringMaster: boolean;
  readOnly: boolean;
  reminders?: GReminders;
}

export function fromGoogle(g: GEvent, calendarId: string, readOnly: boolean): CalEvent | null {
  if (!g || g.status === 'cancelled' || !g.start) return null;
  const allDay = !!g.start.date;
  const start = (allDay ? g.start.date : g.start.dateTime) ?? '';
  let end = (allDay ? g.end?.date : g.end?.dateTime) ?? '';
  if (!end) end = allDay ? addDays(start, 1) : start;
  const p = g.extendedProperties?.private ?? {};
  const imp = Number(p.pcImportance);
  return {
    key: `${calendarId}|${g.id}`,
    id: g.id,
    calendarId,
    etag: g.etag,
    title: g.summary ?? '',
    allDay,
    start,
    end,
    location: g.location || undefined,
    description: g.description || undefined,
    colorId: g.colorId || undefined,
    category: p.pcCategory || undefined,
    importance: imp === 1 || imp === 2 ? imp : 0,
    recurringEventId: g.recurringEventId,
    isRecurringMaster: Array.isArray(g.recurrence) && g.recurrence.length > 0,
    readOnly,
    reminders: g.reminders,
  };
}

/** 일정이 차지하는 시각 범위 [시작, 끝) (ms) */
function eventRange(e: CalEvent): [number, number] {
  if (e.allDay) return [parseDateStr(e.start).getTime(), parseDateStr(e.end).getTime()];
  return [new Date(e.start).getTime(), new Date(e.end).getTime()];
}

export function overlaps(e: CalEvent, min: number, max: number): boolean {
  const [s, en] = eventRange(e);
  return s < max && Math.max(en, s + 1) > min;
}

// ───────────── 편집 양식 ─────────────

export type RepeatFreq = 'none' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'custom';
export type ReminderChoice = 'default' | 'none' | 'keep' | number;

export interface EventForm {
  title: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string; // 종일 일정은 마지막 날(포함)
  endTime: string;
  location: string;
  description: string;
  category: string; // '' = 없음
  colorId: string; // '' = 캘린더 기본색
  importance: Importance;
  reminder: ReminderChoice;
  repeat: RepeatFreq;
  byDay: string[];
  repeatEnd: 'never' | 'until' | 'count';
  until: string;
  count: number;
  customRule?: string; // 앱이 다루지 않는 반복 규칙 원문 (변경하지 않으면 그대로 유지)
}

export function blankForm(date: string, defaultReminder: ReminderChoice = 'default', startTime?: string): EventForm {
  const now = new Date();
  let st = startTime;
  if (!st) {
    const h = Math.min(now.getHours() + 1, 23);
    st = `${String(h).padStart(2, '0')}:00`;
  }
  const [h, m] = st.split(':').map(Number);
  const endH = Math.min(h + 1, 23);
  const et = endH === h ? '23:59' : `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return {
    title: '', allDay: false, startDate: date, startTime: st, endDate: date, endTime: et,
    location: '', description: '', category: '', colorId: '', importance: 0,
    reminder: defaultReminder, repeat: 'none', byDay: [weekdayCode(date)], repeatEnd: 'never',
    until: addDays(date, 30), count: 10,
  };
}

export function reminderFromEvent(r: GReminders | undefined): ReminderChoice {
  if (!r || r.useDefault) return 'default';
  const o = r.overrides ?? [];
  if (o.length === 0) return 'none';
  if (o.length === 1 && o[0].method === 'popup') return o[0].minutes;
  return 'keep'; // 여러 개·이메일 알림은 앱에서 건드리지 않고 유지
}

interface ParsedRule {
  repeat: RepeatFreq; byDay: string[]; repeatEnd: 'never' | 'until' | 'count'; until: string; count: number; customRule?: string;
}

export function parseRRule(recurrence: string[] | undefined, startDate: string): ParsedRule {
  const base: ParsedRule = { repeat: 'none', byDay: [weekdayCode(startDate)], repeatEnd: 'never', until: addDays(startDate, 30), count: 10 };
  const line = recurrence?.find((l) => l.startsWith('RRULE:'));
  if (!line) return base;
  const parts = Object.fromEntries(line.slice(6).split(';').map((kv) => kv.split('=') as [string, string]));
  const allowed = new Set(['FREQ', 'BYDAY', 'UNTIL', 'COUNT', 'WKST']);
  const freq = parts.FREQ as RepeatFreq;
  const simple = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)
    && Object.keys(parts).every((k) => allowed.has(k))
    && (!parts.BYDAY || (freq === 'WEEKLY' && /^(SU|MO|TU|WE|TH|FR|SA)(,(SU|MO|TU|WE|TH|FR|SA))*$/.test(parts.BYDAY)));
  if (!simple) return { ...base, repeat: 'custom', customRule: line };
  const r: ParsedRule = { ...base, repeat: freq };
  if (parts.BYDAY) r.byDay = parts.BYDAY.split(',');
  if (parts.UNTIL) { r.repeatEnd = 'until'; r.until = untilToDateStr(parts.UNTIL) || r.until; }
  else if (parts.COUNT) { r.repeatEnd = 'count'; r.count = Number(parts.COUNT) || 10; }
  return r;
}

export function buildRRule(f: EventForm): string | null {
  if (f.repeat === 'none') return null;
  if (f.repeat === 'custom') return f.customRule ?? null;
  let rule = `RRULE:FREQ=${f.repeat}`;
  if (f.repeat === 'WEEKLY') {
    const days = f.byDay.length ? f.byDay : [weekdayCode(f.startDate)];
    const order = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
    rule += `;BYDAY=${[...new Set(days)].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(',')}`;
  }
  if (f.repeatEnd === 'until') rule += `;UNTIL=${f.allDay ? f.until.replace(/-/g, '') : untilUtc(f.until)}`;
  else if (f.repeatEnd === 'count') rule += `;COUNT=${Math.max(1, Math.floor(f.count))}`;
  return rule;
}

export function eventToForm(e: CalEvent, masterRecurrence?: string[]): EventForm {
  let startDate: string, startTime: string, endDate: string, endTime: string;
  if (e.allDay) {
    startDate = e.start;
    endDate = addDays(e.end, -1);
    if (endDate < startDate) endDate = startDate;
    startTime = '09:00';
    endTime = '10:00';
  } else {
    const s = new Date(e.start), en = new Date(e.end);
    startDate = toDateStr(s); startTime = toTimeStr(s);
    endDate = toDateStr(en); endTime = toTimeStr(en);
  }
  const rule = parseRRule(masterRecurrence, startDate);
  return {
    title: e.title, allDay: e.allDay, startDate, startTime, endDate, endTime,
    location: e.location ?? '', description: e.description ?? '',
    category: e.category ?? '', colorId: e.colorId ?? '', importance: e.importance,
    reminder: reminderFromEvent(e.reminders), ...rule,
  };
}

export function validateForm(f: EventForm): string | null {
  if (f.title.trim().length > 1000) return '제목이 너무 깁니다.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(f.endDate)) return '날짜를 입력해 주세요.';
  if (f.allDay) {
    if (f.endDate < f.startDate) return '종료 날짜가 시작 날짜보다 빠릅니다.';
  } else {
    if (!/^\d{2}:\d{2}$/.test(f.startTime) || !/^\d{2}:\d{2}$/.test(f.endTime)) return '시간을 입력해 주세요.';
    if (`${f.endDate}T${f.endTime}` <= `${f.startDate}T${f.startTime}`) return '종료 시각이 시작 시각보다 늦어야 합니다.';
  }
  if (f.repeat !== 'none' && f.repeat !== 'custom') {
    if (f.repeatEnd === 'until' && f.until < f.startDate) return '반복 종료일이 시작 날짜보다 빠릅니다.';
    if (f.repeatEnd === 'count' && (!(f.count >= 1) || f.count > 999)) return '반복 횟수는 1~999회로 입력해 주세요.';
    if (f.repeat === 'WEEKLY' && f.byDay.length === 0) return '반복할 요일을 하나 이상 선택해 주세요.';
  }
  return null;
}

function applyTimes(r: GEvent, f: EventForm, startDate: string, endDate: string, tz: string) {
  if (f.allDay) {
    r.start = { date: startDate };
    r.end = { date: addDays(endDate, 1) };
  } else {
    r.start = { dateTime: localDateTime(startDate, f.startTime), timeZone: tz };
    r.end = { dateTime: localDateTime(endDate, f.endTime), timeZone: tz };
  }
}

interface ApplyOptions {
  tz: string;
  includeRecurrence: boolean; // 단일 일정·반복 전체 수정 시 true, 반복 중 '이 일정만'은 false
  /** 반복 전체 수정 시: 원래 회차 시작일 → 마스터 시작일을 같은 만큼 이동 */
  series?: { masterStartDate: string; instanceOldStartDate: string };
}

/** 기존 Google 일정(또는 빈 객체)에 양식 내용을 반영한 새 객체를 만든다. 앱이 모르는 필드는 보존된다. */
export function applyForm(resource: Partial<GEvent>, f: EventForm, opt: ApplyOptions): GEvent {
  const r = JSON.parse(JSON.stringify(resource ?? {})) as GEvent;
  r.summary = f.title.trim();
  r.location = f.location.trim();
  r.description = f.description;
  if (f.colorId) r.colorId = f.colorId; else delete r.colorId;

  let startDate = f.startDate, endDate = f.endDate;
  if (opt.series) {
    const shift = daysBetween(opt.series.instanceOldStartDate, f.startDate);
    startDate = addDays(opt.series.masterStartDate, shift);
    endDate = addDays(startDate, daysBetween(f.startDate, f.endDate));
  }
  applyTimes(r, f, startDate, endDate, opt.tz);

  const priv = { ...(r.extendedProperties?.private ?? {}) };
  if (f.category) priv.pcCategory = f.category; else delete priv.pcCategory;
  priv.pcImportance = String(f.importance);
  r.extendedProperties = { ...(r.extendedProperties ?? {}), private: priv };

  if (f.reminder === 'default') r.reminders = { useDefault: true };
  else if (f.reminder === 'none') r.reminders = { useDefault: false, overrides: [] };
  else if (typeof f.reminder === 'number') r.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: f.reminder }] };

  if (opt.includeRecurrence) {
    let form = f;
    // 매주 반복에서 하루짜리 요일만 지정돼 있고 시작 요일이 바뀌었다면 요일도 따라 바꾼다
    if (f.repeat === 'WEEKLY' && f.byDay.length === 1 && opt.series && startDate !== opt.series.masterStartDate) {
      const oldCode = weekdayCode(opt.series.instanceOldStartDate);
      if (f.byDay[0] === oldCode) form = { ...f, byDay: [weekdayCode(f.startDate)] };
    }
    const rule = buildRRule(form);
    const others = (r.recurrence ?? []).filter((l) => !l.startsWith('RRULE:'));
    if (rule) r.recurrence = [rule, ...others];
    else delete r.recurrence;
  } else {
    delete r.recurrence;
  }
  return r;
}

export function importanceMark(i: Importance): string {
  return i === 2 ? '★★ ' : i === 1 ? '★ ' : '';
}

export function reminderLabel(m: number): string {
  if (m === 0) return '일정 시작 시';
  if (m % 1440 === 0) return `${m / 1440}일 전`;
  if (m % 60 === 0) return `${m / 60}시간 전`;
  return `${m}분 전`;
}
