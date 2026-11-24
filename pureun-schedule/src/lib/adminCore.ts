// 숨겨진 관리자 진입(5회 연속 클릭)과 기기별 관리자 비밀번호. 원문은 저장하지 않고 PBKDF2 해시만 보관한다.

export class TapCounter {
  private count = 0;
  private first = 0;
  constructor(private readonly needed = 5, private readonly windowMs = 3000, private readonly now: () => number = () => Date.now()) {}

  /** 한 번 눌림을 기록. needed번째 눌림이 첫 눌림 후 windowMs 안이면 true */
  tap(): boolean {
    const t = this.now();
    if (this.count === 0 || t - this.first > this.windowMs) {
      this.count = 0;
      this.first = t;
    }
    this.count += 1;
    if (this.count >= this.needed) {
      this.count = 0;
      return true;
    }
    return false;
  }

  reset() { this.count = 0; }
  get current() { return this.count; }
}

interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

const PW_KEY = 'pc.admin.pw';
const LOCK_KEY = 'pc.admin.lock';
const PBKDF2_ITER = 310_000;
const MAX_FAILS = 5;
export const LOCK_MS = 5 * 60 * 1000;
export const MIN_PW_LEN = 4;

interface StoredPw { v: 1; salt: string; hash: string; iter: number }

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, key, 256);
  return b64(bits);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class AdminPassword {
  constructor(private readonly store: KV, private readonly now: () => number = () => Date.now(), private readonly iter = PBKDF2_ITER) {}

  isSet(): boolean {
    try { return !!JSON.parse(this.store.getItem(PW_KEY) ?? 'null')?.hash; } catch { return false; }
  }

  async set(password: string): Promise<void> {
    if (password.length < MIN_PW_LEN) throw new Error(`비밀번호는 ${MIN_PW_LEN}자 이상이어야 합니다.`);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await pbkdf2(password, salt, this.iter);
    const rec: StoredPw = { v: 1, salt: b64(salt), hash, iter: this.iter };
    this.store.setItem(PW_KEY, JSON.stringify(rec));
    this.store.removeItem(LOCK_KEY);
  }

  clear() { this.store.removeItem(PW_KEY); this.store.removeItem(LOCK_KEY); }

  lockedUntil(): number {
    try {
      const l = JSON.parse(this.store.getItem(LOCK_KEY) ?? 'null');
      return l && l.until > this.now() ? l.until : 0;
    } catch { return 0; }
  }

  private fails(): number {
    try { return JSON.parse(this.store.getItem(LOCK_KEY) ?? 'null')?.fails ?? 0; } catch { return 0; }
  }

  /** 결과: ok | wrong(남은 횟수) | locked(해제 시각) */
  async verify(password: string): Promise<{ ok: true } | { ok: false; locked: number; remaining: number }> {
    const until = this.lockedUntil();
    if (until) return { ok: false, locked: until, remaining: 0 };
    let rec: StoredPw | null = null;
    try { rec = JSON.parse(this.store.getItem(PW_KEY) ?? 'null'); } catch { rec = null; }
    if (!rec) return { ok: false, locked: 0, remaining: 0 };
    const hash = await pbkdf2(password, unb64(rec.salt), rec.iter);
    if (safeEqual(hash, rec.hash)) {
      this.store.removeItem(LOCK_KEY);
      return { ok: true };
    }
    const fails = this.fails() + 1;
    if (fails >= MAX_FAILS) {
      const lockUntil = this.now() + LOCK_MS;
      this.store.setItem(LOCK_KEY, JSON.stringify({ fails: 0, until: lockUntil }));
      return { ok: false, locked: lockUntil, remaining: 0 };
    }
    this.store.setItem(LOCK_KEY, JSON.stringify({ fails, until: 0 }));
    return { ok: false, locked: 0, remaining: MAX_FAILS - fails };
  }
}
