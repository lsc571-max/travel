// IndexedDB 캐시: 빠른 첫 화면과 오프라인 읽기용 사본. 원본은 항상 Google Calendar.
import type { CalEvent } from './eventModel';

const DB = 'pureun-schedule';
const STORE = 'events';
let dbp: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (!dbp) {
    dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null); // 저장소를 쓸 수 없는 환경에서도 앱은 동작
      }
    });
  }
  return dbp;
}

export async function loadAll(): Promise<CalEvent[]> {
  const db = await open();
  if (!db) return [];
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as CalEvent[]);
    req.onerror = () => resolve([]);
  });
}

export async function replace(removeKeys: string[], put: CalEvent[]): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    removeKeys.forEach((k) => st.delete(k));
    put.forEach((e) => st.put(e));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

export async function clearAll(): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
