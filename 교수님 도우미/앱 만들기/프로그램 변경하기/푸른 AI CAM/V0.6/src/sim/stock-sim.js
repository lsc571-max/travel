/* =====================================================================
 * 푸른 AI CAM - [시뮬레이션 엔진] sim/stock-sim.js
 * 역할: 소재 윗면을 높이맵(격자)으로 두고, 독립 NC 검증기가 해석한 실제 이동(motions)을
 *       공구 모양대로 깎는다. 화면(3D)과 무관한 순수 계산이라 Node 테스트로 검증 가능.
 *   - 평 엔드밀: 원판(바닥 평면) / 드릴·센터: 원뿔 끝(선단각) / 탭: 깎지 않고 나사 표시만
 *   - 모따기 공구: 끝 평면 + 원뿔 / 페이스밀: 원판
 *   - 격자 칸마다 가공 종류 태그 (1 센터, 2 드릴, 3 탭, 4 엔드밀(포켓·윤곽), 5 평면, 6 모따기)
 *   - 가공 시간 추정: 이송 길이 ÷ F, 급속 길이 ÷ 장비 급속 속도
 * 의존: engine/common.js
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  const { stockRect, toNum } = P;
  const TAG = { none: 0, center: 1, drill: 2, tap: 3, pocket: 4, face: 5, chamfer: 6 }; // [V0.5] 평면·모따기

  function createSim(stock, opts) {
    opts = opts || {};
    const sr = stockRect(stock), sx = sr.x1 - sr.x0, sy = sr.y1 - sr.y0;
    const maxCells = opts.maxCells || 160000;
    const dx = Math.max(opts.minCell || 0.2, Math.sqrt(sx * sy / maxCells));
    const nx = Math.ceil(sx / dx) + 1, ny = Math.ceil(sy / dx) + 1;
    const h = new Float32Array(nx * ny), tag = new Uint8Array(nx * ny);
    return { x0: sr.x0, y0: sr.y0, sx, sy, dx, nx, ny, h, tag, bottom: -toNum(stock.sz, 10), dirty: null };
  }
  function resetSim(sim) { sim.h.fill(0); sim.tag.fill(0); sim.dirty = { i0: 0, i1: sim.nx - 1, j0: 0, j1: sim.ny - 1 }; }
  function markDirty(sim, i0, i1, j0, j1) {
    const d = sim.dirty;
    if (!d) sim.dirty = { i0, i1, j0, j1 };
    else { d.i0 = Math.min(d.i0, i0); d.i1 = Math.max(d.i1, i1); d.j0 = Math.min(d.j0, j0); d.j1 = Math.max(d.j1, j1); }
  }
  function toolKind(tool) { return !tool ? 'none' : tool.type === 'endmill' ? 'pocket' : tool.type === 'facemill' ? 'face' : tool.type === 'chamfer' ? 'chamfer' : tool.type === 'tap' ? 'tap' : tool.type === 'center' ? 'center' : 'drill'; }

  // 공구 끝 위치 (x, y, z) 에서 한 번 찍기
  function stamp(sim, x, y, z, tool) {
    if (!tool || !(tool.dia > 0)) return;
    const R = tool.dia / 2, kind = toolKind(tool), tg = TAG[kind];
    const cone = (kind === 'drill' || kind === 'center' || kind === 'chamfer') ? 1 / Math.tan(toNum(tool.angle, kind === 'drill' ? 118 : 90) / 2 * Math.PI / 180) : 0;
    const tipR = kind === 'chamfer' ? Math.max(0, toNum(tool.tip, 0)) / 2 : 0; // 모따기 공구: 끝 평면 반경
    const i0 = Math.max(0, Math.floor((x - R - sim.x0) / sim.dx)), i1 = Math.min(sim.nx - 1, Math.ceil((x + R - sim.x0) / sim.dx));
    const j0 = Math.max(0, Math.floor((y - R - sim.y0) / sim.dx)), j1 = Math.min(sim.ny - 1, Math.ceil((y + R - sim.y0) / sim.dx));
    if (i0 > i1 || j0 > j1) return;
    let hit = false;
    for (let j = j0; j <= j1; j++) {
      const cy = sim.y0 + j * sim.dx, ddy = cy - y;
      for (let i = i0; i <= i1; i++) {
        const cx = sim.x0 + i * sim.dx, r = Math.hypot(cx - x, ddy);
        if (r > R) continue;
        const k = j * sim.nx + i;
        if (kind === 'tap') { if (sim.h[k] < z + 0.5 && sim.h[k] < -0.01) { sim.tag[k] = tg; hit = true; } continue; }
        let zc = z + Math.max(0, r - tipR) * cone;
        if (zc < sim.bottom) zc = sim.bottom - 0.001;
        if (zc < sim.h[k]) { sim.h[k] = zc; sim.tag[k] = tg; hit = true; }
      }
    }
    if (hit) markDirty(sim, i0, i1, j0, j1);
  }
  // 이동 하나를 따라 깎기 (급속은 깎지 않음). t0~t1 구간만 (애니메이션 중간 상태)
  function cutMotion(sim, m, tool, t0, t1) {
    if (m.k === 'rapid' || !tool) return;
    t0 = t0 || 0; t1 = t1 === undefined ? 1 : t1;
    const step = Math.max(0.05, sim.dx * 0.5);
    if (m.k === 'arc') {
      const a0 = Math.atan2(m.y0 - m.cy, m.x0 - m.cx), a1 = Math.atan2(m.y1 - m.cy, m.x1 - m.cx), TAU = Math.PI * 2;
      let sw = m.ccw ? a1 - a0 : a0 - a1; sw = ((sw % TAU) + TAU) % TAU; if (sw < 1e-9) sw = TAU;
      const r = Math.hypot(m.x0 - m.cx, m.y0 - m.cy), n = Math.max(2, Math.ceil(sw * r * (t1 - t0) / step));
      for (let s = 0; s <= n; s++) {
        const t = t0 + (t1 - t0) * s / n, a = a0 + (m.ccw ? 1 : -1) * sw * t;
        stamp(sim, m.cx + r * Math.cos(a), m.cy + r * Math.sin(a), m.z0 + (m.z1 - m.z0) * t, tool);
      }
      return;
    }
    const len = Math.hypot(m.x1 - m.x0, m.y1 - m.y0, m.z1 - m.z0) * (t1 - t0), n = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s <= n; s++) {
      const t = t0 + (t1 - t0) * s / n;
      stamp(sim, m.x0 + (m.x1 - m.x0) * t, m.y0 + (m.y1 - m.y0) * t, m.z0 + (m.z1 - m.z0) * t, tool);
    }
  }
  // 이동 위치 (애니메이션용 공구 위치)
  function motionPoint(m, t) {
    if (m.k === 'arc') {
      const a0 = Math.atan2(m.y0 - m.cy, m.x0 - m.cx), a1 = Math.atan2(m.y1 - m.cy, m.x1 - m.cx), TAU = Math.PI * 2;
      let sw = m.ccw ? a1 - a0 : a0 - a1; sw = ((sw % TAU) + TAU) % TAU; if (sw < 1e-9) sw = TAU;
      const r = Math.hypot(m.x0 - m.cx, m.y0 - m.cy), a = a0 + (m.ccw ? 1 : -1) * sw * t;
      return { x: m.cx + r * Math.cos(a), y: m.cy + r * Math.sin(a), z: m.z0 + (m.z1 - m.z0) * t };
    }
    return { x: m.x0 + (m.x1 - m.x0) * t, y: m.y0 + (m.y1 - m.y0) * t, z: m.z0 + (m.z1 - m.z0) * t };
  }
  function motionLength(m) {
    if (m.k === 'arc') {
      const a0 = Math.atan2(m.y0 - m.cy, m.x0 - m.cx), a1 = Math.atan2(m.y1 - m.cy, m.x1 - m.cx), TAU = Math.PI * 2;
      let sw = m.ccw ? a1 - a0 : a0 - a1; sw = ((sw % TAU) + TAU) % TAU; if (sw < 1e-9) sw = TAU;
      return Math.hypot(sw * Math.hypot(m.x0 - m.cx, m.y0 - m.cy), m.z1 - m.z0);
    }
    return Math.hypot(m.x1 - m.x0, m.y1 - m.y0, m.z1 - m.z0);
  }
  // 이동별 시간(초)·누적 시간. 펙 사이클은 후퇴·재진입을 근사(펙 횟수 × 2 × 깊이 / 급속)
  function timeline(motions, machine) {
    const rapid = toNum(machine && machine.rapid, 10000);
    let acc = 0;
    return motions.map(m => {
      const L = motionLength(m);
      let sec = m.k === 'rapid' ? L / rapid * 60 : L / Math.max(1, toNum(m.f, 100)) * 60;
      if (m.k === 'drill' && m.q > 0) sec += Math.ceil(L / m.q) * (2 * L / 2) / rapid * 60;
      if (m.k === 'drill') sec += L / rapid * 60; // 복귀
      const t0 = acc; acc += sec;
      return { t0, t1: acc, sec };
    });
  }
  function removedVolume(sim) { let v = 0; for (let k = 0; k < sim.h.length; k++) v -= Math.min(0, sim.h[k]); return v * sim.dx * sim.dx; }
  function heightAt(sim, x, y) {
    const i = Math.round((x - sim.x0) / sim.dx), j = Math.round((y - sim.y0) / sim.dx);
    if (i < 0 || j < 0 || i >= sim.nx || j >= sim.ny) return null;
    return sim.h[j * sim.nx + i];
  }

  P.SIM = Object.freeze({ TAG, createSim, resetSim, stamp, cutMotion, motionPoint, motionLength, timeline, removedVolume, heightAt, toolKind });
})(typeof globalThis !== 'undefined' ? globalThis : this);
