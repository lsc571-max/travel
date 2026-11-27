/* =====================================================================
 * 푸른 AI CAM - [그래픽 모듈] ui/graphics.js
 * 역할: 캔버스 좌표 변환(월드 mm ↔ 화면 px), 화면 맞춤·확대, 소재·격자·좌표계·클램프·홀·
 *       포켓(실제 크기)·바닥 Z·가공 경로·NC 해석 결과 그리기. 입력(마우스·터치) 처리는 app.js 담당.
 * 의존: PCAM(계산 엔진), 상태 제공 함수 getCtx() → { P, S, DB, drag, machine }
 * ===================================================================== */
(function () {
  'use strict';
  const C = window.PCAM;
  window.PCAM_UI = window.PCAM_UI || {};
  window.PCAM_UI.createGraphics = function (getCtx) {
    let P, S, DB, drag, machine;
    const sync = () => { const c = getCtx(); P = c.P; S = c.S; DB = c.DB; drag = c.drag; machine = c.machine; };
    const $ = s => document.querySelector(s);
    const cv = () => $('#cv');
  function canvasSize() { const c = cv(), r = c.getBoundingClientRect(); return { w: r.width, h: r.height }; }
  function w2s(x, y) { const { w, h } = canvasSize(); return [w / 2 + (x - S.view.cx) * S.view.scale, h / 2 - (y - S.view.cy) * S.view.scale]; }
  function s2w(px, py) { const { w, h } = canvasSize(); return [S.view.cx + (px - w / 2) / S.view.scale, S.view.cy - (py - h / 2) / S.view.scale]; }
  function fitView() {
    const r = C.stockRect(P.stock);
    let x0 = Math.min(r.x0, 0), y0 = Math.min(r.y0, 0), x1 = Math.max(r.x1, 0), y1 = Math.max(r.y1, 0);
    const tm0 = C.toolMap(machine());
    P.groups.forEach(g => { const e = extentOf(g, tm0), hx = e.rect ? e.w / 2 : e.d / 2, hy = e.rect ? e.h / 2 : e.d / 2; g.holes.forEach(h => { if (C.isNum(h.x) && C.isNum(h.y)) { x0 = Math.min(x0, h.x - hx); x1 = Math.max(x1, h.x + hx); y0 = Math.min(y0, h.y - hy); y1 = Math.max(y1, h.y + hy); } }); });
    P.clamps.forEach(c => { const cr = { x0: Math.min(c.x, c.x + c.w), x1: Math.max(c.x, c.x + c.w), y0: Math.min(c.y, c.y + c.h), y1: Math.max(c.y, c.y + c.h) }; x0 = Math.min(x0, cr.x0); x1 = Math.max(x1, cr.x1); y0 = Math.min(y0, cr.y0); y1 = Math.max(y1, cr.y1); });
    const { w, h } = canvasSize(); if (!w || !h) return;
    const sw = Math.max(x1 - x0, 1), sh = Math.max(y1 - y0, 1);
    S.view.scale = Math.max(0.05, Math.min((w - 60) / sw, (h - 60) / sh));
    S.view.cx = (x0 + x1) / 2; S.view.cy = (y0 + y1) / 2; S.view.fitted = true;
  }
  function zoom(f, px, py) {
    const { w, h } = canvasSize(); if (px === undefined) { px = w / 2; py = h / 2; }
    const [wx, wy] = s2w(px, py);
    S.view.scale = Math.max(0.05, Math.min(200, S.view.scale * f));
    S.view.cx = wx - (px - w / 2) / S.view.scale; S.view.cy = wy + (py - h / 2) / S.view.scale;
    drawView();
  }
  // 그룹의 표시 크기: 포켓 공정이 있으면 포켓 모양·크기, 아니면 가장 큰 공구 직경
  function extentOf(g, tm) {
    const pk = g.ops.find(o => o.type === 'pocketRough' || o.type === 'pocketFinish');
    if (pk) {
      if (pk.shape === 'circle') return { pocket: true, rect: false, d: C.toNum(pk.dia, 10) };
      return { pocket: true, rect: true, w: C.toNum(pk.w, 10), h: C.toNum(pk.h, 10), cr: C.toNum(pk.cr, 0) };
    }
    return { pocket: false, rect: false, d: C.holeDiaForGroup(g, tm) || 3 };
  }
  function roundRect(x, a, b, w, h, r) {
    r = Math.max(0, r); x.moveTo(a + r, b); x.lineTo(a + w - r, b); x.arcTo(a + w, b, a + w, b + r, r); x.lineTo(a + w, b + h - r); x.arcTo(a + w, b + h, a + w - r, b + h, r);
    x.lineTo(a + r, b + h); x.arcTo(a, b + h, a, b + h - r, r); x.lineTo(a, b + r); x.arcTo(a, b, a + r, b, r); x.closePath();
  }
  const uf = v => String(C.fmt(v)).replace(/\.$/, ''); // 화면 표시용 (NC 끝 소수점 제거)
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function drawView() {
    const c = cv(); if (!c) return;
    const { w, h } = canvasSize(); if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    if (!S.view.fitted) fitView();
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = cssVar('--cv-bg'); x.fillRect(0, 0, w, h);
    const sc = S.view.scale, gs = DB.settings.grid;
    // 격자
    if (gs.show) {
      let step = gs.step; while (step * sc < 7) step *= (String(step).startsWith('2') ? 2.5 : 2);
      const [wx0, wy1] = s2w(0, 0), [wx1, wy0] = s2w(w, h);
      x.lineWidth = 1;
      const major = step * 5;
      for (let gx = Math.floor(wx0 / step) * step; gx <= wx1; gx += step) { const [sx] = w2s(gx, 0); x.strokeStyle = Math.abs(gx / major - Math.round(gx / major)) < 1e-6 ? cssVar('--cv-grid2') : cssVar('--cv-grid'); x.beginPath(); x.moveTo(Math.round(sx) + .5, 0); x.lineTo(Math.round(sx) + .5, h); x.stroke(); }
      for (let gy = Math.floor(wy0 / step) * step; gy <= wy1; gy += step) { const [, sy] = w2s(0, gy); x.strokeStyle = Math.abs(gy / major - Math.round(gy / major)) < 1e-6 ? cssVar('--cv-grid2') : cssVar('--cv-grid'); x.beginPath(); x.moveTo(0, Math.round(sy) + .5); x.lineTo(w, Math.round(sy) + .5); x.stroke(); }
    }
    // 소재
    const r = C.stockRect(P.stock);
    const [a0, b0] = w2s(r.x0, r.y1), [a1, b1] = w2s(r.x1, r.y0);
    x.fillStyle = cssVar('--cv-stock'); x.fillRect(a0, b0, a1 - a0, b1 - b0);
    x.strokeStyle = cssVar('--cv-stock-line'); x.lineWidth = 1.5; x.strokeRect(a0, b0, a1 - a0, b1 - b0);
    x.fillStyle = cssVar('--muted'); x.font = '12px ' + cssVar('--font');
    x.fillText(P.stock.sx + ' × ' + P.stock.sy + ' × ' + P.stock.sz + ' ' + P.stock.material, a0 + 4, b0 - 6);
    // 클램프
    P.clamps.forEach((cl, i) => {
      const [p0, q0] = w2s(Math.min(cl.x, cl.x + cl.w), Math.max(cl.y, cl.y + cl.h)), [p1, q1] = w2s(Math.max(cl.x, cl.x + cl.w), Math.min(cl.y, cl.y + cl.h));
      x.save(); x.fillStyle = 'rgba(230,120,20,.18)'; x.fillRect(p0, q0, p1 - p0, q1 - q0); x.strokeStyle = '#d9731a'; x.lineWidth = 1.5; x.setLineDash([5, 3]); x.strokeRect(p0, q0, p1 - p0, q1 - q0);
      x.beginPath(); x.rect(p0, q0, p1 - p0, q1 - q0); x.clip(); x.setLineDash([]); x.strokeStyle = 'rgba(217,115,26,.45)';
      for (let k = -Math.abs(q1 - q0); k < Math.abs(p1 - p0); k += 8) { x.beginPath(); x.moveTo(p0 + k, q1); x.lineTo(p0 + k + (q1 - q0), q0); x.stroke(); }
      x.restore(); x.fillStyle = '#b85c0c'; x.fillText('클램프' + (i + 1) + ' H' + cl.height, p0 + 2, q0 - 3);
    });
    // 원점 축
    const [ox, oy] = w2s(0, 0), al = 40;
    x.lineWidth = 2; x.strokeStyle = '#d62728'; x.beginPath(); x.moveTo(ox, oy); x.lineTo(ox + al, oy); x.stroke(); x.fillStyle = '#d62728'; x.fillText('X', ox + al + 3, oy + 4);
    x.strokeStyle = '#2ca02c'; x.beginPath(); x.moveTo(ox, oy); x.lineTo(ox, oy - al); x.stroke(); x.fillStyle = '#2ca02c'; x.fillText('Y', ox - 4, oy - al - 4);
    x.fillStyle = cssVar('--text'); x.beginPath(); x.arc(ox, oy, 3.5, 0, Math.PI * 2); x.fill();
    x.fillText(P.settings.wcs, ox + 5, oy + 14);
    // 경로
    const steps = S.V.plan.steps;
    const errHoles = new Set(S.V.issues.filter(i => i.level === 'error' && i.ref && i.ref.hid).map(i => i.ref.hid));
    const warnHoles = new Set(S.V.issues.filter(i => i.level === 'warn' && i.ref && i.ref.hid).map(i => i.ref.hid));
    if (S.showPath && steps.length) {
      const show = S.pathStep ? steps.filter(s => s.idx === S.pathStep) : steps;
      show.forEach(s => {
        x.strokeStyle = S.pathStep ? '#7b3fd0' : 'rgba(123,63,208,.35)'; x.lineWidth = S.pathStep ? 1.6 : 1; x.setLineDash([4, 3]);
        x.beginPath(); s.holes.forEach((hh, k) => { const [px, py] = w2s(hh.x, hh.y); if (k) x.lineTo(px, py); else x.moveTo(px, py); }); x.stroke(); x.setLineDash([]);
        if (S.pathStep) {
          s.holes.forEach((hh, k) => {
            const [px, py] = w2s(hh.x, hh.y);
            if (k) { const [qx, qy] = w2s(s.holes[k - 1].x, s.holes[k - 1].y); const mx = (px + qx) / 2, my = (py + qy) / 2, an = Math.atan2(py - qy, px - qx); x.fillStyle = '#7b3fd0'; x.beginPath(); x.moveTo(mx + 6 * Math.cos(an), my + 6 * Math.sin(an)); x.lineTo(mx + 6 * Math.cos(an + 2.5), my + 6 * Math.sin(an + 2.5)); x.lineTo(mx + 6 * Math.cos(an - 2.5), my + 6 * Math.sin(an - 2.5)); x.fill(); }
            x.fillStyle = '#7b3fd0'; x.font = 'bold 11px ' + cssVar('--font'); x.fillText(String(k + 1), px + 7, py - 7);
          });
        }
      });
    }
    // 구멍·포켓 (포켓은 실제 크기의 사각/원형, 구멍은 공구 직경 원) + 바닥 Z 표시
    const tm = C.toolMap(machine());
    P.groups.forEach(g => {
      const ext = extentOf(g, tm), z = S.gz ? S.gz.get(g.id) : null;
      const lbl = S.gzLabel ? S.gzLabel.get(g.id) : '';
      g.holes.forEach((hh, hk) => {
        if (!C.isNum(hh.x) || !C.isNum(hh.y)) return;
        const [px, py] = w2s(hh.x, hh.y);
        x.fillStyle = g.color + (ext.pocket ? '38' : '55'); x.strokeStyle = g.color; x.lineWidth = 1.5;
        let rr;
        if (ext.rect) {
          const hw = ext.w / 2 * sc, hh2 = ext.h / 2 * sc, cr = Math.min(ext.cr * sc, hw, hh2);
          x.beginPath(); roundRect(x, px - hw, py - hh2, hw * 2, hh2 * 2, cr); x.fill(); x.stroke();
          rr = Math.max(hw, hh2);
        } else {
          rr = Math.max(3, ext.d / 2 * sc);
          x.beginPath(); x.arc(px, py, rr, 0, Math.PI * 2); x.fill(); x.stroke();
        }
        x.beginPath(); x.moveTo(px - 3, py); x.lineTo(px + 3, py); x.moveTo(px, py - 3); x.lineTo(px, py + 3); x.stroke();
        // 깊이 이름표: 포켓은 각각, 구멍·탭은 그룹의 첫 위치에만 (화면 혼잡 방지, 나머지는 마우스를 올리면 표시)
        if (lbl && hh.id !== S.sel.hid && (ext.pocket ? rr > 18 : hk === 0 && rr >= 4)) {
          x.font = '600 11.5px ' + cssVar('--font'); x.textAlign = ext.pocket ? 'center' : 'start';
          const tx = ext.pocket ? px : px + rr + 5, ty = ext.pocket ? py + 15 : py + 4, tw = x.measureText(lbl).width;
          x.fillStyle = cssVar('--surface'); x.globalAlpha = 0.85; x.fillRect(ext.pocket ? tx - tw / 2 - 3 : tx - 3, ty - 11, tw + 6, 15); x.globalAlpha = 1;
          x.fillStyle = cssVar('--text'); x.fillText(lbl, tx, ty); x.textAlign = 'start';
        }
        const ring = (pad) => { x.beginPath(); if (ext.rect) { const hw = ext.w / 2 * sc + pad, hh2 = ext.h / 2 * sc + pad; roundRect(x, px - hw, py - hh2, hw * 2, hh2 * 2, Math.min(ext.cr * sc + pad, hw, hh2)); } else x.arc(px, py, (ext.pocket ? rr : Math.min(rr, 60)) + pad, 0, Math.PI * 2); x.stroke(); };
        if (errHoles.has(hh.id) || warnHoles.has(hh.id)) { x.strokeStyle = errHoles.has(hh.id) ? cssVar('--err') : cssVar('--warn'); x.lineWidth = 2.5; ring(4); }
        if (hh.id === S.sel.hid) { x.strokeStyle = cssVar('--brand'); x.lineWidth = 2; x.setLineDash([3, 2]); ring(8); x.setLineDash([]); x.fillStyle = cssVar('--text'); x.font = '12px ' + cssVar('--mono'); x.fillText('X' + uf(hh.x) + ' Y' + uf(hh.y) + (lbl ? '  ' + lbl : ''), px + Math.min(rr, 60) + 10, py + 4); }
      });
    });
    // NC 해석 결과 오버레이 (독립 검증기의 해석 결과)
    const vr = S.nc.edited ? S.nc.editVerify : S.nc.verify;
    if (S.showNC && vr) {
      x.strokeStyle = '#e0457b'; x.lineWidth = 1; x.setLineDash([2, 3]);
      vr.moves.forEach(mv => { const [p0, q0] = w2s(mv.x0, mv.y0), [p1, q1] = w2s(mv.x1, mv.y1); x.beginPath(); x.moveTo(p0, q0); x.lineTo(p1, q1); x.stroke(); });
      x.setLineDash([]); x.lineWidth = 2;
      vr.hits.forEach(ht => { const [px, py] = w2s(ht.x, ht.y); x.beginPath(); x.moveTo(px - 5, py - 5); x.lineTo(px + 5, py + 5); x.moveTo(px + 5, py - 5); x.lineTo(px - 5, py + 5); x.stroke(); });
    }
    // 드래그 중인 클램프
    if (drag && drag.kind === 'clamp' && drag.cur) {
      const [p0, q0] = w2s(drag.w0[0], drag.w0[1]), [p1, q1] = w2s(drag.cur[0], drag.cur[1]);
      x.strokeStyle = '#d9731a'; x.setLineDash([4, 3]); x.strokeRect(Math.min(p0, p1), Math.min(q0, q1), Math.abs(p1 - p0), Math.abs(q1 - q0)); x.setLineDash([]);
    }
    // 축척 막대
    let bar = 10; while (bar * sc < 60) bar *= (String(bar).startsWith('2') ? 2.5 : 2); while (bar * sc > 160) bar /= 2;
    x.strokeStyle = cssVar('--text'); x.lineWidth = 2; x.beginPath(); x.moveTo(w - 20 - bar * sc, h - 14); x.lineTo(w - 20, h - 14); x.stroke();
    x.fillStyle = cssVar('--text'); x.font = '11px ' + cssVar('--font'); x.fillText(C.r3(bar) + ' mm', w - 20 - bar * sc, h - 20);
  }
    const wrap = fn => function () { sync(); return fn.apply(null, arguments); };
    return { extentOf, size: wrap(canvasSize), w2s: wrap(w2s), s2w: wrap(s2w), fit: wrap(fitView), zoom: wrap(zoom), draw: wrap(drawView) };
  };
})();
