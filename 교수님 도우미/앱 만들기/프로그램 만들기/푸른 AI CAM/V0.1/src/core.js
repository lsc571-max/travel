/* =====================================================================
 * 푸른 AI CAM - 계산 엔진 (core.js)
 * - 화면(UI)과 분리된 순수 계산 모듈: 브라우저와 Node.js 테스트에서 동일하게 사용
 * - G코드는 AI가 만들지 않고, 아래의 결정적(deterministic) 계산식과
 *   FANUC 포스트프로세서로만 생성한다.
 * - generateNC(생성기)와 verifyNC(검증기)는 서로 다른 코드 경로로 작성하여
 *   생성 결과를 독립적으로 다시 해석·검증한다.
 * ===================================================================== */
(function (root) {
  'use strict';

  const VERSION = 'V0.1';
  const BUILD_DATE = '2026-11-27';
  const EPS = 1e-6;
  const CLAMP_MARGIN = 2;      // 클램프 위 최소 통과 여유(mm)
  const MAX_HOLES = 5000;      // 프로젝트당 최대 홀 수
  const FANUC_MAX = 99999.999; // FANUC 좌표 최대 입력값(mm, 소수 3자리 기준)

  /* ---------------- 기본 정의 ---------------- */
  const OP_TYPES = {
    center: { label: '센터 드릴', code: 'G81', stage: 1, tools: ['center'] },
    drill:  { label: '일반 드릴', code: 'G81', stage: 2, tools: ['drill'] },
    peck:   { label: '고속 펙 드릴', code: 'G73', stage: 2, tools: ['drill'] },
    deep:   { label: '심공 드릴', code: 'G83', stage: 2, tools: ['drill'] },
    tap:    { label: '일반 탭', code: 'G84', stage: 3, tools: ['tap'] },
    rigid:  { label: '리지드 탭', code: 'M29+G84', stage: 3, tools: ['tap'] }
  };
  const TOOL_TYPES = { center: '센터/스팟 드릴', drill: '드릴', tap: '탭' };
  const isDrillOp = t => t === 'drill' || t === 'peck' || t === 'deep';
  const isTapOp = t => t === 'tap' || t === 'rigid';

  // 재질별 참고 절삭 조건 (일반 공구 카탈로그 범위의 보수적 대표값, 공구 제조사 값 우선)
  const MATERIALS = {
    AL6061: { label: '알루미늄 (AL6061 등)', vcHss: 70, vcCarb: 150, fFactor: 1.3, vcTap: 15 },
    C3604:  { label: '황동 (C3604)', vcHss: 45, vcCarb: 120, fFactor: 1.2, vcTap: 12 },
    SS400:  { label: '일반 구조용강 (SS400)', vcHss: 25, vcCarb: 80, fFactor: 1.0, vcTap: 8 },
    S45C:   { label: '기계 구조용 탄소강 (S45C)', vcHss: 20, vcCarb: 70, fFactor: 0.9, vcTap: 7 },
    SCM440: { label: '합금강 (SCM440)', vcHss: 15, vcCarb: 60, fFactor: 0.8, vcTap: 5 },
    SUS304: { label: '스테인리스 (SUS304)', vcHss: 12, vcCarb: 45, fFactor: 0.7, vcTap: 4 },
    FC250:  { label: '회주철 (FC250)', vcHss: 20, vcCarb: 70, fFactor: 1.1, vcTap: 8 }
  };

  // 미터 보통 나사: [호칭경, 피치, 표준 기초 드릴]
  const METRIC_COARSE = [
    [1.6, 0.35, 1.25], [2, 0.4, 1.6], [2.5, 0.45, 2.05], [3, 0.5, 2.5], [4, 0.7, 3.3],
    [5, 0.8, 4.2], [6, 1.0, 5.0], [8, 1.25, 6.8], [10, 1.5, 8.5], [12, 1.75, 10.2],
    [14, 2.0, 12.0], [16, 2.0, 14.0], [18, 2.5, 15.5], [20, 2.5, 17.5], [22, 2.5, 19.5],
    [24, 3.0, 21.0], [27, 3.0, 24.0], [30, 3.5, 26.5]
  ];
  // 미터 가는 나사(대표): [호칭경, 피치]
  const METRIC_FINE = [
    [8, 1.0], [10, 1.25], [10, 1.0], [12, 1.5], [12, 1.25], [14, 1.5], [16, 1.5],
    [18, 1.5], [18, 2.0], [20, 1.5], [20, 2.0], [22, 1.5], [22, 2.0], [24, 2.0], [24, 1.5],
    [27, 2.0], [30, 2.0], [30, 1.5]
  ];

  const CHECKS = [
    { id: 1, name: '좌표값 유효성' },
    { id: 2, name: '소재 범위' },
    { id: 3, name: '중복·간섭 홀' },
    { id: 4, name: '공구 번호·종류' },
    { id: 5, name: '공구 직경·탭 기초 드릴' },
    { id: 6, name: '절삭 조건 (S·F·Vc)' },
    { id: 7, name: '탭 이송·장비 지원' },
    { id: 8, name: '가공 깊이' },
    { id: 9, name: '펙·사이클 조건' },
    { id: 10, name: '안전 높이·충돌' },
    { id: 11, name: 'NC 구조·장비 설정' }
  ];

  /* ---------------- 공통 유틸 ---------------- */
  let _uidN = 0;
  function uid(p) { _uidN = (_uidN + 1) % 1e6; return (p || 'id') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + _uidN.toString(36); }
  const isNum = v => typeof v === 'number' && isFinite(v);
  const r3 = v => Math.round(v * 1000) / 1000;
  const deg = a => a * Math.PI / 180;
  function toNum(v, d) { const n = typeof v === 'string' ? parseFloat(v) : v; return isNum(n) ? n : d; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // FANUC 좌표 형식: 항상 소수점 포함 (소수점 없는 X10 은 0.010mm 로 해석될 수 있음)
  function fmt(v) {
    let x = r3(v);
    if (x === 0 || Object.is(x, -0)) return '0.';
    return x.toFixed(3).replace(/0+$/, '');
  }
  // 이송속도: 소수 3자리까지, 소수점 포함
  const fmtF = v => fmt(v);
  // NC 주석: FANUC 는 대부분 영문 대문자·숫자만 허용 → ASCII 외 문자 제거
  function ncText(s, max) {
    const t = String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9 .,_\-+=/:#*]/g, '').replace(/\s+/g, ' ').replace(/^[^A-Z0-9]+|[^A-Z0-9.]+$/g, '').trim();
    return t.slice(0, max || 40);
  }
  const pad = (n, w) => String(n).padStart(w, '0');

  /* ---------------- 소재·공구 계산 ---------------- */
  function stockRect(stock) {
    const sx = stock.sx, sy = stock.sy;
    switch (stock.origin) {
      case 'UL': return { x0: 0, y0: -sy, x1: sx, y1: 0 };
      case 'LR': return { x0: -sx, y0: 0, x1: 0, y1: sy };
      case 'UR': return { x0: -sx, y0: -sy, x1: 0, y1: 0 };
      case 'C': return { x0: -sx / 2, y0: -sy / 2, x1: sx / 2, y1: sy / 2 };
      default: return { x0: 0, y0: 0, x1: sx, y1: sy }; // 'LL' 좌하단
    }
  }
  const ORIGIN_LABEL = { LL: '좌하단 모서리', UL: '좌상단 모서리', LR: '우하단 모서리', UR: '우상단 모서리', C: '소재 중심' };
  const ORIGIN_NC = { LL: 'LOWER LEFT', UL: 'UPPER LEFT', LR: 'LOWER RIGHT', UR: 'UPPER RIGHT', C: 'CENTER' };

  // 드릴 끝 원뿔 길이 = (D/2) / tan(선단각/2)
  function tipLength(tool) {
    if (!tool || tool.type !== 'drill') return 0;
    const a = toNum(tool.angle, 118);
    if (!(a > 0 && a < 180)) return 0;
    return (tool.dia / 2) / Math.tan(deg(a / 2));
  }

  // 공정의 실제 가공 깊이 계산 (Z0 = 소재 상면, 아래 방향이 +깊이)
  function opDepth(op, tool, stock) {
    const tip = tipLength(tool);
    let depth, full;
    if (isDrillOp(op.type)) {
      if (op.thru) { full = stock.sz + toNum(op.brk, 1); depth = full + tip; }
      else if (op.depthMode === 'full') { full = toNum(op.depth, 0); depth = full + tip; }
      else { depth = toNum(op.depth, 0); full = depth - tip; }
    } else if (isTapOp(op.type)) {
      depth = op.thru ? stock.sz + toNum(op.brk, 1) : toNum(op.depth, 0);
      full = depth;
    } else {
      depth = toNum(op.depth, 0); full = depth;
    }
    return { depth: r3(depth), full: r3(full), tip: r3(tip), z: r3(-depth) };
  }

  // 센터/스팟 드릴의 모따기 직경 = 2 × 깊이 × tan(선단각/2)
  function spotDiameter(tool, depth) {
    if (!tool) return 0;
    const a = toNum(tool.angle, 90);
    return 2 * depth * Math.tan(deg(a / 2));
  }

  // 미터 나사 기초 드릴 추천 (절삭 탭 기준)
  function tapDrill(d, p) {
    d = toNum(d, NaN); p = toNum(p, NaN);
    if (!(d > 0)) return null;
    const coarse = METRIC_COARSE.find(r => Math.abs(r[0] - d) < 1e-9);
    if (!(p > 0)) p = coarse ? coarse[1] : NaN;
    if (!(p > 0)) return null;
    if (coarse && Math.abs(coarse[1] - p) < 1e-9) return { dia: coarse[2], pitch: p, kind: '보통 나사', name: 'M' + d + '×' + p };
    const fine = METRIC_FINE.find(r => Math.abs(r[0] - d) < 1e-9 && Math.abs(r[1] - p) < 1e-9);
    return { dia: r3(Math.round((d - p) * 20) / 20), pitch: p, kind: fine ? '가는 나사' : '비표준 피치', name: 'M' + d + '×' + p };
  }
  function standardPitch(d, p) {
    return METRIC_COARSE.some(r => Math.abs(r[0] - d) < 1e-9 && Math.abs(r[1] - p) < 1e-9) ||
      METRIC_FINE.some(r => Math.abs(r[0] - d) < 1e-9 && Math.abs(r[1] - p) < 1e-9);
  }

  // 재질·공구 기준 참고값 (Vc: m/min, fpr: mm/rev)
  function refConditions(type, tool, matKey) {
    const m = MATERIALS[matKey] || MATERIALS.S45C;
    if (!tool) return null;
    const carb = tool.mat === 'CARBIDE';
    const D = tool.dia;
    if (isTapOp(type)) return { vc: m.vcTap * (carb ? 2 : 1), fpr: toNum(tool.pitch, 0) };
    const vcBase = carb ? m.vcCarb : m.vcHss;
    const fBase = (0.02 + 0.016 * D) * m.fFactor;
    if (type === 'center') return { vc: vcBase * 0.8, fpr: fBase * 0.5 };
    return { vc: vcBase, fpr: fBase };
  }

  // 추천 절삭 조건 (계산식 기반, AI 미사용)
  function recommend(type, tool, matKey, machine) {
    const ref = refConditions(type, tool, matKey);
    if (!ref || !(tool.dia > 0)) return { rpm: 0, feed: 0, limited: false };
    let rpm = ref.vc * 1000 / (Math.PI * tool.dia);
    rpm = Math.max(10, Math.round(rpm / 10) * 10);
    let limited = false;
    const maxR = isTapOp(type) && type === 'rigid' ? Math.min(machine.maxRpm, machine.maxTapRpm || machine.maxRpm) : machine.maxRpm;
    if (rpm > maxR) { rpm = Math.floor(maxR / 10) * 10; limited = true; }
    let feed = isTapOp(type) ? r3(rpm * toNum(tool.pitch, 0)) : Math.max(1, Math.round(rpm * ref.fpr));
    if (!isTapOp(type) && feed > machine.maxFeed) { feed = machine.maxFeed; limited = true; }
    return { rpm, feed, limited };
  }

  // 공정의 실제 사용 S, F (탭은 항상 G94 기준 F = S × P 자동 계산)
  function opConditions(op, tool, matKey, machine) {
    let rpm, feed;
    if (op.auto && tool) { const r = recommend(op.type, tool, matKey, machine); rpm = r.rpm; feed = r.feed; }
    else { rpm = Math.round(toNum(op.rpm, 0)); feed = toNum(op.feed, 0); }
    if (isTapOp(op.type)) feed = tool ? r3(rpm * toNum(tool.pitch, 0)) : 0;
    return { rpm, feed: r3(feed) };
  }

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

  /* ---------------- 장비·공구 ---------------- */
  function toolMap(machine) { const m = new Map(); (machine.tools || []).forEach(t => { if (!m.has(t.no)) m.set(t.no, t); }); return m; }
  function toolLabel(t) {
    if (!t) return '(없음)';
    if (t.type === 'tap') return 'T' + pad(t.no, 2) + ' 탭 M' + t.dia + '×' + t.pitch;
    return 'T' + pad(t.no, 2) + ' ' + TOOL_TYPES[t.type] + ' Ø' + t.dia;
  }
  function holeDiaForGroup(group, tools) {
    let d = 0;
    group.ops.forEach(op => { const t = tools.get(op.toolNo); if (t && t.dia > d && op.type !== 'center') d = t.dia; });
    if (!d) group.ops.forEach(op => { const t = tools.get(op.toolNo); if (t && t.dia > d) d = t.dia; });
    return d;
  }

  /* ---------------- 기본 데이터 ---------------- */
  function defaultMachine() {
    return {
      id: uid('m'), name: 'MC-1 FANUC 3축', control: 'FANUC',
      travel: { x: 800, y: 450, z: 500 }, maxRpm: 8000, maxTapRpm: 3000, maxFeed: 10000, magazine: 24,
      rigidTap: true, rigidM03: false, endY: true, verified: false, verifiedBy: '', verifiedAt: '', verifyNote: '',
      tools: [
        { no: 1, type: 'center', name: '스팟 드릴', dia: 6, angle: 90, mat: 'CARBIDE', flute: 10 },
        { no: 2, type: 'drill', name: '드릴', dia: 3.3, angle: 118, mat: 'HSS', flute: 33 },
        { no: 3, type: 'drill', name: '드릴', dia: 4.2, angle: 118, mat: 'HSS', flute: 43 },
        { no: 4, type: 'drill', name: '드릴', dia: 5.0, angle: 118, mat: 'HSS', flute: 52 },
        { no: 5, type: 'drill', name: '드릴', dia: 6.8, angle: 118, mat: 'HSS', flute: 69 },
        { no: 6, type: 'drill', name: '드릴', dia: 8.5, angle: 118, mat: 'HSS', flute: 75 },
        { no: 7, type: 'drill', name: '드릴(볼트 구멍)', dia: 6.6, angle: 118, mat: 'HSS', flute: 63 },
        { no: 8, type: 'drill', name: '드릴(볼트 구멍)', dia: 9.0, angle: 118, mat: 'HSS', flute: 81 },
        { no: 11, type: 'tap', name: '핸드 탭', dia: 4, pitch: 0.7, mat: 'HSS', flute: 20 },
        { no: 12, type: 'tap', name: '스파이럴 탭', dia: 5, pitch: 0.8, mat: 'HSS', flute: 22 },
        { no: 13, type: 'tap', name: '스파이럴 탭', dia: 6, pitch: 1.0, mat: 'HSS', flute: 25 },
        { no: 14, type: 'tap', name: '스파이럴 탭', dia: 8, pitch: 1.25, mat: 'HSS', flute: 30 },
        { no: 15, type: 'tap', name: '스파이럴 탭', dia: 10, pitch: 1.5, mat: 'HSS', flute: 35 }
      ]
    };
  }
  function newOp(type, toolNo, extra) {
    const o = { id: uid('o'), type, toolNo: toolNo || 1, depth: type === 'center' ? 2.5 : 10, depthMode: 'tip', thru: false, brk: 1, r: isTapOp(type) ? 5 : 3, q: 2, dwell: 0, auto: true, rpm: 1000, feed: 100 };
    return Object.assign(o, extra || {});
  }
  function defaultBundles(machine) {
    const tm = toolMap(machine);
    const spec = n => { const t = tm.get(n); return t ? { type: t.type, dia: t.dia, pitch: t.pitch || 0 } : null; };
    const b = (name, desc, ops) => ({ id: uid('b'), name, desc, ops: ops.map(o => { const op = newOp(o[0], o[1], o[2]); op.toolSpec = spec(o[1]); delete op.id; return op; }) });
    return [
      b('M5 탭 (깊이 10)', '스팟 → Ø4.2 펙 드릴 14 → M5 리지드 탭 10', [['center', 1, { depth: 2.6 }], ['peck', 3, { depth: 14, q: 2 }], ['rigid', 12, { depth: 10 }]]),
      b('M6 탭 (깊이 12)', '스팟 → Ø5.0 펙 드릴 17 → M6 리지드 탭 12', [['center', 1, { depth: 3 }], ['peck', 4, { depth: 17, q: 2 }], ['rigid', 13, { depth: 12 }]]),
      b('M8 탭 (깊이 15)', '스팟 → Ø6.8 심공 드릴 21 → M8 리지드 탭 15', [['center', 1, { depth: 3 }], ['deep', 5, { depth: 21, q: 3 }], ['rigid', 14, { depth: 15 }]]),
      b('M10 탭 (깊이 18)', '스팟 → Ø8.5 심공 드릴 25 → M10 리지드 탭 18', [['center', 1, { depth: 3 }], ['deep', 6, { depth: 25, q: 3 }], ['rigid', 15, { depth: 18 }]]),
      b('Ø6.6 볼트 구멍 (관통)', '스팟 → Ø6.6 펙 드릴 관통 (하부 여유 필요)', [['center', 1, { depth: 3 }], ['peck', 7, { thru: true, brk: 1, q: 3 }]]),
      b('Ø9.0 볼트 구멍 (관통)', '스팟 → Ø9.0 펙 드릴 관통 (하부 여유 필요)', [['center', 1, { depth: 3 }], ['peck', 8, { thru: true, brk: 1, q: 3 }]])
    ];
  }
  const GROUP_COLORS = ['#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e', '#17becf', '#8c564b', '#e377c2'];
  function newGroup(name, i) { return { id: uid('g'), name: name || '홀 그룹', color: GROUP_COLORS[(i || 0) % GROUP_COLORS.length], holes: [], ops: [] }; }
  function newProject(machine) {
    return {
      schema: 1, id: uid('p'), name: '새 프로젝트', programNo: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      machineId: machine ? machine.id : null,
      stock: { material: 'S45C', sx: 150, sy: 100, sz: 20, origin: 'LL', under: 0 },
      settings: { initialZ: 50, retract: 'G98', wcs: 'G54', coolant: true, m01: true, seqNo: false, toolOrder: 'tool', pathOrder: 'nearest' },
      clamps: [], groups: []
    };
  }

  // 외부(JSON) 데이터 정리: 형식 오류·악성 값 방지
  function normalizeTool(t) {
    const type = TOOL_TYPES[t && t.type] ? t.type : 'drill';
    const o = { no: Math.round(toNum(t && t.no, 1)), type, name: String((t && t.name) || '').slice(0, 40), dia: toNum(t && t.dia, 1), mat: (t && t.mat) === 'CARBIDE' ? 'CARBIDE' : 'HSS', flute: toNum(t && t.flute, 30) };
    if (type === 'tap') o.pitch = toNum(t.pitch, 1); else o.angle = toNum(t && t.angle, type === 'center' ? 90 : 118);
    return o;
  }
  function normalizeMachine(m) {
    const d = defaultMachine();
    m = m || {};
    return {
      id: typeof m.id === 'string' ? m.id : uid('m'), name: String(m.name || d.name).slice(0, 60), control: m.control === 'FANUC' ? 'FANUC' : String(m.control || 'FANUC'),
      travel: { x: toNum(m.travel && m.travel.x, d.travel.x), y: toNum(m.travel && m.travel.y, d.travel.y), z: toNum(m.travel && m.travel.z, d.travel.z) },
      maxRpm: toNum(m.maxRpm, d.maxRpm), maxTapRpm: toNum(m.maxTapRpm, d.maxTapRpm), maxFeed: toNum(m.maxFeed, d.maxFeed), magazine: Math.round(toNum(m.magazine, d.magazine)),
      rigidTap: m.rigidTap !== false, rigidM03: !!m.rigidM03, endY: m.endY !== false,
      verified: !!m.verified, verifiedBy: String(m.verifiedBy || '').slice(0, 40), verifiedAt: String(m.verifiedAt || '').slice(0, 40), verifyNote: String(m.verifyNote || '').slice(0, 200),
      tools: Array.isArray(m.tools) ? m.tools.slice(0, 300).map(normalizeTool) : d.tools
    };
  }
  function normalizeOp(o) {
    const type = OP_TYPES[o && o.type] ? o.type : 'drill';
    const n = newOp(type, Math.round(toNum(o && o.toolNo, 1)));
    if (o && typeof o.id === 'string') n.id = o.id;
    ['depth', 'brk', 'r', 'q', 'dwell', 'rpm', 'feed'].forEach(k => { n[k] = toNum(o && o[k], n[k]); });
    n.depthMode = o && o.depthMode === 'full' ? 'full' : 'tip';
    n.thru = !!(o && o.thru); n.auto = !(o && o.auto === false);
    if (o && o.toolSpec) n.toolSpec = { type: String(o.toolSpec.type), dia: toNum(o.toolSpec.dia, 0), pitch: toNum(o.toolSpec.pitch, 0) };
    return n;
  }
  function normalizeProject(p) {
    const d = newProject(null);
    p = p || {};
    const s = p.stock || {}, st = p.settings || {};
    const out = {
      schema: 1, id: typeof p.id === 'string' ? p.id : uid('p'), name: String(p.name || d.name).slice(0, 60),
      programNo: Math.round(toNum(p.programNo, 1)), createdAt: String(p.createdAt || d.createdAt), updatedAt: String(p.updatedAt || d.updatedAt),
      machineId: typeof p.machineId === 'string' ? p.machineId : null,
      stock: { material: MATERIALS[s.material] ? s.material : 'S45C', sx: toNum(s.sx, 150), sy: toNum(s.sy, 100), sz: toNum(s.sz, 20), origin: ORIGIN_LABEL[s.origin] ? s.origin : 'LL', under: toNum(s.under, 0) },
      settings: {
        initialZ: toNum(st.initialZ, 50), retract: st.retract === 'G99' ? 'G99' : 'G98', wcs: /^G5[4-9]$/.test(st.wcs) ? st.wcs : 'G54',
        coolant: st.coolant !== false, m01: st.m01 !== false, seqNo: !!st.seqNo, toolOrder: st.toolOrder === 'group' ? 'group' : 'tool',
        pathOrder: ['input', 'nearest', 'zigzag'].includes(st.pathOrder) ? st.pathOrder : 'nearest'
      },
      clamps: Array.isArray(p.clamps) ? p.clamps.slice(0, 50).map(c => ({ id: typeof c.id === 'string' ? c.id : uid('c'), x: toNum(c.x, 0), y: toNum(c.y, 0), w: toNum(c.w, 10), h: toNum(c.h, 10), height: toNum(c.height, 30) })) : [],
      groups: Array.isArray(p.groups) ? p.groups.slice(0, 200).map((g, i) => ({
        id: typeof g.id === 'string' ? g.id : uid('g'), name: String(g.name || '홀 그룹').slice(0, 40),
        color: /^#[0-9a-fA-F]{6}$/.test(g.color) ? g.color : GROUP_COLORS[i % GROUP_COLORS.length],
        holes: Array.isArray(g.holes) ? g.holes.slice(0, MAX_HOLES).map(h => ({ id: typeof h.id === 'string' ? h.id : uid('h'), x: toNum(h.x, NaN), y: toNum(h.y, NaN) })) : [],
        ops: Array.isArray(g.ops) ? g.ops.slice(0, 20).map(normalizeOp) : []
      })) : []
    };
    return out;
  }
  function normalizeBundle(b) {
    b = b || {};
    return { id: typeof b.id === 'string' ? b.id : uid('b'), name: String(b.name || '공정 묶음').slice(0, 60), desc: String(b.desc || '').slice(0, 200), ops: Array.isArray(b.ops) ? b.ops.slice(0, 20).map(o => { const n = normalizeOp(o); delete n.id; return n; }) : [] };
  }

  /* ---------------- 공정 묶음 적용·적합성 ---------------- */
  function findToolBySpec(machine, spec) {
    if (!spec) return null;
    return (machine.tools || []).find(t => t.type === spec.type && Math.abs(t.dia - spec.dia) < 1e-6 && (t.type !== 'tap' || Math.abs((t.pitch || 0) - spec.pitch) < 1e-6)) || null;
  }
  function specMatches(t, spec) { return !!(t && spec && t.type === spec.type && Math.abs(t.dia - spec.dia) < 1e-6 && (t.type !== 'tap' || Math.abs((t.pitch || 0) - spec.pitch) < 1e-6)); }
  function specText(s) { return s ? (s.type === 'tap' ? '탭 M' + s.dia + '×' + s.pitch : TOOL_TYPES[s.type] + ' Ø' + s.dia) : '-'; }

  // 묶음을 현재 장비에 맞춰 공정 목록으로 변환 (공구 사양이 맞는 번호로 자동 매칭)
  function applyBundle(bundle, machine) {
    const tm = toolMap(machine), notes = [];
    const ops = bundle.ops.map(t => {
      const op = normalizeOp(t); op.id = uid('o');
      const cur = tm.get(op.toolNo);
      if (t.toolSpec && !specMatches(cur, t.toolSpec)) {
        const alt = findToolBySpec(machine, t.toolSpec);
        if (alt) { notes.push(OP_TYPES[op.type].label + ': T' + op.toolNo + ' → T' + alt.no + ' (' + specText(t.toolSpec) + ' 사양 일치 공구로 변경)'); op.toolNo = alt.no; }
        else notes.push(OP_TYPES[op.type].label + ': 장비에 ' + specText(t.toolSpec) + ' 공구가 없습니다. 공구 확인 필요');
      }
      delete op.toolSpec;
      return op;
    });
    return { ops, notes };
  }
  function opsToBundle(name, ops, machine) {
    const tm = toolMap(machine);
    return normalizeBundle({ name, desc: '', ops: ops.map(o => { const c = clone(o); delete c.id; const t = tm.get(o.toolNo); c.toolSpec = t ? { type: t.type, dia: t.dia, pitch: t.pitch || 0 } : null; return c; }) });
  }

  // 묶음 적합성 확인: 묶음 하나를 임시 프로젝트에 적용하여 가공 조건만 검사
  function checkBundleFit(bundle, machine, stock) {
    const res = applyBundle(bundle, machine);
    const r = stockRect(stock);
    const g = newGroup('적합성 확인', 0);
    g.holes = [{ id: 'chk', x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }];
    g.ops = res.ops;
    const p = newProject(machine); p.stock = clone(stock); p.groups = [g]; p.machineId = machine.id;
    const v = validateProject(p, machine);
    const issues = v.issues.filter(i => ![1, 2, 3, 10, 11].includes(i.cat) && i.level !== 'info');
    return { notes: res.notes, issues, ok: !issues.some(i => i.level === 'error') && !res.notes.some(n => n.includes('없습니다')) };
  }

  /* ---------------- 가공 계획 (공정 순서) ---------------- */
  function buildPlan(project, machine) {
    const tm = toolMap(machine), info = [];
    const inst = [];
    project.groups.forEach((g, gi) => {
      if (!g.holes.length) return;
      g.ops.forEach((op, oi) => inst.push({ g, gi, op, oi, tool: tm.get(op.toolNo) || null, stage: OP_TYPES[op.type].stage, idx: inst.length }));
    });
    let ordered = inst;
    if (project.settings.toolOrder === 'tool') {
      const first = new Map();
      inst.forEach(i => { if (!first.has(i.op.toolNo)) first.set(i.op.toolNo, i.idx); });
      const sorted = inst.slice().sort((a, b) => a.stage - b.stage || first.get(a.op.toolNo) - first.get(b.op.toolNo) || a.idx - b.idx);
      // 그룹 내부 공정 순서가 바뀌면 안전을 위해 그룹 순서로 되돌림
      const ok = project.groups.every(g => { let last = -1; return sorted.filter(i => i.g === g).every(i => { const r = i.oi > last; last = i.oi; return r; }); });
      if (ok) ordered = sorted; else info.push('공구 교환 최소화 시 그룹 내부 공정 순서가 바뀌므로 그룹 순서대로 가공합니다.');
    }
    const steps = [];
    ordered.forEach(i => {
      const d = opDepth(i.op, i.tool, project.stock);
      const c = opConditions(i.op, i.tool, project.stock.material, machine);
      const params = {
        type: i.op.type, toolNo: i.op.toolNo, z: d.z, r: r3(toNum(i.op.r, 3)),
        q: (i.op.type === 'peck' || i.op.type === 'deep') ? r3(toNum(i.op.q, 0)) : 0,
        dwell: (i.op.type === 'center' || i.op.type === 'drill') ? Math.round(toNum(i.op.dwell, 0)) : 0,
        rpm: c.rpm, feed: c.feed
      };
      const key = JSON.stringify(params);
      const holes = i.g.holes.map(h => ({ x: h.x, y: h.y, gid: i.g.id, hid: h.id }));
      const last = steps[steps.length - 1];
      if (last && last.key === key) { last.holes.push(...holes); last.refs.push({ gid: i.g.id, opId: i.op.id }); }
      else steps.push(Object.assign({ key, tool: i.tool, holes, refs: [{ gid: i.g.id, opId: i.op.id }], depthInfo: d }, params));
    });
    let pos = { x: 0, y: 0 };
    steps.forEach((s, k) => {
      s.idx = k + 1;
      s.holes = orderHoles(s.holes, project.settings.pathOrder, pos);
      if (s.holes.length) pos = s.holes[s.holes.length - 1];
    });
    return { steps, info };
  }

  /* ---------------- 기하 유틸 ---------------- */
  function segRectHit(x0, y0, x1, y1, r) {
    // 선분이 사각형(r.x0..x1, y0..y1)과 만나는지 (Liang–Barsky)
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dy = y1 - y0;
    const p = [-dx, dx, -dy, dy], q = [x0 - r.x0, r.x1 - x0, y0 - r.y0, r.y1 - y0];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(p[i]) < 1e-12) { if (q[i] < 0) return false; }
      else { const t = q[i] / p[i]; if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } }
    }
    return true;
  }
  const clampRect = (c, grow) => ({ x0: Math.min(c.x, c.x + c.w) - grow, y0: Math.min(c.y, c.y + c.h) - grow, x1: Math.max(c.x, c.x + c.w) + grow, y1: Math.max(c.y, c.y + c.h) + grow });
  const inRect = (x, y, r) => x >= r.x0 - EPS && x <= r.x1 + EPS && y >= r.y0 - EPS && y <= r.y1 + EPS;

  /* ---------------- 모델 검증 (11개 항목) ---------------- */
  function validateProject(project, machine) {
    const issues = [];
    const add = (level, cat, msg, ref) => issues.push({ level, cat, msg, ref: ref || null });
    const st = project.stock, set = project.settings;
    const tm = machine ? toolMap(machine) : new Map();
    if (!machine) { add('error', 11, '장비가 선택되지 않았습니다.'); return { issues, plan: { steps: [], info: [] } }; }
    const sr = stockRect(st);
    const under = toNum(st.under, 0);

    // 11. 장비·프로그램 기본 설정
    if (machine.control !== 'FANUC') add('error', 11, '지원하지 않는 제어기입니다: ' + machine.control + ' (V0.1은 FANUC 전용)');
    if (!(Number.isInteger(project.programNo) && project.programNo >= 1 && project.programNo <= 9999)) add('error', 11, '프로그램 번호는 1~9999 정수여야 합니다 (O0001 형식).');
    else if (project.programNo >= 8000) add('warn', 11, 'O8000~O9999는 장비에서 보호 영역(매크로)으로 쓰이는 경우가 많습니다.');
    if (!machine.verified) add('warn', 11, '장비 "' + machine.name + '" 은(는) 실가공 검증 전입니다. NC 파일은 "검증용"으로 표시됩니다.');
    if (!(machine.maxRpm > 0) || !(machine.maxFeed > 0)) add('error', 11, '장비의 최대 회전수/최대 이송속도 설정이 잘못되었습니다.');
    if (!/^G5[4-9]$/.test(set.wcs)) add('error', 11, '공작물 좌표계는 G54~G59 중 하나여야 합니다.');

    // 1. 소재·좌표 기본값
    if (!(st.sx > 0 && st.sy > 0 && st.sz > 0)) add('error', 1, '소재 크기(X, Y, 두께)는 0보다 커야 합니다.');
    if (st.sx > machine.travel.x || st.sy > machine.travel.y) add('error', 1, '소재 크기가 장비 X/Y 행정(' + machine.travel.x + '×' + machine.travel.y + ')을 초과합니다.');
    if (!(under >= 0)) add('error', 8, '소재 하부 여유는 0 이상이어야 합니다.');
    if (!(set.initialZ > 0)) add('error', 10, '초기점(안전 높이) Z는 0보다 커야 합니다.');
    if (set.initialZ > machine.travel.z) add('error', 1, '초기점 Z가 장비 Z 행정을 초과합니다.');

    // 툴 번호 중복
    const seen = new Set();
    (machine.tools || []).forEach(t => {
      if (seen.has(t.no)) add('error', 4, '장비 공구 목록에 T' + t.no + ' 번호가 중복되어 있습니다.');
      seen.add(t.no);
      if (!(t.dia > 0)) add('error', 4, 'T' + t.no + ' 공구 직경이 올바르지 않습니다.');
      if (t.type === 'tap' && !(t.pitch > 0)) add('error', 7, 'T' + t.no + ' 탭 피치가 올바르지 않습니다.');
    });

    let totalHoles = 0;
    const allHoles = [];
    project.groups.forEach(g => {
      const gname = '[' + g.name + ']';
      const dia = holeDiaForGroup(g, tm);
      const rad = dia / 2;
      totalHoles += g.holes.length;
      if (g.holes.length && !g.ops.length) add('warn', 4, gname + ' 홀은 있지만 공정이 없어 가공되지 않습니다.', { gid: g.id });
      if (!g.holes.length && g.ops.length) add('info', 4, gname + ' 공정은 있지만 홀이 없습니다.', { gid: g.id });

      // 1, 2. 좌표·소재 범위
      g.holes.forEach((h, hi) => {
        const ref = { gid: g.id, hid: h.id };
        const hn = gname + ' 홀 ' + (hi + 1);
        if (!isNum(h.x) || !isNum(h.y)) { add('error', 1, hn + ': 좌표가 숫자가 아닙니다.', ref); return; }
        if (Math.abs(h.x) > FANUC_MAX || Math.abs(h.y) > FANUC_MAX) add('error', 1, hn + ': 좌표가 입력 한계를 넘습니다.', ref);
        if (h.x - rad < sr.x0 - EPS || h.x + rad > sr.x1 + EPS || h.y - rad < sr.y0 - EPS || h.y + rad > sr.y1 + EPS)
          add('error', 2, hn + ' (X' + fmt(h.x) + ' Y' + fmt(h.y) + '): 홀(Ø' + r3(dia) + ')이 소재 밖으로 벗어납니다.', ref);
        else {
          const wall = Math.min(h.x - rad - sr.x0, sr.x1 - h.x - rad, h.y - rad - sr.y0, sr.y1 - h.y - rad);
          if (dia > 0 && wall < Math.max(1, dia * 0.25)) add('warn', 2, hn + ': 소재 가장자리까지 남는 살 두께가 ' + r3(wall) + 'mm 로 얇습니다.', ref);
        }
        // 10. 클램프 영역
        project.clamps.forEach((c, ci) => {
          if (inRect(h.x, h.y, clampRect(c, rad + 1))) add('error', 10, hn + ': 클램프 ' + (ci + 1) + ' 영역과 겹칩니다 (공구 충돌).', ref);
        });
        allHoles.push({ g, h, rad, hi, ref, hn });
      });

      // 공정별 검사
      const ops = g.ops;
      ops.forEach((op, oi) => {
        const ref = { gid: g.id, opId: op.id };
        const on = gname + ' 공정 ' + (oi + 1) + ' (' + OP_TYPES[op.type].label + ')';
        const tool = tm.get(op.toolNo);
        // 4. 공구
        if (!Number.isInteger(op.toolNo) || op.toolNo < 1) { add('error', 4, on + ': 공구 번호가 올바르지 않습니다.', ref); return; }
        if (op.toolNo > machine.magazine) add('error', 4, on + ': T' + op.toolNo + ' 가 매거진 수(' + machine.magazine + ')를 초과합니다.', ref);
        if (!tool) { add('error', 4, on + ': T' + op.toolNo + ' 공구가 장비 공구 목록에 없습니다.', ref); return; }
        if (!OP_TYPES[op.type].tools.includes(tool.type)) { add('error', 4, on + ': T' + op.toolNo + '(' + TOOL_TYPES[tool.type] + ')는 이 공정에 사용할 수 없습니다.', ref); return; }

        const d = opDepth(op, tool, st);
        const c = opConditions(op, tool, st.material, machine);
        // 6. 절삭 조건
        if (!(c.rpm > 0)) add('error', 6, on + ': 주축 회전수(S)가 0 이하입니다.', ref);
        else if (c.rpm > machine.maxRpm) add('error', 6, on + ': S' + c.rpm + ' 이(가) 장비 최대 회전수 ' + machine.maxRpm + ' 을 초과합니다.', ref);
        if (!(c.feed > 0)) add('error', 6, on + ': 이송속도(F)가 0 이하입니다.', ref);
        else if (c.feed > machine.maxFeed) add('error', 6, on + ': F' + c.feed + ' 이(가) 장비 최대 절삭 이송 ' + machine.maxFeed + ' 을 초과합니다.', ref);
        if (op.auto === false && !Number.isInteger(toNum(op.rpm, 0))) add('warn', 6, on + ': 회전수는 정수로 출력됩니다 (S' + c.rpm + ').', ref);
        const ref0 = refConditions(op.type, tool, st.material);
        if (c.rpm > 0 && ref0 && ref0.vc > 0) {
          const vc = Math.PI * tool.dia * c.rpm / 1000, ratio = vc / ref0.vc;
          if (ratio > 3) add('error', 6, on + ': 절삭속도 Vc ' + r3(vc) + ' m/min 이 참고값(' + r3(ref0.vc) + ')의 3배를 넘습니다 (비정상 조건).', ref);
          else if (ratio > 1.5) add('warn', 6, on + ': 절삭속도 Vc ' + r3(vc) + ' m/min 이 참고값(' + r3(ref0.vc) + ')보다 높습니다.', ref);
          else if (ratio < 0.2) add('warn', 6, on + ': 절삭속도 Vc ' + r3(vc) + ' m/min 이 매우 낮습니다.', ref);
          if (!isTapOp(op.type) && c.feed > 0) {
            const fpr = c.feed / c.rpm, fr = fpr / ref0.fpr;
            if (fr > 3) add('error', 6, on + ': 회전당 이송 ' + r3(fpr) + ' mm/rev 가 참고값(' + r3(ref0.fpr) + ')의 3배를 넘습니다 (공구 파손 위험).', ref);
            else if (fr > 1.6) add('warn', 6, on + ': 회전당 이송 ' + r3(fpr) + ' mm/rev 가 참고값(' + r3(ref0.fpr) + ')보다 큽니다.', ref);
          }
        }
        // 7. 탭
        if (isTapOp(op.type)) {
          if (!(tool.pitch > 0)) add('error', 7, on + ': 탭 피치가 없습니다.', ref);
          else if (!standardPitch(tool.dia, tool.pitch)) add('warn', 7, on + ': M' + tool.dia + '×' + tool.pitch + ' 는 표준 미터 나사 피치가 아닙니다.', ref);
          if (op.type === 'rigid' && !machine.rigidTap) add('error', 7, on + ': 장비가 리지드 탭(M29)을 지원하지 않도록 설정되어 있습니다.', ref);
          if (op.type === 'rigid' && c.rpm > (machine.maxTapRpm || machine.maxRpm)) add('error', 7, on + ': 리지드 탭 회전수 S' + c.rpm + ' 이(가) 장비 탭 최대 회전수 ' + machine.maxTapRpm + ' 을 초과합니다.', ref);
          if (op.type === 'tap') add('info', 7, on + ': 일반 탭(G84)은 텐션·컴프레션 탭 홀더가 필요합니다. F = S × P = ' + c.rpm + ' × ' + tool.pitch + ' = ' + c.feed);
        }
        // 8. 깊이
        if (!(d.depth > 0)) add('error', 8, on + ': 가공 깊이가 0 이하입니다.', ref);
        if (op.type === 'center') {
          const sd = spotDiameter(tool, d.depth);
          if (sd > tool.dia + EPS) add('error', 8, on + ': 깊이 ' + d.depth + ' 에서 필요한 모따기 Ø' + r3(sd) + ' 가 공구 직경 Ø' + tool.dia + ' 보다 큽니다.', ref);
        }
        if (tool.flute > 0 && d.depth > tool.flute + EPS) add('error', 8, on + ': 깊이 ' + d.depth + ' 가 공구 유효 날 길이 ' + tool.flute + ' 을 초과합니다.', ref);
        if (d.z < -(st.sz + under) - EPS) add('error', 8, on + ': 공구 끝 Z' + fmt(d.z) + ' 이(가) 소재 바닥 아래 허용 범위(하부 여유 ' + under + 'mm)를 넘습니다. 테이블/지그 충돌 위험 → 하부 여유(패럴렐 틈)를 확인하세요.', ref);
        else if (!op.thru && d.depth > st.sz + EPS) add('warn', 8, on + ': 깊이가 소재 두께를 넘습니다. 관통이면 "관통" 옵션을 사용하세요.', ref);
        if (isDrillOp(op.type) && !op.thru && op.depthMode !== 'full' && d.full <= 0) add('error', 8, on + ': 깊이가 드릴 끝 원뿔 길이(' + d.tip + ')보다 작아 직경부가 형성되지 않습니다.', ref);
        if (isTapOp(op.type)) {
          const prev = ops.slice(0, oi).filter(o => isDrillOp(o.type) && tm.get(o.toolNo));
          // 5. 기초 드릴
          if (!prev.length) add('error', 5, on + ': 탭 앞에 기초 드릴 공정이 없습니다.', ref);
          else {
            // 탭 기초 드릴: 직경이 허용 범위인 드릴 중 가장 깊은 것 (단차 드릴 대응). 없으면 마지막 드릴로 판정
            const okDia = o => { const t2 = tm.get(o.toolNo); return t2.dia >= tool.dia - 1.25 * tool.pitch - EPS && t2.dia < tool.dia - 0.5 * tool.pitch - EPS; };
            const cands = prev.filter(okDia);
            const depthOf = o => o.thru ? Infinity : opDepth(o, tm.get(o.toolNo), st).full;
            const dop = cands.length ? cands.reduce((a, o) => depthOf(o) >= depthOf(a) ? o : a) : prev[prev.length - 1];
            const dt = tm.get(dop.toolNo), dd = opDepth(dop, dt, st);
            const rec = tapDrill(tool.dia, tool.pitch);
            if (dt.dia < tool.dia - 1.25 * tool.pitch - EPS) add('error', 5, on + ': 기초 드릴 Ø' + dt.dia + ' 가 너무 작습니다 (탭 파손 위험, 추천 Ø' + (rec ? rec.dia : '-') + ').', ref);
            else if (dt.dia >= tool.dia - 0.5 * tool.pitch - EPS) add('error', 5, on + ': 기초 드릴 Ø' + dt.dia + ' 가 너무 커서 나사산이 형성되지 않습니다 (추천 Ø' + (rec ? rec.dia : '-') + ').', ref);
            else if (rec && Math.abs(dt.dia - rec.dia) > 0.1 + EPS) add('warn', 5, on + ': 기초 드릴 Ø' + dt.dia + ' 가 추천값 Ø' + rec.dia + ' 와 다릅니다.', ref);
            if (op.thru && !dop.thru) add('error', 8, on + ': 탭은 관통인데 기초 드릴은 관통이 아닙니다.', ref);
            else if (!dop.thru && !op.thru) {
              if (dd.full < d.depth - EPS) add('error', 8, on + ': 탭 깊이 ' + d.depth + ' 가 기초 드릴 직경부 깊이 ' + dd.full + ' 보다 깊습니다 (탭 파손 위험).', ref);
              else if (dd.full < d.depth + 2 * tool.pitch - EPS) add('warn', 8, on + ': 기초 드릴 직경부 깊이 ' + dd.full + ' 가 탭 깊이 + 2피치(' + r3(d.depth + 2 * tool.pitch) + ')보다 얕습니다.', ref);
            }
          }
          if (toNum(op.r, 0) < 3 * tool.pitch - EPS) add('warn', 10, on + ': 탭 R점은 3피치(' + r3(3 * tool.pitch) + 'mm) 이상 띄우는 것을 권장합니다.', ref);
        }
        if (isDrillOp(op.type)) {
          const dt = tool;
          if (!ops.slice(0, oi).some(o => o.type === 'center') && dt.dia < 12) add('info', 5, on + ': 센터 드릴 공정 없이 드릴 가공합니다 (위치 정밀도 확인).', ref);
          const ratio = d.full / dt.dia;
          if (op.type === 'drill' && ratio > 4) add('warn', 9, on + ': 깊이/직경 비 ' + r3(ratio) + ' → 칩 배출을 위해 G83(심공) 사용을 권장합니다.', ref);
        }
        // 9. 펙·드웰
        if (op.type === 'peck' || op.type === 'deep') {
          const q = toNum(op.q, 0);
          if (!(q >= 0.1)) add('error', 9, on + ': 펙 깊이 Q는 0.1mm 이상이어야 합니다.', ref);
          else if (q >= d.depth) add('warn', 9, on + ': Q(' + q + ')가 전체 깊이 이상이라 펙 없이 한 번에 가공됩니다.', ref);
          else if (q > tool.dia * 1.5) add('warn', 9, on + ': Q(' + q + ')가 공구 직경의 1.5배를 넘습니다.', ref);
        }
        if (op.type === 'center' || op.type === 'drill') {
          const dw = toNum(op.dwell, 0);
          if (!(dw >= 0 && dw <= 5000)) add('error', 9, on + ': 드웰은 0~5000ms 범위여야 합니다.', ref);
        }
        // 10. 안전 높이
        const R = toNum(op.r, NaN);
        if (!(R >= 0.5)) add('error', 10, on + ': R점은 소재 상면 위 0.5mm 이상이어야 합니다.', ref);
        else if (R < 1) add('warn', 10, on + ': R점 ' + R + 'mm 는 낮습니다 (1mm 이상 권장).', ref);
        if (R >= set.initialZ) add('error', 10, on + ': R점(' + R + ')이 초기점 Z(' + set.initialZ + ') 이상입니다.', ref);
      });
    });

    if (totalHoles > MAX_HOLES) add('error', 1, '홀 수가 최대 ' + MAX_HOLES + '개를 초과합니다.');
    // 1. 홀 분포가 장비 행정 이내인지
    const xs = allHoles.map(a => a.h.x), ys = allHoles.map(a => a.h.y);
    if (xs.length && (Math.max(...xs) - Math.min(...xs) > machine.travel.x || Math.max(...ys) - Math.min(...ys) > machine.travel.y)) add('error', 1, '홀 분포 범위가 장비 X/Y 행정을 초과합니다.');

    // 3. 중복·간섭 홀 (공간 해시로 대량 홀도 빠르게 검사)
    let maxRad = 0;
    allHoles.forEach((a, k) => { a.k = k; if (a.rad > maxRad) maxRad = a.rad; });
    const cell = Math.max(20, maxRad * 4), grid = new Map();
    allHoles.forEach(a => { const k = Math.floor(a.h.x / cell) + ',' + Math.floor(a.h.y / cell); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(a); });
    let nDup = 0, nOv = 0;
    allHoles.forEach(a => {
      const cx = Math.floor(a.h.x / cell), cy = Math.floor(a.h.y / cell);
      for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) {
        (grid.get(i + ',' + j) || []).forEach(b => {
          if (b.k <= a.k) return;
          const dist = Math.hypot(a.h.x - b.h.x, a.h.y - b.h.y);
          const same = a.g === b.g;
          if (dist < 0.01) {
            nDup++;
            if (nDup <= 50) add('error', 3, a.hn + ' 과 ' + b.hn + ' 의 위치가 같습니다 (' + (same ? '중복 홀' : '그룹 간 중복 홀') + ').', b.ref);
          } else if (dist < a.rad + b.rad - EPS) {
            nOv++;
            if (nOv <= 50) add('warn', 3, a.hn + ' 과 ' + b.hn + ' 이(가) 서로 겹칩니다 (중심 간격 ' + r3(dist) + 'mm).', b.ref);
          }
        });
      }
    });
    if (nDup > 50) add('error', 3, '중복 홀이 그 외 ' + (nDup - 50) + '건 더 있습니다.');
    if (nOv > 50) add('warn', 3, '겹치는 홀이 그 외 ' + (nOv - 50) + '건 더 있습니다.');

    // 10. 클램프 높이 vs 초기점 / G99 이동
    let maxClamp = -Infinity;
    project.clamps.forEach((c, ci) => {
      if (!(c.w !== 0 && c.h !== 0)) add('error', 10, '클램프 ' + (ci + 1) + ' 크기가 0입니다.');
      maxClamp = Math.max(maxClamp, c.height);
    });
    if (project.clamps.length && set.initialZ < maxClamp + CLAMP_MARGIN) add('error', 10, '초기점 Z' + set.initialZ + ' 가 클램프 최고 높이 ' + maxClamp + ' + 여유 ' + CLAMP_MARGIN + 'mm 보다 낮습니다 (이동 중 충돌).');

    const plan = buildPlan(project, machine);
    if (!plan.steps.length) add('error', 11, '가공할 홀/공정이 없습니다.');
    plan.info.forEach(m => add('info', 11, m));
    if (set.retract === 'G99' && project.clamps.length) {
      plan.steps.forEach(s => {
        const rad = s.tool ? s.tool.dia / 2 : 0;
        for (let k = 1; k < s.holes.length; k++) {
          const a = s.holes[k - 1], b = s.holes[k];
          project.clamps.forEach((c, ci) => {
            if (s.r < c.height + CLAMP_MARGIN && segRectHit(a.x, a.y, b.x, b.y, clampRect(c, rad + 1)))
              add('error', 10, '공정 ' + s.idx + ': G99(R점 복귀) 이동 경로가 클램프 ' + (ci + 1) + ' 위를 지나갑니다. G98 사용 또는 R점을 높이세요.', { gid: b.gid, hid: b.hid });
          });
        }
      });
    }
    return { issues, plan };
  }

  /* ---------------- FANUC 포스트프로세서 (G코드 생성) ---------------- */
  function generateNC(project, machine, plan, opts) {
    opts = opts || {};
    plan = plan || buildPlan(project, machine);
    if (!plan.steps.length) return { text: '', hits: [], lines: 0, blocked: '가공할 홀/공정이 없습니다.' };
    if (plan.steps.some(s => !s.tool || !OP_TYPES[s.type].tools.includes(s.tool.type))) return { text: '', hits: [], lines: 0, blocked: '공구가 없거나 공정에 맞지 않는 공구가 있어 G코드를 만들 수 없습니다.' };
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
    let curTool = null;
    plan.steps.forEach((s, k) => {
      const t = s.tool;
      const code = s.type === 'peck' ? 'G73' : s.type === 'deep' ? 'G83' : isTapOp(s.type) ? 'G84' : (s.dwell > 0 ? 'G82' : 'G81');
      const opName = ({ center: 'CENTER DRILL', drill: 'DRILL', peck: 'PECK DRILL', deep: 'DEEP DRILL', tap: 'TAP', rigid: 'RIGID TAP' })[s.type];
      const toolChange = curTool !== t.no;
      if (toolChange) {
        if (curTool !== null) {
          if (set.coolant) out('M09');
          out('M05');
          out('G91 G28 Z0.');
          out('G90');
          if (set.m01) out('M01');
        }
      }
      out('(OP' + s.idx + ' ' + opName + ' T' + pad(t.no, 2) + ' Z' + fmt(s.z) + ' ' + s.holes.length + ' HOLES)', false);
      if (toolChange) out('T' + pad(t.no, 2) + ' M06');
      const h0 = s.holes[0];
      const rigid = s.type === 'rigid';
      const spin = rigid && !machine.rigidM03 ? '' : ' S' + s.rpm + ' M03';
      if (!toolChange) out('G00 Z' + fmt(set.initialZ)); // 같은 공구 연속 공정: 먼저 초기점으로 상승 후 XY 이동
      out('G00 G90 ' + set.wcs + ' X' + fmt(h0.x) + ' Y' + fmt(h0.y) + spin);
      if (toolChange) out('G43 Z' + fmt(set.initialZ) + ' H' + pad(t.no, 2) + (set.coolant ? ' M08' : ''));
      if (rigid) out('M29 S' + s.rpm);
      let first = 'G' + set.retract.slice(1) + ' ' + code + ' X' + fmt(h0.x) + ' Y' + fmt(h0.y) + ' Z' + fmt(s.z) + ' R' + fmt(s.r);
      if (code === 'G73' || code === 'G83') first += ' Q' + fmt(s.q);
      if (code === 'G82') first += ' P' + s.dwell;
      first += ' F' + fmtF(s.feed);
      out(first);
      hits.push({ t: t.no, x: r3(h0.x), y: r3(h0.y), z: s.z, r: s.r, code });
      for (let i = 1; i < s.holes.length; i++) {
        const h = s.holes[i];
        out('X' + fmt(h.x) + ' Y' + fmt(h.y));
        hits.push({ t: t.no, x: r3(h.x), y: r3(h.y), z: s.z, r: s.r, code });
      }
      out('G80');
      curTool = t.no;
      if (k === plan.steps.length - 1) {
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

  const API = {
    VERSION, BUILD_DATE, OP_TYPES, TOOL_TYPES, MATERIALS, METRIC_COARSE, METRIC_FINE, CHECKS, ORIGIN_LABEL, GROUP_COLORS, CLAMP_MARGIN, MAX_HOLES,
    uid, fmt, ncText, r3, clone, toNum, isNum, stockRect, tipLength, opDepth, spotDiameter, tapDrill, standardPitch, refConditions, recommend, opConditions,
    genLine, genGrid, genPCD, checkArrayParams, orderHoles, toolMap, toolLabel, holeDiaForGroup, isDrillOp, isTapOp,
    defaultMachine, defaultBundles, newOp, newGroup, newProject, normalizeProject, normalizeMachine, normalizeBundle, normalizeTool,
    applyBundle, opsToBundle, checkBundleFit, findToolBySpec, specText, buildPlan, validateProject, generateNC, verifyNC, segRectHit
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  root.PCAM = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
