/* =====================================================================
 * 푸른 AI CAM - [저장 모듈] ui/storage.js
 * 역할: 브라우저 저장소(localStorage) 읽기·쓰기, 초기 데이터, 저장 데이터 정규화·손상 복구,
 *       관리자 비밀번호 해시(PBKDF2-SHA256) 도구. 외부 서버 전송 없음.
 * 의존: PCAM(계산 엔진), 화면 알림 함수(toast) 주입
 * ===================================================================== */
(function () {
  'use strict';
  const C = window.PCAM;
  window.PCAM_UI = window.PCAM_UI || {};
  window.PCAM_UI.createStorage = function (toast) {
    const DB_KEY = 'pcam.db.v1', ADMIN_KEY = 'pcam.admin.v1';
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { toast('브라우저 저장 실패: 저장 공간 또는 권한을 확인하세요. 파일로 백업하세요.', 'err'); return false; } }
  function freshDB() {
    const m = C.defaultMachine();
    const p = C.newProject(m);
    p.name = '예제 - M6 탭 플레이트';
    const g = C.newGroup('M6 탭', 0);
    g.holes = C.genGrid({ x: 20, y: 20, px: 55, py: 60, nx: 3, ny: 2 }).map(h => ({ id: C.uid('h'), x: h.x, y: h.y }));
    const bundles = C.defaultBundles(m);
    g.ops = C.applyBundle(bundles[1], m).ops;
    const g2 = C.newGroup('M5 탭 PCD', 1);
    g2.holes = C.genPCD({ cx: 75, cy: 50, dia: 40, count: 4, start: 45 }).map(h => ({ id: C.uid('h'), x: h.x, y: h.y }));
    g2.ops = C.applyBundle(bundles[0], m).ops;
    p.groups = [g, g2];
    return { schema: 1, machines: [m], bundles, projects: { [p.id]: p }, currentProjectId: p.id, settings: { theme: 'system', fs: 'm', sound: true, grid: { show: true, step: 5, snap: true } } };
  }
  function loadDB() {
    const raw = lsGet(DB_KEY);
    if (raw) {
      try {
        const d = JSON.parse(raw);
        if (d && d.schema === 1 && Array.isArray(d.machines) && d.machines.length) {
          d.machines = d.machines.map(C.normalizeMachine);
          d.bundles = Array.isArray(d.bundles) ? d.bundles.map(C.normalizeBundle) : [];
          const pr = {};
          Object.values(d.projects || {}).forEach(p => { const n = C.normalizeProject(p); pr[n.id] = n; });
          d.projects = pr;
          d.settings = Object.assign({ theme: 'system', fs: 'm', sound: true }, d.settings || {});
          d.settings.grid = Object.assign({ show: true, step: 5, snap: true }, d.settings.grid || {});
          return d;
        }
      } catch (e) { toast('저장 데이터를 읽지 못해 새로 시작합니다. (기존 데이터는 보존: ' + DB_KEY + '.broken)', 'err'); lsSet(DB_KEY + '.broken', raw); }
    }
    return freshDB();
  }
  function adminRec() { try { return JSON.parse(lsGet(ADMIN_KEY) || 'null'); } catch (e) { return null; } }
  function b64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
  function unb64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
  async function pbkdf2(pw, salt, iter) {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, k, 256));
  }
  function safeEq(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
  function pwRule(pw) { return pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw); }
    return { DB_KEY, ADMIN_KEY, lsGet, lsSet, freshDB, loadDB, adminRec, b64, unb64, pbkdf2, safeEq, pwRule };
  };
})();
