/* =====================================================================
 * 푸른 AI CAM - [포스트프로세서: FANUC] post/fanuc.js
 * 역할: 표준 가공 데이터(plan.steps[].toolpath) → FANUC 0i/31i 계열 G코드 텍스트
 *       - 모든 좌표·R·Q 소수점 강제, 주석 ASCII 만
 *       - 공구 교환: M09 M05 G91 G28 Z0. G90 (M01) T__ M06 → G43 Z초기점 H__
 *       - 리지드 탭: (S M03 옵션) M29 S__ 직후 G84
 * 의존: engine/common.js, post/registry.js
 * 다른 제어기(미쓰비시·지멘스 등)는 이 파일을 복사해 새 파일로 등록한다 (이 파일 수정 불필요).
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  const { VERSION, fmt, fmtF, r3, ncText, pad, ORIGIN_NC } = P;
  // 표준 사이클 종류 → FANUC 고정 사이클
  const CYCLE = { drill: 'G81', drillDwell: 'G82', peck: 'G73', deep: 'G83', tap: 'G84', rigidTap: 'G84', ream: 'G85' }; // [V0.6] 리머 G85, 보링은 장비에 따라 G76/G86

  function generate(project, machine, plan, opts) {
    const set = project.settings, st = project.stock;
    const B = [], hits = [], cuts = []; // B: { s: 블록, num: 시퀀스 번호 대상 }, cuts: 절삭 이동 끝점 (검증기 교차 비교용)
    let spinOn = false;
    const out = (s, numbered) => B.push({ s, num: numbered !== false && !!s && s[0] !== '(' && s !== '%' });
    const now = opts.date || new Date();
    const ds = now.getFullYear() + '-' + pad(now.getMonth() + 1, 2) + '-' + pad(now.getDate(), 2) + ' ' + pad(now.getHours(), 2) + ':' + pad(now.getMinutes(), 2);
    out('%', false);
    out('O' + pad(project.programNo, 4) + ' (' + (ncText(project.name, 24) || 'PROGRAM') + ')', false);
    out('(PUREUN AI CAM ' + VERSION + ' ' + ds + ')', false);
    // [V0.6] 승인: 가공 종류 × 앱 버전. 승인 없는 가공이 하나라도 있으면 TEST
    const ap = P.approvalOf(machine, plan);
    if (opts.part) out('(PART ' + opts.part.k + ' OF ' + opts.part.n + (opts.part.after ? ' - RUN ONLY AFTER O' + pad(opts.part.after, 4) : ' - RUN FIRST') + ')', false); // [V0.6 검토] 분할 파일 순서
    if (opts.forceTest && ap.ok) out('(*** TEST ONLY - WHOLE JOB NOT VERIFIED ***)', false);
    if (!ap.ok) out(ap.approved.length ? '(*** TEST ONLY - NOT VERIFIED: ' + ap.missing.map(k => (P.OPS.get(k) || {}).ncName || k).join(', ').slice(0, 90) + ' ***)' : '(*** TEST ONLY - MACHINE NOT VERIFIED ***)', false);
    const hashAt = B.length; // [V0.6] NC 해시 줄 자리 (마지막에 채움)
    out('(MACHINE: ' + (ncText(machine.name, 30) || 'MC') + ')', false);
    out('(MATERIAL: ' + ncText(st.material) + ' STOCK ' + fmt(st.sx) + ' X ' + fmt(st.sy) + ' X ' + fmt(st.sz) + ')', false);
    out('(' + set.wcs + ' X0Y0=' + ORIGIN_NC[st.origin] + ' Z0=TOP)', false);
    const used = [];
    plan.steps.forEach(s => { if (s.tool && !used.includes(s.tool)) used.push(s.tool); });
    const tname = t => t.type === 'tap' ? 'TAP M' + fmt(t.dia) + ' P' + fmt(t.pitch)
      : t.type === 'reamer' ? 'REAMER D' + fmt(t.dia) + ' ' + String(t.tol || 'H7').replace(/[^A-Za-z0-9]/g, '')
      : t.type === 'boring' ? 'BORING BAR D' + fmt(t.dia)
      : t.type === 'chamfer' ? 'CHAMFER MILL D' + fmt(t.dia) + ' A' + fmt(t.angle) + ' TIP D' + fmt(t.tip || 0)
        : (t.type === 'center' ? 'SPOT DRILL D' : t.type === 'endmill' ? 'FLAT ENDMILL D' : t.type === 'facemill' ? 'FACE MILL D' : 'DRILL D') + fmt(t.dia) + (t.type === 'endmill' || t.type === 'facemill' ? ' Z' + (t.z || 3) : '');
    used.forEach(t => out('(T' + pad(t.no, 2) + ' ' + tname(t) + ')', false));
    // [V0.6] 첫 가공 모드: 공정마다 진입 전 M00 정지, 절삭 이송을 지정 % 로 낮춤 (탭은 동기 이송이라 그대로)
    const firstRun = !!set.firstRun, fpct = Math.max(10, Math.min(100, Math.round(P.toNum(set.firstFeed, 50)))) / 100;
    const fF = f => firstRun ? Math.max(1, Math.round(f * fpct)) : f;
    if (firstRun) out('(FIRST RUN MODE - M00 BEFORE EACH OP, CUTTING FEED ' + Math.round(fpct * 100) + ' PERCENT)', false);
    const restart = !!set.restart; let nRestart = 0; // [V0.6] 공구별 재시작 블록 (N100, N200 …)
    // M00 은 장비에 따라 주축·절삭유를 멈추므로, 다시 지령
    // [V0.6 검토] 공구 교환 공정은 M06 바로 뒤(G43 이동 전)에 멈춰 H·G54 를 먼저 확인. 같은 공구 연속 공정은 진입 전에 멈춤
    const stopAt = (t, tp) => { if (firstRun) { out('(CHECK T' + pad(t.no, 2) + ' H' + pad(t.no, 2) + ' ' + set.wcs + ' - SINGLE BLOCK, CYCLE START)', false); out('M00'); if (spinOn) out('S' + tp.rpm + ' M03'); if (spinOn && set.coolant) out('M08'); } };
    out('G21');
    out('G00 G17 G40 G49 G80 G90 G94'); // G94: 분당 이송 (이전 프로그램의 G95 잔류 방지)
    out('G91 G28 Z0.');
    out('G90');
    plan.steps.forEach(s => {
      const t = s.tool, tp = s.toolpath;
      const code = tp.kind === 'bore' ? (machine.g76 !== false ? 'G76' : 'G86') : CYCLE[tp.kind];
      // 공구 교환·안전 이동 (공정 관리 모듈이 정한 toolChange 에 따름)
      if (s.toolChange && !s.first) {
        if (set.coolant) out('M09');
        out('M05'); spinOn = false;
        out('G91 G28 Z0.');
        out('G90');
        if (set.m01) out('M01');
      }
      out('(OP' + s.idx + ' ' + s.ncName + ' T' + pad(t.no, 2) + ' Z' + fmt(tp.z) + ' ' + s.holes.length + (tp.kind === 'path' ? ' ' + (P.OPS.get(s.type).ncUnit || 'POCKETS') + ')' : ' HOLES)'), false);
      if (tp.kind === 'tap' || tp.kind === 'rigidTap') out('(TAP - SET FEED AND SPINDLE OVERRIDE TO 100 PERCENT)', false); // 탭: 오버라이드 100% 안내
      if (s.toolChange && restart) { nRestart += 100; out('N' + nRestart + ' (RESTART T' + pad(t.no, 2) + ')', false); if (!s.first) { out('G91 G28 Z0.'); out('G90'); } } // [V0.6 검토] 재시작 시 Z 원점 복귀 후 교환
      if (s.toolChange) out('T' + pad(t.no, 2) + ' M06');
      if (s.toolChange && restart) out('G00 G17 G40 G49 G80 G90 G94'); // 재시작 시 모달 상태 초기화
      if (s.toolChange && firstRun) { out('(CHECK T' + pad(t.no, 2) + ' H' + pad(t.no, 2) + ' ' + set.wcs + ' BEFORE G43 - SINGLE BLOCK, CYCLE START)', false); out('M00'); }
      const stopHere = () => { if (!s.toolChange) stopAt(t, tp); };
      if (tp.kind === 'path') { pathBlock(s, t, tp); return; }
      const h0 = s.holes[0];
      const rigid = tp.kind === 'rigidTap';
      const spin = rigid && !machine.rigidM03 ? '' : ' S' + tp.rpm + ' M03';
      if (!s.toolChange) out('G00 Z' + fmt(set.initialZ)); // 같은 공구 연속 공정: 먼저 초기점으로 상승 후 XY 이동
      out('G00 G90 ' + set.wcs + ' X' + fmt(h0.x) + ' Y' + fmt(h0.y) + spin);
      if (spin) spinOn = true;
      if (s.toolChange) out('G43 Z' + fmt(set.initialZ) + ' H' + pad(t.no, 2) + (set.coolant ? ' M08' : ''));
      if (rigid && spinOn && !machine.rigidM03) { out('M05'); spinOn = false; } // FANUC: M29 는 주축 정지 상태에서 지령
      stopHere();
      if (rigid) out('M29 S' + tp.rpm);
      // [V0.5] 이미 깎인 면(포켓 바닥 등)에서 시작하는 구멍은 R점이 소재 윗면 아래 → 구멍 사이는 항상 초기점 복귀(G98)
      let first = (s.top < 0 ? 'G98' : 'G' + set.retract.slice(1)) + ' ' + code + ' X' + fmt(h0.x) + ' Y' + fmt(h0.y) + ' Z' + fmt(tp.z) + ' R' + fmt(tp.r);
      if (code === 'G73' || code === 'G83' || code === 'G76') first += ' Q' + fmt(tp.q);
      if (code === 'G82') first += ' P' + tp.dwell;
      first += ' F' + fmtF(rigid || tp.kind === 'tap' ? tp.feed : fF(tp.feed));
      out(first);
      hits.push({ t: t.no, x: r3(h0.x), y: r3(h0.y), z: tp.z, r: tp.r, code });
      for (let i = 1; i < s.holes.length; i++) {
        const h = s.holes[i];
        out('X' + fmt(h.x) + ' Y' + fmt(h.y));
        hits.push({ t: t.no, x: r3(h.x), y: r3(h.y), z: tp.z, r: tp.r, code });
      }
      out('G80');
      if (s.last) {
        if (set.coolant) out('M09');
        out('M05');
      }
    });
    // 포켓 등 절삭 경로: 포켓마다 위치결정 → R점 → G01/G03 이동 → 초기점 상승
    function pathBlock(s, t, tp) {
      s.holes.forEach((h, k) => {
        const def = P.OPS.get(s.type), top = s.top < 0 ? s.top : 0;
        // [V0.5] 이미 깎인 면에서 시작: 그 면을 0 으로 경로를 만든 뒤 Z 를 옮김. 급속 재위치는 소재 윗면 위(Z1 이상)에서만
        const s2 = top ? Object.assign({}, s, { z: r3(s.z - top), r: r3(s.r - top) }) : s;
        let pm = (def.moves || P.pocketMoves)(s2, t, h, machine, project);
        if (top) pm = Object.assign({}, pm, { moves: pm.moves.map(mv => Object.assign({}, mv, { z: mv.g === 0 ? Math.max(1, r3(mv.z + top)) : r3(mv.z + top) })) });
        if (k === 0) {
          if (!s.toolChange) out('G00 Z' + fmt(set.initialZ));
          out('G00 G90 ' + set.wcs + ' X' + fmt(pm.sx) + ' Y' + fmt(pm.sy) + ' S' + tp.rpm + ' M03'); spinOn = true;
          if (s.toolChange) out('G43 Z' + fmt(set.initialZ) + ' H' + pad(t.no, 2) + (set.coolant ? ' M08' : ''));
        } else out('G00 X' + fmt(pm.sx) + ' Y' + fmt(pm.sy));
        if (k === 0 && !s.toolChange) stopAt(t, tp);
        out('G00 Z' + fmt(tp.r));
        let lastF = null, lastZ = tp.r, lastX = pm.sx, lastY = pm.sy;
        pm.moves.forEach(mv => {
          // 급속(G00)은 바뀐 축만 출력 (Z 만 올라갈 때 XY 를 다시 쓰지 않음)
          let line = mv.g === 0 && Math.abs(mv.x - lastX) < 1e-9 && Math.abs(mv.y - lastY) < 1e-9 ? 'G00' : 'G0' + mv.g + ' X' + fmt(mv.x) + ' Y' + fmt(mv.y);
          lastX = mv.x; lastY = mv.y;
          if (Math.abs(mv.z - lastZ) > 1e-9) line += ' Z' + fmt(mv.z);
          if (mv.g === 2 || mv.g === 3) line += ' I' + fmt(mv.i) + ' J' + fmt(mv.j);
          if (mv.g !== 0 && fF(mv.f) !== lastF) { line += ' F' + fmtF(fF(mv.f)); lastF = fF(mv.f); }
          if (line !== 'G00') out(line); lastZ = mv.z; // 바뀐 축이 없는 급속은 생략
          if (mv.g !== 0) cuts.push({ t: t.no, x: mv.x, y: mv.y, z: mv.z });
        });
        out('G00 Z' + fmt(set.initialZ));
      });
      if (s.last) {
        if (set.coolant) out('M09');
        out('M05');
      }
    }
    out('G91 G28 Z0.');
    if (machine.endY) out('G91 G28 Y0.');
    out('G90');
    out('M30');
    out('%', false);
    // 시퀀스 번호: 10 간격, 5자리(N99999) 초과 시 1 간격, 그래도 넘으면 1부터 다시 (FANUC 최대 5자리)
    let L;
    if (set.seqNo && !restart) { // 재시작 블록을 쓰면 순번은 재시작 번호만
      const n = B.filter(b => b.num).length, inc = n * 10 <= 99999 ? 10 : 1;
      let k = 0;
      L = B.map(b => { if (!b.num) return b.s; k++; return 'N' + (((k * inc - 1) % 99999) + 1) + ' ' + b.s; });
    } else L = B.map(b => b.s);
    // [V0.6] NC 해시 (이 줄을 뺀 전체 내용 기준) — 작업 기록·승인과 대조
    const hash = P.ncHash(L.join('\n'));
    L.splice(hashAt, 0, '(NC HASH ' + hash + ' - PUREUN AI CAM ' + VERSION + ')');
    return { text: L.join('\n'), hits, cuts, lines: L.length, hash };
  }

  P.POST.register({ id: 'FANUC', label: 'FANUC 0i/31i (3축 머시닝센터)', kinds: Object.keys(CYCLE).concat(['path', 'bore']), verifier: 'FANUC', generate });
  // 개발 예정 제어기 (선택 시 생성 차단)
  P.POST.register({ id: 'MITSUBISHI', label: '미쓰비시 M70/M80 (개발 예정)', status: 'planned' });
  P.POST.register({ id: 'SIEMENS', label: '지멘스 SINUMERIK (개발 예정)', status: 'planned' });
})(typeof globalThis !== 'undefined' ? globalThis : this);
