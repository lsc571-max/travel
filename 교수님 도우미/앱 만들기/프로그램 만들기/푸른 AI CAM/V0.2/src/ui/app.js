/* =====================================================================
 * 푸른 AI CAM - [통합 화면] ui/app.js
 * 역할: 5분할 통합 화면(입력 패널·공정 카드·검증 결과·G코드), 마우스/터치 입력, 설정·관리자·공유·버전.
 *       저장은 ui/storage.js, 그리기는 ui/graphics.js, 계산·생성·검증은 PCAM 엔진 모듈만 사용한다.
 * 계산·G코드 생성·검증은 core.js(PCAM)만 사용하고, 이 파일은 입력·표시·저장만 담당한다.
 * 모든 데이터는 이 브라우저의 localStorage 에만 저장된다 (외부 서버 전송 없음).
 * ===================================================================== */
(function () {
  'use strict';
  const C = window.PCAM;
  const CHANGELOG = [
    { v: 'V0.2', d: C.BUILD_DATE, items: ['기능별 모듈 구조: 공통 엔진·가공 모듈(6종)·공정 관리·포스트프로세서·검증·저장·그래픽 분리', '안전 강화: 소재 관통 급속/G01 이동, 탭 기초 구멍·절삭 조건(수정 NC 포함), 좌표계, G94, M29 주축 정지, N번호 5자리 검사', '수정 NC 재검증 결과를 소재·장비 변경 시 자동 갱신, 검증 전 G코드 복사 차단', '개발 예정 가공(평면·사각/원형 포켓·외곽) 목록 표시, 미지원 가공은 드릴로 바꾸지 않고 제외'] },
    { v: 'V0.1', d: '2026-11-27', items: ['최초 버전: FANUC 3축 2.5축 홀 가공(G81·G82·G73·G83·G84·M29 리지드 탭)', '홀 배열(개별·직선·사각·PCD), 공정 묶음, 공구·장비 관리', '11개 항목 자동 검증, 독립 NC 해석 검증, 오류 시 NC 생성 차단', '로컬 저장·JSON 백업/복원, 공유·QR코드, 숨겨진 관리자 설정'] }
  ];

  /* ---------------- 상태 ---------------- */
  let DB = null;           // 저장 데이터
  let P = null;            // 현재 프로젝트
  const S = {
    leftTab: 'stock', bottomTab: 'check', mpanel: 'view', mode: 'select',
    sel: { gid: null, hid: null }, arrKind: 'single', arr: {},
    bundleSel: null, pathStep: 0, showPath: true, showNC: false,
    view: { scale: 3, cx: 75, cy: 50, fitted: false },
    undo: [], redo: [],
    V: null, nc: { text: '', hits: [], blocked: '', verify: null, edited: false, editText: '', editVerify: null },
    admin: { authed: false, until: 0, clicks: [] }
  };
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmtN = v => (C.isNum(v) ? String(C.r3(v)) : '');

  /* ---------------- 저장소 ---------------- */
  // 저장 모듈 (ui/storage.js)
  const ST = window.PCAM_UI.createStorage(toast);
  const { DB_KEY, ADMIN_KEY, lsGet, lsSet, freshDB, loadDB, adminRec, b64, unb64, pbkdf2, safeEq, pwRule } = ST;
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
      select(val, opts, fn, a) { const k = key(); binds.set(k, el => fn(el.value)); return '<select data-k="' + k + '" ' + (a || '') + '>' + opts.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + (o[2] ? ' disabled' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>'; },
      check(val, fn, label, a) { const k = key(); binds.set(k, el => fn(el.checked)); return '<label class="chk"><input type="checkbox" data-k="' + k + '"' + (val ? ' checked' : '') + ' ' + (a || '') + '>' + esc(label) + '</label>'; },
      btn(label, fn, cls, a) { const k = key(); acts.set(k, fn); return '<button type="button" data-a="' + k + '" class="' + (cls || '') + '" ' + (a || '') + '>' + label + '</button>'; },
      fld(label, inner) { return '<label class="fld"><span>' + esc(label) + '</span>' + inner + '</label>'; }
    };
  }
  // change 처리는 포커스 이동(Tab) 이후 실행하여 다음 입력칸 포커스를 유지
  document.addEventListener('change', e => { const el = e.target, k = el && el.dataset && el.dataset.k; if (k && binds.has(k)) { const fn = binds.get(k); setTimeout(() => fn(el), 0); } });
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-a]'); if (b && acts.has(b.dataset.a) && !b.disabled) { e.preventDefault(); acts.get(b.dataset.a)(e, b); } });

  /* ---------------- 변경·되돌리기 ---------------- */
  function mutate(fn, keepNC) {
    S.undo.push(JSON.stringify(P)); if (S.undo.length > 50) S.undo.shift();
    S.redo = [];
    fn();
    P.updatedAt = new Date().toISOString();
    saveDB();
    renderAll();
  }
  function undo() { if (!S.undo.length) return; S.redo.push(JSON.stringify(P)); P = C.normalizeProject(JSON.parse(S.undo.pop())); saveDB(); renderAll(); toast('되돌렸습니다.'); }
  function redo() { if (!S.redo.length) return; S.undo.push(JSON.stringify(P)); P = C.normalizeProject(JSON.parse(S.redo.pop())); saveDB(); renderAll(); toast('다시 실행했습니다.'); }
  function dbChange(fn) { fn(); saveDB(); renderAll(); }

  /* ---------------- 알림 ---------------- */
  function toast(msg, kind) {
    const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg;
    $('#toasts').appendChild(t); setTimeout(() => t.remove(), kind === 'err' ? 5000 : 2600);
  }
  function beep() {
    if (!DB.settings.sound) return;
    try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(), g = a.createGain(); o.frequency.value = 440; o.type = 'square'; g.gain.value = 0.05; o.connect(g); g.connect(a.destination); o.start(); setTimeout(() => { o.stop(); a.close(); }, 250); } catch (e) { /* 소리 미지원 */ }
  }

  /* ---------------- 재계산 (검증·생성·독립 검증) ---------------- */
  function recompute() {
    const m = machine();
    S.V = C.validateProject(P, m);
    const g = C.generateNC(P, m, S.V.plan);
    S.nc.text = g.text; S.nc.hits = g.hits; S.nc.blocked = g.blocked || '';
    S.nc.verify = g.text ? C.verifyNC(g.text, { stock: P.stock, machine: m, clamps: P.clamps, settings: P.settings, expected: g.hits }) : null;
    // 재검증한 수정본도 소재·장비·클램프가 바뀌면 현재 조건으로 다시 검사 (이전 통과 결과 재사용 금지)
    if (S.nc.edited && S.nc.editVerify) S.nc.editVerify = C.verifyNC(S.nc.editText, { stock: P.stock, machine: m, clamps: P.clamps, settings: P.settings, expected: null });
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
    renderTop(); renderLeft(); renderRight(); renderVTools(); renderBottom(); drawView();
    if (ak) { const el = document.querySelector('[data-k="' + ak + '"]'); if (el) el.focus(); }
  }
  function renderTop() {
    $('#verTag').textContent = C.VERSION;
    const pn = $('#projName'); if (document.activeElement !== pn) pn.value = P.name;
    $('#btnUndo').disabled = !S.undo.length; $('#btnRedo').disabled = !S.redo.length;
    const ds = downloadState(), b = $('#btnDownload');
    b.classList.toggle('primary', ds.ok);
    b.title = ds.ok ? (ds.test ? 'NC 다운로드 (검증용 표시)' : 'NC 다운로드') : 'NC 생성 차단: ' + ds.why;
    b.setAttribute('aria-disabled', ds.ok ? 'false' : 'true');
    document.querySelectorAll('#leftTabs button').forEach(x => x.classList.toggle('act', x.dataset.tab === S.leftTab));
    document.querySelectorAll('#bottomTabs button').forEach(x => x.classList.toggle('act', x.dataset.tab === S.bottomTab));
    document.querySelectorAll('#mnav button').forEach(x => x.classList.toggle('act', x.dataset.m === S.mpanel));
    document.querySelectorAll('.mpanel').forEach(x => x.classList.toggle('mact', x.id === S.mpanel));
    const c = counts(), bd = $('#chkBadge');
    const ne = c.e + c.ne;
    bd.className = 'badge ' + (ne ? 'err' : (c.w + c.nw ? 'warn' : 'ok'));
    bd.textContent = ne ? ne : (c.w + c.nw ? c.w + c.nw : '✓');
  }

  /* ---------------- 좌측: 소재·가공 ---------------- */
  function renderLeft() {
    const el = $('#leftBody');
    if (S.leftTab === 'stock') el.innerHTML = leftStock();
    else if (S.leftTab === 'machine') el.innerHTML = leftMachine();
    else el.innerHTML = leftBundle();
  }
  function leftStock() {
    const u = U('ls'), st = P.stock, set = P.settings;
    const matOpts = Object.keys(C.MATERIALS).map(k => [k, C.MATERIALS[k].label]);
    let h = '<h3>소재</h3>';
    h += u.fld('재질', u.select(st.material, matOpts, v => mutate(() => { st.material = v; })));
    h += '<div class="grid3" style="margin-top:6px">' +
      u.fld('가로 X (mm)', u.num(st.sx, v => mutate(() => { st.sx = v; }))) +
      u.fld('세로 Y (mm)', u.num(st.sy, v => mutate(() => { st.sy = v; }))) +
      u.fld('두께 Z (mm)', u.num(st.sz, v => mutate(() => { st.sz = v; }))) + '</div>';
    h += '<div class="grid2" style="margin-top:6px">' +
      u.fld('공작물 원점 (X0 Y0)', u.select(st.origin, Object.keys(C.ORIGIN_LABEL).map(k => [k, C.ORIGIN_LABEL[k]]), v => changeOrigin(v))) +
      u.fld('하부 여유 (패럴렐 틈, mm)', u.num(st.under, v => mutate(() => { st.under = v; }))) + '</div>';
    h += '<small>Z0 = 소재 윗면. 관통 가공 시 하부 여유보다 깊이 들어가면 차단됩니다.</small>';
    h += '<h3>NC 설정</h3><div class="grid2">' +
      u.fld('프로그램 번호 O', u.int(P.programNo, v => mutate(() => { P.programNo = v; }), 'min="1" max="9999"')) +
      u.fld('좌표계', u.select(set.wcs, ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].map(x => [x, x]), v => mutate(() => { set.wcs = v; }))) +
      u.fld('초기점 Z (안전 높이)', u.num(set.initialZ, v => mutate(() => { set.initialZ = v; }))) +
      u.fld('구멍 간 복귀', u.select(set.retract, [['G98', 'G98 초기점 복귀 (안전)'], ['G99', 'G99 R점 복귀 (빠름)']], v => mutate(() => { set.retract = v; }))) +
      u.fld('공정 순서', u.select(set.toolOrder, [['tool', '공구 교환 최소화'], ['group', '그룹 순서대로']], v => mutate(() => { set.toolOrder = v; }))) +
      u.fld('구멍 순서', u.select(set.pathOrder, [['nearest', '최단 거리(근사)'], ['zigzag', '지그재그(행)'], ['input', '입력 순서']], v => mutate(() => { set.pathOrder = v; }))) + '</div>';
    h += '<div class="grid2">' + u.check(set.coolant, v => mutate(() => { set.coolant = v; }), '절삭유 M08/M09') + u.check(set.m01, v => mutate(() => { set.m01 = v; }), '공구 교환 전 M01') +
      u.check(set.seqNo, v => mutate(() => { set.seqNo = v; }), '시퀀스 번호(N)') + '</div>';
    h += '<h3>클램프·금지 영역 <small>(공구 충돌 검사)</small></h3>';
    if (!P.clamps.length) h += '<small>클램프가 없습니다. 화면의 "클램프" 모드로 드래그하거나 아래 버튼으로 추가하세요.</small>';
    else {
      h += '<div class="tblwrap"><table class="tbl"><tr><th>#</th><th>X</th><th>Y</th><th>폭</th><th>길이</th><th>높이</th><th></th></tr>';
      P.clamps.forEach((c, i) => {
        h += '<tr><td>' + (i + 1) + '</td><td>' + u.num(c.x, v => mutate(() => { c.x = v; })) + '</td><td>' + u.num(c.y, v => mutate(() => { c.y = v; })) + '</td><td>' + u.num(c.w, v => mutate(() => { c.w = v; })) + '</td><td>' + u.num(c.h, v => mutate(() => { c.h = v; })) + '</td><td>' + u.num(c.height, v => mutate(() => { c.height = v; })) + '</td><td>' + u.btn('✕', () => mutate(() => { P.clamps.splice(i, 1); }), 'sm danger', 'title="클램프 삭제"') + '</td></tr>';
      });
      h += '</table></div><small>높이 = 소재 윗면(Z0) 기준 클램프 최고 높이. 초기점은 클램프보다 ' + C.CLAMP_MARGIN + 'mm 이상 높아야 합니다.</small>';
    }
    h += '<div class="row" style="margin-top:6px">' + u.btn('+ 클램프 추가', () => mutate(() => { const r = C.stockRect(P.stock); P.clamps.push({ id: C.uid('c'), x: r.x0 - 10, y: (r.y0 + r.y1) / 2 - 10, w: 20, h: 20, height: 30 }); })) + '</div>';
    return h;
  }
  function changeOrigin(v) {
    const st = P.stock;
    if (v === st.origin) return;
    const a = C.stockRect(st), b = C.stockRect(Object.assign({}, st, { origin: v }));
    const hasItems = P.groups.some(g => g.holes.length) || P.clamps.length;
    const keep = hasItems ? confirm('원점을 바꿉니다.\n[확인] 홀·클램프를 소재 위 같은 위치에 유지 (좌표 자동 변환)\n[취소] 좌표값 그대로 유지') : false;
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

  /* ---------------- 좌측: 장비·공구 ---------------- */
  function leftMachine() {
    const u = U('lm'), m = machine();
    let h = '<h3>장비 선택</h3><div class="row">' +
      u.select(m.id, DB.machines.map(x => [x.id, x.name + (x.verified ? ' ✔' : '')]), v => mutate(() => { P.machineId = v; })) + '</div>';
    h += '<div class="row" style="margin-top:6px">' +
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
      u.fld('매거진 공구 수', u.int(m.magazine, dm(v => { m.magazine = v; }))) + u.fld('제어기 (포스트프로세서)', u.select(m.control, C.POST.all().map(x => [x.id, x.label, x.status !== 'ready']), dm(v => { if (C.POST.get(v)) m.control = v; }))) + '</div>';
    h += u.check(m.rigidTap, dm(v => { m.rigidTap = v; }), '리지드 탭(M29) 지원') + u.check(m.rigidM03, dm(v => { m.rigidM03 = v; }), '리지드 탭 전에 S__ M03 출력 (장비 파라미터에 따름)') + u.check(m.endY, dm(v => { m.endY = v; }), '종료 시 Y축 원점 복귀 (G91 G28 Y0.)');

    h += '<h3>공구 목록 <small>(' + m.tools.length + '개)</small></h3><div class="tblwrap" style="max-height:340px"><table class="tbl"><tr><th>T</th><th>종류</th><th>직경</th><th>각/피치</th><th>재질</th><th>날장</th><th></th></tr>';
    m.tools.slice().sort((a, b) => a.no - b.no).forEach(t => {
      h += '<tr><td style="width:52px">' + u.int(t.no, dm(v => { t.no = v; })) + '</td><td>' + u.select(t.type, Object.keys(C.TOOL_TYPES).map(k => [k, C.TOOL_TYPES[k]]), dm(v => { const n = C.normalizeTool(Object.assign({}, t, { type: v })); Object.keys(t).forEach(k => delete t[k]); Object.assign(t, n); })) + '</td>' +
        '<td>' + u.num(t.dia, dm(v => { t.dia = v; })) + '</td>' +
        '<td>' + (t.type === 'tap' ? u.num(t.pitch, dm(v => { t.pitch = v; }), 'title="피치(mm)"') : u.num(t.angle, dm(v => { t.angle = v; }), 'title="선단각(°)"')) + '</td>' +
        '<td>' + u.select(t.mat, [['HSS', 'HSS'], ['CARBIDE', '초경']], dm(v => { t.mat = v; })) + '</td>' +
        '<td>' + u.num(t.flute, dm(v => { t.flute = v; }), 'title="유효 날 길이(mm)"') + '</td>' +
        '<td>' + u.btn('✕', () => { if (confirm('T' + t.no + ' 공구를 삭제할까요?')) dm(() => { m.tools.splice(m.tools.indexOf(t), 1); })(); }, 'sm danger') + '</td></tr>';
    });
    h += '</table></div><div class="row" style="margin-top:6px">' + u.btn('+ 드릴', () => addTool('drill'), 'sm') + u.btn('+ 탭', () => addTool('tap'), 'sm') + u.btn('+ 센터 드릴', () => addTool('center'), 'sm') + '</div>';
    h += '<small>직경: 탭은 호칭경(M8 → 8). 각/피치: 드릴은 선단각, 탭은 피치. 날장: 가공 가능한 최대 깊이.</small>';

    // 기초 드릴 추천
    S.tdc = S.tdc || { d: 8, p: 1.25 };
    const rec = C.tapDrill(S.tdc.d, S.tdc.p);
    h += '<h3>미터 나사 기초 드릴 추천</h3><div class="grid3">' +
      u.fld('호칭경 M', u.num(S.tdc.d, v => { S.tdc.d = v; const c = C.METRIC_COARSE.find(r => r[0] === v); if (c) S.tdc.p = c[1]; renderLeft(); })) +
      u.fld('피치', u.num(S.tdc.p, v => { S.tdc.p = v; renderLeft(); })) +
      '<div class="fld"><span>추천 드릴</span><b style="font-size:1.2em">' + (rec ? 'Ø' + rec.dia : '-') + '</b></div></div>' +
      '<small>' + (rec ? esc(rec.name + ' ' + rec.kind + ' · 절삭 탭 기준 (D − P). 전조(롤) 탭은 별도 표 사용') : '호칭경을 입력하세요') + '</small>';
    return h;
    function addTool(type) {
      const used = new Set(m.tools.map(t => t.no)); let no = 1; while (used.has(no)) no++;
      dbChange(() => { m.tools.push(C.normalizeTool({ no, type, dia: type === 'tap' ? 6 : 5, pitch: 1, angle: type === 'center' ? 90 : 118, flute: type === 'center' ? 10 : 40, name: '' })); if (m.verified) m.verified = false; });
    }
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
          op.type = v; const ok = m.tools.filter(x => C.OP_TYPES[v].tools.includes(x.type));
          const cur = tm.get(op.toolNo); if (!cur || !C.OP_TYPES[v].tools.includes(cur.type)) { if (ok.length) op.toolNo = ok[0].no; }
          if (C.isTapOp(v) && op.r < 5) op.r = 5;
        }))) +
        u.fld('공구', u.select(op.toolNo, toolOpts, set(v => { op.toolNo = parseInt(v, 10); }))) + '</div>';
      h += '<div class="grid3" style="margin-top:4px">' +
        u.fld(op.thru ? '깊이 (관통 자동)' : '깊이 (mm)', u.num(op.depth, set(v => { op.depth = v; }), op.thru ? 'disabled' : '')) +
        u.fld('R점 (상면 위)', u.num(op.r, set(v => { op.r = v; }))) +
        (def.ui.q ? u.fld('펙 Q (mm)', u.num(op.q, set(v => { op.q = v; }))) :
          (def.ui.dwell ? u.fld('드웰 P (ms, G82)', u.int(op.dwell, set(v => { op.dwell = v; }))) : '<span></span>')) + '</div>';
      if (def.ui.thru) {
        h += '<div class="row">' + u.check(op.thru, set(v => { op.thru = v; }), '관통') + (op.thru ? u.fld('관통 여유(mm)', u.num(op.brk, set(v => { op.brk = v; }), 'style="width:80px"')) : '') +
          (def.ui.depthMode && !op.thru ? u.select(op.depthMode, [['tip', '깊이 = 공구 끝'], ['full', '깊이 = 직경부(끝각 자동 추가)']], set(v => { op.depthMode = v; })) : '') + '</div>';
      }
      const cnd = C.opConditions(op, t, st.material, m);
      h += '<div class="grid3" style="margin-top:4px;align-items:end">' + u.check(op.auto, set(v => { op.auto = v; if (!v) { op.rpm = cnd.rpm; op.feed = cnd.feed; } }), '자동 추천') +
        u.fld('회전수 S', op.auto ? '<input type="text" value="' + cnd.rpm + '" disabled>' : u.num(op.rpm, set(v => { op.rpm = v; }))) +
        u.fld(isTp ? '이송 F (=S×P)' : '이송 F (mm/min)', (op.auto || isTp) ? '<input type="text" value="' + cnd.feed + '" disabled>' : u.num(op.feed, set(v => { op.feed = v; })) ) + '</div>';
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

  /* ---------------- 좌측: 공정 묶음 ---------------- */
  function leftBundle() {
    const u = U('lb');
    let h = '<h3>공정 묶음 <small>(반복 공정 프리셋)</small></h3><div class="glist">';
    DB.bundles.forEach((b, i) => {
      h += '<div class="card' + (S.bundleSel === b.id ? ' sel' : '') + '"><div class="head"><b>' + esc(b.name) + '</b>' +
        u.btn('편집', () => { S.bundleSel = S.bundleSel === b.id ? null : b.id; renderLeft(); }, 'sm') +
        u.btn('↑', () => dbChange(() => { if (i > 0) DB.bundles.splice(i - 1, 0, DB.bundles.splice(i, 1)[0]); }), 'sm', i ? '' : 'disabled') +
        u.btn('↓', () => dbChange(() => { if (i < DB.bundles.length - 1) DB.bundles.splice(i + 1, 0, DB.bundles.splice(i, 1)[0]); }), 'sm', i < DB.bundles.length - 1 ? '' : 'disabled') + '</div>' +
        '<small>' + esc(b.desc || b.ops.map(o => C.OP_TYPES[o.type].label).join(' → ')) + '</small></div>';
      if (S.bundleSel === b.id) {
        h += '<div class="card sel">' + u.fld('이름', u.text(b.name, v => dbChange(() => { b.name = v.slice(0, 60) || '공정 묶음'; }))) +
          u.fld('설명', u.text(b.desc, v => dbChange(() => { b.desc = v.slice(0, 200); }))) +
          opCards(u, b.ops, fn => dbChange(fn), { template: true }) +
          '<div class="row end">' + u.btn('복제', () => dbChange(() => { const n = C.normalizeBundle(C.clone(b)); n.id = C.uid('b'); n.name = b.name + ' 복사'; DB.bundles.splice(i + 1, 0, n); }), 'sm') +
          u.btn('삭제', () => { if (confirm('"' + b.name + '" 묶음을 삭제할까요?')) dbChange(() => { DB.bundles.splice(i, 1); S.bundleSel = null; }); }, 'sm danger') + '</div></div>';
      }
    });
    h += '</div><div class="row" style="margin-top:6px">' +
      u.btn('+ 새 묶음', () => dbChange(() => { const n = C.normalizeBundle({ name: '새 공정 묶음', ops: [] }); DB.bundles.push(n); S.bundleSel = n.id; }), 'sm') +
      u.btn('적합성 확인', () => openFitReport(), 'sm') +
      u.btn('⬇ 내보내기', () => downloadText('pureun-cam-bundles.json', JSON.stringify({ type: 'pcam-bundles', version: C.VERSION, bundles: DB.bundles }, null, 1), 'application/json'), 'sm') +
      u.btn('⬆ 가져오기', () => pickFile('.json', txt => {
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
      r.issues.forEach(i => { h += '<div class="' + i.level + '" style="color:var(--' + (i.level === 'error' ? 'err' : 'warn') + ')"><small>• ' + esc(i.msg.replace('[적합성 확인] ', '')) + '</small></div>'; });
      if (r.ok && !r.notes.length && !r.issues.length) h += '<small>문제 없음</small>';
      h += '</div>';
    });
    if (!DB.bundles.length) h += '<p>등록된 공정 묶음이 없습니다.</p>';
    // 현재 프로젝트 공정
    const cur = S.V.issues.filter(i => [4, 5, 6, 7, 8, 9].includes(i.cat) && i.level !== 'info');
    h += '<h3>현재 프로젝트 공정</h3>' + (cur.length ? cur.map(i => '<div style="color:var(--' + (i.level === 'error' ? 'err' : 'warn') + ')"><small>• ' + esc(i.msg) + '</small></div>').join('') : '<small>문제 없음</small>');
    openDlg('적합성 확인 (소재·장비 변경 점검)', h);
  }

  /* ---------------- 우측: 홀 그룹·공정·배열 ---------------- */
  function curGroup() { return P.groups.find(g => g.id === S.sel.gid) || null; }
  function renderRight() {
    const u = U('rt');
    if (!curGroup() && P.groups.length) S.sel.gid = P.groups[0].id;
    const g = curGroup();
    let h = '<h3>홀 그룹 <small>(같은 공정을 쓰는 홀 묶음)</small></h3><div class="glist">';
    P.groups.forEach((x, i) => {
      h += '<div class="card' + (x === g ? ' sel' : '') + '" data-a="' + regAct(u, () => { S.sel = { gid: x.id, hid: null }; renderAll(); }) + '"><div class="head"><span class="dot" style="background:' + esc(x.color) + '"></span><b>' + esc(x.name) + '</b><small>' + x.holes.length + '홀 · ' + x.ops.length + '공정</small>' +
        u.btn('↑', () => mutate(() => { if (i > 0) P.groups.splice(i - 1, 0, P.groups.splice(i, 1)[0]); }), 'sm', i ? '' : 'disabled') +
        u.btn('✕', () => { if (confirm('"' + x.name + '" 그룹(홀 ' + x.holes.length + '개)을 삭제할까요?')) mutate(() => { P.groups.splice(i, 1); S.sel = { gid: null, hid: null }; }); }, 'sm danger') + '</div></div>';
    });
    h += '</div>' + u.btn('+ 홀 그룹 추가', () => mutate(() => { const n = C.newGroup('홀 그룹 ' + (P.groups.length + 1), P.groups.length); P.groups.push(n); S.sel = { gid: n.id, hid: null }; }), 'sm');
    if (g) {
      h += '<hr><div class="grid2">' + u.fld('그룹 이름', u.text(g.name, v => mutate(() => { g.name = v.slice(0, 40) || '홀 그룹'; }))) +
        u.fld('색상', '<input type="color" data-k="' + regBind(u, el => mutate(() => { g.color = el.value; })) + '" value="' + esc(g.color) + '">') + '</div>';
      h += '<h3>공정 묶음 적용</h3><div class="row">' + u.select(S.applyB || '', [['', '묶음 선택...']].concat(DB.bundles.map(b => [b.id, b.name])), v => { S.applyB = v; }) +
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
      h += '<h3>공정 <small>(위에서부터 순서대로 가공)</small></h3>' + opCards(u, g.ops, fn => mutate(fn));
      h += '<h3>홀 추가</h3><div class="subtabs">' + [['single', '개별'], ['line', '직선'], ['grid', '사각'], ['pcd', 'PCD']].map(k => u.btn(k[1], () => { S.arrKind = k[0]; renderRight(); }, 'sm' + (S.arrKind === k[0] ? ' on' : ''))).join('') + '</div>';
      h += arrayForm(u, g);
      h += '<h3>홀 목록 <small>(' + g.holes.length + '개)</small></h3>';
      if (g.holes.length) {
        const lim = 300;
        h += '<div class="tblwrap"><table class="tbl"><tr><th>#</th><th>X</th><th>Y</th><th></th></tr>';
        g.holes.slice(0, lim).forEach((hh, i) => {
          h += '<tr class="' + (S.sel.hid === hh.id ? 'sel' : '') + '"><td>' + u.btn(String(i + 1), () => { S.sel.hid = hh.id; renderAll(); }, 'sm', 'title="화면에서 선택"') + '</td><td>' + u.num(hh.x, v => mutate(() => { hh.x = C.r3(v); })) + '</td><td>' + u.num(hh.y, v => mutate(() => { hh.y = C.r3(v); })) + '</td><td>' + u.btn('✕', () => mutate(() => { g.holes.splice(i, 1); }), 'sm danger', 'title="홀 삭제"') + '</td></tr>';
        });
        h += '</table></div>' + (g.holes.length > lim ? '<small>처음 ' + lim + '개만 표시 (화면에서 선택·편집 가능)</small>' : '');
        h += '<div class="row" style="margin-top:6px">' + u.btn('전체 삭제', () => { if (confirm('이 그룹의 홀 ' + g.holes.length + '개를 모두 삭제할까요?')) mutate(() => { g.holes = []; }); }, 'sm danger') + '</div>';
      } else h += '<small>홀이 없습니다. 위 입력란을 쓰거나, 화면 위쪽 "홀 추가" 모드에서 클릭/터치하세요.</small>';
    } else h += '<p><small>홀 그룹을 추가하세요.</small></p>';
    $('#rightBody').innerHTML = h;
  }
  function regAct(u, fn) { const k = 'rt:x' + Math.random().toString(36).slice(2, 9); acts.set(k, fn); return k; }
  function regBind(u, fn) { const k = 'rt:b' + Math.random().toString(36).slice(2, 9); binds.set(k, fn); return k; }
  function arrayForm(u, g) {
    const k = S.arrKind, a = S.arr[k] = S.arr[k] || ({ single: { x: 10, y: 10 }, line: { x: 10, y: 10, pitch: 20, angle: 0, count: 5 }, grid: { x: 10, y: 10, px: 20, py: 20, nx: 4, ny: 3 }, pcd: { cx: 50, cy: 50, dia: 60, count: 6, start: 0 } })[k];
    const f = (lbl, key, int) => u.fld(lbl, (int ? u.int : u.num)(a[key], v => { a[key] = v; }));
    let h = '';
    if (k === 'single') h = '<div class="grid2">' + f('X', 'x') + f('Y', 'y') + '</div>';
    if (k === 'line') h = '<div class="grid3">' + f('시작 X', 'x') + f('시작 Y', 'y') + f('간격', 'pitch') + f('각도(°)', 'angle') + f('개수', 'count', 1) + '</div>';
    if (k === 'grid') h = '<div class="grid3">' + f('시작 X', 'x') + f('시작 Y', 'y') + '<span></span>' + f('X 간격', 'px') + f('Y 간격', 'py') + '<span></span>' + f('X 개수', 'nx', 1) + f('Y 개수', 'ny', 1) + '</div>';
    if (k === 'pcd') h = '<div class="grid3">' + f('중심 X', 'cx') + f('중심 Y', 'cy') + f('PCD 직경', 'dia') + f('개수', 'count', 1) + f('시작각(°)', 'start') + '</div>';
    h += '<div class="row" style="margin-top:6px">' + u.btn('홀 추가', () => {
      const e = C.checkArrayParams(k, a); if (e.length) return toast(e[0], 'err');
      const pts = k === 'single' ? [{ x: C.r3(a.x), y: C.r3(a.y) }] : k === 'line' ? C.genLine(a) : k === 'grid' ? C.genGrid(a) : C.genPCD(a);
      const total = P.groups.reduce((s, x) => s + x.holes.length, 0);
      if (total + pts.length > C.MAX_HOLES) return toast('프로젝트 홀 수는 최대 ' + C.MAX_HOLES + '개입니다.', 'err');
      mutate(() => { pts.forEach(p => g.holes.push({ id: C.uid('h'), x: p.x, y: p.y })); });
      toast(pts.length + '개 홀을 추가했습니다.', 'ok');
    }, 'primary sm') + '<small>좌표는 공작물 원점(' + esc(C.ORIGIN_LABEL[P.stock.origin]) + ') 기준</small></div>';
    return h;
  }

  /* ---------------- 하단: 검증 결과·G코드 ---------------- */
  function renderBottom() {
    const el = $('#bottomBody');
    if (S.bottomTab === 'check') el.innerHTML = bottomCheck(); else { el.innerHTML = bottomCode(); bindCode(); }
  }
  function bottomCheck() {
    U('bc'); // 이 영역의 이전 핸들러 정리
    const c = counts(), ds = downloadState(), iss = S.V.issues;
    let h = '';
    if (!ds.ok) h += '<div class="banner err">✖ NC 파일 생성 차단 — ' + esc(ds.why) + '. 아래 오류를 해결하세요.</div>';
    else if (ds.test || c.w || c.nw) h += '<div class="banner warn">⚠ NC 다운로드 가능' + (ds.test ? ' — <u>검증용(TEST)</u> 표시: 장비 실가공 검증 전' : '') + (c.w + c.nw ? ' · 경고 ' + (c.w + c.nw) + '건 확인' : '') + '</div>';
    else h += '<div class="banner ok">✔ 모든 자동 검증 통과 — NC 다운로드 가능</div>';
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
        '<li class="info">해석된 구멍 ' + vr.hits.length + '개' + (vr.match === true ? ' · 생성기 계산과 100% 일치 (교차 검증)' : vr.match === false ? ' · 생성기 계산과 불일치' : ' · 수정본은 교차 검증 대상 아님') + '</li></ul></details>';
    }
    const m = machine();
    const st = (ok, label, detail) => '<div class="stage"><span class="ic ' + (ok === true ? 'ok">✔' : ok === false ? 'err">✖' : 'warn">⚠') + '</span><div><b>' + label + '</b><br><small>' + detail + '</small></div></div>';
    h += '<b style="display:block;margin-top:10px">5단계 검증 절차</b>' +
      st(true, '① 코드 알고리즘', '계산식·생성기 자동 테스트 (개발 단계 수행, 테스트 결과 문서 참조)') +
      st(vr ? !vr.errors.some(x => /해석|소수점|주소|코드|형식|괄호/.test(x.msg)) : false, '② NC 문법', 'FANUC 주소·소수점·지원 코드 검사') +
      st(vr ? !vr.errors.some(x => /충돌|범위|경로|급속|하강|바닥/.test(x.msg)) : false, '③ 이동 경로', '모달 상태 시뮬레이션: 소재·클램프·하부 충돌') +
      st(c.e === 0, '④ 입력값 한계', '좌표·깊이·조건·장비 한계 (모델 검증 11항목)') +
      st(m.verified ? true : null, '⑤ 실장비 테스트', m.verified ? '검증 완료: ' + esc(m.verifiedBy) + ' ' + esc(m.verifiedAt) : '미실시 — 드라이런(Z 띄움)·싱글 블록·시편 가공 후 관리자 승인 필요');
    h += '<p><small>자동 검증은 실제 가공 안전을 보장하지 않습니다. 최초 가공은 반드시 작업자가 공회전·싱글 블록으로 확인하세요.</small></p></div></div>';
    return h;
  }
  function regActBc(ref) { const k = 'bc:r' + Math.random().toString(36).slice(2, 9); acts.set(k, () => { if (!ref) return; if (ref.gid) S.sel.gid = ref.gid; S.sel.hid = ref.hid || null; if (window.innerWidth <= 900) S.mpanel = ref.hid ? 'view' : 'right'; renderAll(); }); return k; }
  function regActLine(line) { const k = 'bc:l' + Math.random().toString(36).slice(2, 9); acts.set(k, () => { S.bottomTab = 'code'; renderAll(); gotoLine(line); }); return k; }
  function gotoLine(line) {
    const ta = $('#ncText'); if (!ta || !line) return;
    const lines = ta.value.split('\n'); let pos = 0; for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    ta.focus(); ta.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
    ta.scrollTop = Math.max(0, (line - 4) * 18);
  }
  function bottomCode() {
    const u = U('cd'), ds = downloadState();
    const text = S.nc.edited ? S.nc.editText : S.nc.text;
    let h = '<div class="codebar">' +
      u.btn('⟳ 다시 생성', () => { if (S.nc.edited && !confirm('수정한 내용이 사라지고 현재 설정으로 다시 생성합니다.')) return; S.nc.edited = false; S.nc.editText = ''; S.nc.editVerify = null; renderAll(); toast('G코드를 다시 생성했습니다.'); }, 'sm') +
      u.btn('⧉ 복사', () => { const st = downloadState(); if (!st.ok) { beep(); return toast('복사 차단: ' + st.why + ' (검증을 통과한 G코드만 복사할 수 있습니다)', 'err'); } copyText(text); }, 'sm', ds.ok ? '' : 'aria-disabled="true" title="검증 통과 후 복사 가능"') +
      u.btn(S.nc.edited ? '✎ 편집 중' : '✎ 직접 수정', () => {
        if (!S.nc.text) return toast('먼저 오류를 해결하여 G코드를 생성하세요.', 'err');
        if (!S.nc.edited) { if (!confirm('G코드를 직접 수정하면 기존 검증 결과가 무효화되고, 다운로드 전에 재검증이 필요합니다.\n계속할까요?')) return; S.nc.edited = true; S.nc.editText = S.nc.text; S.nc.editVerify = null; renderAll(); }
      }, 'sm' + (S.nc.edited ? ' on' : '')) +
      (S.nc.edited ? u.btn('✔ 수정본 재검증', () => { reverify(); }, 'sm primary') : '') +
      u.btn('⬇ NC 다운로드', () => doDownload(), ds.ok ? 'sm primary' : 'sm') +
      '<small>' + (S.nc.edited ? (S.nc.editVerify ? (S.nc.editVerify.errors.length ? '<span style="color:var(--err)">재검증 오류 ' + S.nc.editVerify.errors.length + '건</span>' : '<span style="color:var(--ok)">재검증 통과</span>') : '<span style="color:var(--warn)">수정됨 · 재검증 필요</span>') : (S.nc.blocked ? esc(S.nc.blocked) : (text.split('\n').length + '줄 · 설정 변경 시 자동 갱신'))) + '</small></div>';
    h += '<div class="codewrap"><div class="gutter" id="ncGutter"></div><textarea id="ncText" spellcheck="false" aria-label="G코드" ' + (S.nc.edited ? 'class="edited"' : 'readonly') + '>' + esc(text) + '</textarea></div>';
    return h;
  }
  function bindCode() {
    const ta = $('#ncText'), gu = $('#ncGutter'); if (!ta) return;
    const upd = () => { const n = ta.value.split('\n').length; let s = ''; for (let i = 1; i <= n; i++) s += i + '\n'; gu.textContent = s; };
    upd();
    ta.addEventListener('scroll', () => { gu.scrollTop = ta.scrollTop; });
    ta.addEventListener('input', () => { if (!S.nc.edited) return; S.nc.editText = ta.value; if (S.nc.editVerify) { S.nc.editVerify = null; renderTop(); } upd(); const sm = ta.parentElement.previousElementSibling.querySelector('small'); if (sm) sm.innerHTML = '<span style="color:var(--warn)">수정됨 · 재검증 필요</span>'; });
  }
  function reverify() {
    const m = machine();
    S.nc.editVerify = C.verifyNC(S.nc.editText, { stock: P.stock, machine: m, clamps: P.clamps, settings: P.settings, expected: null });
    renderAll();
    const e = S.nc.editVerify.errors.length;
    toast(e ? '재검증 오류 ' + e + '건 — 다운로드 차단' : '재검증 통과', e ? 'err' : 'ok');
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
  function doDownload() {
    const ds = downloadState();
    if (!ds.ok) { beep(); toast('NC 생성 차단: ' + ds.why, 'err'); S.bottomTab = 'check'; if (window.innerWidth <= 900) S.mpanel = 'bottom'; renderAll(); return; }
    let text = S.nc.edited ? S.nc.editText : S.nc.text;
    if (S.nc.edited && !/USER EDITED/.test(text)) {
      const L = text.split(/\r?\n/), oi = L.findIndex(l => /^\s*O\d/.test(l));
      L.splice(oi >= 0 ? oi + 1 : 1, 0, '(USER EDITED - REVERIFIED ' + new Date().toISOString().slice(0, 10) + ')');
      text = L.join('\n');
    }
    const msg = (ds.test ? '이 NC는 실가공 검증 전 장비용 "검증용(TEST)" 파일입니다.\n\n' : '') +
      '가공 전 반드시 확인하세요:\n• 공구 길이·공작물 좌표계(' + P.settings.wcs + ') 보정값\n• Z를 띄운 드라이런(공회전), 싱글 블록 운전\n• 클램프·지그 위치와 소재 하부 여유\n\n다운로드할까요?';
    if (!confirm(msg)) return;
    const name = (ds.test ? 'TEST_' : '') + 'O' + String(P.programNo).padStart(4, '0') + '_' + (C.ncText(P.name, 20).replace(/[^A-Z0-9_-]+/g, '_') || 'PROGRAM') + (S.nc.edited ? '_EDIT' : '') + '.nc';
    downloadText(name, text.replace(/\r?\n/g, '\r\n') + '\r\n', 'text/plain');
    toast(name + ' 저장', 'ok');
  }

  /* ---------------- 그래픽 화면 ---------------- */
  const cv = () => $('#cv');
  function renderVTools() {
    const u = U('vt'), gs = DB.settings.grid;
    const stepOpts = [[0, '전체 경로']].concat((S.V.plan.steps || []).map(s => [s.idx, s.idx + '. ' + C.OP_TYPES[s.type].label + ' T' + s.toolNo + ' (' + s.holes.length + ')']));
    if (S.pathStep > S.V.plan.steps.length) S.pathStep = 0;
    $('#vtools').innerHTML =
      u.btn('↖ 선택', () => setMode('select'), 'sm' + (S.mode === 'select' ? ' on' : ''), 'title="선택·이동 (빈 곳 드래그 = 화면 이동)"') +
      u.btn('＋ 홀 추가', () => setMode('add'), 'sm' + (S.mode === 'add' ? ' on' : ''), 'title="클릭/터치한 위치에 홀 추가"') +
      u.btn('▭ 클램프', () => setMode('clamp'), 'sm' + (S.mode === 'clamp' ? ' on' : ''), 'title="드래그하여 클램프 영역 추가"') +
      u.btn('🗑', () => deleteSelectedHole(), 'sm', 'title="선택한 홀 삭제 (Delete)" ' + (S.sel.hid ? '' : 'disabled')) +
      '<span class="sep"></span>' +
      u.check(gs.show, v => dbChange(() => { gs.show = v; }), '격자') +
      u.check(gs.snap, v => dbChange(() => { gs.snap = v; }), '스냅') +
      u.select(gs.step, [[0.5, '0.5'], [1, '1'], [2, '2'], [2.5, '2.5'], [5, '5'], [10, '10']].map(x => [x[0], x[1] + 'mm']), v => dbChange(() => { gs.step = parseFloat(v); }), 'title="격자·스냅 간격"') +
      '<span class="sep"></span>' +
      u.btn('＋', () => zoom(1.25), 'sm', 'title="확대"') + u.btn('－', () => zoom(0.8), 'sm', 'title="축소"') + u.btn('맞춤', () => { fitView(); drawView(); }, 'sm', 'title="전체 보기"') +
      '<span class="sep"></span>' +
      u.check(S.showPath, v => { S.showPath = v; drawView(); }, '경로·순서') +
      u.select(S.pathStep, stepOpts, v => { S.pathStep = parseInt(v, 10); drawView(); }, 'title="표시할 공정"') +
      u.check(S.showNC, v => { S.showNC = v; drawView(); }, 'NC 해석');
    const hint = { select: '홀 클릭=선택 · 드래그=이동 · 빈 곳 드래그=화면 이동 · 휠/두 손가락=확대', add: '클릭/터치 위치에 [' + (curGroup() ? curGroup().name : '그룹 없음') + '] 홀 추가', clamp: '드래그하여 클램프 영역 지정 (높이 기본 30mm)' };
    $('#viewHint').textContent = hint[S.mode];
  }
  function setMode(m) { S.mode = m; renderVTools(); drawView(); }
  function deleteSelectedHole() {
    const g = curGroup(); if (!g || !S.sel.hid) return;
    const i = g.holes.findIndex(h => h.id === S.sel.hid); if (i < 0) return;
    mutate(() => { g.holes.splice(i, 1); S.sel.hid = null; });
  }
  // 그래픽 모듈 (ui/graphics.js)
  const G = window.PCAM_UI.createGraphics(() => ({ P, S, DB, drag, machine }));
  const canvasSize = G.size, w2s = G.w2s, s2w = G.s2w, fitView = G.fit, zoom = G.zoom, drawView = G.draw;
  function snap(v) { const gs = DB.settings.grid; return gs.snap ? C.r3(Math.round(v / gs.step) * gs.step) : C.r3(v); }
  function hitHole(px, py) {
    const tm = C.toolMap(machine()); let best = null, bd = Infinity;
    P.groups.forEach(g => { const d = C.holeDiaForGroup(g, tm) || 3; g.holes.forEach(h => { const [sx, sy] = w2s(h.x, h.y); const dist = Math.hypot(sx - px, sy - py); if (dist <= Math.max(10, d / 2 * S.view.scale) && dist < bd) { bd = dist; best = { g, h }; } }); });
    return best;
  }
  let drag = null; const ptrs = new Map(); let pinch = null;
  function initCanvas() {
    const c = cv();
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
        if (hit) { S.sel = { gid: hit.g.id, hid: hit.h.id }; drag = { kind: 'move', g: hit.g, h: hit.h, sx: px, sy: py, ox: hit.h.x, oy: hit.h.y, moved: false, snap: JSON.stringify(P) }; renderAll(); return; }
        drag = { kind: 'pan', sx: px, sy: py, cx: S.view.cx, cy: S.view.cy, click: true };
      } else if (S.mode === 'add') drag = { kind: 'add', sx: px, sy: py, w0 };
      else if (S.mode === 'clamp') drag = { kind: 'clamp', sx: px, sy: py, w0: [snap(w0[0]), snap(w0[1])], cur: null };
    });
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const [wx, wy] = s2w(px, py);
      $('#cursorPos').textContent = 'X ' + C.fmt(snap(wx)) + '  Y ' + C.fmt(snap(wy)) + (DB.settings.grid.snap ? ' (스냅)' : '');
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
        drag.moved = true; drag.h.x = snap(wx); drag.h.y = snap(wy); recompute(); drawView();
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
        if (!g) { toast('먼저 홀 그룹을 추가하세요.', 'err'); return; }
        const total = P.groups.reduce((s, x) => s + x.holes.length, 0);
        if (total >= C.MAX_HOLES) return toast('홀 수 한계 초과', 'err');
        const hid = C.uid('h');
        mutate(() => { g.holes.push({ id: hid, x: snap(d.w0[0]), y: snap(d.w0[1]) }); S.sel.hid = hid; });
      } else if (d.kind === 'clamp' && d.cur) {
        const w = d.cur[0] - d.w0[0], hh = d.cur[1] - d.w0[1];
        if (Math.abs(w) < 1 || Math.abs(hh) < 1) { drawView(); return; }
        mutate(() => { P.clamps.push({ id: C.uid('c'), x: Math.min(d.w0[0], d.cur[0]), y: Math.min(d.w0[1], d.cur[1]), w: Math.abs(w), h: Math.abs(hh), height: 30 }); });
        toast('클램프를 추가했습니다. 높이는 [소재·가공] 탭에서 수정하세요.', 'ok');
      } else drawView();
    };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { $('#cursorPos').textContent = ''; });
    window.addEventListener('resize', () => drawView());
    if (window.ResizeObserver) new ResizeObserver(() => drawView()).observe($('#canvasWrap'));
  }

  /* ---------------- 대화상자 ---------------- */
  function openDlg(title, body, foot, opts) {
    const d = $(opts && opts.second ? '#dlg2' : '#dlg');
    d.dataset.admin = '';
    const sc = opts && opts.second ? 'd2' : 'd1';
    const u = U(sc);
    const extra = opts && opts.head ? opts.head(u) : '';
    d.querySelector('div').innerHTML = '<div class="dhead">' + extra + '<h2>' + esc(title) + '</h2>' + u.btn('✕', () => closeDlg(d), 'sm', 'aria-label="닫기"') + '</div><div class="dbody">' + (typeof body === 'function' ? body(u) : body) + '</div>' + (foot ? '<div class="dfoot">' + foot(u) + '</div>' : '');
    if (!d.open) d.showModal();
    d.onclose = () => { if (opts && opts.onClose) opts.onClose(); };
    return d;
  }
  function closeDlg(d) { (d || $('#dlg')).close(); }

  /* ---------------- 프로젝트 관리 ---------------- */
  function openProjects() {
    openDlg('프로젝트', u => {
      const list = Object.values(DB.projects).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      let h = '<div class="row">' + u.btn('+ 새 프로젝트', () => { const n = C.newProject(machine()); DB.projects[n.id] = n; switchProject(n.id); closeDlg(); }, 'primary sm') +
        u.btn('⬇ 현재 프로젝트 파일로 내보내기', () => exportProject(), 'sm') +
        u.btn('⬆ 프로젝트 파일 가져오기', () => pickFile('.json', importProject), 'sm') + '</div>';
      h += '<table class="tbl" style="margin-top:8px"><tr><th>이름</th><th>홀</th><th>수정</th><th></th></tr>';
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
    S.undo = []; S.redo = []; S.sel = { gid: null, hid: null }; S.view.fitted = false; S.pathStep = 0;
    S.nc.edited = false; S.nc.editText = ''; S.nc.editVerify = null;
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
  }
  function openSettings() {
    S.admin.clicks = [];
    openDlg('설정', u => {
      const s = DB.settings;
      let h = '<div class="sect"><b>화면</b><div class="grid2">' +
        u.fld('테마', u.select(s.theme, [['system', '시스템 설정 따름'], ['light', '밝게'], ['dark', '어둡게']], v => { s.theme = v; applyTheme(); saveDB(); drawView(); })) +
        u.fld('글자 크기', u.select(s.fs, [['s', '작게'], ['m', '보통'], ['l', '크게']], v => { s.fs = v; applyTheme(); saveDB(); drawView(); })) + '</div></div>';
      h += '<div class="sect"><b>소리·언어</b>' + u.check(s.sound, v => { s.sound = v; saveDB(); if (v) beep(); }, 'NC 생성 차단·검증 오류 시 경고음') +
        u.fld('언어', u.select('ko', [['ko', '한국어']], () => { }, 'title="V0.1은 한국어만 지원"')) + '<small>NC 파일 주석은 장비 호환을 위해 영문으로 출력됩니다.</small></div>';
      h += '<div class="sect"><b>공유·버전</b><div class="row">' + u.btn('🔗 공유 링크·QR코드', () => openShare(), 'sm') + u.btn('⬆ 업그레이드 / 버전 정보', () => openVersion(), 'sm') + '</div>' +
        '<small class="ver">푸른 AI CAM ' + C.VERSION + ' (' + C.BUILD_DATE + ')</small></div>';
      h += '<div class="sect"><b>데이터 백업·복원</b><div class="row">' +
        u.btn('⬇ 전체 백업 (JSON)', () => backupAll(), 'sm') + u.btn('⬆ 백업 복원', () => pickFile('.json', restoreAll), 'sm') + '</div>' +
        '<small>프로젝트·공정 묶음·공구·장비 설정을 한 파일로 저장합니다. 인증 정보는 백업에 포함되지 않습니다.</small></div>';
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
    DB = nd; P = DB.projects[DB.currentProjectId];
    S.undo = []; S.redo = []; S.view.fitted = false; S.nc.edited = false;
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
        u.btn('⧉ 링크 복사', () => copyText(url), 'sm') + (navigator.share ? u.btn('공유하기', () => navigator.share({ title: '푸른 AI CAM', url }).catch(() => { }), 'sm') : '') +
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
        try { localStorage.removeItem(ADMIN_KEY); } catch (e) { }
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
          backupAll(); DB = freshDB(); P = DB.projects[DB.currentProjectId]; S.undo = []; S.redo = []; S.view.fitted = false; S.nc.edited = false;
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
    applyTheme();
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); drawView(); });
    $('#projName').addEventListener('change', e => mutate(() => { P.name = e.target.value.slice(0, 60) || '프로젝트'; }));
    $('#btnProjects').onclick = openProjects;
    $('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo;
    $('#btnDownload').onclick = doDownload;
    $('#btnShare').onclick = openShare;
    $('#btnSettings').onclick = openSettings;
    document.querySelectorAll('#leftTabs button').forEach(b => b.onclick = () => { S.leftTab = b.dataset.tab; renderAll(); });
    document.querySelectorAll('#bottomTabs button').forEach(b => b.onclick = () => { S.bottomTab = b.dataset.tab; renderAll(); });
    document.querySelectorAll('#mnav button').forEach(b => b.onclick = () => { S.mpanel = b.dataset.m; renderAll(); });
    document.addEventListener('keydown', e => {
      const tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && S.sel.hid && !document.querySelector('dialog[open]')) { e.preventDefault(); deleteSelectedHole(); }
      else if (!typing && e.key === 'Escape' && S.mode !== 'select') setMode('select');
      else if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); openAdminAuth(); } // 접근성용 대체 관리자 진입 (비밀번호 필요)
    });
    window.addEventListener('beforeunload', () => saveDB(true));
    initCanvas();
    renderAll();
    requestAnimationFrame(() => { S.view.fitted = false; drawView(); });
  }
  window.addEventListener('DOMContentLoaded', init);
  window.__PCAM_UI__ = { get P() { return P; }, get S() { return S; }, get DB() { return DB; }, renderAll, downloadState };
})();
