// 날짜 문자열(YYYY-MM-DD)·시간(HH:MM) 도우미. 모두 기기 현지 시간 기준.

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toTimeStr(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 'YYYY-MM-DD' → 현지 자정 Date */
export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** 'YYYY-MM-DD' + 'HH:MM' → Google에 보낼 현지 dateTime (시간대는 별도 필드로 전송) */
export function localDateTime(date: string, time: string): string {
  return `${date}T${time}:00`;
}

/** 해당 날짜 현지 23:59:59를 UTC RRULE 형식(YYYYMMDDTHHMMSSZ)으로 */
export function untilUtc(date: string): string {
  const d = parseDateStr(date);
  d.setHours(23, 59, 59, 0);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** RRULE UNTIL 값(YYYYMMDD 또는 YYYYMMDDTHHMMSSZ) → 현지 'YYYY-MM-DD' */
export function untilToDateStr(v: string): string {
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v);
  if (!m) return '';
  return toDateStr(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])));
}

export const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
export const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

export function weekdayCode(date: string): string {
  return WEEKDAY_CODES[parseDateStr(date).getDay()];
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
  } catch {
    return 'Asia/Seoul';
  }
}

export function formatKoDate(date: string): string {
  const d = parseDateStr(date);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_KO[d.getDay()]})`;
}
