// 관리자 비밀번호 (기기별 로컬 저장)
// - 원문을 저장하지 않고 PBKDF2-SHA256(무작위 salt, 31만 회 반복) 해시만 저장한다.
// - 브라우저 저장소(localStorage)는 운영체제 보안 저장소만큼 안전하지 않다. 이 앱의 관리자 기능은
//   로컬 도구(성능 측정, 저장 데이터 초기화)만 다루며, 서버 권한이나 비밀키를 보관하지 않는다.
// - 기기 간 자동 동기화하지 않는다.
const KEY = 'pureun-cad.admin';
const FAIL_KEY = 'pureun-cad.admin.fail';
const ITER = 310000;
export const MAX_FAIL = 5;
export const LOCK_MS = 5 * 60 * 1000;

interface Stored {
  salt: string;
  hash: string;
  iter: number;
}
interface FailState {
  count: number;
  until: number;
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pw: string, salt: Uint8Array, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, key, 256);
  return b64(new Uint8Array(bits));
}

function read(): Stored | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? (JSON.parse(s) as Stored) : null;
  } catch {
    return null;
  }
}

export const hasPassword = () => read() !== null;

export function validatePassword(pw: string): string | null {
  if (pw.length < 6) return '비밀번호는 6자 이상이어야 합니다.';
  if (pw.length > 128) return '비밀번호가 너무 깁니다.';
  return null;
}

export async function setPassword(pw: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pw, salt, ITER);
  localStorage.setItem(KEY, JSON.stringify({ salt: b64(salt), hash, iter: ITER } satisfies Stored));
  localStorage.removeItem(FAIL_KEY);
}

function failState(): FailState {
  try {
    return JSON.parse(localStorage.getItem(FAIL_KEY) ?? '') as FailState;
  } catch {
    return { count: 0, until: 0 };
  }
}

/** 잠금 남은 시간(ms). 0이면 잠금 아님 */
export function lockRemaining(): number {
  const f = failState();
  return Math.max(0, (f.until ?? 0) - Date.now());
}

/** 상수 시간 비교 */
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** 동시에 여러 번 호출되어도 실패 횟수가 빠지지 않도록 순서대로 처리 */
let queue: Promise<unknown> = Promise.resolve();
export function verifyPassword(pw: string): Promise<'ok' | 'fail' | 'locked' | 'none'> {
  const run = queue.then(() => verifyOnce(pw));
  queue = run.catch(() => {});
  return run;
}

async function verifyOnce(pw: string): Promise<'ok' | 'fail' | 'locked' | 'none'> {
  const st = read();
  if (!st) return 'none';
  if (lockRemaining() > 0) return 'locked';
  const h = await derive(pw, unb64(st.salt), st.iter);
  if (safeEqual(h, st.hash)) {
    localStorage.removeItem(FAIL_KEY);
    return 'ok';
  }
  const f = failState();
  const count = (f.count ?? 0) + 1;
  localStorage.setItem(FAIL_KEY, JSON.stringify({ count: count >= MAX_FAIL ? 0 : count, until: count >= MAX_FAIL ? Date.now() + LOCK_MS : 0 }));
  return count >= MAX_FAIL ? 'locked' : 'fail';
}

export function failCount() {
  return failState().count ?? 0;
}

/** 비밀번호 재설정: 이 기기에 저장된 관리자 비밀번호 삭제 (관리자 전용 데이터만 영향) */
export function resetPassword() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(FAIL_KEY);
}
