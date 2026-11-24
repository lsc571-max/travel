import { describe, expect, it } from 'vitest';
import { AdminPassword, LOCK_MS, TapCounter } from '../src/lib/adminCore';
import { resolveColor, textOn, DEFAULT_CATEGORY_COLORS } from '../src/lib/colors';
import { addDays, daysBetween, untilToDateStr } from '../src/lib/dates';
import {
  applyForm, blankForm, buildRRule, eventToForm, fromGoogle, overlaps, parseRRule, reminderFromEvent, validateForm,
  type GEvent,
} from '../src/lib/eventModel';

const TZ = 'Asia/Seoul';
process.env.TZ = 'Asia/Seoul';

describe('날짜 도우미', () => {
  it('월말·윤년 날짜 더하기', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-11-24', '2026-12-01')).toBe(7);
  });
  it('RRULE UNTIL 변환', () => {
    expect(untilToDateStr('20261231')).toBe('2026-12-31');
    expect(untilToDateStr('20261231T145959Z')).toBe('2026-12-31'); // 한국 23:59:59
  });
});

describe('Google 일정 변환', () => {
  it('종일 일정: 종료일은 구글 규칙(다음날)으로 받고 양식에서는 마지막 날로 표시', () => {
    const g: GEvent = { id: 'a', start: { date: '2026-11-24' }, end: { date: '2026-11-26' }, summary: '출장', colorId: '11', extendedProperties: { private: { pcCategory: 'trip', pcImportance: '2' } } };
    const e = fromGoogle(g, 'primary', false)!;
    expect(e.allDay).toBe(true);
    expect(e.category).toBe('trip');
    expect(e.importance).toBe(2);
    const f = eventToForm(e);
    expect(f.endDate).toBe('2026-11-25');
    const body = applyForm({}, f, { tz: TZ, includeRecurrence: true });
    expect(body.start).toEqual({ date: '2026-11-24' });
    expect(body.end).toEqual({ date: '2026-11-26' });
  });
  it('취소된 일정은 제외', () => {
    expect(fromGoogle({ id: 'x', status: 'cancelled', start: { date: '2026-01-01' }, end: { date: '2026-01-02' } }, 'primary', false)).toBeNull();
  });
  it('시간 일정 양식 왕복', () => {
    const g: GEvent = { id: 'b', start: { dateTime: '2026-11-24T09:30:00+09:00' }, end: { dateTime: '2026-11-24T11:00:00+09:00' } };
    const f = eventToForm(fromGoogle(g, 'primary', false)!);
    expect([f.startDate, f.startTime, f.endTime]).toEqual(['2026-11-24', '09:30', '11:00']);
    const body = applyForm(g, f, { tz: TZ, includeRecurrence: true });
    expect(body.start).toEqual({ dateTime: '2026-11-24T09:30:00', timeZone: TZ });
  });
  it('앱이 모르는 필드(참석자 등)는 보존하고 색상을 지우면 colorId 삭제', () => {
    const g: GEvent = { id: 'c', start: { date: '2026-11-24' }, end: { date: '2026-11-25' }, colorId: '5', attendees: [{ email: 'x' }], extendedProperties: { private: { other: '1' } } };
    const f = { ...eventToForm(fromGoogle(g, 'primary', false)!), colorId: '' };
    const body = applyForm(g, f, { tz: TZ, includeRecurrence: true });
    expect(body.attendees).toEqual([{ email: 'x' }]);
    expect(body.colorId).toBeUndefined();
    expect(body.extendedProperties?.private).toEqual({ other: '1', pcImportance: '0' });
  });
  it('기간 겹침 판정', () => {
    const e = fromGoogle({ id: 'd', start: { date: '2026-11-24' }, end: { date: '2026-11-25' } }, 'primary', false)!;
    expect(overlaps(e, new Date(2026, 10, 24, 12).getTime(), new Date(2026, 10, 24, 13).getTime())).toBe(true);
    expect(overlaps(e, new Date(2026, 10, 25).getTime(), new Date(2026, 10, 26).getTime())).toBe(false);
  });
});

