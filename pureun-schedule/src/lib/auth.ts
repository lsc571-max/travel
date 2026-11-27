// Google 로그인 (Google Identity Services 토큰 방식). 서버·클라이언트 비밀번호 없음.
// 액세스 토큰은 메모리에만 보관하고 기기 저장소에 저장하지 않는다.
import { BUILD_CLIENT_ID, CALENDAR_SCOPE, GIS_SCRIPT, SCOPES, TASKS_SCOPE } from '../config';
import { getStoredClientId, safeStorage } from './settings';

interface TokenResponse { access_token?: string; expires_in?: number | string; error?: string; error_description?: string; scope?: string }
interface TokenClient { requestAccessToken(o?: { prompt?: string; login_hint?: string }): void }
interface GoogleOAuth2 {
  initTokenClient(c: {
    client_id: string; scope: string; callback: (r: TokenResponse) => void;
    error_callback?: (e: { type: string; message?: string }) => void;
  }): TokenClient;
  hasGrantedAllScopes(r: TokenResponse, ...scopes: string[]): boolean;
  hasGrantedAnyScope?(r: TokenResponse, ...scopes: string[]): boolean;
  revoke(token: string, done?: () => void): void;
}
declare global { interface Window { google?: { accounts?: { oauth2?: GoogleOAuth2 } } } }

class AuthError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

let token: { value: string; exp: number } | null = null;
let tasksGranted = false; // 할 일 권한은 선택: 허용하지 않아도 일정 기능은 동작
let client: TokenClient | null = null;
let clientFor = '';
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
let scriptPromise: Promise<void> | null = null;
const listeners: (() => void)[] = [];
const CONNECTED_KEY = 'pc.connectedOnce';

export function clientId(): string { return getStoredClientId() || BUILD_CLIENT_ID; }
export function hasClientId(): boolean { return !!clientId(); }
export function wasConnected(): boolean { return safeStorage.getItem(CONNECTED_KEY) === '1'; }
export function onAuthChange(l: () => void) { listeners.push(l); }
const emit = () => listeners.forEach((l) => l());

export function getToken(): string | null {
  if (token && Date.now() < token.exp - 60_000) return token.value;
  return null;
}
export function isConnected(): boolean { return !!getToken(); }
export function hasTasksAccess(): boolean { return isConnected() && tasksGranted; }

export function invalidateToken() { token = null; tasksGranted = false; emit(); }

function loadScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SCRIPT;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { scriptPromise = null; reject(new AuthError('Google 로그인 모듈을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.', 'script')); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

/** 페이지 시작 시 미리 불러와 두면 버튼 클릭 후 팝업이 바로 뜬다 (팝업 차단 방지) */
export async function preload(): Promise<void> {
  if (!hasClientId()) return;
  try { await loadScript(); ensureClient(); } catch { /* 연결 시 다시 시도 */ }
}

function ensureClient(): TokenClient {
  const id = clientId();
  if (!id) throw new AuthError('OAuth 클라이언트 ID가 설정되지 않았습니다. 관리자 설정에서 입력해 주세요.', 'no_client');
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new AuthError('Google 로그인 모듈이 준비되지 않았습니다.', 'script');
  if (client && clientFor === id) return client;
  client = oauth2.initTokenClient({
    client_id: id,
    scope: SCOPES,
    callback: (r) => {
      const p = pending; pending = null;
      if (!p) return;
      if (r.error || !r.access_token) {
        p.reject(new AuthError(r.error === 'access_denied' ? '권한 허용이 취소되었습니다.' : `로그인 실패: ${r.error_description || r.error || '알 수 없는 오류'}`, r.error || 'unknown'));
        return;
      }
      if (!oauth2.hasGrantedAllScopes(r, CALENDAR_SCOPE)) {
        p.reject(new AuthError('캘린더 권한이 허용되지 않았습니다. 다시 연결하고 "일정 보기·수정" 권한에 체크해 주세요.', 'scope'));
        return;
      }
      tasksGranted = oauth2.hasGrantedAnyScope
        ? oauth2.hasGrantedAnyScope(r, TASKS_SCOPE)
        : (r.scope ?? '').split(' ').includes(TASKS_SCOPE);
      token = { value: r.access_token, exp: Date.now() + Number(r.expires_in ?? 3600) * 1000 };
      safeStorage.setItem(CONNECTED_KEY, '1');
      p.resolve(r.access_token);
      emit();
    },
    error_callback: (e) => {
      const p = pending; pending = null;
      p?.reject(new AuthError(e.type === 'popup_closed' ? '로그인 창이 닫혔습니다.' : e.type === 'popup_failed_to_open' ? '로그인 팝업이 차단되었습니다. 브라우저의 팝업 허용 후 다시 눌러 주세요.' : `로그인 오류: ${e.message || e.type}`, e.type));
    },
  });
  clientFor = id;
  return client;
}

/** 반드시 버튼 클릭 등 사용자 동작 안에서 호출 (팝업 차단 방지) */
export async function connect(prompt: '' | 'consent' | 'select_account' = ''): Promise<string> {
  await loadScript();
  const c = ensureClient();
  if (pending) pending.reject(new AuthError('이전 로그인 요청이 취소되었습니다.', 'superseded'));
  return new Promise<string>((resolve, reject) => {
    pending = { resolve, reject };
    c.requestAccessToken({ prompt });
  });
}

export async function disconnect(): Promise<void> {
  const t = token?.value;
  token = null;
  tasksGranted = false;
  safeStorage.removeItem(CONNECTED_KEY);
  if (t && window.google?.accounts?.oauth2) {
    await new Promise<void>((res) => window.google!.accounts!.oauth2!.revoke(t, () => res()));
  }
  emit();
}

/** 클라이언트 ID가 바뀌면 기존 연결을 끊는다 */
export function resetClient() { client = null; clientFor = ''; token = null; tasksGranted = false; emit(); }
