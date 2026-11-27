/* =====================================================================
 * 푸른 AI CAM - [통합 화면] ui/app.js  (V0.4 화면 재설계)
 * 화면 구성 (산업용 CAM 표준 배치)
 *   머리글  : 프로젝트 이름 · 되돌리기 · 프로젝트/장비·공구/작업지시서 · 공유 · 설정 · [NC 저장]
 *   왼쪽    : 작업 목록 — 공통 정보(소재·원점/NC 설정)를 먼저, 그 아래 가공(구멍·탭·포켓) 순서
 *   가운데  : 2D 배치(위치 입력·순서) / 3D 시뮬레이션(실제 NC 해석 결과로 소재를 깎아 보여줌)
 *   오른쪽  : 선택한 항목의 속성 (간편 입력 → 자동 공정 → 깊이 단면도(Z값) → 위치)
 *   아래    : 상태 표시줄(검증·예상 시간·공구 수) + 검증 결과/G코드 서랍
 * 계산·G코드 생성·검증·시뮬레이션은 PCAM 엔진 모듈만 사용하고, 이 파일은 입력·표시·저장만 담당한다.
 * 모든 데이터는 이 브라우저의 localStorage 에만 저장된다 (외부 서버 전송 없음).
 * ===================================================================== */
(function () {
  'use strict';
  const C = window.PCAM;
  const CHANGELOG = [
    { v: 'V0.4', d: C.BUILD_DATE, items: ['화면 전면 재설계: 작업 목록(소재 → 원점·NC → 가공) · 속성 패널 · 상태 표시줄 · 검증/G코드 서랍', '포켓 가공 추가: 사각(코너 R)·원형, 헬리컬 진입, 황삭(여유)·정삭, 공구·절입 자동', '3D 가공 시뮬레이션: 실제 NC 해석 결과로 소재를 깎아 표시, 회전·확대, 재생·구간 이동, 현재 X·Y·Z 표시', '깊이 단면도: 초기점·R점·소재 윗면·공구 끝 Z값을 한 그림에', '예상 가공 시간(추정)·작업지시서 인쇄, 평 엔드밀 공구 관리'] },
    { v: 'V0.3', d: '2026-11-27', items: ['구멍·탭 간편 입력: 지름·깊이 또는 나사 규격·탭 깊이만 넣으면 센터 → 드릴(사이클 자동) → 탭 공정 자동 구성', '없는 공구는 [공구 추가] 한 번으로 등록, 공정 이름 자동 표시(T번호·직경·가공)', '탭 공정 앞 오버라이드 100% 안내 주석 출력'] },
    { v: 'V0.2', d: '2026-11-27', items: ['기능별 모듈 구조: 공통 엔진·가공 모듈·공정 관리·포스트프로세서·검증·저장·그래픽 분리', '안전 강화: 소재 관통 급속/G01 이동, 탭 기초 구멍·절삭 조건(수정 NC 포함), 좌표계, G94, M29 주축 정지 검사'] },
    { v: 'V0.1', d: '2026-11-27', items: ['최초 버전: FANUC 3축 2.5축 홀 가공(G81·G82·G73·G83·G84·M29 리지드 탭)', '홀 배열(개별·직선·사각·PCD), 공정 묶음, 공구·장비 관리, 11개 항목 자동 검증, 독립 NC 해석 검증'] }
  ];
  const KIND = {
    drill: { ico: 'i-drill', cls: 'k-drill', label: '구멍', color: '#2f6fed' },
    tap: { ico: 'i-tap', cls: 'k-tap', label: '탭', color: '#8b5cf6' },
    pocket: { ico: 'i-pocket', cls: 'k-pocket', label: '포켓', color: '#ee8a10' },
    custom: { ico: 'i-custom', cls: 'k-custom', label: '직접 구성', color: '#64748b' }
  };
  const SIM_RES = { l: 60000, m: 160000, h: 400000 };
  const TOOL_BAND = { center: '#14a37f', drill: '#2f6fed', tap: '#8b5cf6', endmill: '#ee8a10' };

  /* ---------------- 상태 ---------------- */
  let DB = null;           // 저장 데이터
  let P = null;            // 현재 프로젝트
  const S = {
    sel: { kind: 'stock', gid: null, hid: null },
    vmode: '2d', drawer: false, bottomTab: 'check', mpanel: 'view', mode: 'select',
    arrKind: 'single', arr: {}, bundleSel: null, pathStep: 0, showPath: true, showNC: false,
    view: { scale: 3, cx: 75, cy: 50, fitted: false },
    undo: [], redo: [],
    V: null, nc: { text: '', hits: [], cuts: [], blocked: '', verify: null, edited: false, editText: '', editVerify: null },
    admin: { authed: false, until: 0, clicks: [] },
    openSec: {}, gz: new Map(), est: null, toolsTab: 'machine', dlgRefresh: null,
    sim: { speed: 10, res: 'm', showPaths: true, sig: '', stockSig: '', total: 0, tl: [], motions: [], t: 0 }
  };
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmtN = v => (C.isNum(v) ? String(C.r3(v)) : '');
  const ico = (id, cls) => '<svg' + (cls ? ' class="' + cls + '"' : '') + '><use href="#' + id + '"/></svg>';
  const mobile = () => window.innerWidth <= 900;
  const fmtSec = s => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60), r = s % 60; return m >= 60 ? Math.floor(m / 60) + '시간 ' + (m % 60) + '분' : (m ? m + '분 ' : '') + r + '초'; };
  const clock = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  /* ---------------- 저장소 ---------------- */
  const ST = window.PCAM_UI.createStorage(toast);
  const { DB_KEY, ADMIN_KEY, lsSet, freshDB, loadDB, adminRec, b64, unb64, pbkdf2, safeEq, pwRule } = ST;
  let saveTimer = null;
  function saveDB(now) {
    clearTimeout(saveTimer);
    const run = () => { if (P) DB.projects[P.id] = P; DB.currentProjectId = P ? P.id : null; lsSet(DB_KEY, JSON.stringify(DB)); };
    if (now) run(); else saveTimer = setTimeout(run, 300);
  }
  const machine = () => DB.machines.find(m => m.id === P.machineId) || DB.machines[0];

  /* ---------------- 바인딩 헬퍼 ---------------- */
  const binds = new Map(), acts = new Map();
  function clearScope(sc) { for (const k of [...binds.keys()]) if (k.startsWith(sc + ':')) binds.delete(k); for (const k of [...acts.keys()]) if (k.startsWith(sc + ':')) acts.delete(k); }
  function U(sc) {
    clearScope(sc); let n = 0;
    const key = () => sc + ':' + (++n);
    return {
      num(val, fn, a) { const k = key(); binds.set(k, el => { const raw = el.value.trim(); const v = parseFloat(raw); if (raw === '' || !isFinite(v)) { toast('숫자를 입력하세요.', 'err'); renderAll(); return; } fn(v); }); return '<input type="number" step="any" inputmode="decimal" data-k="' + k + '" value="' + esc(fmtN(val)) + '" ' + (a || '') + '>'; },
      int(val, fn, a) { const k = key(); binds.set(k, el => { const v = el.value.trim() === '' ? NaN : Number(el.value); if (!Number.isInteger(v)) { toast('정수를 입력하세요.', 'err'); renderAll(); return; } fn(v); }); return '<input type="number" step="1" inputmode="numeric" data-k="' + k + '" value="' + esc(val) + '" ' + (a || '') + '>'; },
      text(val, fn, a) { const k = key(); binds.set(k, el => fn(el.value)); return '<input type="text" data-k="' + k + '" value="' + esc(val) + '" ' + (a || '') + '>'; },
      color(val, fn) { const k = key(); binds.set(k, el => fn(el.value)); return '<input type="color" data-k="' + k + '" value="' + esc(val) + '" title="표시 색상" aria-label="표시 색상">'; },
      select(val, opts, fn, a) { const k = key(); binds.set(k, el => fn(el.value)); return '<select data-k="' + k + '" ' + (a || '') + '>' + opts.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + (o[2] ? ' disabled' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>'; },
      check(val, fn, label, a) { const k = key(); binds.set(k, el => fn(el.checked)); return '<label class="chk"><input type="checkbox" data-k="' + k + '"' + (val ? ' checked' : '') + ' ' + (a || '') + '>' + esc(label) + '</label>'; },
      btn(label, fn, cls, a) { const k = key(); acts.set(k, fn); return '<button type="button" data-a="' + k + '" class="' + (cls || '') + '" ' + (a || '') + '>' + label + '</button>'; },
      act(fn) { const k = key(); acts.set(k, fn); return k; },
      fld(label, inner, hint) { return '<label class="fld"' + (hint ? ' title="' + esc(hint) + '"' : '') + '><span>' + label + '</span>' + inner + '</label>'; }
    };
  }
  // change 처리는 포커스 이동(Tab) 이후 실행하여 다음 입력칸 포커스를 유지
  document.addEventListener('change', e => { const el = e.target, k = el && el.dataset && el.dataset.k; if (k && binds.has(k)) { const fn = binds.get(k); setTimeout(() => fn(el), 0); } });
  document.addEventListener('toggle', e => { const d = e.target; if (d && d.dataset && d.dataset.sec) S.openSec[d.dataset.sec] = d.open; }, true);
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-a]'); if (b && acts.has(b.dataset.a) && !b.disabled) { e.preventDefault(); acts.get(b.dataset.a)(e, b); } });
  // 버튼이 아닌 선택 항목(작업 목록 등)도 키보드 Enter/Space 로 선택
  document.addEventListener('keydown', e => { const b = e.target; if ((e.key === 'Enter' || e.key === ' ') && b && b.getAttribute && b.getAttribute('role') === 'button' && b.tagName !== 'BUTTON' && b.dataset.a) { e.preventDefault(); b.click(); } });

  /* ---------------- 변경·되돌리기 ---------------- */
  function mutate(fn) {
    S.undo.push(JSON.stringify(P)); if (S.undo.length > 50) S.undo.shift();
    S.redo = [];
    fn();
    regenSpecs();
    P.updatedAt = new Date().toISOString();
    saveDB();
    renderAll();
  }
  // 간편 입력 그룹은 소재·장비·입력이 바뀔 때마다 공정을 다시 구성
  function regenSpecs() { const m = machine(); P.groups.forEach(g => { if (g.spec) C.applyHoleSpec(g, m, P.stock); }); }
  function undo() { if (!S.undo.length) return; S.redo.push(JSON.stringify(P)); P = C.normalizeProject(JSON.parse(S.undo.pop())); regenSpecs(); saveDB(); renderAll(); toast('되돌렸습니다.'); }
  function redo() { if (!S.redo.length) return; S.undo.push(JSON.stringify(P)); P = C.normalizeProject(JSON.parse(S.redo.pop())); regenSpecs(); saveDB(); renderAll(); toast('다시 실행했습니다.'); }
  function dbChange(fn) { fn(); regenSpecs(); saveDB(); renderAll(); }

  /* ---------------- 알림 ---------------- */
  function toast(msg, kind) {
    const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg;
    $('#toasts').appendChild(t); setTimeout(() => t.remove(), kind === 'err' ? 5000 : 2600);
  }
  function beep() {
    if (!DB.settings.sound) return;
    try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(), g = a.createGain(); o.frequency.value = 440; o.type = 'square'; g.gain.value = 0.05; o.connect(g); g.connect(a.destination); o.start(); setTimeout(() => { o.stop(); a.close(); }, 250); } catch (e) { /* 소리 미지원 */ }
  }

  /* ---------------- 재계산 (검증·생성·독립 검증·시간 추정) ---------------- */
  function verifyCtx(m, extra) { return Object.assign({ stock: P.stock, machine: m, clamps: P.clamps, settings: P.settings, pockets: C.pocketRegions(P) }, extra); }
  function recompute() {
    const m = machine();
    S.V = C.validateProject(P, m);
    const g = C.generateNC(P, m, S.V.plan);
    S.nc.text = g.text; S.nc.hits = g.hits; S.nc.cuts = g.cuts || []; S.nc.blocked = g.blocked || '';
    S.nc.verify = g.text ? C.verifyNC(g.text, verifyCtx(m, { expected: g.hits, expectedCuts: g.cuts || [] })) : null;
    // 재검증한 수정본도 소재·장비·클램프가 바뀌면 현재 조건으로 다시 검사 (이전 통과 결과 재사용 금지)
    if (S.nc.edited && S.nc.editVerify) S.nc.editVerify = C.verifyNC(S.nc.editText, verifyCtx(m, { expected: null }));
    // 그룹별 가장 깊은 공구 끝 Z (화면 표시용)
    const tm = C.toolMap(m); S.gz = new Map();
    P.groups.forEach(gr => {
      let z = null;
      gr.ops.forEach(op => { const t = tm.get(op.toolNo); if (!t || !C.OP_TYPES[op.type] || !C.OP_TYPES[op.type].tools.includes(t.type)) return; const d = C.opDepth(op, t, P.stock); if (d && C.isNum(d.z) && (z === null || d.z < z)) z = d.z; });
      S.gz.set(gr.id, z);
    });
    S.est = estimate(m);
  }
  // 시뮬레이션·시간 추정에 쓰는 NC 해석 결과 (수정본이면 재검증한 수정본만)
  function simSource() { return S.nc.edited ? S.nc.editVerify : S.nc.verify; }
  function estimate(m) {
    const vr = simSource(); if (!vr || !vr.motions || !vr.motions.length) return null;
    const tl = C.SIM.timeline(vr.motions, m);
    const runs = []; let cur = null;
    vr.motions.forEach((mv, i) => { if (!cur || cur.t !== mv.t) { cur = { t: mv.t, sec: 0 }; runs.push(cur); } cur.sec += tl[i].sec; });
    const cut = tl[tl.length - 1].t1, tc = runs.length * C.toNum(m.tcSec, 6);
    return { cut, tc, total: cut + tc, runs, changes: runs.length };
  }
  function counts() {
    const iss = S.V ? S.V.issues : [];
    const e = iss.filter(i => i.level === 'error').length, w = iss.filter(i => i.level === 'warn').length;
    const vr = S.nc.edited ? S.nc.editVerify : S.nc.verify;
    return { e, w, ne: vr ? vr.errors.length : 0, nw: vr ? vr.warnings.length : 0, vr };
  }
  // NC 다운로드 가능 여부와 사유
  function downloadState() {
    const c = counts();
    if (S.nc.blocked) return { ok: false, why: S.nc.blocked };
    if (c.e) return { ok: false, why: '모델 검증 오류 ' + c.e + '건' };
    if (S.nc.edited) {
      if (!S.nc.editVerify) return { ok: false, why: '수정한 G코드는 재검증이 필요합니다' };
      if (S.nc.editVerify.errors.length) return { ok: false, why: '수정한 G코드 검증 오류 ' + S.nc.editVerify.errors.length + '건' };
    } else {
      if (!S.nc.verify) return { ok: false, why: 'G코드가 없습니다' };
      if (S.nc.verify.errors.length) return { ok: false, why: 'NC 해석 검증 오류 ' + S.nc.verify.errors.length + '건' };
    }
    return { ok: true, test: !machine().verified };
  }

  /* ---------------- 전체 렌더 ---------------- */
  function renderAll() {
    const ae = document.activeElement, ak = ae && ae.dataset ? ae.dataset.k : null;
    recompute();
    renderTop(); renderTree(); renderProps(); renderVTools(); renderStatus(); renderBottom();
    if (S.vmode === '2d') drawView(); else update3D();
    if (S.dlgRefresh && $('#dlg').open) S.dlgRefresh();
    if (ak) { const el = document.querySelector('[data-k="' + ak + '"]'); if (el) el.focus(); }
  }
  function renderTop() {
    $('#verTag').textContent = C.VERSION;
    const pn = $('#projName'); if (document.activeElement !== pn) pn.value = P.name;
    $('#btnUndo').disabled = !S.undo.length; $('#btnRedo').disabled = !S.redo.length;
    const ds = downloadState(), b = $('#btnDownload');
    b.classList.toggle('blocked', !ds.ok); b.classList.toggle('test', ds.ok && !!ds.test);
    b.title = ds.ok ? (ds.test ? 'NC 저장 — 장비 실가공 검증 전이므로 "검증용(TEST)" 파일로 저장됩니다' : 'NC 파일 저장') : 'NC 생성 차단: ' + ds.why;
    b.setAttribute('aria-disabled', ds.ok ? 'false' : 'true');
    document.querySelectorAll('#bottomTabs button[data-tab]').forEach(x => x.classList.toggle('act', x.dataset.tab === S.bottomTab));
    document.querySelectorAll('#mnav button').forEach(x => x.classList.toggle('act', x.dataset.m === S.mpanel));
    document.querySelectorAll('.mpanel').forEach(x => x.classList.toggle('mact', x.id === S.mpanel));
    $('#app').classList.toggle('drawer-open', S.drawer);
    $('#tab2d').classList.toggle('act', S.vmode === '2d'); $('#tab3d').classList.toggle('act', S.vmode === '3d');
    $('#tab2d').setAttribute('aria-selected', S.vmode === '2d'); $('#tab3d').setAttribute('aria-selected', S.vmode === '3d');
    $('#canvasWrap').hidden = S.vmode !== '2d'; $('#v3wrap').hidden = S.vmode !== '3d';
    const c = counts(), bd = $('#chkBadge'), ne = c.e + c.ne;
    bd.className = 'badge ' + (ne ? 'err' : (c.w + c.nw ? 'warn' : 'ok'));
    bd.textContent = ne ? ne : (c.w + c.nw ? c.w + c.nw : '✓');
  }

  /* ---------------- 왼쪽: 작업 목록 ---------------- */
  const kindOf = g => (g.spec && KIND[g.spec.kind]) ? g.spec.kind : 'custom';
  const isFineThread = sp => !C.METRIC_COARSE.some(r => r[0] === sp.tapD && r[1] === sp.tapP);
  function groupSummary(g) {
    const sp = g.spec, n = g.holes.length;
    let s;
    if (!sp) s = g.ops.length ? g.ops.map(o => C.OP_TYPES[o.type] ? C.OP_TYPES[o.type].label : o.type).join('→') : '공정 없음';
    else if (sp.kind === 'tap') s = 'M' + sp.tapD + (isFineThread(sp) ? '×' + sp.tapP : '') + (sp.thru ? ' 관통' : ' 깊이 ' + sp.tapDepth);
    else if (sp.kind === 'pocket') s = (sp.shape === 'circle' ? '원형 Ø' + sp.dia : '사각 ' + sp.w + '×' + sp.h + (sp.cr > 0 ? ' R' + sp.cr : '')) + ' 깊이 ' + sp.depth;
    else s = 'Ø' + sp.dia + (sp.thru ? ' 관통' : ' 깊이 ' + sp.depth);
    return s + ' · ' + n + '개';
  }
  function groupStatus(g) {
    const iss = S.V.issues.filter(i => i.ref && i.ref.gid === g.id);
    if (!g.ops.length || iss.some(i => i.level === 'error')) return 'err';
    if (!g.holes.length || iss.some(i => i.level === 'warn')) return 'warn';
    return 'ok';
  }
  const stIcon = s => '<span class="st ' + s + '" title="' + (s === 'ok' ? '문제 없음' : s === 'err' ? '오류 확인 필요' : '경고 확인') + '">' + ico(s === 'ok' ? 'i-check' : s === 'err' ? 'i-x' : 'i-warn') + '</span>';
  function select(kind, gid) { S.sel = { kind, gid: gid || null, hid: null }; if (mobile()) S.mpanel = 'right'; renderAll(); }
  function renderTree() {
    const u = U('tr'), m = machine(), st = P.stock, set = P.settings;
    const item = (sel, icon, cls, title, sub, status, fn, extra) => '<div class="titem' + (sel ? ' sel' : '') + '" role="button" tabindex="0" aria-pressed="' + sel + '" data-a="' + u.act(fn) + '"><span class="ico ' + cls + '">' + ico(icon) + '</span><span class="tx"><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span>' + (extra || '') + stIcon(status) + '</div>';
    const okStock = st.sx > 0 && st.sy > 0 && st.sz > 0;
    let h = '<div class="sect-t">공통 정보</div>';
    h += item(S.sel.kind === 'stock', 'i-stock', 'k-stock', '소재·고정', (C.MATERIALS[st.material] ? C.MATERIALS[st.material].label.split(' ')[0] : st.material) + ' ' + st.sx + '×' + st.sy + '×' + st.sz + (P.clamps.length ? ' · 클램프 ' + P.clamps.length : ''), okStock ? 'ok' : 'err', () => select('stock'));
    const zIss = S.V.issues.filter(i => i.cat === 10 && !i.ref);
    h += item(S.sel.kind === 'nc', 'i-nc', 'k-nc', '원점·NC 출력', set.wcs + ' · O' + String(P.programNo).padStart(4, '0') + ' · 초기점 Z' + set.initialZ, zIss.some(i => i.level === 'error') ? 'err' : zIss.some(i => i.level === 'warn') ? 'warn' : 'ok', () => select('nc'));
    h += '<div class="sect-t">가공 <small>(위에서부터)</small></div>';
    if (!P.groups.length) h += '<div class="note info">아래에서 가공을 추가하세요. 구멍·탭·포켓 중 고르면 공구와 조건이 자동으로 정해집니다.</div>';
    P.groups.forEach(g => {
      const k = KIND[kindOf(g)];
      h += item(S.sel.kind === 'group' && S.sel.gid === g.id, k.ico, k.cls, g.name, groupSummary(g), groupStatus(g), () => select('group', g.id));
    });
    h += '<div class="addrow">' +
      u.btn(ico('i-drill') + '+ 구멍', () => addGroup('drill'), 'addbtn k-drill', 'title="드릴 구멍 추가 (센터 → 드릴, 사이클 자동)"') +
      u.btn(ico('i-tap') + '+ 탭', () => addGroup('tap'), 'addbtn k-tap', 'title="나사(탭) 구멍 추가 (센터 → 기초 드릴 → 탭)"') +
      u.btn(ico('i-pocket') + '+ 포켓', () => addGroup('pocket'), 'addbtn k-pocket', 'title="사각·원형 포켓 추가 (헬리컬 진입 → 황삭 → 정삭)"') + '</div>';
    // 요약
    const holes = P.groups.reduce((s, g) => s + g.holes.length, 0);
    const tools = new Set(S.V.plan.steps.map(s => s.toolNo));
    h += '<div class="tsum">위치 <b>' + holes + '</b>개 · 공정 <b>' + S.V.plan.steps.length + '</b>단계 · 공구 <b>' + tools.size + '</b>개' +
      (S.est ? '<br>예상 가공 시간 <b>약 ' + fmtSec(S.est.total) + '</b> <small>(추정)</small>' : '') +
      '<br><small>장비: ' + esc(m.name) + (m.verified ? ' · 실가공 검증 완료' : ' · 실가공 검증 전') + '</small></div>';
    $('#tree').innerHTML = h;
  }
  function addGroup(kind) {
    mutate(() => {
      const label = KIND[kind].label;
      const n = C.newGroup(label + ' ' + (P.groups.filter(g => kindOf(g) === kind).length + 1), P.groups.length);
      n.color = KIND[kind].color;
      n.spec = kind === 'pocket' ? C.newPocketSpec() : C.newHoleSpec(kind);
      if (kind === 'pocket') { // 포켓은 바로 보이도록 소재 중앙에 하나 배치
        const r = C.stockRect(P.stock);
        n.holes.push({ id: C.uid('h'), x: C.r3((r.x0 + r.x1) / 2), y: C.r3((r.y0 + r.y1) / 2) });
      }
      P.groups.push(n); S.sel = { kind: 'group', gid: n.id, hid: null };
    });
    if (mobile()) { S.mpanel = 'right'; renderAll(); }
  }

  /* ---------------- 오른쪽: 속성 ---------------- */
  function curGroup() { return P.groups.find(g => g.id === S.sel.gid) || null; }
  function renderProps() {
    if (S.sel.kind === 'group' && !curGroup()) S.sel = { kind: 'stock', gid: null, hid: null };
    const u = U('rt');
    let head = '', body = '';
    if (S.sel.kind === 'group') {
      const g = curGroup(), k = KIND[kindOf(g)], i = P.groups.indexOf(g);
      head = '<span class="ico ' + k.cls + '" style="background:' + esc(g.color) + '">' + ico(k.ico) + '</span>' +
        u.text(g.name, v => mutate(() => { g.name = v.slice(0, 40) || '가공'; }), 'aria-label="가공 이름" maxlength="40"') +
        u.color(g.color, v => mutate(() => { g.color = v; })) +
        u.btn('↑', () => mutate(() => { if (i > 0) P.groups.splice(i - 1, 0, P.groups.splice(i, 1)[0]); }), 'ibtn sm', 'title="순서 위로" aria-label="순서 위로" ' + (i ? '' : 'disabled')) +
        u.btn('↓', () => mutate(() => { if (i < P.groups.length - 1) P.groups.splice(i + 1, 0, P.groups.splice(i, 1)[0]); }), 'ibtn sm', 'title="순서 아래로" aria-label="순서 아래로" ' + (i < P.groups.length - 1 ? '' : 'disabled')) +
        u.btn(ico('i-x'), () => { if (confirm('"' + g.name + '" (위치 ' + g.holes.length + '개)를 삭제할까요?')) mutate(() => { P.groups.splice(i, 1); S.sel = { kind: 'stock', gid: null, hid: null }; }); }, 'ibtn sm danger', 'title="삭제" aria-label="이 가공 삭제"');
      body = groupBody(u, g);
    } else if (S.sel.kind === 'nc') {
      head = '<span class="ico k-nc">' + ico('i-nc') + '</span><b style="flex:1">원점·NC 출력 설정</b>';
      body = ncBody(u);
    } else {
      head = '<span class="ico k-stock">' + ico('i-stock') + '</span><b style="flex:1">소재·고정</b>';
      body = stockBody(u);
    }
    $('#propHead').innerHTML = head;
    $('#rightBody').innerHTML = body;
  }
  const sec = (key, title, defOpen) => '<details class="sect2" data-sec="' + key + '"' + ((S.openSec[key] !== undefined ? S.openSec[key] : defOpen) ? ' open' : '') + '><summary>' + title + '</summary>';
  function stockBody(u) {
    const st = P.stock;
    const matOpts = Object.keys(C.MATERIALS).map(k => [k, C.MATERIALS[k].label]);
    let h = '<h3><span class="step">1</span>소재</h3>';
    h += u.fld('재질', u.select(st.material, matOpts, v => mutate(() => { st.material = v; })), '재질에 따라 회전수·이송·절입이 자동 계산됩니다');
    h += '<div class="grid3" style="margin-top:8px">' +
      u.fld('가로 X (mm)', u.num(st.sx, v => mutate(() => { st.sx = v; }))) +
      u.fld('세로 Y (mm)', u.num(st.sy, v => mutate(() => { st.sy = v; }))) +
      u.fld('두께 Z (mm)', u.num(st.sz, v => mutate(() => { st.sz = v; }))) + '</div>';
    h += '<h3><span class="step">2</span>공작물 원점</h3><div class="grid2">' +
      u.fld('원점 위치 (X0 Y0)', u.select(st.origin, Object.keys(C.ORIGIN_LABEL).map(k => [k, C.ORIGIN_LABEL[k]]), v => changeOrigin(v))) +
      u.fld('하부 여유 (패럴렐 틈, mm)', u.num(st.under, v => mutate(() => { st.under = v; })), '관통 가공 시 소재 아래로 들어갈 수 있는 깊이') + '</div>';
    h += '<div class="note info">Z0 = 소재 윗면입니다. 공구 길이 보정 후 소재 윗면에 Z0 을 맞추세요. 관통 가공이 하부 여유보다 깊으면 차단됩니다.</div>';
    h += '<h3><span class="step">3</span>클램프·금지 영역 <small>(' + P.clamps.length + '개)</small></h3>';
    if (!P.clamps.length) h += '<small>클램프가 없습니다. 2D 화면 위쪽 [클램프] 도구로 드래그하거나 아래 버튼으로 추가하세요. 공구 경로가 클램프에 닿으면 차단됩니다.</small>';
    else {
      h += '<div class="tblwrap"><table class="tbl"><tr><th>#</th><th>X</th><th>Y</th><th>폭</th><th>길이</th><th>높이</th><th></th></tr>';
      P.clamps.forEach((c, i) => {
        h += '<tr><td>' + (i + 1) + '</td><td>' + u.num(c.x, v => mutate(() => { c.x = v; })) + '</td><td>' + u.num(c.y, v => mutate(() => { c.y = v; })) + '</td><td>' + u.num(c.w, v => mutate(() => { c.w = v; })) + '</td><td>' + u.num(c.h, v => mutate(() => { c.h = v; })) + '</td><td>' + u.num(c.height, v => mutate(() => { c.height = v; })) + '</td><td>' + u.btn('✕', () => mutate(() => { P.clamps.splice(i, 1); }), 'sm danger', 'title="클램프 삭제" aria-label="클램프 삭제"') + '</td></tr>';
      });
      h += '</table></div><small>높이 = 소재 윗면(Z0) 기준 클램프 최고 높이. 초기점은 클램프보다 ' + C.CLAMP_MARGIN + 'mm 이상 높아야 합니다.</small>';
    }
    h += '<div class="row" style="margin-top:8px">' + u.btn(ico('i-plus') + '클램프 추가', () => mutate(() => { const r = C.stockRect(P.stock); P.clamps.push({ id: C.uid('c'), x: r.x0 - 10, y: (r.y0 + r.y1) / 2 - 10, w: 20, h: 20, height: 30 }); }), 'sm') + '</div>';
    return h;
  }
  function ncBody(u) {
    const set = P.settings;
    let h = '<h3>프로그램</h3><div class="grid2">' +
      u.fld('프로그램 번호 O', u.int(P.programNo, v => mutate(() => { P.programNo = v; }), 'min="1" max="9999"')) +
      u.fld('공작물 좌표계', u.select(set.wcs, ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].map(x => [x, x]), v => mutate(() => { set.wcs = v; }))) + '</div>';
    h += '<h3>높이 (Z)</h3><div class="grid2">' +
      u.fld('초기점 Z (안전 높이, mm)', u.num(set.initialZ, v => mutate(() => { set.initialZ = v; })), '공구 교환 후 접근·구멍 사이 이동 높이 (클램프보다 높게)') +
      u.fld('구멍 사이 이동 높이', u.select(set.retract, [['G98', '초기점까지 올림 (G98, 안전)'], ['G99', 'R점까지만 올림 (G99, 빠름)']], v => mutate(() => { set.retract = v; }))) + '</div>';
    h += '<div class="note info">초기점 Z 와 R점은 다릅니다. <b>초기점</b>은 이동용 안전 높이, <b>R점</b>은 각 공정에서 절삭 이송을 시작하는 높이(소재 윗면 위 몇 mm)입니다. R점은 각 가공의 공정에서 정해집니다.</div>';
    h += '<h3>순서</h3><div class="grid2">' +
      u.fld('공정 순서', u.select(set.toolOrder, [['tool', '공구 교환 최소화'], ['group', '가공 목록 순서대로']], v => mutate(() => { set.toolOrder = v; }))) +
      u.fld('구멍 순서', u.select(set.pathOrder, [['nearest', '최단 거리(근사)'], ['zigzag', '지그재그(행)'], ['input', '입력 순서']], v => mutate(() => { set.pathOrder = v; }))) + '</div>';
    h += '<h3>출력 옵션</h3>' + u.check(set.coolant, v => mutate(() => { set.coolant = v; }), '절삭유 M08/M09') + u.check(set.m01, v => mutate(() => { set.m01 = v; }), '공구 교환 전 선택 정지 M01') +
      u.check(set.seqNo, v => mutate(() => { set.seqNo = v; }), '시퀀스 번호(N) 출력');
    return h;
  }
  function changeOrigin(v) {
    const st = P.stock;
    if (v === st.origin) return;
    const a = C.stockRect(st), b = C.stockRect(Object.assign({}, st, { origin: v }));
    const hasItems = P.groups.some(g => g.holes.length) || P.clamps.length;
    const keep = hasItems ? confirm('원점을 바꿉니다.\n[확인] 구멍·포켓·클램프를 소재 위 같은 위치에 유지 (좌표 자동 변환)\n[취소] 좌표값 그대로 유지') : false;
    mutate(() => {
      st.origin = v;
      if (keep) {
        const dx = b.x0 - a.x0, dy = b.y0 - a.y0;
        P.groups.forEach(g => g.holes.forEach(hh => { hh.x = C.r3(hh.x + dx); hh.y = C.r3(hh.y + dy); }));
        P.clamps.forEach(c => { c.x = C.r3(c.x + dx); c.y = C.r3(c.y + dy); });
      }
      S.view.fitted = false;
    });
  }

  /* ---------------- 가공 그룹 속성 ---------------- */
  function groupBody(u, g) {
    const mode = kindOf(g);
    let h = '<h3><span class="step">1</span>가공 방법</h3><div class="seg" role="radiogroup" aria-label="가공 방법">' +
      ['drill', 'tap', 'pocket', 'custom'].map(k => u.btn(ico(KIND[k].ico) + (k === 'custom' ? '직접' : KIND[k].label), () => setGroupMode(g, k), (mode === k ? 'on ' : '') + KIND[k].cls, 'role="radio" aria-checked="' + (mode === k) + '"')).join('') + '</div>';
    if (mode === 'pocket') h += pocketForm(u, g);
    else if (g.spec) h += specForm(u, g);
    else h += customForm(u, g);
    h += depthDiagram(g);
    const isPk = mode === 'pocket';
    h += '<h3><span class="step">2</span>' + (isPk ? '포켓 중심 위치' : '구멍 위치') + ' <small>(' + g.holes.length + '개)</small></h3><div class="subtabs">' + [['single', '개별'], ['line', '직선'], ['grid', '사각 배열'], ['pcd', '원형(PCD)']].map(k => u.btn(k[1], () => { S.arrKind = k[0]; renderProps(); }, 'sm' + (S.arrKind === k[0] ? ' on' : ''))).join('') + '</div>';
    h += arrayForm(u, g);
    if (g.holes.length) {
      const lim = 300, z = S.gz.get(g.id);
      h += '<div class="tblwrap" style="margin-top:8px"><table class="tbl"><tr><th>#</th><th>X</th><th>Y</th><th title="가장 깊은 공구 끝">바닥 Z</th><th></th></tr>';
      g.holes.slice(0, lim).forEach((hh, i) => {
        h += '<tr class="' + (S.sel.hid === hh.id ? 'sel' : '') + '"><td>' + u.btn(String(i + 1), () => { S.sel.hid = hh.id; renderAll(); }, 'sm', 'title="화면에서 선택"') + '</td><td>' + u.num(hh.x, v => mutate(() => { hh.x = C.r3(v); })) + '</td><td>' + u.num(hh.y, v => mutate(() => { hh.y = C.r3(v); })) + '</td><td class="num">' + (z === null || z === undefined ? '-' : C.fmt(z)) + '</td><td>' + u.btn('✕', () => mutate(() => { g.holes.splice(i, 1); }), 'sm danger', 'title="삭제" aria-label="위치 삭제"') + '</td></tr>';
      });
      h += '</table></div>' + (g.holes.length > lim ? '<small>처음 ' + lim + '개만 표시 (화면에서 선택·편집 가능)</small>' : '');
      h += '<div class="row" style="margin-top:6px">' + u.btn('위치 전체 삭제', () => { if (confirm('위치 ' + g.holes.length + '개를 모두 삭제할까요?')) mutate(() => { g.holes = []; }); }, 'sm danger') + '</div>';
    } else h += '<div class="note warn">위치가 없습니다. 위 입력란을 쓰거나 2D 화면의 [위치 추가] 도구로 클릭하세요.</div>';
    return h;
  }
  function setGroupMode(g, mode) {
    const cur = kindOf(g);
    if (mode === cur) return;
    if (mode === 'custom') { mutate(() => { g.spec = null; }); return; }
    if (!g.spec && g.ops.length && !confirm('직접 구성한 공정 ' + g.ops.length + '개를 지우고 간편 입력으로 다시 구성할까요?')) return;
    mutate(() => { g.spec = mode === 'pocket' ? C.newPocketSpec() : C.newHoleSpec(mode); if (g.color === KIND[cur].color) g.color = KIND[mode].color; });
  }
  // 자동 구성 결과 (공정 목록·안내·없는 공구 추가)
  function genBlock(u, g, res) {
    const m = machine(), tm = C.toolMap(m);
    let h = '<div class="gen"><b>자동 구성된 공정</b>';
    if (!g.ops.length) h += '<div class="opinfo">공정이 없습니다.</div>';
    g.ops.forEach((op, i) => {
      const t = tm.get(op.toolNo), d = t ? C.opDepth(op, t, P.stock) : null, c = C.opConditions(op, t, P.stock.material, m);
      const col = t ? (TOOL_BAND[t.type] || '#64748b') : '#64748b';
      const extra = op.type === 'pocketRough' ? ' · 절입 ' + op.stepdown + ' · 간격 ' + op.stepover + '% · 여유 ' + op.allowWall + '/' + op.allowFloor : op.type === 'pocketFinish' ? ' · 여유 0' : (op.q && C.OPS.get(op.type).ui.q ? ' · Q' + op.q : '');
      h += '<div class="genrow"><span class="num" style="background:' + col + '">' + (i + 1) + '</span><span class="nm">' + esc(C.opLabel(op, m)) + '</span><small>' + (d ? '끝 Z' + C.fmt(d.z) + ' · ' : '') + 'S' + c.rpm + ' F' + c.feed + extra + '</small></div>';
    });
    res.notes.forEach(n => { h += '<div class="note ' + n.level + '">' + (n.level === 'error' ? '✖ ' : n.level === 'warn' ? '⚠ ' : 'ℹ ') + esc(n.msg) + '</div>'; });
    res.missing.forEach(mm => {
      const lbl = mm.type === 'tap' ? '탭 M' + mm.dia + '×' + mm.pitch : mm.type === 'center' ? '센터 드릴' : mm.type === 'endmill' ? '평 엔드밀 Ø' + mm.dia : '드릴 Ø' + mm.dia;
      h += '<div class="row" style="margin-top:6px">' + u.btn(ico('i-plus') + '공구 추가: ' + lbl, () => {
        let added = null;
        dbChange(() => { added = C.addMissingTool(m, mm); if (m.verified) { m.verified = false; toast('장비 공구가 바뀌어 실가공 검증 승인이 해제되었습니다.', 'warn'); } });
        if (added) toast('T' + added.no + ' 공구를 추가했습니다. 날 길이·재질을 [장비·공구]에서 확인하세요.', 'ok');
      }, 'sm primary') + '</div>';
    });
    h += '</div>';
    h += '<details class="adv" data-sec="adv-' + g.id + '"' + (S.openSec['adv-' + g.id] ? ' open' : '') + '><summary>공정 상세 편집 (고급)</summary><small>여기서 바꾸면 이 가공은 "직접 구성"으로 전환됩니다.</small>' +
      opCards(u, g.ops, fn => { mutate(() => { fn(); g.spec = null; }); toast('직접 구성으로 전환했습니다.', 'warn'); }) + '</details>';
    return h;
  }
  // 간편 입력 양식 (구멍 / 탭)
  function specForm(u, g) {
    const sp = g.spec, m = machine();
    const set = fn => v => mutate(() => { fn(v); });
    let h = '<div class="card wiz">';
    if (sp.kind === 'tap') {
      const opts = C.threadList().map(t => [t.d + '|' + t.p, t.label]);
      const cur = sp.tapD + '|' + sp.tapP;
      if (!opts.some(o => o[0] === cur)) opts.unshift([cur, 'M' + sp.tapD + '×' + sp.tapP + ' (사용자)']);
      const rec = C.tapDrill(sp.tapD, sp.tapP);
      h += '<div class="grid2">' + u.fld('나사 규격', u.select(cur, opts, v => mutate(() => { const a = v.split('|'); sp.tapD = parseFloat(a[0]); sp.tapP = parseFloat(a[1]); }))) +
        u.fld(sp.thru ? '탭 깊이 (관통)' : '탭 끝 깊이 (mm)', u.num(sp.tapDepth, set(v => { sp.tapDepth = v; }), sp.thru ? 'disabled' : '')) + '</div>';
      h += '<div class="opinfo">피치 <b>' + sp.tapP + '</b> · 기초 드릴 추천 <b>Ø' + (rec ? rec.dia : '-') + '</b> · 탭 이송 F = S × ' + sp.tapP + ' (자동)' + (sp.thru ? '' : '<br>탭 끝 기준 깊이입니다. 도면의 완전 나사 깊이가 기준이면 2~3피치(' + C.r3(2 * sp.tapP) + '~' + C.r3(3 * sp.tapP) + 'mm)를 더해 입력하세요.') + '</div>';
      h += '<div class="row">' + u.check(sp.thru, set(v => { sp.thru = v; }), '관통') + u.check(sp.center, set(v => { sp.center = v; }), '센터 드릴') +
        u.select(sp.tapMode, [['auto', '탭 방식: 자동' + (m.rigidTap ? '(리지드)' : '(일반)')], ['rigid', '리지드 탭 (M29)'], ['tap', '일반 탭 (홀더)']], set(v => { sp.tapMode = v; })) + '</div>';
    } else {
      const drills = [...new Set(m.tools.filter(t => t.type === 'drill').map(t => t.dia))].sort((a, b) => a - b);
      h += '<div class="grid2">' + u.fld('구멍 지름 Ø (mm)', u.num(sp.dia, set(v => { sp.dia = v; }))) +
        u.fld(sp.thru ? '깊이 (관통)' : '깊이 (mm)', u.num(sp.depth, set(v => { sp.depth = v; }), sp.thru ? 'disabled' : '')) + '</div>';
      if (drills.length) h += '<div class="chips"><small>보유 드릴:</small>' + drills.map(d => u.btn('Ø' + d, () => mutate(() => { sp.dia = d; }), 'sm chip' + (d === sp.dia ? ' on' : ''))).join('') + '</div>';
      h += '<div class="row">' + u.check(sp.thru, set(v => { sp.thru = v; }), '관통') + u.check(sp.center, set(v => { sp.center = v; }), '센터 드릴') +
        (sp.thru ? '' : u.select(sp.depthMode, [['full', '깊이 = 유효 깊이(직경부)'], ['tip', '깊이 = 드릴 끝']], set(v => { sp.depthMode = v; }))) + '</div>';
    }
    h += '<div class="row">' + u.select(sp.cycle, [['auto', '드릴 사이클: 자동 (깊이/지름 비율)'], ['drill', 'G81 일반'], ['peck', 'G73 고속 펙 (칩 끊기)'], ['deep', 'G83 심공 (완전 후퇴)']], set(v => { sp.cycle = v; })) +
      (sp.thru ? u.fld('관통 여유(mm)', u.num(sp.brk, set(v => { sp.brk = v; }), 'style="width:80px"')) : '') + '</div>';
    h += genBlock(u, g, C.planHoleSpec(sp, m, P.stock)) + '</div>';
    return h;
  }
  // 포켓 간편 입력
  function pocketForm(u, g) {
    const sp = g.spec, m = machine();
    const set = fn => v => mutate(() => { fn(v); });
    let h = '<div class="card wiz"><div class="seg" role="radiogroup" aria-label="포켓 모양">' +
      [['rect', '사각 (코너 R)'], ['circle', '원형']].map(s => u.btn(s[1], () => mutate(() => { sp.shape = s[0]; }), sp.shape === s[0] ? 'on' : '', 'role="radio" aria-checked="' + (sp.shape === s[0]) + '"')).join('') + '</div>';
    if (sp.shape === 'circle') h += '<div class="grid2" style="margin-top:8px">' + u.fld('지름 Ø (mm)', u.num(sp.dia, set(v => { sp.dia = v; }))) + u.fld('깊이 (mm)', u.num(sp.depth, set(v => { sp.depth = v; }))) + '</div>';
    else h += '<div class="grid2" style="margin-top:8px">' + u.fld('가로 X (mm)', u.num(sp.w, set(v => { sp.w = v; }))) + u.fld('세로 Y (mm)', u.num(sp.h, set(v => { sp.h = v; }))) +
      u.fld('코너 R (mm)', u.num(sp.cr, set(v => { sp.cr = v; })), '공구 반경보다 작으면 모서리가 공구 반경으로 남습니다') + u.fld('깊이 (mm)', u.num(sp.depth, set(v => { sp.depth = v; }))) + '</div>';
    const ems = m.tools.filter(t => t.type === 'endmill').sort((a, b) => a.no - b.no);
    h += '<div class="grid2" style="margin-top:8px">' + u.fld('공구', u.select(sp.toolNo, [[0, '자동 선택 (권장)']].concat(ems.map(t => [t.no, C.toolLabel(t)])), set(v => { sp.toolNo = parseInt(v, 10) || 0; }))) +
      '<div class="fld"><span>가공</span><div class="row">' + u.check(sp.rough, set(v => { sp.rough = v; }), '황삭') + u.check(sp.finish, set(v => { sp.finish = v; }), '정삭') + '</div></div></div>';
    h += '<div class="opinfo">진입: ' + (m.helical === false ? '<b>중심 수직 진입</b> (장비 헬리컬 미지원)' : '<b>헬리컬</b> (포켓 중심, 경사 3°)') + ' · 절삭 방향: 하향(반시계) · 안쪽 → 바깥</div>';
    h += sec('pk-' + g.id, '절삭 설정 <small>(경로 간격 · 1회 절입 · 남김 여유)</small>', false) + '<div class="grid2">' +
      u.fld('경로 간격 (공구 지름 %)', u.num(sp.stepover, set(v => { sp.stepover = v; }), 'min="10" max="' + C.STEPOVER_MAX + '"'), '10~' + C.STEPOVER_MAX + '%. 클수록 빠르지만 공구 부하가 큽니다 (권장 40~50%)') +
      u.fld('1회 절입 (mm, 0=자동)', u.num(sp.stepdown, set(v => { sp.stepdown = v; })), '0 이면 재질·공구 지름으로 자동 계산') +
      u.fld('측벽 남김 여유 (mm)', u.num(sp.allowWall, set(v => { sp.allowWall = v; })), '황삭 후 정삭으로 깎을 벽 두께') +
      u.fld('바닥 남김 여유 (mm)', u.num(sp.allowFloor, set(v => { sp.allowFloor = v; })), '황삭 후 정삭으로 깎을 바닥 두께') + '</div>' +
      (sp.stepover > 50 ? '<div class="note warn">⚠ 경로 간격 ' + sp.stepover + '% — 공구 부하가 커집니다. 일반적으로 40~50% 를 권장합니다.</div>' : '') + '</details>';
    h += genBlock(u, g, C.planPocketSpec(sp, m, P.stock)) + '</div>';
    return h;
  }
  // 직접 구성 (공정 묶음·공정 카드)
  function customForm(u, g) {
    let h = '<div class="card wiz"><div class="row">' + u.select(S.applyB || '', [['', '공정 묶음 선택...']].concat(DB.bundles.map(b => [b.id, b.name])), v => { S.applyB = v; }) +
      u.btn('적용', () => {
        const b = DB.bundles.find(x => x.id === S.applyB); if (!b) return toast('묶음을 선택하세요.', 'err');
        if (g.ops.length && !confirm('현재 공정 ' + g.ops.length + '개를 "' + b.name + '" 묶음으로 바꿀까요?')) return;
        const r = C.applyBundle(b, machine());
        mutate(() => { g.ops = r.ops; });
        r.notes.forEach(n => toast(n, (n.includes('없습니다') || n.includes('제외')) ? 'err' : 'warn'));
      }, 'sm') +
      u.btn('현재 공정을 묶음으로 저장', () => {
        if (!g.ops.length) return toast('저장할 공정이 없습니다.', 'err');
        const name = prompt('공정 묶음 이름', g.name); if (!name) return;
        dbChange(() => { DB.bundles.push(C.opsToBundle(name, g.ops, machine())); }); toast('공정 묶음으로 저장했습니다.', 'ok');
      }, 'sm') + '</div>';
    h += '<small>위에서부터 순서대로 가공합니다.</small>' + opCards(u, g.ops, fn => mutate(fn)) + '</div>';
    return h;
  }

  /* ---------------- 깊이 단면도 (Z값을 한 그림에) ---------------- */
  function depthDiagram(g) {
    const m = machine(), tm = C.toolMap(m), st = P.stock, set = P.settings;
    const ops = g.ops.filter(op => { const t = tm.get(op.toolNo); return t && C.OP_TYPES[op.type] && C.OP_TYPES[op.type].tools.includes(t.type); });
    if (!ops.length) return '';
    const W = 360, H = 250, L = 18, R = 250, top = 22, mid = 104, bot = H - 30;
    const iz = C.toNum(set.initialZ, 50), under = C.toNum(st.under, 0), zb = -st.sz, zu = -(st.sz + under);
    const info = ops.map(op => { const t = tm.get(op.toolNo); return { op, t, d: C.opDepth(op, t, st) }; });
    const rMax = Math.max(1, ...ops.map(o => C.toNum(o.r, 3))) + 2;
    const deep = Math.max(st.sz + under, ...info.map(x => -x.d.z)) * 1.06;
    const dc = Math.min(deep, Math.max(1, ...info.map(x => -x.d.z)) * 1.25); // 가공 깊이 구간을 크게 (아래 나머지는 압축)
    const Y = z => {
      if (z >= 0) { const up = mid - top; if (z <= rMax || iz <= rMax) return mid - Math.min(z, Math.max(iz, rMax)) / rMax * up * 0.5; return mid - (0.5 + 0.5 * Math.min(1, (z - rMax) / Math.max(1e-6, iz - rMax))) * up; }
      const lo = bot - mid, f = dc < deep - 1e-6 ? 0.78 : 1;
      if (-z <= dc) return mid + (-z / dc) * lo * f;
      return mid + (f + (1 - f) * Math.min(1, (-z - dc) / Math.max(1e-6, deep - dc))) * lo;
    };
    const s = []; // svg 조각
    const txt = (x, y, t, st2, anchor) => '<text x="' + x + '" y="' + y + '" font-size="10.5" style="fill:' + (st2 || 'var(--text2)') + '" text-anchor="' + (anchor || 'start') + '">' + esc(t) + '</text>';
    const hline = (z, label, color, dash) => { const y = Y(z).toFixed(1); s.push('<line x1="' + (L - 6) + '" x2="' + (R + 6) + '" y1="' + y + '" y2="' + y + '" style="stroke:' + color + '" stroke-width="1" ' + (dash ? 'stroke-dasharray="4 3"' : '') + '/>'); s.push(txt(R + 10, +y + 3.5, label, color)); };
    // 소재·하부 여유
    s.push('<rect x="' + L + '" y="' + Y(0).toFixed(1) + '" width="' + (R - L) + '" height="' + (Y(zb) - Y(0)).toFixed(1) + '" style="fill:var(--cv-stock);stroke:var(--cv-stock-line)" stroke-width="1"/>');
    if (under > 0) s.push('<rect x="' + L + '" y="' + Y(zb).toFixed(1) + '" width="' + (R - L) + '" height="' + (Y(zu) - Y(zb)).toFixed(1) + '" style="fill:none;stroke:var(--muted)" stroke-dasharray="2 2"/>');
    const isPk = ops.some(o => C.OP_TYPES[o.type].tools.includes('endmill'));
    if (isPk) {
      // 포켓 단면: 황삭 단(절입)과 정삭 바닥
      const rough = info.find(x => x.op.type === 'pocketRough'), fin = info.find(x => x.op.type === 'pocketFinish');
      const depth = C.toNum((fin || rough).op.depth, 0), wallX0 = L + 40, wallX1 = R - 40;
      s.push('<rect x="' + wallX0 + '" y="' + Y(0).toFixed(1) + '" width="' + (wallX1 - wallX0) + '" height="' + (Y(-depth) - Y(0)).toFixed(1) + '" style="fill:var(--surface);stroke:var(--c-pocket)" stroke-width="1.6"/>');
      if (rough) {
        const af = C.toNum(rough.op.allowFloor, 0), ap = Math.max(0.01, C.toNum(rough.op.stepdown, 1)), rd = depth - af;
        const n = Math.max(1, Math.ceil(rd / ap - 1e-9));
        for (let k = 1; k <= n; k++) {
          const z = -rd * k / n, y = Y(z).toFixed(1);
          s.push('<line x1="' + wallX0 + '" x2="' + wallX1 + '" y1="' + y + '" y2="' + y + '" style="stroke:var(--c-pocket)" stroke-dasharray="3 3" opacity=".8"/>');
          if (n <= 6 || k === n) s.push(txt(wallX0 + 4, +y - 2, k + '단 Z' + C.fmt(z), 'var(--c-pocket)'));
        }
      }
      // 공구 (엔드밀 그림)
      const t = (rough || fin).t, tw = Math.min(40, Math.max(10, t.dia * 2.2)), tx = (wallX0 + wallX1) / 2 - tw / 2, ty = Y(-depth);
      s.push('<rect x="' + tx.toFixed(1) + '" y="' + (Y(rMax + 6)).toFixed(1) + '" width="' + tw.toFixed(1) + '" height="' + (ty - Y(rMax + 6)).toFixed(1) + '" rx="1.5" style="fill:var(--c-pocket)" opacity=".25"/>');
      s.push(txt((wallX0 + wallX1) / 2, Y(-depth) + 13, '바닥 Z' + C.fmt(-depth), 'var(--c-pocket)', 'middle'));
      s.push(txt(L + 4, Y(rMax + 6) - 4, 'T' + t.no + ' Ø' + t.dia + ' 엔드밀', 'var(--text2)'));
    } else {
      // 구멍·탭: 공정마다 한 칸
      const n = info.length, colW = (R - L) / n;
      info.forEach((x, i) => {
        const cx = L + colW * (i + 0.5), w = Math.min(colW * 0.5, Math.max(7, x.t.dia * 2.4)), z = x.d.z, y0 = Y(0), yz = Y(z);
        const col = TOOL_BAND[x.t.type] || '#64748b';
        const tipH = (x.t.type === 'drill' || x.t.type === 'center') ? Math.min(14, Math.max(3, w / 2 / Math.tan(((x.t.angle || 118) / 2) * Math.PI / 180))) : 0;
        // 구멍(제거된 부분)
        const yStart = Math.min(y0, yz);
        let path = 'M' + (cx - w / 2).toFixed(1) + ',' + yStart.toFixed(1) + ' L' + (cx - w / 2).toFixed(1) + ',' + (yz - tipH).toFixed(1) + ' L' + cx.toFixed(1) + ',' + yz.toFixed(1) + ' L' + (cx + w / 2).toFixed(1) + ',' + (yz - tipH).toFixed(1) + ' L' + (cx + w / 2).toFixed(1) + ',' + yStart.toFixed(1) + ' Z';
        if (x.t.type === 'center') path = 'M' + (cx - w / 2).toFixed(1) + ',' + y0.toFixed(1) + ' L' + cx.toFixed(1) + ',' + yz.toFixed(1) + ' L' + (cx + w / 2).toFixed(1) + ',' + y0.toFixed(1) + ' Z';
        s.push('<path d="' + path + '" style="fill:var(--surface);stroke:' + col + '" stroke-width="1.6"/>');
        if (x.t.type === 'tap') for (let yy = y0 + 4; yy < yz - 2; yy += 4) s.push('<line x1="' + (cx - w / 2).toFixed(1) + '" x2="' + (cx + w / 2).toFixed(1) + '" y1="' + yy.toFixed(1) + '" y2="' + (yy + 2.5).toFixed(1) + '" style="stroke:' + col + '" stroke-width="1"/>');
        s.push(txt(cx, yz + 13, 'Z' + C.fmt(z), col, 'middle'));
        s.push(txt(cx, top - 6, (i + 1) + '. T' + x.t.no, col, 'middle'));
      });
    }
    // 기준 높이 선
    hline(iz, '초기점 Z' + C.fmt(iz), 'var(--info)', true);
    const rs = [...new Set(ops.map(o => C.toNum(o.r, 3)))].slice(0, 2);
    rs.forEach((r, k) => { hline(r, 'R점 Z' + C.fmt(r), 'var(--warn)', true); if (k && Math.abs(Y(r) - Y(rs[0])) < 11) s[s.length - 1] = s[s.length - 1].replace(/y="([\d.]+)"/, (a, y) => 'y="' + (Math.min(+y, Y(rs[0])) - 8).toFixed(1) + '"'); });
    hline(0, 'Z0 소재 윗면', 'var(--text)', false);
    hline(zb, '소재 밑면 Z' + C.fmt(zb), 'var(--muted)', false);
    if (under > 0) hline(zu, '하부 여유 Z' + C.fmt(zu), 'var(--muted)', true);
    if (iz > rMax) { const y = (Y(rMax) + Y(iz)) / 2; s.push('<path d="M' + (L - 8) + ',' + (y + 3) + ' l6,-6 M' + (L - 8) + ',' + (y + 7) + ' l6,-6" style="stroke:var(--muted)" stroke-width="1"/>'); }
    return '<div class="depth"><div class="dt"><span>깊이 단면도 (Z값)</span><small>단위 mm · 축척 아님</small></div><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="깊이 단면도: 초기점, R점, 소재 윗면, 공구 끝 Z값">' + s.join('') + '</svg></div>';
  }

  /* ---------------- 공정 카드 (프로젝트·묶음 공용) ---------------- */
  function opCards(u, ops, commit, opts) {
    const m = machine(), tm = C.toolMap(m), st = P.stock;
    let h = '';
    ops.forEach((op, i) => {
      const t = tm.get(op.toolNo);
      const okTools = m.tools.filter(x => C.OP_TYPES[op.type].tools.includes(x.type)).sort((a, b) => a.no - b.no);
      const toolOpts = okTools.map(x => [x.no, C.toolLabel(x)]);
      if (!t || !C.OP_TYPES[op.type].tools.includes(t.type)) toolOpts.unshift([op.toolNo, 'T' + op.toolNo + ' (없음/맞지 않음)']);
      const set = fn => v => commit(() => fn(v));
      const isDr = C.isDrillOp(op.type), isTp = C.isTapOp(op.type), def = C.OPS.get(op.type); // 입력 항목은 가공 모듈의 ui 규격을 따름
      h += '<div class="card"><div class="head"><b>' + (i + 1) + '. ' + esc(C.OP_TYPES[op.type].label) + ' <small>' + esc(C.OP_TYPES[op.type].code) + '</small></b>' +
        u.btn('↑', () => commit(() => { if (i > 0) ops.splice(i - 1, 0, ops.splice(i, 1)[0]); }), 'sm', 'title="위로" ' + (i ? '' : 'disabled')) +
        u.btn('↓', () => commit(() => { if (i < ops.length - 1) ops.splice(i + 1, 0, ops.splice(i, 1)[0]); }), 'sm', 'title="아래로" ' + (i < ops.length - 1 ? '' : 'disabled')) +
        u.btn('✕', () => commit(() => { ops.splice(i, 1); }), 'sm danger', 'title="공정 삭제"') + '</div>';
      h += '<div class="grid2">' +
        u.fld('가공 방식', u.select(op.type, Object.keys(C.OP_TYPES).map(k => [k, C.OP_TYPES[k].label + ' (' + C.OP_TYPES[k].code + ')']), set(v => {
          const fresh = C.newOp(v, op.toolNo); Object.keys(fresh).forEach(k => { if (!(k in op) || k === 'type') op[k] = fresh[k]; });
          const ok = m.tools.filter(x => C.OP_TYPES[v].tools.includes(x.type));
          const cur = tm.get(op.toolNo); if (!cur || !C.OP_TYPES[v].tools.includes(cur.type)) { if (ok.length) op.toolNo = ok[0].no; }
          if (C.isTapOp(v) && op.r < 5) op.r = 5;
        }))) +
        u.fld('공구', u.select(op.toolNo, toolOpts, set(v => { op.toolNo = parseInt(v, 10); }))) + '</div>';
      if (def.ui.pocket) {
        h += '<div class="grid3" style="margin-top:4px">' + u.fld('모양', u.select(op.shape, [['rect', '사각'], ['circle', '원형']], set(v => { op.shape = v; }))) +
          (op.shape === 'circle' ? u.fld('지름 Ø', u.num(op.dia, set(v => { op.dia = v; }))) + '<span></span>' : u.fld('가로 X', u.num(op.w, set(v => { op.w = v; }))) + u.fld('세로 Y', u.num(op.h, set(v => { op.h = v; })))) +
          (op.shape === 'circle' ? '' : u.fld('코너 R', u.num(op.cr, set(v => { op.cr = v; })))) +
          u.fld('깊이 (mm)', u.num(op.depth, set(v => { op.depth = v; }))) + u.fld('R점 (상면 위)', u.num(op.r, set(v => { op.r = v; }))) +
          u.fld('경로 간격 %', u.num(op.stepover, set(v => { op.stepover = v; }))) + u.fld('1회 절입', u.num(op.stepdown, set(v => { op.stepdown = v; }))) +
          u.fld('측벽 여유', u.num(op.allowWall, set(v => { op.allowWall = v; }))) + u.fld('바닥 여유', u.num(op.allowFloor, set(v => { op.allowFloor = v; }))) + '</div>';
      } else {
        h += '<div class="grid3" style="margin-top:4px">' +
          u.fld(op.thru ? '깊이 (관통 자동)' : '깊이 (mm)', u.num(op.depth, set(v => { op.depth = v; }), op.thru ? 'disabled' : '')) +
          u.fld('R점 (상면 위)', u.num(op.r, set(v => { op.r = v; }))) +
          (def.ui.q ? u.fld('펙 Q (mm)', u.num(op.q, set(v => { op.q = v; }))) :
            (def.ui.dwell ? u.fld('드웰 P (ms, G82)', u.int(op.dwell, set(v => { op.dwell = v; }))) : '<span></span>')) + '</div>';
        if (def.ui.thru) {
          h += '<div class="row">' + u.check(op.thru, set(v => { op.thru = v; }), '관통') + (op.thru ? u.fld('관통 여유(mm)', u.num(op.brk, set(v => { op.brk = v; }), 'style="width:80px"')) : '') +
            (def.ui.depthMode && !op.thru ? u.select(op.depthMode, [['tip', '깊이 = 공구 끝'], ['full', '깊이 = 직경부(끝각 자동 추가)']], set(v => { op.depthMode = v; })) : '') + '</div>';
        }
      }
      const cnd = C.opConditions(op, t, st.material, m);
      h += '<div class="grid3" style="margin-top:4px;align-items:end">' + u.check(op.auto, set(v => { op.auto = v; if (!v) { op.rpm = cnd.rpm; op.feed = cnd.feed; } }), '자동 추천') +
        u.fld('회전수 S', op.auto ? '<input type="text" value="' + cnd.rpm + '" disabled>' : u.num(op.rpm, set(v => { op.rpm = v; }))) +
        u.fld(isTp ? '이송 F (=S×P)' : '이송 F (mm/min)', (op.auto || isTp) ? '<input type="text" value="' + cnd.feed + '" disabled>' : u.num(op.feed, set(v => { op.feed = v; }))) + '</div>';
      // 계산 정보
      let info = '';
      if (t && C.OP_TYPES[op.type].tools.includes(t.type)) {
        const d = C.opDepth(op, t, st);
        const vc = Math.PI * t.dia * cnd.rpm / 1000, ref = C.refConditions(op.type, t, st.material);
        info += '공구 끝 <b>Z' + C.fmt(d.z) + '</b>';
        if (isDr) info += ' · 직경부 깊이 ' + d.full + ' · 끝각 길이 ' + d.tip;
        if (op.type === 'center') info += ' · 모따기 Ø' + C.r3(C.spotDiameter(t, d.depth));
        info += '<br>Vc ' + vc.toFixed(1) + ' m/min (참고 ' + ref.vc.toFixed(1) + ')';
        if (!isTp && cnd.rpm > 0) info += ' · f ' + C.r3(cnd.feed / cnd.rpm) + ' mm/rev (참고 ' + C.r3(ref.fpr) + ')';
        if (isTp) { const rd = C.tapDrill(t.dia, t.pitch); info += ' · F = ' + cnd.rpm + ' × ' + t.pitch + ' = <b>' + cnd.feed + '</b> (G94)' + (rd ? '<br>기초 드릴 추천 Ø' + rd.dia : ''); }
      } else info = '<span style="color:var(--err)">공구를 확인하세요.</span>';
      if (opts && opts.template && op.toolSpec) {
        const ok = t && t.type === op.toolSpec.type && Math.abs(t.dia - op.toolSpec.dia) < 1e-6;
        info += '<br>등록 공구 사양: ' + esc(C.specText(op.toolSpec)) + (ok ? '' : ' <span style="color:var(--warn)">(현재 장비 T' + op.toolNo + ' 와 다름 → 적용 시 사양 일치 공구로 자동 매칭)</span>');
      }
      h += '<div class="opinfo">' + info + '</div></div>';
    });
    h += '<div class="row">' + u.select('', [['', '+ 공정 추가...']].concat(Object.keys(C.OP_TYPES).map(k => [k, C.OP_TYPES[k].label + ' (' + C.OP_TYPES[k].code + ')'])).concat(C.OPS.planned().map(d => ['', d.label + ' (개발 예정)', true])), v => {
      if (!v) return; const ok = m.tools.filter(x => C.OP_TYPES[v].tools.includes(x.type));
      commit(() => { const o = C.newOp(v, ok.length ? ok[0].no : 1); if (opts && opts.template) { delete o.id; const tt = tm.get(o.toolNo); o.toolSpec = tt ? { type: tt.type, dia: tt.dia, pitch: tt.pitch || 0 } : null; } ops.push(o); });
    }) + '</div>';
    return h;
  }
  function arrayForm(u, g) {
    const k = S.arrKind, a = S.arr[k] = S.arr[k] || ({ single: { x: 10, y: 10 }, line: { x: 10, y: 10, pitch: 20, angle: 0, count: 5 }, grid: { x: 10, y: 10, px: 20, py: 20, nx: 4, ny: 3 }, pcd: { cx: 50, cy: 50, dia: 60, count: 6, start: 0 } })[k];
    const f = (lbl, key, int) => u.fld(lbl, (int ? u.int : u.num)(a[key], v => { a[key] = v; }));
    let h = '';
    if (k === 'single') h = '<div class="grid2">' + f('X', 'x') + f('Y', 'y') + '</div>';
    if (k === 'line') h = '<div class="grid3">' + f('시작 X', 'x') + f('시작 Y', 'y') + f('간격', 'pitch') + f('각도(°)', 'angle') + f('개수', 'count', 1) + '</div>';
    if (k === 'grid') h = '<div class="grid3">' + f('시작 X', 'x') + f('시작 Y', 'y') + '<span></span>' + f('X 간격', 'px') + f('Y 간격', 'py') + '<span></span>' + f('X 개수', 'nx', 1) + f('Y 개수', 'ny', 1) + '</div>';
    if (k === 'pcd') h = '<div class="grid3">' + f('중심 X', 'cx') + f('중심 Y', 'cy') + f('PCD 직경', 'dia') + f('개수', 'count', 1) + f('시작각(°)', 'start') + '</div>';
    h += '<div class="row" style="margin-top:6px">' + u.btn(ico('i-plus') + '위치 추가', () => {
      const e = C.checkArrayParams(k, a); if (e.length) return toast(e[0], 'err');
      const pts = k === 'single' ? [{ x: C.r3(a.x), y: C.r3(a.y) }] : k === 'line' ? C.genLine(a) : k === 'grid' ? C.genGrid(a) : C.genPCD(a);
      const total = P.groups.reduce((s, x) => s + x.holes.length, 0);
      if (total + pts.length > C.MAX_HOLES) return toast('프로젝트 위치 수는 최대 ' + C.MAX_HOLES + '개입니다.', 'err');
      mutate(() => { pts.forEach(p => g.holes.push({ id: C.uid('h'), x: p.x, y: p.y })); });
      toast(pts.length + '개 위치를 추가했습니다.', 'ok');
    }, 'primary sm') + '<small>좌표는 공작물 원점(' + esc(C.ORIGIN_LABEL[P.stock.origin]) + ') 기준</small></div>';
    return h;
  }

  /* ---------------- 상태 표시줄 ---------------- */
  function renderStatus() {
    const u = U('sb'), c = counts(), ds = downloadState(), m = machine(), ne = c.e + c.ne, nw = c.w + c.nw;
    let h = u.btn(ico(ne ? 'i-x' : nw ? 'i-warn' : 'i-check') + (ne ? '오류 ' + ne + '건 — NC 차단' : nw ? '경고 ' + nw + '건' : '검증 통과'), () => openDrawer('check'), 'sb ' + (ne ? 'err' : nw ? 'warn' : 'ok'), 'title="검증 결과 보기"');
    if (ds.ok && ds.test) h += '<span class="pill warn" title="관리자가 실가공 검증을 승인하기 전까지 NC 파일은 TEST 로 표시됩니다">검증용(TEST)</span>';
    h += '<span class="sbsep"></span>';
    if (S.est) h += '<span class="sb" title="급속 ' + m.rapid + 'mm/min, 공구 교환 ' + m.tcSec + '초 기준 추정 (가감속·주축 가속 미반영). 장비 값은 [장비·공구]에서 수정">예상 시간 약 ' + fmtSec(S.est.total) + '</span><span class="sbsep"></span>';
    const tools = new Set(S.V.plan.steps.map(s => s.toolNo));
    h += '<span class="sb">공구 ' + tools.size + ' · 공정 ' + S.V.plan.steps.length + '</span>';
    h += '<span class="sbspace"></span>';
    h += u.btn('검증 결과', () => toggleDrawer('check'), 'sb' + (S.drawer && S.bottomTab === 'check' ? ' on' : ''));
    h += u.btn('G코드', () => toggleDrawer('code'), 'sb' + (S.drawer && S.bottomTab === 'code' ? ' on' : ''));
    $('#status').innerHTML = h;
  }
  function openDrawer(tab) { S.bottomTab = tab; if (mobile()) S.mpanel = 'bottom'; else S.drawer = true; renderAll(); }
  function toggleDrawer(tab) { if (mobile()) return openDrawer(tab); if (S.drawer && S.bottomTab === tab) S.drawer = false; else { S.drawer = true; S.bottomTab = tab; } renderAll(); }

  /* ---------------- 서랍: 검증 결과·G코드 ---------------- */
  function renderBottom() {
    const el = $('#bottomBody');
    if (!S.drawer && !(mobile() && S.mpanel === 'bottom')) { if (el.innerHTML) { el.innerHTML = ''; U('bc'); U('cd'); } return; }
    if (S.bottomTab === 'check') el.innerHTML = bottomCheck(); else { el.innerHTML = bottomCode(); bindCode(); }
  }
  function bottomCheck() {
    U('bc'); // 이 영역의 이전 핸들러 정리
    const c = counts(), ds = downloadState(), iss = S.V.issues;
    let h = '';
    if (!ds.ok) h += '<div class="banner err">' + ico('i-x') + 'NC 파일 생성 차단 — ' + esc(ds.why) + '. 아래 항목을 눌러 해당 위치로 이동하세요.</div>';
    else if (ds.test || c.w || c.nw) h += '<div class="banner warn">' + ico('i-warn') + 'NC 저장 가능' + (ds.test ? ' — <u>검증용(TEST)</u> 표시: 장비 실가공 검증 전' : '') + (c.w + c.nw ? ' · 경고 ' + (c.w + c.nw) + '건 확인' : '') + '</div>';
    else h += '<div class="banner ok">' + ico('i-check') + '모든 자동 검증 통과 — NC 저장 가능</div>';
    const vr0 = c.vr, todo = [];
    iss.filter(i => i.level === 'error').forEach(i => todo.push({ lv: 'err', msg: i.msg, a: regActBc(i.ref) }));
    if (vr0) vr0.errors.forEach(x => todo.push({ lv: 'err', msg: 'G코드 ' + (x.line ? x.line + '행: ' : '') + x.msg, a: regActLine(x.line) }));
    iss.filter(i => i.level === 'warn' && !(i.cat === 11 && /실가공 검증 전/.test(i.msg))).forEach(i => todo.push({ lv: 'warn', msg: i.msg, a: regActBc(i.ref) }));
    if (vr0) vr0.warnings.forEach(x => todo.push({ lv: 'warn', msg: 'G코드 ' + (x.line ? x.line + '행: ' : '') + x.msg, a: regActLine(x.line) }));
    h += '<div class="todo"><b>' + (todo.length ? '확인할 내용 ' + todo.length + '건' : '확인할 내용 없음') + '</b>' + (todo.length ? '<ul>' + todo.slice(0, 60).map(t => '<li class="' + t.lv + '" data-a="' + t.a + '" role="button" tabindex="0">' + (t.lv === 'err' ? '✖ ' : '⚠ ') + esc(t.msg) + '</li>').join('') + '</ul>' + (todo.length > 60 ? '<small>그 외 ' + (todo.length - 60) + '건은 아래 상세에서 확인</small>' : '') : '') + '</div>';
    h += '<details class="sect2" data-sec="chkdetail"' + (S.openSec.chkdetail ? ' open' : '') + '><summary>검증 상세 (11개 항목 · 독립 NC 해석 · 5단계 절차)</summary>';
    h += '<div class="chkcols"><div><b>모델 검증 (11개 항목)</b>';
    C.CHECKS.forEach(ck => {
      const li = iss.filter(i => i.cat === ck.id);
      const e = li.filter(i => i.level === 'error').length, w = li.filter(i => i.level === 'warn').length;
      const ic = e ? '<span class="ic err">✖</span>' : w ? '<span class="ic warn">⚠</span>' : '<span class="ic ok">✔</span>';
      h += '<details class="citem"' + (e || w ? ' open' : '') + '><summary>' + ic + '<span class="nm">' + ck.id + '. ' + esc(ck.name) + '</span>' + (e ? '<span class="pill err">오류 ' + e + '</span>' : '') + (w ? '<span class="pill warn">경고 ' + w + '</span>' : '') + (!e && !w ? '<span class="pill ok">통과</span>' : '') + '</summary>';
      if (li.length) h += '<ul>' + li.map(i => '<li class="' + i.level + '" data-a="' + regActBc(i.ref) + '">' + (i.level === 'error' ? '오류: ' : i.level === 'warn' ? '경고: ' : '참고: ') + esc(i.msg) + '</li>').join('') + '</ul>';
      h += '</details>';
    });
    h += '</div><div><b>독립 NC 해석 검증</b>';
    const vr = c.vr;
    if (S.nc.blocked) h += '<div class="citem" style="padding:6px 8px"><span class="ic err">✖</span> ' + esc(S.nc.blocked) + '</div>';
    else if (S.nc.edited && !S.nc.editVerify) h += '<div class="citem" style="padding:6px 8px"><span class="ic warn">⚠</span> G코드가 수정되었습니다. [G코드] 탭에서 "수정본 재검증"을 실행하세요.</div>';
    else if (vr) {
      h += '<details class="citem" open><summary>' + (vr.errors.length ? '<span class="ic err">✖</span>' : vr.warnings.length ? '<span class="ic warn">⚠</span>' : '<span class="ic ok">✔</span>') + '<span class="nm">' + (S.nc.edited ? '수정한 G코드' : '생성된 G코드') + ' 문법·경로 시뮬레이션</span>' + (vr.errors.length ? '<span class="pill err">오류 ' + vr.errors.length + '</span>' : '') + (vr.warnings.length ? '<span class="pill warn">경고 ' + vr.warnings.length + '</span>' : '') + '</summary><ul>' +
        vr.errors.map(x => '<li class="err" data-a="' + regActLine(x.line) + '">' + (x.line ? x.line + '행: ' : '') + esc(x.msg) + '</li>').join('') +
        vr.warnings.map(x => '<li class="warn" data-a="' + regActLine(x.line) + '">' + (x.line ? x.line + '행: ' : '') + esc(x.msg) + '</li>').join('') +
        '<li class="info">해석된 구멍 ' + vr.hits.length + '개 · 절삭 이동 ' + (vr.cuts ? vr.cuts.length : 0) + '개' + (vr.match === true ? ' · 생성기 계산과 100% 일치 (교차 검증)' : vr.match === false ? ' · 생성기 계산과 불일치' : ' · 수정본은 교차 검증 대상 아님') + '</li></ul></details>';
    }
    const m = machine();
    const st = (ok, label, detail) => '<div class="stage"><span class="ic ' + (ok === true ? 'ok">✔' : ok === false ? 'err">✖' : 'warn">⚠') + '</span><div><b>' + label + '</b><br><small>' + detail + '</small></div></div>';
    h += '<b style="display:block;margin-top:10px">5단계 검증 절차</b>' +
      st(true, '① 코드 알고리즘', '계산식·생성기 자동 테스트 (개발 단계 수행, 테스트 결과 문서 참조)') +
      st(vr ? !vr.errors.some(x => /해석|소수점|주소|코드|형식|괄호|원호/.test(x.msg)) : false, '② NC 문법', 'FANUC 주소·소수점·지원 코드·원호(I·J) 검사') +
      st(vr ? !vr.errors.some(x => /충돌|범위|경로|급속|하강|바닥|과삭|포켓/.test(x.msg)) : false, '③ 이동 경로', '모달 상태 시뮬레이션: 소재·클램프·하부 충돌, 포켓 벽·바닥 과삭') +
      st(c.e === 0, '④ 입력값 한계', '좌표·깊이·조건·장비 한계 (모델 검증 11항목)') +
      st(m.verified ? true : null, '⑤ 실장비 테스트', m.verified ? '검증 완료: ' + esc(m.verifiedBy) + ' ' + esc(m.verifiedAt) : '미실시 — 드라이런(Z 띄움)·싱글 블록·시편 가공 후 관리자 승인 필요');
    h += '</div></div></details>';
    h += '<p><small>자동 검증과 3D 시뮬레이션은 실제 가공 안전을 보장하지 않습니다. 최초 가공은 반드시 작업자가 공회전·싱글 블록으로 확인하세요.</small></p>';
    return h;
  }
  function regActBc(ref) {
    const k = 'bc:r' + Math.random().toString(36).slice(2, 9);
    acts.set(k, () => { if (!ref) return; if (ref.gid) S.sel = { kind: 'group', gid: ref.gid, hid: ref.hid || null }; if (mobile()) S.mpanel = ref.hid ? 'view' : 'right'; if (ref.hid) S.vmode = '2d'; renderAll(); });
    return k;
  }
  function regActLine(line) { const k = 'bc:l' + Math.random().toString(36).slice(2, 9); acts.set(k, () => { S.bottomTab = 'code'; renderAll(); gotoLine(line); }); return k; }
  function gotoLine(line) {
    const ta = $('#ncText'); if (!ta || !line) return;
    const lines = ta.value.split('\n'); let pos = 0; for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    ta.focus(); ta.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
    ta.scrollTop = Math.max(0, (line - 4) * 18.6);
  }
  function bottomCode() {
    const u = U('cd'), ds = downloadState();
    const text = S.nc.edited ? S.nc.editText : S.nc.text;
    let h = '<div class="codebar">' +
      u.btn('⟳ 다시 생성', () => { if (S.nc.edited && !confirm('수정한 내용이 사라지고 현재 설정으로 다시 생성합니다.')) return; S.nc.edited = false; S.nc.editText = ''; S.nc.editVerify = null; renderAll(); toast('G코드를 다시 생성했습니다.'); }, 'sm') +
      u.btn('⧉ 복사', () => { const st = downloadState(); if (!st.ok) { beep(); return toast('복사 차단: ' + st.why + ' (검증을 통과한 G코드만 복사할 수 있습니다)', 'err'); } copyText(text); }, 'sm', ds.ok ? '' : 'aria-disabled="true" title="검증 통과 후 복사 가능"') +
      u.btn(S.nc.edited ? '✎ 편집 중' : '✎ 직접 수정', () => {
        if (!S.nc.text) return toast('먼저 오류를 해결하여 G코드를 생성하세요.', 'err');
        if (!S.nc.edited) { if (!confirm('G코드를 직접 수정하면 기존 검증 결과가 무효화되고, 저장 전에 재검증이 필요합니다.\n계속할까요?')) return; S.nc.edited = true; S.nc.editText = S.nc.text; S.nc.editVerify = null; renderAll(); }
      }, 'sm' + (S.nc.edited ? ' on' : '')) +
      (S.nc.edited ? u.btn('✔ 수정본 재검증', () => { reverify(); }, 'sm primary') : '') +
      u.btn(ico('i-save') + 'NC 저장', () => doDownload(), ds.ok ? 'sm primary' : 'sm') +
      '<small>' + (S.nc.edited ? (S.nc.editVerify ? (S.nc.editVerify.errors.length ? '<span style="color:var(--err)">재검증 오류 ' + S.nc.editVerify.errors.length + '건</span>' : '<span style="color:var(--ok)">재검증 통과</span>') : '<span style="color:var(--warn)">수정됨 · 재검증 필요</span>') : (S.nc.blocked ? esc(S.nc.blocked) : (text.split('\n').length + '줄 · 설정 변경 시 자동 갱신 · 줄을 누르면 3D 시뮬레이션이 그 위치로 이동'))) + '</small></div>';
    h += '<div class="codewrap"><div class="gutter" id="ncGutter"></div><textarea id="ncText" spellcheck="false" aria-label="G코드" ' + (S.nc.edited ? 'class="edited"' : 'readonly') + '>' + esc(text) + '</textarea></div>';
    return h;
  }
  function bindCode() {
    const ta = $('#ncText'), gu = $('#ncGutter'); if (!ta) return;
    const upd = () => { const n = ta.value.split('\n').length; let s = ''; for (let i = 1; i <= n; i++) s += i + '\n'; gu.textContent = s; };
    upd();
    ta.addEventListener('scroll', () => { gu.scrollTop = ta.scrollTop; });
    ta.addEventListener('input', () => { if (!S.nc.edited) return; S.nc.editText = ta.value; if (S.nc.editVerify) { S.nc.editVerify = null; renderTop(); renderStatus(); } upd(); const sm = ta.parentElement.previousElementSibling.querySelector('small'); if (sm) sm.innerHTML = '<span style="color:var(--warn)">수정됨 · 재검증 필요</span>'; });
    // G코드 줄 → 3D 시뮬레이션 위치 (생성된 코드 기준)
    ta.addEventListener('click', () => {
      if (S.nc.edited || !V3 || !V3.ok || !S.sim.motions.length) return;
      const ln = ta.value.slice(0, ta.selectionStart).split('\n').length;
      const i = S.sim.motions.findIndex(mv => mv.line >= ln);
      if (i < 0) return;
      if (S.vmode !== '3d') { S.vmode = '3d'; renderAll(); }
      V3.pause(); V3.seek(S.sim.tl[i].t1);
    });
  }
  function reverify() {
    S.nc.editVerify = C.verifyNC(S.nc.editText, verifyCtx(machine(), { expected: null }));
    renderAll();
    const e = S.nc.editVerify.errors.length;
    toast(e ? '재검증 오류 ' + e + '건 — 저장 차단' : '재검증 통과', e ? 'err' : 'ok');
    if (e) beep();
  }

  /* ---------------- 다운로드·파일 ---------------- */
  function downloadText(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function pickFile(accept, cb) {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept;
    i.onchange = () => {
      const f = i.files[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) return toast('파일이 너무 큽니다 (5MB 이하).', 'err');
      const r = new FileReader();
      r.onload = () => { try { cb(String(r.result)); } catch (e) { toast('파일을 읽을 수 없습니다: ' + e.message, 'err'); } };
      r.readAsText(f);
    };
    i.click();
  }
  function copyText(t) {
    if (!t) return toast('복사할 내용이 없습니다.', 'err');
    const done = () => toast('클립보드에 복사했습니다.', 'ok');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(done, fallback); else fallback();
    function fallback() { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('복사 실패: 직접 선택하여 복사하세요.', 'err'); } ta.remove(); }
  }
  function ncFileName(ds) { return (ds.test ? 'TEST_' : '') + 'O' + String(P.programNo).padStart(4, '0') + '_' + (C.ncText(P.name, 20).replace(/[^A-Z0-9_-]+/g, '_') || 'PROGRAM') + (S.nc.edited ? '_EDIT' : '') + '.nc'; }
  function doDownload() {
    const ds = downloadState();
    if (!ds.ok) { beep(); toast('NC 생성 차단: ' + ds.why, 'err'); openDrawer('check'); return; }
    let text = S.nc.edited ? S.nc.editText : S.nc.text;
    if (S.nc.edited && !/USER EDITED/.test(text)) {
      const L = text.split(/\r?\n/), oi = L.findIndex(l => /^\s*O\d/.test(l));
      L.splice(oi >= 0 ? oi + 1 : 1, 0, '(USER EDITED - REVERIFIED ' + new Date().toISOString().slice(0, 10) + ')');
      text = L.join('\n');
    }
    const msg = (ds.test ? '이 NC는 실가공 검증 전 장비용 "검증용(TEST)" 파일입니다.\n\n' : '') +
      '가공 전 반드시 확인하세요:\n• 공구 길이·공작물 좌표계(' + P.settings.wcs + ') 보정값\n• Z를 띄운 드라이런(공회전), 싱글 블록 운전\n• 클램프·지그 위치와 소재 하부 여유\n\n저장할까요?';
    if (!confirm(msg)) return;
    const name = ncFileName(ds);
    downloadText(name, text.replace(/\r?\n/g, '\r\n') + '\r\n', 'text/plain');
    toast(name + ' 저장', 'ok');
  }

  /* ---------------- 가운데: 2D/3D 도구 ---------------- */
  function setVMode(v) { if (S.vmode === v) return; if (v === '2d' && V3 && V3.ok) V3.pause(); S.vmode = v; if (mobile()) S.mpanel = 'view'; renderAll(); }
  function renderVTools() {
    const u = U('vt');
    if (S.vmode === '3d') {
      $('#vtools').innerHTML =
        [['iso', '등각'], ['top', '위'], ['front', '앞'], ['side', '옆']].map(v => u.btn(v[1], () => { if (V3 && V3.ok) V3.view(v[0]); }, 'sm', 'title="' + v[1] + ' 보기"')).join('') +
        '<span class="sep"></span>' +
        u.check(S.sim.showPaths, v => { S.sim.showPaths = v; if (V3 && V3.ok) V3.setShowPaths(v); }, '공구 경로') +
        u.select(S.sim.res, [['l', '해상도: 낮음(빠름)'], ['m', '해상도: 보통'], ['h', '해상도: 높음(느림)']], v => { S.sim.res = v; update3D(true); }, 'title="시뮬레이션 격자 해상도"') +
        '<span class="sep"></span>' + u.btn(ico('i-play') + '처음부터 재생', () => { if (V3 && V3.ok) { V3.seek(0); V3.play(); } }, 'sm primary');
      $('#viewHint').textContent = '';
      return;
    }
    const gs = DB.settings.grid;
    const stepOpts = [[0, '전체 경로']].concat((S.V.plan.steps || []).map(s => [s.idx, s.idx + '. ' + C.OP_TYPES[s.type].label + ' T' + s.toolNo + ' (' + s.holes.length + ')']));
    if (S.pathStep > S.V.plan.steps.length) S.pathStep = 0;
    $('#vtools').innerHTML =
      u.btn('선택', () => setMode('select'), 'sm' + (S.mode === 'select' ? ' on' : ''), 'title="선택·이동 (빈 곳 드래그 = 화면 이동)"') +
      u.btn(ico('i-plus') + '위치 추가', () => setMode('add'), 'sm' + (S.mode === 'add' ? ' on' : ''), 'title="클릭/터치한 위치에 구멍·포켓 추가"') +
      u.btn('클램프', () => setMode('clamp'), 'sm' + (S.mode === 'clamp' ? ' on' : ''), 'title="드래그하여 클램프 영역 추가"') +
      u.btn(ico('i-x'), () => deleteSelectedHole(), 'sm', 'title="선택한 위치 삭제 (Delete)" aria-label="선택한 위치 삭제" ' + (S.sel.hid ? '' : 'disabled')) +
      '<span class="sep"></span>' +
      u.check(gs.show, v => dbChange(() => { gs.show = v; }), '격자') +
      u.check(gs.snap, v => dbChange(() => { gs.snap = v; }), '스냅') +
      u.select(gs.step, [[0.5, '0.5'], [1, '1'], [2, '2'], [2.5, '2.5'], [5, '5'], [10, '10']].map(x => [x[0], x[1] + 'mm']), v => dbChange(() => { gs.step = parseFloat(v); }), 'title="격자·스냅 간격"') +
      '<span class="sep"></span>' +
      u.btn('＋', () => zoom(1.25), 'sm', 'title="확대" aria-label="확대"') + u.btn('－', () => zoom(0.8), 'sm', 'title="축소" aria-label="축소"') + u.btn('맞춤', () => { fitView(); drawView(); }, 'sm', 'title="전체 보기"') +
      '<span class="sep"></span>' +
      u.check(S.showPath, v => { S.showPath = v; drawView(); }, '순서') +
      u.select(S.pathStep, stepOpts, v => { S.pathStep = parseInt(v, 10); drawView(); }, 'title="표시할 공정"') +
      u.check(S.showNC, v => { S.showNC = v; drawView(); }, 'NC 해석');
    const g = curGroup();
    const hint = { select: '클릭=선택 · 드래그=이동 · 빈 곳 드래그=화면 이동 · 휠/두 손가락=확대', add: g ? '클릭/터치 위치에 [' + g.name + '] 추가' : '먼저 왼쪽 목록에서 가공을 선택하세요', clamp: '드래그하여 클램프 영역 지정 (높이 기본 30mm)' };
    $('#viewHint').textContent = hint[S.mode];
  }
  function setMode(m) { S.mode = m; renderVTools(); drawView(); }
  function deleteSelectedHole() {
    const g = curGroup(); if (!g || !S.sel.hid) return;
    const i = g.holes.findIndex(h => h.id === S.sel.hid); if (i < 0) return;
    mutate(() => { g.holes.splice(i, 1); S.sel.hid = null; });
  }

  /* ---------------- 2D 그래픽 ---------------- */
  const G = window.PCAM_UI.createGraphics(() => ({ P, S, DB, drag, machine }));
  const w2s = G.w2s, s2w = G.s2w, fitView = G.fit, zoom = G.zoom, drawView = G.draw;
  function snap(v) { const gs = DB.settings.grid; return gs.snap ? C.r3(Math.round(v / gs.step) * gs.step) : C.r3(v); }
  function hitHole(px, py) {
    const tm = C.toolMap(machine()); let best = null, bd = Infinity;
    P.groups.forEach(g => {
      const ext = G.extentOf(g, tm);
      g.holes.forEach(h => {
        const [sx, sy] = w2s(h.x, h.y); const dist = Math.hypot(sx - px, sy - py);
        const inside = ext.rect ? (Math.abs(sx - px) <= Math.max(10, ext.w / 2 * S.view.scale) && Math.abs(sy - py) <= Math.max(10, ext.h / 2 * S.view.scale)) : dist <= Math.max(10, ext.d / 2 * S.view.scale);
        if (inside && dist < bd) { bd = dist; best = { g, h }; }
      });
    });
    return best;
  }
  let drag = null; const ptrs = new Map(); let pinch = null;
  function initCanvas() {
    const c = $('#cv');
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => { e.preventDefault(); const r = c.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      ptrs.set(e.pointerId, { x: px, y: py });
      if (ptrs.size === 2) { const [p1, p2] = [...ptrs.values()]; pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2 }; drag = null; return; }
      const w0 = s2w(px, py);
      if (e.button === 1 || e.button === 2) { drag = { kind: 'pan', sx: px, sy: py, cx: S.view.cx, cy: S.view.cy }; return; }
      if (S.mode === 'select') {
        const hit = hitHole(px, py);
        if (hit) { S.sel = { kind: 'group', gid: hit.g.id, hid: hit.h.id }; drag = { kind: 'move', g: hit.g, h: hit.h, sx: px, sy: py, ox: hit.h.x, oy: hit.h.y, moved: false }; renderAll(); return; }
        drag = { kind: 'pan', sx: px, sy: py, cx: S.view.cx, cy: S.view.cy, click: true };
      } else if (S.mode === 'add') drag = { kind: 'add', sx: px, sy: py, w0 };
      else if (S.mode === 'clamp') drag = { kind: 'clamp', sx: px, sy: py, w0: [snap(w0[0]), snap(w0[1])], cur: null };
    });
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const [wx, wy] = s2w(px, py);
      const hit = !drag ? hitHole(px, py) : null, z = hit ? S.gz.get(hit.g.id) : null;
      $('#cursorPos').textContent = 'X ' + C.fmt(snap(wx)) + '  Y ' + C.fmt(snap(wy)) + (DB.settings.grid.snap ? ' (스냅)' : '') + (hit ? '  ·  ' + hit.g.name + (z !== null && z !== undefined ? ' 바닥 Z' + C.fmt(z) : '') : '');
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: px, y: py });
      if (pinch && ptrs.size === 2) {
        const [p1, p2] = [...ptrs.values()]; const d = Math.hypot(p1.x - p2.x, p1.y - p2.y), mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        S.view.cx -= (mx - pinch.mx) / S.view.scale; S.view.cy += (my - pinch.my) / S.view.scale;
        if (pinch.d > 0) zoom(d / pinch.d, mx, my); else drawView();
        pinch = { d, mx, my }; return;
      }
      if (!drag) return;
      if (drag.kind === 'pan') { if (Math.hypot(px - drag.sx, py - drag.sy) > 3) drag.click = false; S.view.cx = drag.cx - (px - drag.sx) / S.view.scale; S.view.cy = drag.cy + (py - drag.sy) / S.view.scale; drawView(); }
      else if (drag.kind === 'move') {
        if (!drag.moved && Math.hypot(px - drag.sx, py - drag.sy) < 5) return;
        drag.moved = true; drag.h.x = snap(wx); drag.h.y = snap(wy); drawView();
      } else if (drag.kind === 'clamp') { drag.cur = [snap(wx), snap(wy)]; drawView(); }
    });
    const end = e => {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (!drag) return;
      const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const d = drag; drag = null;
      if (d.kind === 'move' && d.moved) {
        const nx = d.h.x, ny = d.h.y; d.h.x = d.ox; d.h.y = d.oy;
        mutate(() => { d.h.x = nx; d.h.y = ny; });
      } else if (d.kind === 'pan' && d.click && e.type === 'pointerup') { if (S.sel.hid) { S.sel.hid = null; renderAll(); } }
      else if (d.kind === 'add' && e.type === 'pointerup' && Math.hypot(px - d.sx, py - d.sy) < 6) {
        const g = curGroup();
        if (!g) { toast('먼저 왼쪽 목록에서 가공(구멍·탭·포켓)을 선택하거나 추가하세요.', 'err'); return; }
        const total = P.groups.reduce((s, x) => s + x.holes.length, 0);
        if (total >= C.MAX_HOLES) return toast('위치 수 한계 초과', 'err');
        const hid = C.uid('h');
        mutate(() => { g.holes.push({ id: hid, x: snap(d.w0[0]), y: snap(d.w0[1]) }); S.sel.hid = hid; });
      } else if (d.kind === 'clamp' && d.cur) {
        const w = d.cur[0] - d.w0[0], hh = d.cur[1] - d.w0[1];
        if (Math.abs(w) < 1 || Math.abs(hh) < 1) { drawView(); return; }
        mutate(() => { P.clamps.push({ id: C.uid('c'), x: Math.min(d.w0[0], d.cur[0]), y: Math.min(d.w0[1], d.cur[1]), w: Math.abs(w), h: Math.abs(hh), height: 30 }); S.sel = { kind: 'stock', gid: null, hid: null }; });
        toast('클램프를 추가했습니다. 높이는 [소재·고정]에서 수정하세요.', 'ok');
      } else drawView();
    };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { $('#cursorPos').textContent = ''; });
    window.addEventListener('resize', () => { if (S.vmode === '2d') drawView(); });
    if (window.ResizeObserver) new ResizeObserver(() => { if (S.vmode === '2d') drawView(); }).observe($('#canvasWrap'));
  }

  /* ---------------- 3D 시뮬레이션 ---------------- */
  let V3 = null, hudRaf = 0, lastProg = null, scrubbing = false;
  function ensure3D() {
    if (V3) return V3;
    V3 = window.PCAM_UI.createView3D($('#v3host'), {
      onHover: hv => { const el = $('#hudHover'); if (el) el.innerHTML = hv ? '마우스 위치 <span class="xyz">X ' + C.fmt(C.r3(hv.x)) + ' · Y ' + C.fmt(C.r3(hv.y)) + ' · Z ' + C.fmt(C.r3(hv.z)) + '</span>' : '소재 위에 마우스를 올리면 그 위치의 X·Y·Z 를 보여줍니다'; },
      onProgress: p => { lastProg = p; if (!hudRaf) hudRaf = requestAnimationFrame(() => { hudRaf = 0; updateHUD(lastProg); }); },
      onState: st => { const b = $('#simPlay'); if (b) { b.innerHTML = ico(st === 'play' ? 'i-pause' : 'i-play'); b.title = st === 'play' ? '일시정지 (Space)' : '재생 (Space)'; b.setAttribute('aria-label', b.title); } }
    });
    if (V3.ok) V3.setTheme(document.documentElement.dataset.theme);
    return V3;
  }
  function update3D(force) {
    if (S.vmode !== '3d') return;
    const v = ensure3D();
    if (!v.ok) { $('#simbar').innerHTML = ''; $('#hud3').innerHTML = ''; return; }
    const src = simSource(), motions = src && src.motions ? src.motions : [];
    const sig = JSON.stringify([S.nc.edited ? S.nc.editText : S.nc.text, motions.length, P.stock, P.clamps, S.sim.res, machine().tools, machine().rapid]);
    if (!force && sig === S.sim.sig) return;
    const stockSig = JSON.stringify(P.stock), keep = S.sim.stockSig === stockSig;
    S.sim.sig = sig; S.sim.stockSig = stockSig; S.sim.motions = motions;
    v.resize();
    renderHUD(src);
    const r = v.load({ stock: P.stock, motions, tools: C.toolMap(machine()), clamps: P.clamps, machine: machine(), maxCells: SIM_RES[S.sim.res] }, keep);
    S.sim.total = r.total; S.sim.tl = r.timeline;
    v.setSpeed(S.sim.speed); v.setShowPaths(S.sim.showPaths);
    renderSimbar();
    updateHUD(lastProg);
  }
  function renderSimbar() {
    const tl = S.sim.tl, mo = S.sim.motions, total = S.sim.total || 1;
    let bands = '';
    if (tl.length) {
      const tm = C.toolMap(machine()); let i = 0;
      while (i < mo.length) {
        const t = mo[i].t, t0 = tl[i].t0; let j = i; while (j < mo.length && mo[j].t === t) j++;
        const tool = tm.get(t), w = (tl[j - 1].t1 - t0) / total * 100;
        bands += '<span style="width:' + w.toFixed(3) + '%;background:' + (tool ? TOOL_BAND[tool.type] || '#64748b' : '#64748b') + '" title="T' + t + (tool ? ' ' + esc(C.toolLabel(tool)) : '') + '"></span>';
        i = j;
      }
    }
    $('#simbar').innerHTML =
      '<button class="ibtn" id="simPrev" title="이전 공구로" aria-label="이전 공구로">' + ico('i-prev') + '</button>' +
      '<button class="play" id="simPlay" title="재생 (Space)" aria-label="재생">' + ico('i-play') + '</button>' +
      '<button class="ibtn" id="simNext" title="다음 공구로" aria-label="다음 공구로">' + ico('i-next') + '</button>' +
      '<button class="ibtn" id="simEnd" title="가공 완료 상태" aria-label="가공 완료 상태로">' + ico('i-end') + '</button>' +
      '<div class="tline"><div class="bands">' + bands + '</div><input type="range" id="simRange" min="0" max="1000" step="1" value="1000" aria-label="시뮬레이션 시간 위치"></div>' +
      '<span class="time" id="simTime">' + clock(total) + ' / ' + clock(total) + '</span>' +
      '<select id="simSpeed" title="재생 속도" aria-label="재생 속도">' + [1, 2, 5, 10, 25, 50, 100].map(s => '<option value="' + s + '"' + (s === S.sim.speed ? ' selected' : '') + '>' + s + '×</option>').join('') + '</select>';
    $('#simPlay').onclick = () => { if (V3.isPlaying()) V3.pause(); else V3.play(); };
    $('#simPrev').onclick = () => { V3.pause(); V3.stepOp(-1); };
    $('#simNext').onclick = () => { V3.pause(); V3.stepOp(1); };
    $('#simEnd').onclick = () => V3.finish();
    $('#simSpeed').onchange = e => { S.sim.speed = parseFloat(e.target.value); V3.setSpeed(S.sim.speed); };
    const rg = $('#simRange');
    rg.addEventListener('pointerdown', () => { scrubbing = true; V3.pause(); });
    rg.addEventListener('input', () => { V3.seek(S.sim.total * rg.value / 1000); });
    const stop = () => { scrubbing = false; }; rg.addEventListener('pointerup', stop); rg.addEventListener('change', stop);
  }
  function renderHUD(src) {
    const err = src && src.errors && src.errors.length;
    const leg = [['센터', 'var(--c-center)'], ['드릴', 'var(--c-drill)'], ['탭', 'var(--c-tap)'], ['포켓', 'var(--c-pocket)'], ['관통', '#22262c']].map(x => '<span><i style="background:' + x[1] + '"></i>' + x[0] + '</span>').join('');
    let msg = '';
    if (!src) msg = '<div class="box" style="color:var(--warn)">' + (S.nc.edited ? '수정한 G코드는 재검증 후 시뮬레이션됩니다.' : '표시할 G코드가 없습니다 — ' + esc(S.nc.blocked || '가공을 추가하세요')) + '</div>';
    else if (err) msg = '<div class="box" style="color:var(--err)">✖ NC 검증 오류 ' + err + '건 — 시뮬레이션은 참고용입니다</div>';
    $('#hud3').innerHTML = msg +
      '<div class="box" id="hudTool"><b>공구 없음</b><div class="xyz"><b>X -</b><b>Y -</b><b>Z -</b></div><small>-</small></div>' +
      '<div class="box aux"><div class="legend">' + leg + '</div><div class="assume">실제 NC 해석 결과로 소재를 깎는 높이맵 근사 시뮬레이션입니다 (격자 ' + (C.r3(Math.sqrt((P.stock.sx * P.stock.sy) / SIM_RES[S.sim.res]))) + 'mm 내외 · 홀더 간섭·가감속 미반영).</div></div>' +
      '<div class="box aux" id="hudHover">소재 위에 마우스를 올리면 그 위치의 X·Y·Z 를 보여줍니다</div>';
  }
  function updateHUD(p) {
    if (!p) return;
    const rg = $('#simRange'), tt = $('#simTime'), el = $('#hudTool');
    if (rg && !scrubbing) rg.value = Math.round(p.total ? p.t / p.total * 1000 : 1000);
    if (tt) tt.textContent = clock(p.t) + ' / ' + clock(p.total);
    if (!el) return;
    if (!p.at) { el.innerHTML = '<b>대기</b>'; return; }
    const m = p.at.m, t = p.tool, pt = p.at.p;
    const what = m.k === 'rapid' ? 'G00 급속 이동' : m.k === 'drill' ? (m.code || '') + ' 사이클 절삭' : m.k === 'arc' ? (m.ccw ? 'G03' : 'G02') + ' 원호 절삭' : 'G01 직선 절삭';
    el.innerHTML = '<b>' + (t ? esc(C.toolLabel(t)) : 'T' + m.t) + '</b>' +
      '<div class="xyz"><b>X ' + C.fmt(C.r3(pt.x)) + '</b><b>Y ' + C.fmt(C.r3(pt.y)) + '</b><b>Z ' + C.fmt(C.r3(pt.z)) + '</b></div>' +
      '<small>' + what + (m.k !== 'rapid' && m.f ? ' · F' + m.f : '') + ' · G코드 ' + m.line + '행 · ' + Math.round(p.total ? p.t / p.total * 100 : 100) + '%</small>';
  }

  /* ---------------- 대화상자 ---------------- */
  function openDlg(title, body, foot, opts) {
    const d = $(opts && opts.second ? '#dlg2' : '#dlg');
    if (!(opts && opts.second)) S.dlgRefresh = opts && opts.refresh ? opts.refresh : null;
    d.dataset.admin = '';
    const sc = opts && opts.second ? 'd2' : 'd1';
    // 다시 그릴 때 스크롤 위치 유지
    const keep = d.open ? [...d.querySelectorAll('.dbody, .tblwrap')].map(x => x.scrollTop) : null;
    const u = U(sc);
    const extra = opts && opts.head ? opts.head(u) : '';
    d.querySelector('div').innerHTML = '<div class="dhead">' + extra + '<h2>' + esc(title) + '</h2>' + u.btn(ico('i-x'), () => closeDlg(d), 'ibtn sm', 'aria-label="닫기"') + '</div><div class="dbody">' + (typeof body === 'function' ? body(u) : body) + '</div>' + (foot ? '<div class="dfoot">' + foot(u) + '</div>' : '');
    if (keep) [...d.querySelectorAll('.dbody, .tblwrap')].forEach((x, i) => { if (keep[i] !== undefined) x.scrollTop = keep[i]; });
    if (!d.open) d.showModal();
    d.onclose = () => { if (!(opts && opts.second)) S.dlgRefresh = null; if (opts && opts.onClose) opts.onClose(); };
    return d;
  }
  function closeDlg(d) { (d || $('#dlg')).close(); }

  /* ---------------- 장비·공구·공정 묶음 (대화상자) ---------------- */
  function openTools() {
    openDlg('장비·공구', u => '<div class="subtabs">' + [['machine', '장비·공구 목록'], ['bundle', '공정 묶음 (프리셋)']].map(t => u.btn(t[1], () => { S.toolsTab = t[0]; openTools(); }, 'sm' + (S.toolsTab === t[0] ? ' on' : ''))).join('') + '</div>' +
      (S.toolsTab === 'machine' ? machineBody(u) : bundleBody(u)), null, { refresh: openTools });
  }
  function machineBody(u) {
    const m = machine();
    let h = '<h3>장비 선택</h3><div class="row">' +
      u.select(m.id, DB.machines.map(x => [x.id, x.name + (x.verified ? ' ✔' : '')]), v => mutate(() => { P.machineId = v; })) +
      u.btn('+ 새 장비', () => { const n = C.defaultMachine(); n.name = '새 장비 ' + (DB.machines.length + 1); DB.machines.push(n); mutate(() => { P.machineId = n.id; }); }, 'sm') +
      u.btn('복제', () => { const n = C.clone(m); n.id = C.uid('m'); n.name = m.name + ' 복사'; n.verified = false; n.verifiedBy = ''; n.verifiedAt = ''; DB.machines.push(n); mutate(() => { P.machineId = n.id; }); }, 'sm') +
      u.btn('삭제', () => {
        if (DB.machines.length < 2) return toast('장비는 최소 1대 필요합니다.', 'err');
        const used = Object.values(DB.projects).filter(p => p.machineId === m.id && p.id !== P.id).length;
        if (!confirm('"' + m.name + '" 장비를 삭제할까요?' + (used ? '\n다른 프로젝트 ' + used + '개가 이 장비를 사용 중입니다.' : ''))) return;
        DB.machines = DB.machines.filter(x => x !== m); mutate(() => { P.machineId = DB.machines[0].id; });
      }, 'sm danger') +
      u.btn('적합성 확인', () => openFitReport(), 'sm', 'title="현재 장비·소재로 모든 공정 묶음 점검"') + '</div>';
    h += '<div class="sect"><b>실가공 검증 상태</b>' + (m.verified
      ? '<span class="pill ok">검증 완료</span> <small>' + esc(m.verifiedBy) + ' · ' + esc(m.verifiedAt) + '</small><br><small>' + esc(m.verifyNote) + '</small>'
      : '<span class="pill warn">미검증 - NC는 "검증용(TEST)"으로 표시</span>') +
      '<br><small>검증 상태 변경은 관리자 설정(설정 창의 ⚙ 아이콘)에서만 가능합니다.</small></div>';
    const dm = (fn) => v => dbChange(() => { fn(v); if (m.verified) { m.verified = false; toast('장비 설정이 바뀌어 실가공 검증 상태가 해제되었습니다.', 'warn'); } });
    h += '<h3>장비 설정</h3>' + u.fld('장비 이름', u.text(m.name, dm(v => { m.name = v.slice(0, 60) || '장비'; })));
    h += '<div class="grid3" style="margin-top:6px">' +
      u.fld('X 행정', u.num(m.travel.x, dm(v => { m.travel.x = v; }))) + u.fld('Y 행정', u.num(m.travel.y, dm(v => { m.travel.y = v; }))) + u.fld('Z 행정', u.num(m.travel.z, dm(v => { m.travel.z = v; }))) +
      u.fld('최대 회전수', u.num(m.maxRpm, dm(v => { m.maxRpm = v; }))) + u.fld('탭 최대 회전수', u.num(m.maxTapRpm, dm(v => { m.maxTapRpm = v; }))) + u.fld('최대 절삭 이송', u.num(m.maxFeed, dm(v => { m.maxFeed = v; }))) +
      u.fld('매거진 공구 수', u.int(m.magazine, dm(v => { m.magazine = v; }))) + u.fld('급속 이송 (시간 추정용)', u.num(m.rapid, v => dbChange(() => { m.rapid = Math.min(100000, Math.max(1000, v)); }))) + u.fld('공구 교환 시간 (초)', u.num(m.tcSec, v => dbChange(() => { m.tcSec = Math.min(120, Math.max(0, v)); }))) +
      u.fld('제어기 (포스트프로세서)', u.select(m.control, C.POST.all().map(x => [x.id, x.label, x.status !== 'ready']), dm(v => { if (C.POST.get(v)) m.control = v; }))) + '</div>';
    h += u.check(m.rigidTap, dm(v => { m.rigidTap = v; }), '리지드 탭(M29) 지원') + u.check(m.rigidM03, dm(v => { m.rigidM03 = v; }), '리지드 탭 전에 S__ M03 출력 (장비 파라미터에 따름)') + u.check(m.endY, dm(v => { m.endY = v; }), '종료 시 Y축 원점 복귀 (G91 G28 Y0.)') + u.check(m.helical, dm(v => { m.helical = v; }), '헬리컬 보간 지원 (포켓 진입 G03 + Z)');

    h += '<h3>공구 목록 <small>(' + m.tools.length + '개)</small></h3><div class="tblwrap" style="max-height:360px"><table class="tbl"><tr><th>T</th><th>종류</th><th>직경</th><th title="드릴: 선단각 · 탭: 피치 · 엔드밀: 날 수">각/피치/날수</th><th>재질</th><th title="유효 날 길이(가공 가능한 최대 깊이)">날장</th><th></th></tr>';
    m.tools.slice().sort((a, b) => a.no - b.no).forEach(t => {
      h += '<tr><td style="width:56px">' + u.int(t.no, dm(v => { t.no = v; })) + '</td><td>' + u.select(t.type, Object.keys(C.TOOL_TYPES).map(k => [k, C.TOOL_TYPES[k]]), dm(v => { const n = C.normalizeTool(Object.assign({}, t, { type: v })); Object.keys(t).forEach(k => delete t[k]); Object.assign(t, n); })) + '</td>' +
        '<td>' + u.num(t.dia, dm(v => { t.dia = v; })) + '</td>' +
        '<td>' + (t.type === 'tap' ? u.num(t.pitch, dm(v => { t.pitch = v; }), 'title="피치(mm)"') : t.type === 'endmill' ? u.int(t.z, dm(v => { t.z = Math.max(1, Math.min(12, v)); }), 'title="날 수"') : u.num(t.angle, dm(v => { t.angle = v; }), 'title="선단각(°)"')) + '</td>' +
        '<td>' + u.select(t.mat, [['HSS', 'HSS'], ['CARBIDE', '초경']], dm(v => { t.mat = v; })) + '</td>' +
        '<td>' + u.num(t.flute, dm(v => { t.flute = v; }), 'title="유효 날 길이(mm)"') + '</td>' +
        '<td>' + u.btn('✕', () => { if (confirm('T' + t.no + ' 공구를 삭제할까요?')) dm(() => { m.tools.splice(m.tools.indexOf(t), 1); })(); }, 'sm danger', 'aria-label="공구 삭제"') + '</td></tr>';
    });
    h += '</table></div><div class="row" style="margin-top:6px">' + u.btn('+ 드릴', () => addTool('drill'), 'sm') + u.btn('+ 탭', () => addTool('tap'), 'sm') + u.btn('+ 센터 드릴', () => addTool('center'), 'sm') + u.btn('+ 평 엔드밀', () => addTool('endmill'), 'sm') + '</div>';
    h += '<small>직경: 탭은 호칭경(M8 → 8). 날장: 가공 가능한 최대 깊이 (포켓 깊이·드릴 깊이 검사에 사용).</small>';
    S.tdc = S.tdc || { d: 8, p: 1.25 };
    const rec = C.tapDrill(S.tdc.d, S.tdc.p);
    h += '<h3>미터 나사 기초 드릴 추천</h3><div class="grid3">' +
      u.fld('호칭경 M', u.num(S.tdc.d, v => { S.tdc.d = v; const c = C.METRIC_COARSE.find(r => r[0] === v); if (c) S.tdc.p = c[1]; openTools(); })) +
      u.fld('피치', u.num(S.tdc.p, v => { S.tdc.p = v; openTools(); })) +
      '<div class="fld"><span>추천 드릴</span><b style="font-size:1.2em">' + (rec ? 'Ø' + rec.dia : '-') + '</b></div></div>' +
      '<small>' + (rec ? esc(rec.name + ' ' + rec.kind + ' · 절삭 탭 기준 (D − P). 전조(롤) 탭은 별도 표 사용') : '호칭경을 입력하세요') + '</small>';
    return h;
    function addTool(type) {
      const used = new Set(m.tools.map(t => t.no)); let no = 1; while (used.has(no)) no++;
      const base = { no, type, dia: type === 'tap' ? 6 : type === 'endmill' ? 6 : 5, pitch: 1, angle: type === 'center' ? 90 : 118, flute: type === 'center' ? 10 : type === 'endmill' ? 15 : 40, z: 3, mat: type === 'endmill' ? 'CARBIDE' : 'HSS', name: '' };
      dbChange(() => { m.tools.push(C.normalizeTool(base)); if (m.verified) m.verified = false; });
    }
  }
  function bundleBody(u) {
    let h = '<p><small>자주 쓰는 공정 순서를 저장해 두고 "직접 구성" 가공에 적용합니다.</small></p>';
    DB.bundles.forEach((b, i) => {
      h += '<div class="card' + (S.bundleSel === b.id ? ' sel' : '') + '"><div class="head"><b>' + esc(b.name) + '</b>' +
        u.btn('편집', () => { S.bundleSel = S.bundleSel === b.id ? null : b.id; openTools(); }, 'sm') +
        u.btn('↑', () => dbChange(() => { if (i > 0) DB.bundles.splice(i - 1, 0, DB.bundles.splice(i, 1)[0]); }), 'sm', i ? '' : 'disabled') +
        u.btn('↓', () => dbChange(() => { if (i < DB.bundles.length - 1) DB.bundles.splice(i + 1, 0, DB.bundles.splice(i, 1)[0]); }), 'sm', i < DB.bundles.length - 1 ? '' : 'disabled') + '</div>' +
        '<small>' + esc(b.desc || b.ops.map(o => C.OP_TYPES[o.type].label).join(' → ')) + '</small>';
      if (S.bundleSel === b.id) {
        h += '<hr>' + u.fld('이름', u.text(b.name, v => dbChange(() => { b.name = v.slice(0, 60) || '공정 묶음'; }))) +
          u.fld('설명', u.text(b.desc, v => dbChange(() => { b.desc = v.slice(0, 200); }))) +
          opCards(u, b.ops, fn => dbChange(fn), { template: true }) +
          '<div class="row end">' + u.btn('복제', () => dbChange(() => { const n = C.normalizeBundle(C.clone(b)); n.id = C.uid('b'); n.name = b.name + ' 복사'; DB.bundles.splice(i + 1, 0, n); }), 'sm') +
          u.btn('삭제', () => { if (confirm('"' + b.name + '" 묶음을 삭제할까요?')) dbChange(() => { DB.bundles.splice(i, 1); S.bundleSel = null; }); }, 'sm danger') + '</div>';
      }
      h += '</div>';
    });
    h += '<div class="row" style="margin-top:6px">' +
      u.btn('+ 새 묶음', () => dbChange(() => { const n = C.normalizeBundle({ name: '새 공정 묶음', ops: [] }); DB.bundles.push(n); S.bundleSel = n.id; }), 'sm') +
      u.btn('적합성 확인', () => openFitReport(), 'sm') +
      u.btn('내보내기', () => downloadText('pureun-cam-bundles.json', JSON.stringify({ type: 'pcam-bundles', version: C.VERSION, bundles: DB.bundles }, null, 1), 'application/json'), 'sm') +
      u.btn('가져오기', () => pickFile('.json', txt => {
        const d = JSON.parse(txt); const arr = Array.isArray(d) ? d : d.bundles;
        if (!Array.isArray(arr)) throw new Error('공정 묶음 파일이 아닙니다.');
        dbChange(() => { arr.slice(0, 200).forEach(b => { const n = C.normalizeBundle(b); n.id = C.uid('b'); if (n.importWarnings) { toast(n.importWarnings[0], 'err'); delete n.importWarnings; } DB.bundles.push(n); }); });
        toast(arr.length + '개 공정 묶음을 가져왔습니다.', 'ok');
      }), 'sm') + '</div>';
    h += '<small>묶음의 공구는 번호와 사양(종류·직경·피치)을 함께 저장합니다. 장비가 바뀌면 사양이 같은 공구로 자동 매칭하고, 없으면 경고합니다.</small>';
    return h;
  }
  function openFitReport() {
    const m = machine();
    let h = '<p>장비 <b>' + esc(m.name) + '</b>, 재질 <b>' + esc(C.MATERIALS[P.stock.material].label) + '</b>, 두께 ' + P.stock.sz + 'mm 기준</p>';
    DB.bundles.forEach(b => {
      const r = C.checkBundleFit(b, m, P.stock);
      h += '<div class="sect"><b>' + (r.ok ? '<span class="pill ok">적합</span> ' : '<span class="pill err">확인 필요</span> ') + esc(b.name) + '</b>';
      r.notes.forEach(n => { h += '<div><small>• ' + esc(n) + '</small></div>'; });
      r.issues.forEach(i => { h += '<div style="color:var(--' + (i.level === 'error' ? 'err' : 'warn') + ')"><small>• ' + esc(i.msg.replace('[적합성 확인] ', '')) + '</small></div>'; });
      if (r.ok && !r.notes.length && !r.issues.length) h += '<small>문제 없음</small>';
      h += '</div>';
    });
    if (!DB.bundles.length) h += '<p>등록된 공정 묶음이 없습니다.</p>';
    const cur = S.V.issues.filter(i => [4, 5, 6, 7, 8, 9].includes(i.cat) && i.level !== 'info');
    h += '<h3>현재 프로젝트 공정</h3>' + (cur.length ? cur.map(i => '<div style="color:var(--' + (i.level === 'error' ? 'err' : 'warn') + ')"><small>• ' + esc(i.msg) + '</small></div>').join('') : '<small>문제 없음</small>');
    openDlg('적합성 확인 (소재·장비 변경 점검)', h, null, { second: true });
  }

  /* ---------------- 작업지시서 (셋업시트) ---------------- */
  function sheetHTML() {
    const m = machine(), st = P.stock, set = P.settings, ds = downloadState(), tm = C.toolMap(m), c = counts();
    const steps = S.V.plan.steps, used = [];
    steps.forEach(s => { if (!used.includes(s.toolNo)) used.push(s.toolNo); });
    const runSec = new Map(); if (S.est) S.est.runs.forEach(r => runSec.set(r.t, (runSec.get(r.t) || 0) + r.sec));
    let h = '<div class="sheet"><div class="sh-head"><div><h1>작업지시서 (셋업시트)</h1><div>' + esc(P.name) + ' · O' + String(P.programNo).padStart(4, '0') + ' · ' + new Date().toISOString().slice(0, 10) + '</div></div>' +
      '<div class="sh-badge ' + (ds.ok ? (ds.test ? 'warn' : 'ok') : 'err') + '">' + (ds.ok ? (ds.test ? '검증용(TEST) — 실가공 검증 전' : '검증 통과') : 'NC 생성 차단: ' + esc(ds.why)) + '</div></div>';
    h += '<table class="sh-t"><tr><th>장비</th><td>' + esc(m.name) + ' (' + esc(m.control) + ')</td><th>NC 파일</th><td>' + esc(ds.ok ? ncFileName(ds) : '-') + '</td></tr>' +
      '<tr><th>소재</th><td>' + esc(C.MATERIALS[st.material] ? C.MATERIALS[st.material].label : st.material) + ' · ' + st.sx + ' × ' + st.sy + ' × ' + st.sz + ' mm</td><th>원점</th><td>' + esc(C.ORIGIN_LABEL[st.origin]) + ' · Z0 = 소재 윗면 · ' + esc(set.wcs) + '</td></tr>' +
      '<tr><th>초기점</th><td>Z' + set.initialZ + ' (' + (set.retract === 'G98' ? 'G98 초기점 복귀' : 'G99 R점 복귀') + ')</td><th>하부 여유</th><td>' + C.toNum(st.under, 0) + ' mm</td></tr>' +
      '<tr><th>예상 시간</th><td>' + (S.est ? '약 ' + fmtSec(S.est.total) + ' (절삭·이동 ' + fmtSec(S.est.cut) + ' + 공구 교환 ' + S.est.changes + '회)' : '-') + '</td><th>클램프</th><td>' + (P.clamps.length ? P.clamps.map((cl, i) => '#' + (i + 1) + ' X' + cl.x + ' Y' + cl.y + ' ' + cl.w + '×' + cl.h + ' H' + cl.height).join('<br>') : '없음') + '</td></tr></table>';
    h += '<h2>공구표</h2><table class="sh-t"><tr><th>T</th><th>공구</th><th>날장</th><th>재질</th><th>사용 공정</th><th>시간(추정)</th><th>확인</th></tr>';
    used.forEach(no => {
      const t = tm.get(no), ss = steps.filter(s => s.toolNo === no);
      h += '<tr><td>T' + String(no).padStart(2, '0') + '</td><td>' + (t ? esc(C.toolLabel(t).replace(/^T\d+\s*/, '')) : '없음') + '</td><td>' + (t ? t.flute : '-') + '</td><td>' + (t ? (t.mat === 'CARBIDE' ? '초경' : 'HSS') : '-') + '</td><td>' + ss.map(s => esc(C.OP_TYPES[s.type].label)).join(', ') + '</td><td>' + (runSec.has(no) ? fmtSec(runSec.get(no)) : '-') + '</td><td class="box"></td></tr>';
    });
    h += '</table><h2>가공 순서</h2><table class="sh-t"><tr><th>#</th><th>공정</th><th>공구</th><th>개수</th><th>공구 끝 Z</th><th>S</th><th>F</th></tr>';
    steps.forEach(s => {
      h += '<tr><td>' + s.idx + '</td><td>' + esc(C.OP_TYPES[s.type].label) + ' <small>' + esc(C.OP_TYPES[s.type].code) + '</small></td><td>T' + String(s.toolNo).padStart(2, '0') + '</td><td>' + s.holes.length + '</td><td>' + (C.isNum(s.z) ? 'Z' + C.fmt(s.z) : '-') + '</td><td>' + s.rpm + '</td><td>' + s.feed + '</td></tr>';
    });
    h += '</table>';
    const warns = S.V.issues.filter(i => i.level !== 'info' && !(i.cat === 11 && /실가공 검증 전/.test(i.msg))).slice(0, 20);
    if (warns.length || (c.vr && c.vr.warnings.length)) h += '<h2>확인 사항</h2><ul>' + warns.map(i => '<li>' + (i.level === 'error' ? '[오류] ' : '[경고] ') + esc(i.msg) + '</li>').join('') + (c.vr ? c.vr.warnings.slice(0, 10).map(x => '<li>[G코드 ' + x.line + '행] ' + esc(x.msg) + '</li>').join('') : '') + '</ul>';
    h += '<h2>가공 전 점검</h2><ul class="sh-check"><li>공구 길이 보정(H)·공작물 좌표계(' + esc(set.wcs) + ') 입력</li><li>Z를 띄운 드라이런(공회전) 확인</li><li>싱글 블록으로 첫 구멍·포켓 진입 확인</li><li>클램프·지그 위치, 소재 하부 여유 확인</li><li>탭 가공 시 이송·주축 오버라이드 100%</li></ul>';
    h += '<table class="sh-t sh-sign"><tr><th>작성</th><td></td><th>확인</th><td></td><th>작업자</th><td></td></tr></table>';
    h += '<p class="sh-foot">푸른 AI CAM ' + C.VERSION + ' · 예상 시간은 급속 ' + m.rapid + 'mm/min, 공구 교환 ' + m.tcSec + '초 기준 추정치입니다 (가감속 미반영). 자동 검증은 실제 가공 안전을 보장하지 않습니다.</p></div>';
    return h;
  }
  function openSheet() {
    openDlg('작업지시서 (셋업시트)', () => sheetHTML(), u => u.btn(ico('i-print') + '인쇄', () => {
      let pa = $('#printArea'); if (!pa) { pa = document.createElement('div'); pa.id = 'printArea'; document.body.appendChild(pa); }
      pa.innerHTML = sheetHTML(); window.print();
    }, 'primary') + u.btn('닫기', () => closeDlg(), ''), { refresh: openSheet });
  }

  /* ---------------- 프로젝트 관리 ---------------- */
  function openProjects() {
    openDlg('프로젝트', u => {
      const list = Object.values(DB.projects).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      let h = '<div class="row">' + u.btn('+ 새 프로젝트', () => { const n = C.newProject(machine()); DB.projects[n.id] = n; switchProject(n.id); closeDlg(); }, 'primary sm') +
        u.btn('현재 프로젝트 파일로 내보내기', () => exportProject(), 'sm') +
        u.btn('프로젝트 파일 가져오기', () => pickFile('.json', importProject), 'sm') + '</div>';
      h += '<table class="tbl" style="margin-top:8px"><tr><th>이름</th><th>위치</th><th>수정</th><th></th></tr>';
      list.forEach(p => {
        const n = p.groups.reduce((s, g) => s + g.holes.length, 0);
        h += '<tr class="' + (p.id === P.id ? 'sel' : '') + '"><td>' + esc(p.name) + '</td><td>' + n + '</td><td><small>' + esc(String(p.updatedAt).slice(0, 16).replace('T', ' ')) + '</small></td><td style="white-space:nowrap">' +
          u.btn('열기', () => { switchProject(p.id); closeDlg(); }, 'sm', p.id === P.id ? 'disabled' : '') +
          u.btn('복제', () => { const c = C.normalizeProject(C.clone(p)); c.id = C.uid('p'); c.name = p.name + ' 복사'; c.updatedAt = new Date().toISOString(); DB.projects[c.id] = c; saveDB(true); openProjects(); }, 'sm') +
          u.btn('삭제', () => { if (Object.keys(DB.projects).length < 2) return toast('프로젝트는 최소 1개 필요합니다.', 'err'); if (!confirm('"' + p.name + '" 프로젝트를 삭제할까요? 되돌릴 수 없습니다.')) return; delete DB.projects[p.id]; if (p.id === P.id) switchProject(Object.keys(DB.projects)[0]); else saveDB(true); openProjects(); }, 'sm danger') + '</td></tr>';
      });
      h += '</table><p><small>모든 프로젝트는 이 PC 브라우저에만 자동 저장됩니다. 브라우저 데이터 삭제에 대비해 파일로 내보내거나 설정 → 전체 백업을 하세요.</small></p>';
      return h;
    });
  }
  function switchProject(id) {
    saveDB(true);
    P = DB.projects[id]; DB.currentProjectId = id;
    if (!DB.machines.find(m => m.id === P.machineId)) P.machineId = DB.machines[0].id;
    regenSpecs(); // 다른 프로젝트에서 장비·공구가 바뀌었을 수 있음
    S.undo = []; S.redo = []; S.sel = { kind: 'stock', gid: null, hid: null }; S.view.fitted = false; S.pathStep = 0;
    S.nc.edited = false; S.nc.editText = ''; S.nc.editVerify = null; S.sim.sig = ''; S.sim.stockSig = '';
    saveDB(true); renderAll();
  }
  function exportProject() {
    const m = machine();
    const data = { type: 'pcam-project', version: C.VERSION, exportedAt: new Date().toISOString(), project: P, machine: Object.assign(C.clone(m), { verified: false }) };
    downloadText((P.name.replace(/[\\/:*?"<>|]+/g, '_') || 'project') + '.pcam.json', JSON.stringify(data, null, 1), 'application/json');
  }
  function importProject(txt) {
    const d = JSON.parse(txt);
    if (!d || d.type !== 'pcam-project' || !d.project) throw new Error('푸른 AI CAM 프로젝트 파일이 아닙니다.');
    const p = C.normalizeProject(d.project); p.id = C.uid('p'); p.updatedAt = new Date().toISOString();
    if (p.importWarnings) { p.importWarnings.forEach(w => toast(w, 'err')); delete p.importWarnings; }
    if (d.machine) {
      const m = C.normalizeMachine(d.machine); m.verified = false; m.verifiedBy = ''; m.verifiedAt = '';
      const ex = DB.machines.find(x => x.id === m.id);
      if (!ex) { DB.machines.push(m); toast('장비 "' + m.name + '" 를 추가했습니다 (실가공 검증 상태는 관리자 재승인 필요).', 'warn'); }
      p.machineId = m.id;
    }
    if (!DB.machines.find(x => x.id === p.machineId)) p.machineId = DB.machines[0].id;
    DB.projects[p.id] = p; switchProject(p.id); closeDlg(); toast('프로젝트를 가져왔습니다.', 'ok');
  }

  /* ---------------- 일반 설정 ---------------- */
  function applyTheme() {
    const t = DB.settings.theme;
    const dark = t === 'dark' || (t === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.fs = DB.settings.fs || 'm';
    if (V3 && V3.ok) V3.setTheme(dark ? 'dark' : 'light');
  }
  function openSettings() {
    S.admin.clicks = [];
    openDlg('설정', u => {
      const s = DB.settings;
      let h = '<div class="sect"><b>화면</b><div class="grid2">' +
        u.fld('테마', u.select(s.theme, [['system', '시스템 설정 따름'], ['light', '밝게'], ['dark', '어둡게']], v => { s.theme = v; applyTheme(); saveDB(); drawView(); })) +
        u.fld('글자 크기', u.select(s.fs, [['s', '작게'], ['m', '보통'], ['l', '크게']], v => { s.fs = v; applyTheme(); saveDB(); drawView(); })) + '</div></div>';
      h += '<div class="sect"><b>소리·언어</b>' + u.check(s.sound, v => { s.sound = v; saveDB(); if (v) beep(); }, 'NC 생성 차단·검증 오류 시 경고음') +
        u.fld('언어', u.select('ko', [['ko', '한국어']], () => { }, 'title="현재 한국어만 지원"')) + '<small>NC 파일 주석은 장비 호환을 위해 영문으로 출력됩니다.</small></div>';
      h += '<div class="sect"><b>공유·버전</b><div class="row">' + u.btn(ico('i-share') + '공유 링크·QR코드', () => openShare(), 'sm') + u.btn('업그레이드 / 버전 정보', () => openVersion(), 'sm') + '</div>' +
        '<small class="ver">푸른 AI CAM ' + C.VERSION + ' (' + C.BUILD_DATE + ')</small></div>';
      h += '<div class="sect"><b>데이터 백업·복원</b><div class="row">' +
        u.btn('전체 백업 (JSON)', () => backupAll(), 'sm') + u.btn('백업 복원', () => pickFile('.json', restoreAll), 'sm') + '</div>' +
        '<small>프로젝트·공정 묶음·공구·장비 설정을 한 파일로 저장합니다. 인증 정보는 백업에 포함되지 않습니다.</small></div>';
      h += '<div class="sect"><b>오픈소스 구성 요소</b><small>three.js r149 (MIT, 3D 표시) · qrcode-generator 1.4.4 (MIT, QR코드). 라이선스 전문은 HTML 파일 안에 포함되어 있습니다.</small></div>';
      h += '<p><small>데이터는 이 브라우저(localStorage)에만 저장되며 외부 서버로 전송되지 않습니다.</small></p>';
      return h;
    }, null, { head: u => u.btn('⚙', () => adminGearClick(), 'gear', 'id="gsGear" title="설정" aria-label="설정 아이콘"') });
  }
  // 숨겨진 관리자: 최초 입력부터 3초 이내 5회 연속 클릭/터치/Enter
  function adminGearClick() {
    const now = Date.now(), c = S.admin.clicks;
    if (!c.length || now - c[0] > 3000) { c.length = 0; }
    c.push(now);
    if (c.length >= 5) { c.length = 0; openAdminAuth(); }
  }
  function backupAll() {
    const data = { type: 'pcam-backup', version: C.VERSION, exportedAt: new Date().toISOString(), db: Object.assign({}, DB, { projects: Object.assign({}, DB.projects, { [P.id]: P }) }) };
    downloadText('pureun-cam-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data), 'application/json');
    toast('전체 백업 파일을 저장했습니다.', 'ok');
  }
  function restoreAll(txt) {
    const d = JSON.parse(txt);
    if (!d || d.type !== 'pcam-backup' || !d.db || !Array.isArray(d.db.machines)) throw new Error('푸른 AI CAM 백업 파일이 아닙니다.');
    if (!confirm('현재 브라우저의 모든 데이터를 백업 파일 내용으로 바꿉니다. 계속할까요?\n(복원 전 현재 데이터를 자동 백업합니다)')) return;
    backupAll();
    const nd = { schema: 1, machines: d.db.machines.map(C.normalizeMachine), bundles: (d.db.bundles || []).map(b => { const n = C.normalizeBundle(b); if (n.importWarnings) { toast(n.importWarnings[0], 'err'); delete n.importWarnings; } return n; }), projects: {}, settings: Object.assign({}, DB.settings, d.db.settings || {}) };
    nd.machines.forEach(m => { m.verified = false; });
    Object.values(d.db.projects || {}).forEach(p => { const n = C.normalizeProject(p); if (n.importWarnings) { toast('[' + n.name + '] ' + n.importWarnings[0], 'err'); delete n.importWarnings; } nd.projects[n.id] = n; });
    if (!nd.machines.length) throw new Error('장비 정보가 없습니다.');
    if (!Object.keys(nd.projects).length) { const n = C.newProject(nd.machines[0]); nd.projects[n.id] = n; }
    Object.values(nd.projects).forEach(p => { if (!nd.machines.find(m => m.id === p.machineId)) p.machineId = nd.machines[0].id; });
    nd.currentProjectId = nd.projects[d.db.currentProjectId] ? d.db.currentProjectId : Object.keys(nd.projects)[0];
    DB = nd; P = DB.projects[DB.currentProjectId]; regenSpecs();
    S.undo = []; S.redo = []; S.view.fitted = false; S.nc.edited = false; S.sim.sig = '';
    saveDB(true); closeDlg(); applyTheme(); renderAll();
    toast('복원했습니다. 장비 실가공 검증 상태는 관리자 재승인이 필요합니다.', 'warn');
  }

  /* ---------------- 공유·QR ---------------- */
  function shareURL() { return /^https?:$/.test(location.protocol) ? location.href.split('#')[0].split('?')[0] : null; }
  function openShare() {
    const url = shareURL();
    openDlg('앱 공유', u => {
      if (!url) return '<p>현재 <b>로컬 파일</b>(' + esc(location.protocol) + ')로 실행 중이라 다른 기기에서 접속할 수 있는 공유 주소가 없습니다.</p><p><small>웹 서버(예: GitHub Pages, Firebase Hosting)에 배포한 뒤 그 주소에서 열면 링크·QR코드 공유가 가능합니다. 지금은 HTML 파일 자체를 USB·메일로 전달하세요.</small></p>' +
        '<p><small>공유에는 앱 주소만 포함되며 프로젝트 데이터·인증 정보는 포함되지 않습니다.</small></p>';
      return '<div class="qrbox"><canvas id="qrCanvas" aria-label="앱 주소 QR코드"></canvas><input type="text" readonly value="' + esc(url) + '" style="width:100%"><div class="row">' +
        u.btn('링크 복사', () => copyText(url), 'sm') + (navigator.share ? u.btn('공유하기', () => navigator.share({ title: '푸른 AI CAM', url }).catch(() => { }), 'sm') : '') +
        u.btn('QR 이미지 저장', () => { const c = $('#qrCanvas'); c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'pureun-ai-cam-qr.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }); }, 'sm') + '</div>' +
        '<small>앱 주소만 공유됩니다. 프로젝트 데이터·인증 정보는 포함되지 않습니다.</small></div>';
    }, null, { second: !!$('#dlg').open });
    if (url) drawQR($('#qrCanvas'), url);
  }
  function drawQR(c, text) {
    try {
      const q = window.qrcode(0, 'M'); q.addData(text, 'Byte'); q.make();
      const n = q.getModuleCount(), cell = 8, quiet = 4, size = (n + quiet * 2) * cell;
      c.width = size; c.height = size;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, size, size); x.fillStyle = '#000';
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) x.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
    } catch (e) { toast('QR코드 생성 실패: ' + e.message, 'err'); }
  }

  /* ---------------- 버전·업그레이드 ---------------- */
  function openVersion() {
    openDlg('버전 정보·업그레이드', () => {
      let h = '<div class="grid2"><div class="fld"><span>현재 버전</span><b>' + C.VERSION + ' (' + C.BUILD_DATE + ')</b></div><div class="fld"><span>최신 버전</span><b id="latestVer">' + (shareURL() ? '확인 중…' : '확인 불가 (로컬 파일)') + '</b></div></div>';
      h += '<h3>변경 내역</h3>' + CHANGELOG.map(c => '<div class="sect"><b>' + c.v + ' · ' + c.d + '</b><ul>' + c.items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul></div>').join('');
      h += '<h3>업데이트 방법</h3><ul><li>웹 배포판: 새 버전이 배포되면 페이지를 새로 고침하면 적용됩니다.</li><li>로컬 HTML 파일: 새 버전 HTML 파일로 교체하세요. 같은 브라우저에서 열면 저장 데이터가 유지됩니다.</li><li>업데이트 전에 <b>설정 → 전체 백업</b>을 권장합니다. 문제가 생기면 이전 HTML 파일과 백업으로 복구할 수 있습니다.</li></ul><p><small>자동 업데이트 기능은 없습니다.</small></p>';
      return h;
    }, null, { second: !!$('#dlg').open });
    if (shareURL()) {
      fetch('version.json?ts=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject(r.status)).then(j => {
        const el = $('#latestVer'); if (!el) return;
        el.textContent = String(j.version || '?') + (j.version === C.VERSION ? ' (최신)' : ' — 새 버전이 있습니다. 새로 고침하세요.');
      }).catch(() => { const el = $('#latestVer'); if (el) el.textContent = '확인 실패 (version.json 없음)'; });
    }
  }

  /* ---------------- 관리자 인증·설정 ---------------- */
  // 관리자 해시 도구는 저장 모듈(ui/storage.js)
  function openAdminAuth() {
    if (!window.crypto || !crypto.subtle) return toast('이 브라우저 환경에서는 안전한 암호화 기능을 쓸 수 없어 관리자 설정을 열 수 없습니다 (https 또는 로컬 파일로 실행).', 'err');
    const rec = adminRec();
    if (!rec) {
      openDlg('관리자 비밀번호 등록', u => '<p>이 기기(브라우저)에서 처음 관리자 설정을 엽니다. 관리자 비밀번호를 등록하세요.</p><div class="grid2">' +
        '<label class="fld"><span>새 비밀번호 (8자 이상, 영문+숫자)</span><input type="password" id="apw1" autocomplete="new-password"></label>' +
        '<label class="fld"><span>비밀번호 확인</span><input type="password" id="apw2" autocomplete="new-password"></label></div>' +
        '<p><small>비밀번호 원문은 저장하지 않고 PBKDF2-SHA256 해시만 이 브라우저에 저장합니다. 기기별로 따로 등록되며 동기화되지 않습니다. 브라우저 저장소는 PC 사용자 계정 보안에 의존합니다.</small></p>',
        u => u.btn('등록', async () => {
          const a = $('#apw1').value, b = $('#apw2').value;
          if (!pwRule(a)) return toast('8자 이상, 영문과 숫자를 포함하세요.', 'err');
          if (a !== b) return toast('비밀번호 확인이 일치하지 않습니다.', 'err');
          const salt = crypto.getRandomValues(new Uint8Array(16)), iter = 150000;
          const hash = await pbkdf2(a, salt, iter);
          lsSet(ADMIN_KEY, JSON.stringify({ v: 1, salt: b64(salt), iter, hash, fails: 0, lockUntil: 0 }));
          toast('관리자 비밀번호를 등록했습니다.', 'ok'); startAdmin();
        }, 'primary'), { second: true });
      return;
    }
    const lockLeft = () => Math.max(0, (rec.lockUntil || 0) - Date.now());
    openDlg('관리자 인증', u => (lockLeft() ? '<p style="color:var(--err)">인증 실패가 반복되어 잠겨 있습니다. ' + Math.ceil(lockLeft() / 60000) + '분 후 다시 시도하세요.</p>' : '') +
      '<label class="fld"><span>관리자 비밀번호</span><input type="password" id="apw" autocomplete="current-password"></label>' +
      '<p><small>5회 실패 시 5분간 잠깁니다. ' + (rec.fails ? '현재 실패 ' + rec.fails + '회' : '') + '</small></p>' +
      '<details><summary><small>비밀번호를 잊으셨나요?</small></summary><p><small>재설정하면 관리자 비밀번호가 삭제되고, 보안을 위해 모든 장비의 실가공 검증 승인도 해제됩니다.</small></p>' +
      u.btn('비밀번호 재설정', () => {
        if (prompt('재설정하려면 "재설정" 을 입력하세요.') !== '재설정') return;
        try { localStorage.removeItem(ADMIN_KEY); } catch (e) { /* 저장소 접근 불가 */ }
        DB.machines.forEach(m => { m.verified = false; m.verifiedBy = ''; m.verifiedAt = ''; });
        saveDB(true); closeDlg($('#dlg2')); renderAll(); toast('관리자 비밀번호를 재설정했습니다. 다시 등록하세요.', 'warn');
      }, 'sm danger') + '</details>',
      u => u.btn('확인', async () => {
        const r = adminRec(); if (!r) return;
        if (Math.max(0, (r.lockUntil || 0) - Date.now())) return toast('잠금 중입니다.', 'err');
        const pw = $('#apw').value; if (!pw) return;
        const hash = await pbkdf2(pw, unb64(r.salt), r.iter);
        if (safeEq(hash, r.hash)) { r.fails = 0; r.lockUntil = 0; lsSet(ADMIN_KEY, JSON.stringify(r)); startAdmin(); }
        else {
          r.fails = (r.fails || 0) + 1;
          if (r.fails >= 5) { r.fails = 0; r.lockUntil = Date.now() + 5 * 60000; toast('5회 실패 — 5분간 잠깁니다.', 'err'); }
          else toast('비밀번호가 틀렸습니다 (' + r.fails + '/5).', 'err');
          lsSet(ADMIN_KEY, JSON.stringify(r)); beep(); openAdminAuth();
        }
      }, 'primary'), { second: true });
    setTimeout(() => { const i = $('#apw'); if (i) { i.focus(); i.onkeydown = e => { if (e.key === 'Enter') $('#dlg2 .dfoot button').click(); }; } }, 50);
  }
  let adminTimer = null;
  function startAdmin() {
    S.admin.authed = true; S.admin.until = Date.now() + 10 * 60000;
    clearTimeout(adminTimer); adminTimer = setTimeout(endAdmin, 10 * 60000);
    openAdminPanel();
  }
  function endAdmin() { S.admin.authed = false; clearTimeout(adminTimer); const d = $('#dlg2'); if (d.open && d.dataset.admin === '1') d.close(); }
  function openAdminPanel() {
    if (!S.admin.authed || Date.now() > S.admin.until) { S.admin.authed = false; return openAdminAuth(); }
    const d = openDlg('관리자 설정', u => {
      let h = '<div class="adm"><b>⚠ 관리자 모드</b> <small>창을 닫거나 10분이 지나면 자동 종료되며 다시 인증해야 합니다.</small></div>';
      h += '<h3>장비 실가공 검증 승인</h3><p><small>실제 머시닝센터에서 아래 시험을 마친 장비만 승인하세요. 승인 전 NC 파일은 "검증용(TEST)"으로 표시됩니다. 장비 설정을 바꾸면 승인이 자동 해제됩니다.</small></p>';
      DB.machines.forEach(m => {
        h += '<div class="sect"><b>' + esc(m.name) + ' ' + (m.verified ? '<span class="pill ok">승인됨 · ' + esc(m.verifiedBy) + ' · ' + esc(m.verifiedAt) + '</span>' : '<span class="pill warn">미승인</span>') + '</b>';
        if (m.verified) h += u.btn('승인 해제', () => { m.verified = false; m.verifiedBy = ''; m.verifiedAt = ''; saveDB(true); renderAll(); openAdminPanel(); }, 'sm danger');
        else {
          const id = m.id.replace(/[^a-z0-9]/gi, '');
          h += '<label class="chk"><input type="checkbox" id="vc1' + id + '">Z를 띄운 드라이런(공회전)으로 경로 확인</label><label class="chk"><input type="checkbox" id="vc2' + id + '">싱글 블록 운전으로 공구 교환·보정·사이클 확인</label><label class="chk"><input type="checkbox" id="vc3' + id + '">시편 실가공 후 위치·깊이·나사 게이지 확인</label>' +
            '<div class="grid2"><label class="fld"><span>확인자</span><input type="text" id="vby' + id + '" maxlength="40"></label><label class="fld"><span>메모 (사용 파라미터 등)</span><input type="text" id="vno' + id + '" maxlength="200"></label></div>' +
            u.btn('검증 완료 승인', () => {
              if (![1, 2, 3].every(k => $('#vc' + k + id).checked)) return toast('세 가지 실장비 시험을 모두 확인하세요.', 'err');
              const by = $('#vby' + id).value.trim(); if (!by) return toast('확인자를 입력하세요.', 'err');
              m.verified = true; m.verifiedBy = by; m.verifiedAt = new Date().toISOString().slice(0, 10); m.verifyNote = $('#vno' + id).value.trim();
              saveDB(true); renderAll(); openAdminPanel(); toast('실가공 검증을 승인했습니다.', 'ok');
            }, 'sm primary');
        }
        h += '</div>';
      });
      h += '<h3>관리자 비밀번호 변경</h3><div class="grid3"><label class="fld"><span>현재 비밀번호</span><input type="password" id="cpw0" autocomplete="current-password"></label><label class="fld"><span>새 비밀번호</span><input type="password" id="cpw1" autocomplete="new-password"></label><label class="fld"><span>새 비밀번호 확인</span><input type="password" id="cpw2" autocomplete="new-password"></label></div>' +
        u.btn('비밀번호 변경', async () => {
          const r = adminRec(), a = $('#cpw1').value;
          if (!safeEq(await pbkdf2($('#cpw0').value, unb64(r.salt), r.iter), r.hash)) return toast('현재 비밀번호가 틀렸습니다.', 'err');
          if (!pwRule(a)) return toast('8자 이상, 영문과 숫자를 포함하세요.', 'err');
          if (a !== $('#cpw2').value) return toast('새 비밀번호 확인이 일치하지 않습니다.', 'err');
          const salt = crypto.getRandomValues(new Uint8Array(16));
          lsSet(ADMIN_KEY, JSON.stringify({ v: 1, salt: b64(salt), iter: r.iter, hash: await pbkdf2(a, salt, r.iter), fails: 0, lockUntil: 0 }));
          ['cpw0', 'cpw1', 'cpw2'].forEach(k => { $('#' + k).value = ''; }); toast('비밀번호를 변경했습니다.', 'ok');
        }, 'sm');
      h += '<h3>데이터 초기화</h3><p><small>이 브라우저의 모든 프로젝트·장비·공정 묶음을 지우고 초기 상태로 되돌립니다 (자동 백업 후 진행).</small></p>' +
        u.btn('전체 데이터 초기화', () => {
          if (prompt('초기화하려면 "초기화" 를 입력하세요.') !== '초기화') return;
          backupAll(); DB = freshDB(); P = DB.projects[DB.currentProjectId]; S.undo = []; S.redo = []; S.view.fitted = false; S.nc.edited = false; S.sim.sig = '';
          saveDB(true); renderAll(); endAdmin(); toast('초기화했습니다.', 'warn');
        }, 'sm danger');
      return h;
    }, null, { second: true, onClose: () => { S.admin.authed = false; clearTimeout(adminTimer); } });
    d.dataset.admin = '1';
  }

  /* ---------------- 시작 ---------------- */
  function init() {
    DB = loadDB();
    P = DB.projects[DB.currentProjectId] || Object.values(DB.projects)[0];
    if (!P) { const n = C.newProject(DB.machines[0]); DB.projects[n.id] = n; P = n; }
    if (!DB.machines.find(m => m.id === P.machineId)) P.machineId = DB.machines[0].id;
    regenSpecs(); // 저장된 간편 입력 그룹을 현재 장비·소재 기준으로 다시 구성
    applyTheme();
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); drawView(); });
    $('#projName').addEventListener('change', e => mutate(() => { P.name = e.target.value.slice(0, 60) || '프로젝트'; }));
    $('#btnProjects').onclick = openProjects;
    $('#btnTools').onclick = openTools;
    $('#btnSheet').onclick = openSheet;
    $('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo;
    $('#btnDownload').onclick = doDownload;
    $('#btnShare').onclick = openShare;
    $('#btnSettings').onclick = openSettings;
    $('#tab2d').onclick = () => setVMode('2d'); $('#tab3d').onclick = () => setVMode('3d');
    $('#drawerClose').onclick = () => { S.drawer = false; renderAll(); };
    document.querySelectorAll('#bottomTabs button[data-tab]').forEach(b => b.onclick = () => { S.bottomTab = b.dataset.tab; renderAll(); });
    document.querySelectorAll('#mnav button').forEach(b => b.onclick = () => { S.mpanel = b.dataset.m; renderAll(); });
    document.addEventListener('keydown', e => {
      const tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      const dlg = document.querySelector('dialog[open]');
      if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (!typing && !dlg && (e.key === 'Delete' || e.key === 'Backspace') && S.sel.hid && S.vmode === '2d') { e.preventDefault(); deleteSelectedHole(); }
      else if (!typing && !dlg && e.key === ' ' && S.vmode === '3d' && V3 && V3.ok && !(e.target.getAttribute && e.target.getAttribute('role') === 'button') && e.target.tagName !== 'BUTTON') { e.preventDefault(); if (V3.isPlaying()) V3.pause(); else V3.play(); }
      else if (!typing && e.key === 'Escape' && S.mode !== 'select') setMode('select');
      else if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); openAdminAuth(); } // 접근성용 대체 관리자 진입 (비밀번호 필요)
    });
    window.addEventListener('beforeunload', () => saveDB(true));
    window.addEventListener('afterprint', () => { const pa = $('#printArea'); if (pa) pa.innerHTML = ''; });
    initCanvas();
    // 처음 실행(가공 없음)에는 소재부터, 가공이 있으면 첫 가공을 선택
    if (P.groups.length) S.sel = { kind: 'group', gid: P.groups[0].id, hid: null };
    renderAll();
    requestAnimationFrame(() => { S.view.fitted = false; drawView(); });
  }
  window.addEventListener('DOMContentLoaded', init);
  window.__PCAM_UI__ = { get P() { return P; }, get S() { return S; }, get DB() { return DB; }, get V3() { return V3; }, renderAll, downloadState, setVMode };
})();