describe('반복 규칙', () => {
  it('매주 화·목, 횟수 지정', () => {
    const f = { ...blankForm('2026-11-24'), repeat: 'WEEKLY' as const, byDay: ['TH', 'TU'], repeatEnd: 'count' as const, count: 8 };
    expect(buildRRule(f)).toBe('RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=8');
  });
  it('시간 일정의 종료일은 그날 한국 23:59:59(UTC)로', () => {
    const f = { ...blankForm('2026-11-24'), repeat: 'DAILY' as const, repeatEnd: 'until' as const, until: '2026-12-31' };
    expect(buildRRule(f)).toBe('RRULE:FREQ=DAILY;UNTIL=20261231T145959Z');
  });
  it('종일 일정의 종료일은 날짜 형식', () => {
    const f = { ...blankForm('2026-11-24'), allDay: true, repeat: 'MONTHLY' as const, repeatEnd: 'until' as const, until: '2027-03-01' };
    expect(buildRRule(f)).toBe('RRULE:FREQ=MONTHLY;UNTIL=20270301');
  });
  it('해석 왕복 및 복잡한 규칙은 원문 유지', () => {
    expect(parseRRule(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T145959Z'], '2026-11-24')).toMatchObject({ repeat: 'WEEKLY', byDay: ['MO', 'WE'], repeatEnd: 'until', until: '2026-12-31' });
    const c = parseRRule(['RRULE:FREQ=MONTHLY;BYDAY=2TU'], '2026-11-24');
    expect(c.repeat).toBe('custom');
    expect(buildRRule({ ...blankForm('2026-11-24'), repeat: 'custom', customRule: c.customRule })).toBe('RRULE:FREQ=MONTHLY;BYDAY=2TU');
  });
  it('반복 전체 수정: 회차를 하루 옮기면 시작일과 요일도 함께 이동, EXDATE 보존', () => {
    const master: GEvent = { id: 'm', start: { dateTime: '2026-11-03T10:00:00+09:00', timeZone: TZ }, end: { dateTime: '2026-11-03T11:00:00+09:00', timeZone: TZ }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU', 'EXDATE;TZID=Asia/Seoul:20261110T100000'] };
    const f = { ...blankForm('2026-11-25'), startTime: '14:00', endTime: '15:00', repeat: 'WEEKLY' as const, byDay: ['TU'] };
    const body = applyForm(master, f, { tz: TZ, includeRecurrence: true, series: { masterStartDate: '2026-11-03', instanceOldStartDate: '2026-11-24' } });
    expect(body.start.dateTime).toBe('2026-11-04T14:00:00');
    expect(body.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=WE', 'EXDATE;TZID=Asia/Seoul:20261110T100000']);
  });
  it('이 일정만 수정 시 recurrence 미포함', () => {
    const inst: GEvent = { id: 'm_1', recurringEventId: 'm', start: { date: '2026-11-24' }, end: { date: '2026-11-25' } };
    const f = { ...eventToForm(fromGoogle(inst, 'primary', false)!), repeat: 'DAILY' as const };
    expect(applyForm(inst, f, { tz: TZ, includeRecurrence: false }).recurrence).toBeUndefined();
  });
});

describe('입력 검증과 알림', () => {
  it('종료가 시작보다 빠르면 오류', () => {
    expect(validateForm({ ...blankForm('2026-11-24', 'default', '10:00'), endTime: '09:00' })).toMatch(/종료 시각/);
    expect(validateForm(blankForm('2026-11-24', 'default', '10:00'))).toBeNull();
    expect(validateForm({ ...blankForm('2026-11-24'), repeat: 'WEEKLY', byDay: [] })).toMatch(/요일/);
  });
  it('알림 해석: 여러 개면 유지', () => {
    expect(reminderFromEvent({ useDefault: true })).toBe('default');
    expect(reminderFromEvent({ useDefault: false, overrides: [] })).toBe('none');
    expect(reminderFromEvent({ useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] })).toBe(30);
    expect(reminderFromEvent({ useDefault: false, overrides: [{ method: 'popup', minutes: 30 }, { method: 'email', minutes: 60 }] })).toBe('keep');
    const g: GEvent = { id: 'r', start: { date: '2026-11-24' }, end: { date: '2026-11-25' }, reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 60 }, { method: 'popup', minutes: 5 }] } };
    const body = applyForm(g, eventToForm(fromGoogle(g, 'primary', false)!), { tz: TZ, includeRecurrence: true });
    expect(body.reminders).toEqual(g.reminders);
  });
});

describe('색상', () => {
  it('카테고리 기본 색은 서로 다르고, 직접 고른 색이 우선', () => {
    expect(new Set(Object.values(DEFAULT_CATEGORY_COLORS)).size).toBe(4);
    expect(resolveColor(undefined, 'trip', DEFAULT_CATEGORY_COLORS)).toBe('#d50000');
    expect(resolveColor('2', 'trip', DEFAULT_CATEGORY_COLORS)).toBe('#33b679');
    expect(textOn('#f6bf26')).toBe('#1f1f1f');
    expect(textOn('#3f51b5')).toBe('#ffffff');
  });
});

describe('관리자 진입·비밀번호', () => {
  it('3초 안 5회만 통과, 시간 초과 시 초기화', () => {
    let t = 0;
    const c = new TapCounter(5, 3000, () => t);
    for (let i = 0; i < 4; i++) { expect(c.tap()).toBe(false); t += 500; }
    expect(c.tap()).toBe(true);
    t += 10_000;
    for (let i = 0; i < 4; i++) { c.tap(); t += 1000; } // 4번째 이후 3초 초과
    expect(c.tap()).toBe(false);
  });

  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };

  it('원문을 저장하지 않고 해시로 검증', async () => {
    const s = mem();
    const pw = new AdminPassword(s, () => 0, 1000);
    await pw.set('blue1234');
    expect([...s.m.values()].join('')).not.toContain('blue1234');
    expect(await pw.verify('blue1234')).toEqual({ ok: true });
    expect((await pw.verify('wrong')).ok).toBe(false);
  });

  it('5회 실패 시 5분 잠금 후 해제', async () => {
    const s = mem();
    let now = 1_000;
    const pw = new AdminPassword(s, () => now, 1000);
    await pw.set('abcd');
    for (let i = 0; i < 4; i++) expect(await pw.verify('x')).toMatchObject({ ok: false, locked: 0 });
    const r = await pw.verify('x');
    expect(r).toMatchObject({ ok: false, locked: now + LOCK_MS });
    expect(await pw.verify('abcd')).toMatchObject({ ok: false }); // 잠긴 동안은 맞아도 거부
    now += LOCK_MS + 1;
    expect(await pw.verify('abcd')).toEqual({ ok: true });
  });

  it('너무 짧은 비밀번호 거부', async () => {
    await expect(new AdminPassword(mem(), () => 0, 1000).set('123')).rejects.toThrow();
  });
});
