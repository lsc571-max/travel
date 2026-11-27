/* =====================================================================
 * 푸른 AI CAM - [공통 엔진: DXF 도면 읽기] engine/dxf.js  (V0.5)
 * 역할: ASCII DXF 파일에서 2D 형상을 읽어 닫힌 윤곽·원으로 정리한다 (외부 라이브러리 없음).
 *   지원: LINE, ARC, CIRCLE, LWPOLYLINE(볼록 bulge 포함), POLYLINE/VERTEX, ELLIPSE(근사)
 *   미지원(경고): SPLINE, INSERT(블록 참조), TEXT·치수 등은 무시
 *   단위: 헤더 $INSUNITS (1 inch, 4 mm, 5 cm, 6 m), 없으면 mm
 *   열린 선분·원호는 끝점이 0.01mm 이내로 이어지면 하나의 닫힌 윤곽으로 묶는다.
 * 결과는 화면(도면 불러오기)이 구멍(원)·윤곽·포켓·섬으로 분류해 가공을 만든다.
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  const TOL = 0.01, CHORD = 0.01, MAX_ENT = 200000;

  function arcPts(cx, cy, r, a0, a1, ccw) {
    // a0 → a1 (라디안), ccw 방향. 현 오차 CHORD 이하로 분할
    let sweep = ccw ? a1 - a0 : a0 - a1;
    while (sweep <= 1e-12) sweep += 2 * Math.PI;
    const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - CHORD / Math.max(r, 1e-9))));
    const n = Math.max(2, Math.ceil(sweep / Math.max(step, 1e-3)));
    const out = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (ccw ? 1 : -1) * sweep * i / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return out;
  }
  // 두 점 사이 볼록(bulge) 원호
  function bulgePts(p, q, b) {
    if (Math.abs(b) < 1e-9) return [p, q];
    const th = 4 * Math.atan(b), c = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (c < 1e-12) return [p, q];
    const r = c / (2 * Math.sin(Math.abs(th) / 2));
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, dx = (q[0] - p[0]) / c, dy = (q[1] - p[1]) / c;
    const h = Math.sqrt(Math.max(0, r * r - c * c / 4)) * (Math.abs(th) > Math.PI ? -1 : 1) * Math.sign(b);
    const cx = mx - dy * h, cy = my + dx * h;
    return arcPts(cx, cy, r, Math.atan2(p[1] - cy, p[0] - cx), Math.atan2(q[1] - cy, q[0] - cx), b > 0);
  }

  function parse(text) {
    const lines = String(text).split(/\r?\n/), pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
    const warnings = [];
    let scale = 1, units = 'mm';
    // 헤더 단위
    for (let i = 0; i < pairs.length - 1; i++) {
      if (pairs[i][0] === 9 && pairs[i][1] === '$INSUNITS') {
        const u = parseInt(pairs[i + 1][1], 10);
        if (u === 1) { scale = 25.4; units = 'inch'; } else if (u === 5) { scale = 10; units = 'cm'; } else if (u === 6) { scale = 1000; units = 'm'; } else if (u === 4 || u === 0) { scale = 1; units = 'mm'; }
        else { warnings.push('도면 단위(코드 ' + u + ')를 알 수 없어 mm 로 읽었습니다.'); }
        break;
      }
    }
    // ENTITIES 구간
    let s = pairs.findIndex((p, i) => p[0] === 2 && p[1] === 'ENTITIES' && pairs[i - 1] && pairs[i - 1][1] === 'SECTION');
    if (s < 0) return { error: 'DXF 파일이 아니거나 ENTITIES 구역이 없습니다 (ASCII DXF 만 지원).' };
    const ents = [];
    let cur = null;
    for (let i = s + 1; i < pairs.length; i++) {
      const [c, v] = pairs[i];
      if (c === 0) { if (cur) ents.push(cur); if (v === 'ENDSEC') { cur = null; break; } cur = { type: v, g: [] }; if (ents.length > MAX_ENT) return { error: '도면 요소가 너무 많습니다 (' + MAX_ENT + '개 초과).' }; continue; }
      if (cur) cur.g.push([c, v]);
    }
    // 좌표·반지름은 읽을 때 mm 로 환산 (원호 분할 오차를 mm 기준으로 맞추기 위해). 각도·비율·볼록은 환산하지 않음
    const LEN = new Set([10, 20, 11, 21, 40]);
    const num = (e, code, def) => { const f = e.g.find(x => x[0] === code); const n = f ? parseFloat(f[1]) : NaN; return isFinite(n) ? (LEN.has(code) && !(e.type === 'ELLIPSE' && code === 40) ? n * scale : n) : def; };
    const segs = [], circles = [], skipped = {};
    let polyOpen = null;
    for (const e of ents) {
      const t = e.type;
      if (t === 'LINE') segs.push([[num(e, 10, 0), num(e, 20, 0)], [num(e, 11, 0), num(e, 21, 0)]]);
      else if (t === 'CIRCLE') circles.push({ cx: num(e, 10, 0), cy: num(e, 20, 0), r: num(e, 40, 0) });
      else if (t === 'ARC') { const cx = num(e, 10, 0), cy = num(e, 20, 0), r = num(e, 40, 0); segs.push(arcPts(cx, cy, r, num(e, 50, 0) * Math.PI / 180, num(e, 51, 360) * Math.PI / 180, true)); }
      else if (t === 'LWPOLYLINE') {
        const closed = (num(e, 70, 0) & 1) === 1, vs = [];
        e.g.forEach(([c, v]) => { if (c === 10) vs.push({ x: parseFloat(v) * scale, y: 0, b: 0 }); else if (c === 20 && vs.length) vs[vs.length - 1].y = parseFloat(v) * scale; else if (c === 42 && vs.length) vs[vs.length - 1].b = parseFloat(v); });
        polyToSeg(vs, closed);
      } else if (t === 'POLYLINE') polyOpen = { closed: (num(e, 70, 0) & 1) === 1, vs: [] };
      else if (t === 'VERTEX' && polyOpen) polyOpen.vs.push({ x: num(e, 10, 0), y: num(e, 20, 0), b: num(e, 42, 0) });
      else if (t === 'SEQEND' && polyOpen) { polyToSeg(polyOpen.vs, polyOpen.closed); polyOpen = null; }
      else if (t === 'ELLIPSE') {
        const cx = num(e, 10, 0), cy = num(e, 20, 0), mx = num(e, 11, 1), my = num(e, 21, 0), ratio = num(e, 40, 1), t0 = num(e, 41, 0), t1 = num(e, 42, 2 * Math.PI);
        const a = Math.hypot(mx, my), rot = Math.atan2(my, mx), n = Math.max(16, Math.ceil(a * 4)), pts = [];
        let sw = t1 - t0; while (sw <= 1e-9) sw += 2 * Math.PI;
        for (let k = 0; k <= n; k++) { const tt = t0 + sw * k / n, ex = a * Math.cos(tt), ey = a * ratio * Math.sin(tt); pts.push([cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot)]); }
        segs.push(pts);
      } else if (!['TEXT', 'MTEXT', 'DIMENSION', 'HATCH', 'POINT', 'LEADER', 'SOLID', 'VIEWPORT', 'ATTRIB', 'ATTDEF'].includes(t)) skipped[t] = (skipped[t] || 0) + 1;
    }
    function polyToSeg(vs, closed) {
      if (vs.length < 2) return;
      const pts = [];
      const n = closed ? vs.length : vs.length - 1;
      for (let i = 0; i < n; i++) { const a = vs[i], b = vs[(i + 1) % vs.length]; const part = bulgePts([a.x, a.y], [b.x, b.y], a.b || 0); if (pts.length) part.shift(); pts.push(...part); }
      segs.push(pts);
    }
    Object.keys(skipped).forEach(k => warnings.push(k + ' 요소 ' + skipped[k] + '개는 지원하지 않아 무시했습니다' + (k === 'SPLINE' ? ' (CAD 에서 폴리선으로 바꿔 저장하세요)' : k === 'INSERT' ? ' (CAD 에서 블록을 분해(EXPLODE)해 저장하세요)' : '') + '.'));
    // 단위 환산
    const segS = segs.filter(a => a.length >= 2);
    const circS = circles.filter(c => c.r > 0);
    // 끝점 잇기
    const loops = [], used = new Array(segS.length).fill(false);
    const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= TOL;
    let open = 0;
    for (let i = 0; i < segS.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      let chain = segS[i].slice();
      let grown = true;
      while (grown && !near(chain[0], chain[chain.length - 1])) {
        grown = false;
        const end = chain[chain.length - 1];
        for (let j = 0; j < segS.length; j++) {
          if (used[j]) continue;
          const sj = segS[j];
          if (near(sj[0], end)) { chain = chain.concat(sj.slice(1)); used[j] = true; grown = true; break; }
          if (near(sj[sj.length - 1], end)) { chain = chain.concat(sj.slice(0, -1).reverse()); used[j] = true; grown = true; break; }
        }
      }
      if (chain.length >= 4 && near(chain[0], chain[chain.length - 1])) { chain.pop(); loops.push(dedupe(chain)); }
      else open++;
    }
    if (open) warnings.push('닫히지 않은 선 ' + open + '개는 가공 형상에서 제외했습니다 (끝점이 0.01mm 이상 떨어짐).');
    return { units, scale, loops: loops.filter(l => l.length >= 3), circles: circS, warnings };
  }
  function dedupe(pts) { const out = []; pts.forEach(p => { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) out.push(p); }); return out; }

  // 분류: 원 → 지름별 구멍, 닫힌 윤곽 → 포함 관계로 부품 외곽 / 포켓 / 섬
  function classify(res) {
    const G = P.GEOM;
    const items = res.loops.map((pts, i) => ({ i, pts, area: Math.abs(G.area(pts)), bb: G.bbox([pts]) })).sort((a, b) => b.area - a.area);
    const inside = (a, b) => G.inPaths([G.toPath(b.pts)], a.pts[0][0], a.pts[0][1]) && a.area < b.area; // a 가 b 안
    items.forEach(it => { it.parent = null; for (const o of items) if (o !== it && inside(it, o) && (!it.parent || o.area < it.parent.area)) it.parent = o; });
    items.forEach(it => { let d = 0, p = it.parent; while (p) { d++; p = p.parent; } it.depth = d; });
    const holes = new Map();
    res.circles.forEach(c => { const d = Math.round(c.r * 2 * 1000) / 1000, k = String(d); if (!holes.has(k)) holes.set(k, { dia: d, pts: [] }); holes.get(k).pts.push([c.cx, c.cy]); });
    return { items, holes: [...holes.values()].sort((a, b) => a.dia - b.dia) };
  }

  P.DXF = Object.freeze({ parse, classify, bulgePts });
})(typeof globalThis !== 'undefined' ? globalThis : this);
