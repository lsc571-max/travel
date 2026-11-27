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
    const L = [], hits = [];
    let seq = 0;
    const out = (s, numbered) => {
      if (set.seqNo && numbered !== false && s && s[0] !== '(' && s !== '%') { seq += 10; L.push('N' + seq + ' ' + s); }
      else L.push(s);
    };
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
    used.forEach(t => out('(T' + pad(t.no, 2) + ' ' + (t.type === 'tap' ? 'TAP M' + fmt(t.dia) + ' P' + fmt(t.pitch) : (t.type === 'center' ? 'SPOT DRILL D' : 'DRILL D') + fmt(t.dia)) + ')', false));
    out('G21');
    out('G00 G17 G40 G49 G80 G90');
    out('G91 G28 Z0.');
    out('G90');
    plan.steps.forEach(s => {
      const t = s.tool, tp = s.toolpath;
      const code = CYCLE[tp.kind];
      // 공구 교환·안전 이동 (공정 관리 모듈이 정한 toolChange 에 따름)
      if (s.toolChange && !s.first) {
        if (set.coolant) out('M09');
        out('M05');
        out('G91 G28 Z0.');
        out('G90');
        if (set.m01) out('M01');
      }
      out('(OP' + s.idx + ' ' + s.ncName + ' T' + pad(t.no, 2) + ' Z' + fmt(tp.z) + ' ' + s.holes.length + ' HOLES)', false);
      if (s.toolChange) out('T' + pad(t.no, 2) + ' M06');
      const h0 = s.holes[0];
      const rigid = tp.kind === 'rigidTap';
      const spin = rigid && !machine.rigidM03 ? '' : ' S' + tp.rpm + ' M03';
      if (!s.toolChange) out('G00 Z' + fmt(set.initialZ)); // 같은 공구 연속 공정: 먼저 초기점으로 상승 후 XY 이동
      out('G00 G90 ' + set.wcs + ' X' + fmt(h0.x) + ' Y' + fmt(h0.y) + spin);
      if (s.toolChange) out('G43 Z' + fmt(set.initialZ) + ' H' + pad(t.no, 2) + (set.coolant ? ' M08' : ''));
      if (rigid) out('M29 S' + tp.rpm);
      let first = 'G' + set.retract.slice(1) + ' ' + code + ' X' + fmt(h0.x) + ' Y' + fmt(h0.y) + ' Z' + fmt(tp.z) + ' R' + fmt(tp.r);
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
    out('G91 G28 Z0.');
    if (machine.endY) out('G91 G28 Y0.');
    out('G90');
    out('M30');
    out('%', false);
    return { text: L.join('\n'), hits, lines: L.length };
  }

  P.POST.register({ id: 'FANUC', label: 'FANUC 0i/31i (3축 머시닝센터)', kinds: Object.keys(CYCLE), verifier: 'FANUC', generate });
  // 개발 예정 제어기 (선택 시 생성 차단)
  P.POST.register({ id: 'MITSUBISHI', label: '미쓰비시 M70/M80 (개발 예정)', status: 'planned' });
  P.POST.register({ id: 'SIEMENS', label: '지멘스 SINUMERIK (개발 예정)', status: 'planned' });
})(typeof globalThis !== 'undefined' ? globalThis : this);
