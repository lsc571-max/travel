/* =====================================================================
 * 푸른 AI CAM - [공통 엔진: 배열·경로 순서] engine/patterns.js
 * 역할: 홀 배열(직선·사각·PCD) 좌표 계산, 입력값 검사, 가공 순서(최단·지그재그·입력)
 * 의존: engine/common.js
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  const { toNum, r3, deg, isNum } = P;

  /* ---------------- 홀 배열 ---------------- */
  function genLine(p) {
    const n = Math.floor(toNum(p.count, 0)), out = [];
    const a = deg(toNum(p.angle, 0)), s = toNum(p.pitch, 0);
    for (let i = 0; i < n; i++) out.push({ x: r3(toNum(p.x, 0) + i * s * Math.cos(a)), y: r3(toNum(p.y, 0) + i * s * Math.sin(a)) });
    return out;
  }
  function genGrid(p) {
    const nx = Math.floor(toNum(p.nx, 0)), ny = Math.floor(toNum(p.ny, 0)), out = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
      out.push({ x: r3(toNum(p.x, 0) + i * toNum(p.px, 0)), y: r3(toNum(p.y, 0) + j * toNum(p.py, 0)) });
    return out;
  }
  function genPCD(p) {
    const n = Math.floor(toNum(p.count, 0)), r = toNum(p.dia, 0) / 2, out = [];
    for (let i = 0; i < n; i++) {
      const a = deg(toNum(p.start, 0) + i * 360 / n);
      out.push({ x: r3(toNum(p.cx, 0) + r * Math.cos(a)), y: r3(toNum(p.cy, 0) + r * Math.sin(a)) });
    }
    return out;
  }
  // 배열 입력값 검사 → 오류 메시지 배열
  function checkArrayParams(kind, p) {
    const e = [], cnt = v => Number.isInteger(toNum(v, NaN)) && toNum(v, 0) >= 1 && toNum(v, 0) <= 1000;
    const f = (k, l) => { if (!isNum(toNum(p[k], NaN))) e.push(l + ' 값이 숫자가 아닙니다.'); };
    if (kind === 'single') { f('x', 'X'); f('y', 'Y'); }
    if (kind === 'line') { f('x', '시작 X'); f('y', '시작 Y'); f('pitch', '간격'); f('angle', '각도'); if (!cnt(p.count)) e.push('개수는 1~1000 정수'); if (toNum(p.count, 0) > 1 && Math.abs(toNum(p.pitch, 0)) < 0.01) e.push('간격이 0 입니다(중복 홀).'); }
    if (kind === 'grid') { f('x', '시작 X'); f('y', '시작 Y'); f('px', 'X 간격'); f('py', 'Y 간격'); if (!cnt(p.nx) || !cnt(p.ny)) e.push('X/Y 개수는 1~1000 정수'); if (toNum(p.nx, 0) * toNum(p.ny, 0) > 5000) e.push('한 번에 5000개 이하'); if (toNum(p.nx, 0) > 1 && Math.abs(toNum(p.px, 0)) < 0.01) e.push('X 간격이 0 입니다.'); if (toNum(p.ny, 0) > 1 && Math.abs(toNum(p.py, 0)) < 0.01) e.push('Y 간격이 0 입니다.'); }
    if (kind === 'pcd') { f('cx', '중심 X'); f('cy', '중심 Y'); f('dia', 'PCD 직경'); f('start', '시작각'); if (!cnt(p.count)) e.push('개수는 1~1000 정수'); if (!(toNum(p.dia, 0) > 0)) e.push('PCD 직경은 0보다 커야 합니다.'); }
    return e;
  }

  /* ---------------- 가공 경로 순서 ---------------- */
  function orderHoles(holes, mode, start) {
    if (mode === 'nearest') {
      const rest = holes.slice(), out = [];
      let cx = start ? start.x : 0, cy = start ? start.y : 0;
      while (rest.length) {
        let bi = 0, bd = Infinity;
        for (let i = 0; i < rest.length; i++) { const d = (rest[i].x - cx) ** 2 + (rest[i].y - cy) ** 2; if (d < bd - 1e-12) { bd = d; bi = i; } }
        const h = rest.splice(bi, 1)[0]; out.push(h); cx = h.x; cy = h.y;
      }
      return out;
    }
    if (mode === 'zigzag') {
      const rows = new Map();
      holes.forEach(h => { const k = Math.round(h.y * 100); if (!rows.has(k)) rows.set(k, []); rows.get(k).push(h); });
      const keys = [...rows.keys()].sort((a, b) => a - b), out = [];
      keys.forEach((k, i) => { const r = rows.get(k).slice().sort((a, b) => a.x - b.x); if (i % 2) r.reverse(); out.push(...r); });
      return out;
    }
    return holes.slice();
  }

  Object.assign(P, { genLine, genGrid, genPCD, checkArrayParams, orderHoles });
})(typeof globalThis !== 'undefined' ? globalThis : this);
