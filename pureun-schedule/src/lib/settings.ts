// 일반 설정 (이 기기에만 저장). 민감정보 없음.
import { DEFAULT_CATEGORY_COLORS } from './colors';
import type { ReminderChoice } from './eventModel';

export type Theme = 'system' | 'light' | 'dark';
export type ViewName = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listWeek';

export interface Settings {
  theme: Theme;
  fontSize: 'normal' | 'large' | 'xlarge';
  weekStart: 0 | 1;
  defaultView: ViewName;
  showHolidays: boolean;
  showTasks: boolean;
  categoryColors: Record<string, string>;
  defaultReminder: ReminderChoice;
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  fontSize: 'normal',
  weekStart: 0,
  defaultView: 'dayGridMonth',
  showHolidays: true,
  showTasks: true,
  categoryColors: { ...DEFAULT_CATEGORY_COLORS },
  defaultReminder: 'default',
};

/** localStorage 접근 실패(사생활 보호 모드 등)에도 앱이 멈추지 않게 감싼다 */
export const safeStorage = {
  getItem(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  setItem(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 시 무시 */ } },
  removeItem(k: string) { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
};

const KEY = 'pc.settings';
type Listener = (s: Settings) => void;
const listeners: Listener[] = [];
let current: Settings = load();

function load(): Settings {
  try {
    const raw = JSON.parse(safeStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULT_SETTINGS, ...raw, categoryColors: { ...DEFAULT_SETTINGS.categoryColors, ...(raw.categoryColors ?? {}) } };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function getSettings(): Settings { return current; }

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  safeStorage.setItem(KEY, JSON.stringify(current));
  listeners.forEach((l) => l(current));
}

export function onSettings(l: Listener) { listeners.push(l); }

// 오늘 API 호출 수 (앱 자체 집계, 이 기기 기준)
const USAGE_KEY = 'pc.usage';
export function countApiCall() {
  const today = new Date().toISOString().slice(0, 10);
  let u = { date: today, count: 0 };
  try { const p = JSON.parse(safeStorage.getItem(USAGE_KEY) ?? 'null'); if (p?.date === today) u = p; } catch { /* 무시 */ }
  u.count += 1;
  safeStorage.setItem(USAGE_KEY, JSON.stringify(u));
}
export function todayApiCalls(): number {
  try {
    const p = JSON.parse(safeStorage.getItem(USAGE_KEY) ?? 'null');
    return p?.date === new Date().toISOString().slice(0, 10) ? p.count : 0;
  } catch { return 0; }
}

// OAuth 클라이언트 ID (공개 식별자 — 비밀 아님). 관리자 설정에서 입력.
const CLIENT_KEY = 'pc.clientId';
export function getStoredClientId(): string { return safeStorage.getItem(CLIENT_KEY) ?? ''; }
export function setStoredClientId(v: string) { if (v) safeStorage.setItem(CLIENT_KEY, v); else safeStorage.removeItem(CLIENT_KEY); }
export function isValidClientId(v: string): boolean { return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(v.trim()); }
