/* =====================================================================
 * 푸른 AI CAM - [검증 모듈: 독립 NC 검증기 FANUC] verify/nc-fanuc.js
 * 역할: 포스트프로세서와 별도의 코드로 NC 텍스트를 한 줄씩 해석·시뮬레이션하여
 *       문법·모달 상태·이동 경로·충돌·탭 이송을 검사하고, 생성기 결과와 교차 비교한다.
 *       사용자가 직접 수정한 NC 도 이 검증기를 통과해야 출력할 수 있다.
 * 의존: engine/common.js (생성기 코드에는 의존하지 않음)
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  const { EPS, CLAMP_MARGIN, toNum, r3, fmt, toolMap, stockRect, segRectHit, clampRect, inRect } = P;
  /* ---------------- 독립 NC 검증기 (G코드 해석·시뮬레이션) ----------------
   * 생성기와 별도로 NC 텍스트를 한 줄씩 해석하여 모달 상태를 추적하고
   * 문법, 이동 경로, 소재/클램프 충돌, 조건을 검사한다. 사용자 수정 NC도 동일하게 검사. */
  const ALLOWED_G = new Set([0, 1, 4, 17, 21, 28, 40, 43, 49, 54, 55, 56, 57, 58, 59, 73, 80, 81, 82, 83, 84, 90, 91, 94, 98, 99]);
  const ALLOWED_M = new Set([0, 1, 2, 3, 5, 6, 8, 9, 29, 30]);
  function verifyNC(text, ctx) {
    const errors = [], warnings = [], hits = [], moves = [];
    const E = (ln, m) => { if (errors.length < 200) errors.push({ line: ln, msg: m }); };
    const W = (ln, m) => { if (warnings.length < 200) warnings.push({ line: ln, msg: m }); };
    const stock = ctx.stock, machine = ctx.machine, clamps = ctx.clamps || [];
    const sr = stockRect(stock);
    const bottom = -(stock.sz + toNum(stock.under, 0));
    const tm = toolMap(machine);
    const s = { units: null, abs: true, motion: null, cycle: null, ret: 98, h: null, hNeed: true, tool: null, nextT: null, spin: false, S: 0, F: 0,
      m29: false, m29S: 0, x: null, y: null, z: Infinity, cz: null, cr: null, cq: null, cp: 0, initZ: null, cool: false, ended: false, wcs: null };
    let pct = 0, hasO = false, unitsWarned = false, sawMotion = false;
    const lines = String(text).split(/\r?\n/);
    const clampHit = (x0, y0, x1, y1, z, rad, ln, what) => {
      clamps.forEach((c, ci) => {
        if (z <= c.height + CLAMP_MARGIN - EPS) {
          const r = clampRect(c, rad + 1);
          const hit = (x0 === null || y0 === null) ? inRect(x1, y1, r) : segRectHit(x0, y0, x1, y1, r);
          if (hit) E(ln, what + ' 경로가 Z' + fmt(z) + ' 높이에서 클램프 ' + (ci + 1) + '(높이 ' + c.height + ')와 충돌합니다.');
        }
      });
    };
    const overStock = (x, y, rad) => x !== null && y !== null && x + rad > sr.x0 && x - rad < sr.x1 && y + rad > sr.y0 && y - rad < sr.y1;

    for (let i = 0; i < lines.length; i++) {
      const ln = i + 1, raw = lines[i];
      if ((raw.match(/\(/g) || []).length !== (raw.match(/\)/g) || []).length) { E(ln, '주석 괄호가 짝이 맞지 않습니다.'); continue; }
      const cmt = raw.match(/\(([^)]*)\)/g) || [];
      cmt.forEach(c => { if (/[^\x20-\x7E]/.test(c)) W(ln, '주석에 영문/숫자 외 문자가 있어 장비에서 알람이 날 수 있습니다.'); });
      let line = raw.replace(/\([^)]*\)/g, '').replace(/\s+/g, '').toUpperCase();
      if (!line) continue;
      if (line === '%') { pct++; continue; }
      if (s.ended) { W(ln, 'M30 이후 내용은 실행되지 않습니다.'); continue; }
      if (line[0] === '/') { E(ln, '블록 스킵(/)은 V0.1 검증기가 지원하지 않습니다.'); continue; }
      if (line[0] === 'O') {
        if (!/^O\d{1,4}$/.test(line) || /^O0+$/.test(line)) E(ln, '프로그램 번호 형식이 잘못되었습니다 (O0001~O9999).');
        if (hasO) E(ln, '프로그램 번호(O)가 두 번 이상 있습니다.');
        hasO = true; continue;
      }
      // 토큰 해석
      const words = []; let pos = 0, bad = false;
      while (pos < line.length) {
        const m = /^([A-Z])([-+]?(?:\d+\.?\d*|\.\d+))/.exec(line.slice(pos));
        if (!m) { E(ln, '해석할 수 없는 문자: "' + line.slice(pos, pos + 6) + '"'); bad = true; break; }
        words.push({ L: m[1], v: parseFloat(m[2]), raw: m[2] });
        pos += m[0].length;
      }
      if (bad) continue;
      const G = [], M = [], A = {};
      let dup = false;
      words.forEach(w => {
        if (w.L === 'G') G.push(w.v);
        else if (w.L === 'M') M.push(w.v);
        else if (w.L === 'N') { /* 시퀀스 번호 */ }
        else { if (A[w.L]) dup = true; A[w.L] = w; }
      });
      if (dup) { E(ln, '한 블록에 같은 주소가 두 번 있습니다.'); continue; }
      const unknownL = Object.keys(A).filter(k => !'XYZRQPFSTH'.includes(k));
      if (unknownL.length) { E(ln, '지원하지 않는 주소: ' + unknownL.join(', ') + ' (원호·보정 등은 V0.1 범위 밖)'); continue; }
      ['X', 'Y', 'Z', 'R', 'Q'].forEach(k => { if (A[k] && !A[k].raw.includes('.')) E(ln, k + A[k].raw + ': 소수점이 없습니다. FANUC 은 ' + k + A[k].raw + ' 를 ' + (A[k].v / 1000) + 'mm 로 해석할 수 있습니다.'); });
      if (A.P && A.P.raw.includes('.')) E(ln, 'P(드웰)는 ms 단위 정수로 입력하세요.');
      if (G.some(g => !Number.isInteger(g)) || M.some(m => !Number.isInteger(m))) { E(ln, '소수점이 있는 G/M 코드는 지원하지 않습니다.'); continue; }
      const badG = G.filter(g => !ALLOWED_G.has(g)), badM = M.filter(m => !ALLOWED_M.has(m));
      if (badG.length) { E(ln, '검증할 수 없는 G코드: ' + badG.map(g => 'G' + g).join(', ') + (badG.includes(20) ? ' (인치 단위 미지원)' : '')); continue; }
      if (badM.length) { E(ln, '검증할 수 없는 M코드: ' + badM.map(m => 'M' + m).join(', ') + (badM.includes(4) ? ' (역회전 미지원)' : '')); continue; }
      if (M.length > 1) W(ln, '한 블록에 M코드가 여러 개입니다 (장비 설정에 따라 알람).');

      // 모달 설정
      let g28 = false, g43 = false, newCycle = null, g04 = false;
      G.forEach(g => {
        if (g === 21) s.units = 'mm';
        else if (g === 90) s.abs = true;
        else if (g === 91) s.abs = false;
        else if (g === 98) s.ret = 98;
        else if (g === 99) s.ret = 99;
        else if (g >= 54 && g <= 59) s.wcs = g;
        else if (g === 49) { s.h = null; }
        else if (g === 80) { s.cycle = null; s.m29 = false; s.initZ = null; }
        else if (g === 0 || g === 1) { s.motion = g; if (s.cycle !== null) { s.cycle = null; s.initZ = null; } }
        else if (g === 28) g28 = true;
        else if (g === 43) g43 = true;
        else if (g === 4) g04 = true;
        else if ([73, 81, 82, 83, 84].includes(g)) newCycle = g;
      });
      if (A.F) { if (!(A.F.v > 0)) E(ln, '이송속도 F는 0보다 커야 합니다.'); else if (A.F.v > machine.maxFeed) E(ln, 'F' + A.F.raw + ' 이(가) 장비 최대 이송 ' + machine.maxFeed + ' 을 초과합니다.'); s.F = A.F.v; }
      if (A.T) {
        const tn = A.T.v;
        if (!Number.isInteger(tn) || !tm.get(tn)) E(ln, 'T' + A.T.raw + ' 공구가 장비 공구 목록에 없습니다.');
        else if (tn > machine.magazine) E(ln, 'T' + tn + ' 가 매거진 수를 초과합니다.');
        s.nextT = tn;
      }
      if (A.S) {
        if (!(A.S.v > 0) || !Number.isInteger(A.S.v)) E(ln, 'S는 0보다 큰 정수여야 합니다.');
        else if (A.S.v > machine.maxRpm) E(ln, 'S' + A.S.raw + ' 이(가) 장비 최대 회전수 ' + machine.maxRpm + ' 을 초과합니다.');
        s.S = A.S.v;
      }
      // M코드
      M.forEach(m => {
        if (m === 6) {
          if (s.cycle !== null) E(ln, '고정 사이클(G80 미취소) 상태에서 공구 교환합니다.');
          if (s.nextT === null || !tm.get(s.nextT)) E(ln, '교환할 공구(T)가 지정되지 않았습니다.');
          if (s.z !== Infinity) W(ln, 'Z축 원점 복귀(G91 G28 Z0.) 없이 공구를 교환합니다 (장비 M06 매크로 확인).');
          if (s.spin) W(ln, '주축 회전 중 공구 교환 (M05 권장).');
          s.tool = s.nextT; s.hNeed = true; s.h = null;
        } else if (m === 3) { if (!(s.S > 0)) E(ln, '회전수(S) 없이 M03 주축 정회전.'); s.spin = true; }
        else if (m === 5) s.spin = false;
        else if (m === 8) s.cool = true;
        else if (m === 9) s.cool = false;
        else if (m === 29) {
          if (!A.S) E(ln, 'M29(리지드 탭)는 같은 블록에 S가 필요합니다.');
          if (!machine.rigidTap) E(ln, '장비가 리지드 탭을 지원하지 않도록 설정되어 있습니다.');
          s.m29 = true; s.m29S = A.S ? A.S.v : 0;
          if (A.S && A.S.v > (machine.maxTapRpm || machine.maxRpm)) E(ln, '리지드 탭 S' + A.S.v + ' 이(가) 탭 최대 회전수를 초과합니다.');
        } else if (m === 30 || m === 2) s.ended = true;
      });
      if (g43) {
        if (!A.H) E(ln, 'G43 에 H 번호가 없습니다.');
        else if (s.tool === null) E(ln, '공구가 장착되지 않은 상태에서 G43.');
        else if (A.H.v !== s.tool) E(ln, 'H' + A.H.raw + ' 가 장착 공구 T' + s.tool + ' 와 다릅니다 (공구 길이 보정 오류 → 충돌 위험).');
        if (!A.Z) W(ln, 'G43 블록에 Z 이동이 없습니다.');
        s.h = A.H ? A.H.v : null; s.hNeed = false;
      } else if (A.H) E(ln, 'G43 없이 H 단어가 사용되었습니다.');
      if (g04) { if (!A.P) E(ln, 'G04 드웰에 P가 없습니다.'); continue; }

      const hasAxis = !!(A.X || A.Y || A.Z);
      if (g28) {
        if (s.abs) E(ln, 'G90(절대) 상태의 G28 은 공작물 좌표 지점을 경유하여 충돌 위험이 있습니다. G91 G28 을 사용하세요.');
        ['X', 'Y', 'Z'].forEach(k => { if (A[k] && Math.abs(A[k].v) > EPS) E(ln, 'G91 G28 ' + k + ' 값은 0 이어야 합니다.'); });
        if (A.Z) s.z = Infinity;
        if (A.X) s.x = null;
        if (A.Y) s.y = null;
        continue;
      }
      if (hasAxis && !s.units) { if (!unitsWarned) E(ln, 'G21(mm 단위) 지정 전에 이동 명령이 있습니다.'); unitsWarned = true; }
      if (hasAxis && !s.abs) { E(ln, '증분(G91) 이동은 V0.1 검증기가 지원하지 않습니다 (G28 제외).'); continue; }

      const rad = s.tool && tm.get(s.tool) ? tm.get(s.tool).dia / 2 : 0;
      if (newCycle !== null) {
        if (s.cycle === null) s.initZ = s.z;
        s.cycle = newCycle;
        s.motion = null;
      }
      if (s.cycle !== null && (newCycle !== null || A.X || A.Y || A.Z || A.R)) {
        // 고정 사이클 실행 (구멍 1개)
        if (A.Z) s.cz = A.Z.v;
        if (A.R) s.cr = A.R.v;
        if (A.Q) s.cq = A.Q.v;
        if (A.P) s.cp = A.P.v;
        const nx = A.X ? A.X.v : s.x, ny = A.Y ? A.Y.v : s.y;
        const tool = s.tool !== null ? tm.get(s.tool) : null;
        const code = 'G' + s.cycle;
        sawMotion = true;
        if (nx === null || ny === null) { E(ln, '고정 사이클 XY 위치가 정해지지 않았습니다.'); continue; }
        if (s.cz === null || s.cr === null) { E(ln, code + ' 에 Z 또는 R 값이 없습니다.'); continue; }
        if (!tool) E(ln, '공구가 장착되지 않은 상태에서 가공합니다.');
        if (s.hNeed || s.h === null) E(ln, '공구 길이 보정(G43 H) 없이 가공합니다.');
        if (s.initZ === null || s.initZ === Infinity) E(ln, '초기점 Z가 정해지지 않은 상태(공구 길이 보정 전)에서 고정 사이클을 시작합니다.');
        if (s.cr <= 0) E(ln, 'R점 ' + fmt(s.cr) + ' 이(가) 소재 상면(Z0) 이하입니다 (급속으로 소재에 진입).');
        if (s.cz >= s.cr) E(ln, 'Z(' + fmt(s.cz) + ')가 R점(' + fmt(s.cr) + ')보다 높습니다.');
        if (s.initZ !== null && s.initZ !== Infinity && s.initZ < s.cr - EPS) E(ln, '초기점 Z' + fmt(s.initZ) + ' 이(가) R점보다 낮습니다.');
        if (s.cz < bottom - EPS) E(ln, '가공 Z' + fmt(s.cz) + ' 이(가) 소재 바닥 아래 허용 한계 Z' + fmt(bottom) + ' 를 넘습니다 (테이블/지그 충돌).');
        if (s.cz > 0) W(ln, '가공 Z가 소재 상면 위입니다 (공회전).');
        if (!(s.F > 0)) E(ln, '이송속도 F가 지정되지 않았습니다.');
        if ((s.cycle === 73 || s.cycle === 83) && !(s.cq > 0)) E(ln, code + ' 에 펙 깊이 Q가 없습니다.');
        if (s.cycle === 82 && !(s.cp > 0)) W(ln, 'G82 에 드웰 P가 없습니다.');
        if (tool) {
          if (s.cycle === 84 && tool.type !== 'tap') E(ln, 'G84(탭) 사이클에 탭이 아닌 공구 T' + tool.no + ' 사용.');
          if (s.cycle !== 84 && tool.type === 'tap') E(ln, '탭 공구 T' + tool.no + ' 로 ' + code + ' 드릴 사이클 실행 (공구 파손).');
          if ((s.cycle === 73 || s.cycle === 83) && tool.type === 'center') W(ln, '센터 드릴로 펙 사이클을 사용합니다.');
          if (tool.flute > 0 && -s.cz > tool.flute + EPS) E(ln, '가공 깊이 ' + fmt(-s.cz) + ' 이(가) T' + tool.no + ' 유효 날 길이 ' + tool.flute + ' 를 초과합니다.');
          if (s.cycle === 84) {
            const S = s.m29 ? s.m29S : s.S, want = S * toNum(tool.pitch, 0);
            if (!s.m29 && !s.spin) E(ln, '주축 정지 상태에서 일반 탭(G84) 실행 (M03 또는 M29 필요).');
            if (Math.abs(s.F - want) > Math.max(0.01, want * 0.001)) E(ln, '탭 이송 F' + s.F + ' 가 S' + S + ' × 피치 ' + tool.pitch + ' = ' + r3(want) + ' 와 다릅니다 (나사산 손상·탭 파손).');
          } else if (!s.spin) E(ln, '주축 정지 상태에서 드릴 사이클 실행.');
          if (nx - rad < sr.x0 - EPS || nx + rad > sr.x1 + EPS || ny - rad < sr.y0 - EPS || ny + rad > sr.y1 + EPS) E(ln, 'X' + fmt(nx) + ' Y' + fmt(ny) + ' 가공 위치가 소재 범위를 벗어납니다.');
          clamps.forEach((c, ci) => { if (inRect(nx, ny, clampRect(c, rad + 1))) E(ln, 'X' + fmt(nx) + ' Y' + fmt(ny) + ' 가공 위치가 클램프 ' + (ci + 1) + ' 와 겹칩니다.'); });
        }
        // 구멍 사이 이동: 현재 높이에서 XY 이동
        const travelZ = s.z;
        if (s.x !== null && s.y !== null) moves.push({ x0: s.x, y0: s.y, x1: nx, y1: ny, z: travelZ, rapid: true });
        clampHit(s.x, s.y, nx, ny, travelZ, rad, ln, '구멍 간 이동');
        if (travelZ <= 0 && overStock(s.x, s.y, rad)) E(ln, '소재 상면 아래 높이에서 구멍 간 급속 이동.');
        s.x = nx; s.y = ny;
        hits.push({ t: s.tool, x: r3(nx), y: r3(ny), z: r3(s.cz), r: r3(s.cr), code, line: ln });
        s.z = s.ret === 98 ? s.initZ : s.cr;
        continue;
      }
      if (hasAxis) {
        sawMotion = true;
        if (s.motion === null) { E(ln, '이동 모드(G00/G01)가 지정되지 않은 상태의 이동.'); continue; }
        const tx = A.X ? A.X.v : s.x, ty = A.Y ? A.Y.v : s.y, tz = A.Z ? A.Z.v : s.z;
        if (A.Z && (s.hNeed || s.h === null) && !g43) E(ln, '공구 길이 보정(G43 H) 없이 Z축 이동 (충돌 위험).');
        if (s.motion === 1) { W(ln, 'G01 직선 절삭은 V0.1 홀 가공 범위 밖입니다.'); if (!(s.F > 0)) E(ln, 'G01 에 이송속도 F가 없습니다.'); }
        if (tz < bottom - EPS) E(ln, 'Z' + fmt(tz) + ' 이(가) 소재 바닥 허용 한계 아래입니다.');
        const xyMove = (A.X || A.Y) && tx !== null && ty !== null;
        const zLow = Math.min(tz, s.z);
        if (xyMove) {
          const zAt = tz < s.z ? tz : s.z; // 하강이 섞이면 낮은 높이로 보수적 판단
          clampHit(s.x, s.y, tx, ty, zAt, rad, ln, (s.motion === 0 ? '급속' : '직선') + ' 이동');
          if (s.motion === 0 && zAt <= 0 && (overStock(s.x, s.y, rad) || overStock(tx, ty, rad))) E(ln, '소재 상면 높이 이하에서 급속 XY 이동 (소재 충돌).');
          if (s.x !== null && s.y !== null) moves.push({ x0: s.x, y0: s.y, x1: tx, y1: ty, z: zAt, rapid: s.motion === 0 });
        }
        if (A.Z && s.motion === 0 && tz < s.z && tz < 1 - EPS && overStock(tx, ty, rad)) E(ln, '급속 이송(G00)으로 소재 상면 1mm 이내로 하강 (Z' + fmt(tz) + ').');
        if (A.Z && zLow !== Infinity) clampHit(null, null, tx === null ? -1e9 : tx, ty === null ? -1e9 : ty, tz, rad, ln, 'Z 하강');
        s.x = tx; s.y = ty; s.z = tz;
      }
    }
    if (!hasO) E(0, '프로그램 번호(O)가 없습니다.');
    if (!s.units) E(0, 'G21(mm 단위) 지정이 없습니다.');
    if (!s.ended) E(0, '프로그램 끝(M30)이 없습니다.');
    else {
      if (s.cycle !== null) E(0, '고정 사이클이 G80 으로 취소되지 않았습니다.');
      if (s.spin) W(0, '프로그램 끝에서 주축이 회전 중입니다 (M05 권장).');
      if (s.cool) W(0, '프로그램 끝에서 절삭유가 켜져 있습니다 (M09 권장).');
    }
    if (pct < 2) W(0, '프로그램 시작/끝의 % 표시가 없습니다 (전송 방식에 따라 필요).');
    if (!sawMotion || !hits.length) E(0, '가공(고정 사이클) 블록이 없습니다.');

    // 생성기 결과와 교차 검증 (수정하지 않은 NC 인 경우)
    let match = null;
    if (ctx.expected) {
      const ex = ctx.expected;
      match = ex.length === hits.length && ex.every((e, k) => {
        const h = hits[k];
        return h.t === e.t && Math.abs(h.x - e.x) < 5e-4 && Math.abs(h.y - e.y) < 5e-4 && Math.abs(h.z - e.z) < 5e-4 && Math.abs(h.r - e.r) < 5e-4 && h.code === e.code;
      });
      if (!match) E(0, '생성기 계산 결과와 NC 해석 결과가 일치하지 않습니다 (예상 ' + ex.length + '개, 해석 ' + hits.length + '개 구멍).');
    }
    return { errors, warnings, hits, moves, match };
  }

  // 제어기별 NC 검증기 등록소 (포스트프로세서의 verifier 이름으로 선택)
  const NCV = { FANUC: verifyNC };
  P.NCV = NCV;
  P.verifyNC = (text, ctx) => {
    const post = ctx && ctx.machine && P.POST.get(ctx.machine.control);
    const fn = post && NCV[post.verifier];
    if (!fn) return { errors: [{ line: 0, msg: '이 제어기용 NC 검증기가 없습니다: ' + (ctx && ctx.machine && ctx.machine.control) }], warnings: [], hits: [], moves: [], match: false };
    return fn(text, ctx);
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
