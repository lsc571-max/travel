// 이 기기의 주인 계정 확인: 처음 연결한 구글 계정의 해시만 저장(이메일 원문 저장 안 함).
import { primaryCalendarName } from './calendarApi';
import { safeStorage } from './settings';

const KEY = 'pc.owner';

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pureun-schedule|${s}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type OwnerCheck = 'first' | 'same' | 'different' | 'unknown';

/** 연결 직후 호출. 처음이면 주인으로 기록, 아니면 같은 계정인지 비교 */
export async function checkOwner(): Promise<OwnerCheck> {
  let name = '';
  try { name = await primaryCalendarName(); } catch { return 'unknown'; }
  if (!name) return 'unknown';
  const h = await sha256(name);
  const saved = safeStorage.getItem(KEY);
  if (!saved) { safeStorage.setItem(KEY, h); return 'first'; }
  return saved === h ? 'same' : 'different';
}

export function clearOwner() { safeStorage.removeItem(KEY); }
