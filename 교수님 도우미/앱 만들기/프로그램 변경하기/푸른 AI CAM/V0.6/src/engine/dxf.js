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
  const TOL = 0.05, CHORD = 0.01, MAX_ENT = 200000; // [V0.5 검토] 끝점 잇기 허용 0.05mm (실제 CAD 도면의 미세한 틈)

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
        if (u === 1) { scale = 25.4; units = 'inch'; } else if (u === 2) { scale = 304.8; units = 'feet'; } else if (u === 5) { scale = 10; units = 'cm'; } else if (u === 6) { scale = 1000; units = 'm'; } else if (u === 4) { scale = 1; units = 'mm'; }
        else if (u === 0) { units = 'none'; }
        else { warnings.push('도면 단위(코드 ' + u + ')를 알 수 없어 mm 로 읽었습니다. 치수를 꼭 확인하세요.'); }
        break;
      }
    }
    // 단위 없음(0) 또는 단위 코드 없음: $MEASUREMENT 0 = 인치 도면
    if (units === 'none' || !pairs.some(p => p[0] === 9 && p[1] === '$INSUNITS')) {
      const mi = pairs.findIndex(p => p[0] === 9 && p[1] === '$MEASUREMENT');
      if (mi >= 0 && pairs[mi + 1] && parseInt(pairs[mi + 1][1], 10) === 0) { scale = 25.4; units = 'inch'; warnings.push('도면 단위가 지정되지 않았고 인치 도면($MEASUREMENT 0)이라 인치로 읽었습니다. 치수를 확인하세요.'); }
      else units = 'mm';
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
    let badNum = 0, tilted = 0;
    // [V0.5 검토] 돌출 방향(OCS) Z 가 음수면 X 가 뒤집힌 좌표 (거울 도면) → 평면 좌표로 바꿈. 기울어진 평면은 제외
    const ocs = e => { const ex = num(e, 210, 0), ey = num(e, 220, 0), ez = num(e, 230, 1); if (Math.abs(ex) > 1e-6 || Math.abs(ey) > 1e-6) return 0; return ez < 0 ? -1 : 1; };
    let polyOpen = null;
    for (const e of ents) {
      const t = e.type;
      e.g.forEach(([c, v]) => { if ([10, 20, 11, 21, 40].includes(c) && !isFinite(parseFloat(v))) badNum++; });
      const fx = ['CIRCLE', 'ARC', 'LWPOLYLINE', 'ELLIPSE'].includes(t) ? ocs(e) : 1;
      if (fx === 0) { tilted++; continue; }
      if (fx < 0) { mirrorEnt(e); }
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
        const a = Math.hypot(mx, my), rot = Math.atan2(my, mx), n = Math.min(4000, Math.max(16, Math.ceil(a * 4))), pts = [];
        let sw = t1 - t0; while (sw <= 1e-9) sw += 2 * Math.PI;
        for (let k = 0; k <= n; k++) { const tt = t0 + sw * k / n, ex = a * Math.cos(tt), ey = a * ratio * Math.sin(tt); pts.push([cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot)]); }
        segs.push(pts);
      } else if (!['TEXT', 'MTEXT', 'DIMENSION', 'HATCH', 'POINT', 'LEADER', 'SOLID', 'VIEWPORT', 'ATTRIB', 'ATTDEF'].includes(t)) skipped[t] = (skipped[t] || 0) + 1;
    }
    // OCS 거울: X 좌표 부호 반전, 원호 각도 a → 180°−a (방향 유지 위해 시작·끝 교환), 볼록 부호 반전
    function mirrorEnt(e) {
      const t = e.type;
      if (t === 'ARC') { const a0 = num(e, 50, 0), a1 = num(e, 51, 360); e.g = e.g.filter(x => x[0] !== 50 && x[0] !== 51).concat([[50, String(180 - a1)], [51, String(180 - a0)]]); }
      e.g = e.g.map(([c, v]) => (c === 10 || c === 11) ? [c, String(-parseFloat(v))] : c === 42 ? [c, String(-parseFloat(v))] : [c, v]);
      if (t === 'ELLIPSE') { const t0 = num(e, 41, 0), t1 = num(e, 42, 2 * Math.PI); e.g = e.g.filter(x => x[0] !== 41 && x[0] !== 42).concat([[41, String(Math.PI - t1)], [42, String(Math.PI - t0)]]); }
    }
    function polyToSeg(vs, closed) {
      if (vs.length < 2) return;
      const pts = [];
      const n = closed ? vs.length : vs.length - 1;
      for (let i = 0; i < n; i++) { const a = vs[i], b = vs[(i + 1) % vs.length]; const part = bulgePts([a.x, a.y], [b.x, b.y], a.b || 0); if (pts.length) part.shift(); pts.push(...part); }
      segs.push(pts);
    }
    if (badNum) warnings.push('숫자가 아닌 좌표 ' + badNum + '개가 있어 해당 점을 0 으로 읽거나 버렸습니다. 도면을 확인하세요.');
    if (tilted) warnings.push('기울어진 평면에 그린 요소 ' + tilted + '개는 제외했습니다 (평면도로 다시 저장하세요).');
    Object.keys(skipped).forEach(k => warnings.push(k + ' 요소 ' + skipped[k] + '개는 지원하지 않아 무시했습니다' + (k === 'SPLINE' ? ' (CAD 에서 폴리선으로 바꿔 저장하세요)' : k === 'INSERT' ? ' (CAD 에서 블록을 분해(EXPLODE)해 저장하세요)' : '') + '.'));
    // 단위 환산
    // [V0.5 검토] 같은 선이 두 번 그려진 경우(중복) 하나만 사용
    const seen = new Set();
    let dup = 0;
    const segS = segs.filter(a => a.length >= 2).filter(a => { const q = v => Math.round(v * 100); const k1 = a.map(p => q(p[0]) + ',' + q(p[1])).join(';'), k2 = a.slice().reverse().map(p => q(p[0]) + ',' + q(p[1])).join(';'); const k = k1 < k2 ? k1 : k2; if (seen.has(k)) { dup++; return false; } seen.add(k); return true; });
    if (dup) warnings.push('겹쳐 그려진 같은 선 ' + dup + '개는 하나로 합쳤습니다.');
    const circS = circles.filter(c => c.r > 0);
    // 끝점 잇기 ([V0.5 검토] 끝점 격자 색인으로 빠르게: 요소 수만 개도 즉시)
    const loops = [], used = new Array(segS.length).fill(false);
    const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= TOL;
    const idx = new Map(), cell = p => Math.floor(p[0] / (TOL * 4)) + ',' + Math.floor(p[1] / (TOL * 4));
    segS.forEach((sg, i) => [sg[0], sg[sg.length - 1]].forEach(p => { const k = cell(p); if (!idx.has(k)) idx.set(k, []); idx.get(k).push(i); }));
    const cands = p => { const cx = Math.floor(p[0] / (TOL * 4)), cy = Math.floor(p[1] / (TOL * 4)), out = []; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = idx.get((cx + i) + ',' + (cy + j)); if (a) out.push(...a); } return out; };
    let open = 0;
    for (let i = 0; i < segS.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      let chain = segS[i].slice();
      let grown = true;
      while (grown && !near(chain[0], chain[chain.length - 1])) {
        grown = false;
        const end = chain[chain.length - 1];
        for (const j of cands(end)) {
          if (used[j]) continue;
          const sj = segS[j];
          if (near(sj[0], end)) { chain = chain.concat(sj.slice(1)); used[j] = true; grown = true; break; }
          if (near(sj[sj.length - 1], end)) { chain = chain.concat(sj.slice(0, -1).reverse()); used[j] = true; grown = true; break; }
        }
      }
      if (chain.length >= 4 && near(chain[0], chain[chain.length - 1])) { chain.pop(); loops.push(dedupe(chain)); }
      else open++;
    }
    if (open) warnings.push('닫히지 않은 선 ' + open + '개는 가공 형상에서 제외했습니다 (끝점이 0.05mm 이상 떨어짐).');
    return { units, scale, loops: loops.filter(l => l.length >= 3), circles: circS, warnings };
  }
  function dedupe(pts) { const out = []; pts.forEach(p => { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) out.push(p); }); return out; }

  // 분류: 원 → 지름별 구멍, 닫힌 윤곽 → 포함 관계로 부품 외곽 / 포켓 / 섬
  function classify(res) {
    const G = P.GEOM;
    const items = res.loops.map((pts, i) => ({ i, pts, area: Math.abs(G.area(pts)), bb: G.bbox([pts]) })).sort((a, b) => b.area - a.area);
    // a 가 b 안: 경계 상자 먼저 비교 (빠름), 그다음 점 포함 검사 ([V0.5 검토] 윤곽 수천 개도 빠르게)
    const bbIn = (a, b) => a.bb.x0 >= b.bb.x0 - 1e-9 && a.bb.x1 <= b.bb.x1 + 1e-9 && a.bb.y0 >= b.bb.y0 - 1e-9 && a.bb.y1 <= b.bb.y1 + 1e-9;
    const inside = (a, b) => a.area < b.area && bbIn(a, b) && G.inPaths([b.path || (b.path = G.toPath(b.pts))], a.pts[0][0], a.pts[0][1]);
    // 면적 큰 순 정렬이므로 자기보다 앞(큰 것)만, 뒤에서부터(작은 것부터) 찾으면 첫 포함이 가장 가까운 부모
    items.forEach((it, k) => { it.parent = null; for (let j = k - 1; j >= 0; j--) { if (inside(it, items[j])) { it.parent = items[j]; break; } } });
    items.forEach(it => { delete it.path; });
    items.forEach(it => { let d = 0, p = it.parent; while (p) { d++; p = p.parent; } it.depth = d; });
    const holes = new Map();
    res.circles.forEach(c => { const d = Math.round(c.r * 2 * 1000) / 1000, k = String(d); if (!holes.has(k)) holes.set(k, { dia: d, pts: [] }); holes.get(k).pts.push([c.cx, c.cy]); });
    return { items, holes: [...holes.values()].sort((a, b) => a.dia - b.dia) };
  }

  P.DXF = Object.freeze({ parse, classify, bulgePts });
})(typeof globalThis !== 'undefined' ? globalThis : this);
