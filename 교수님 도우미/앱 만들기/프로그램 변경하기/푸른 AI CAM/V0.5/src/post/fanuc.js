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
  const CYCLE = { drill: 'G81', drillDwell: 'G82', peck: 'G73', deep: 'G83', tap: 'G84', rigidTap: 'G84' };

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
    if (!machine.verified) out('(*** TEST ONLY - MACHINE NOT VERIFIED ***)', false);
    out('(MACHINE: ' + (ncText(machine.name, 30) || 'MC') + ')', false);
    out('(MATERIAL: ' + ncText(st.material) + ' STOCK ' + fmt(st.sx) + ' X ' + fmt(st.sy) + ' X ' + fmt(st.sz) + ')', false);
    out('(' + set.wcs + ' X0Y0=' + ORIGIN_NC[st.origin] + ' Z0=TOP)', false);
    const used = [];
    plan.steps.forEach(s => { if (s.tool && !used.includes(s.tool)) used.push(s.tool); });
    const tname = t => t.type === 'tap' ? 'TAP M' + fmt(t.dia) + ' P' + fmt(t.pitch)
      : t.type === 'chamfer' ? 'CHAMFER MILL D' + fmt(t.dia) + ' A' + fmt(t.angle) + ' TIP D' + fmt(t.tip || 0)
        : (t.type === 'center' ? 'SPOT DRILL D' : t.type === 'endmill' ? 'FLAT ENDMILL D' : t.type === 'facemill' ? 'FACE MILL D' : 'DRILL D') + fmt(t.dia) + (t.type === 'endmill' || t.type === 'facemill' ? ' Z' + (t.z || 3) : '');
    used.forEach(t => out('(T' + pad(t.no, 2) + ' ' + tname(t) + ')', false));
    out('G21');
    out('G00 G17 G40 G49 G80 G90 G94'); // G94: 분당 이송 (이전 프로그램의 G95 잔류 방지)
    out('G91 G28 Z0.');
    out('G90');
    plan.steps.forEach(s => {
      const t = s.tool, tp = s.toolpath;
      const code = CYCLE[tp.kind];
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
      if (s.toolChange) out('T' + pad(t.no, 2) + ' M06');
      if (tp.kind === 'path') { pathBlock(s, t, tp); return; }
      const h0 = s.holes[0];
      const rigid = tp.kind === 'rigidTap';
      const spin = rigid && !machine.rigidM03 ? '' : ' S' + tp.rpm + ' M03';
      if (!s.toolChange) out('G00 Z' + fmt(set.initialZ)); // 같은 공구 연속 공정: 먼저 초기점으로 상승 후 XY 이동
      out('G00 G90 ' + set.wcs + ' X' + fmt(h0.x) + ' Y' + fmt(h0.y) + spin);
      if (spin) spinOn = true;
      if (s.toolChange) out('G43 Z' + fmt(set.initialZ) + ' H' + pad(t.no, 2) + (set.coolant ? ' M08' : ''));
      if (rigid && spinOn && !machine.rigidM03) { out('M05'); spinOn = false; } // FANUC: M29 는 주축 정지 상태에서 지령
      if (rigid) out('M29 S' + tp.rpm);
      // [V0.5] 이미 깎인 면(포켓 바닥 등)에서 시작하는 구멍은 R점이 소재 윗면 아래 → 구멍 사이는 항상 초기점 복귀(G98)
      let first = (s.top < 0 ? 'G98' : 'G' + set.retract.slice(1)) + ' ' + code + ' X' + fmt(h0.x) + ' Y' + fmt(h0.y) + ' Z' + fmt(tp.z) + ' R' + fmt(tp.r);
      if (code === 'G73' || code === 'G83') first += ' Q' + fmt(tp.q);
      if (code === 'G82') first += ' P' + tp.dwell;
      first += ' F' + fmtF(tp.feed);
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
        out('G00 Z' + fmt(tp.r));
        let lastF = null, lastZ = tp.r, lastX = pm.sx, lastY = pm.sy;
        pm.moves.forEach(mv => {
          // 급속(G00)은 바뀐 축만 출력 (Z 만 올라갈 때 XY 를 다시 쓰지 않음)
          let line = mv.g === 0 && Math.abs(mv.x - lastX) < 1e-9 && Math.abs(mv.y - lastY) < 1e-9 ? 'G00' : 'G0' + mv.g + ' X' + fmt(mv.x) + ' Y' + fmt(mv.y);
          lastX = mv.x; lastY = mv.y;
          if (Math.abs(mv.z - lastZ) > 1e-9) line += ' Z' + fmt(mv.z);
          if (mv.g === 2 || mv.g === 3) line += ' I' + fmt(mv.i) + ' J' + fmt(mv.j);
          if (mv.g !== 0 && mv.f !== lastF) { line += ' F' + fmtF(mv.f); lastF = mv.f; }
          out(line); lastZ = mv.z;
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
    if (set.seqNo) {
      const n = B.filter(b => b.num).length, inc = n * 10 <= 99999 ? 10 : 1;
      let k = 0;
      L = B.map(b => { if (!b.num) return b.s; k++; return 'N' + (((k * inc - 1) % 99999) + 1) + ' ' + b.s; });
    } else L = B.map(b => b.s);
    return { text: L.join('\n'), hits, cuts, lines: L.length };
  }

  P.POST.register({ id: 'FANUC', label: 'FANUC 0i/31i (3축 머시닝센터)', kinds: Object.keys(CYCLE).concat(['path']), verifier: 'FANUC', generate });
  // 개발 예정 제어기 (선택 시 생성 차단)
  P.POST.register({ id: 'MITSUBISHI', label: '미쓰비시 M70/M80 (개발 예정)', status: 'planned' });
  P.POST.register({ id: 'SIEMENS', label: '지멘스 SINUMERIK (개발 예정)', status: 'planned' });
})(typeof globalThis !== 'undefined' ? globalThis : this);
