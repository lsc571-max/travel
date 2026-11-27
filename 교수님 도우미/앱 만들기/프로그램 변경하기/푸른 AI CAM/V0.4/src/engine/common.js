/* =====================================================================
 * 푸른 AI CAM - [공통 엔진] engine/common.js
 * 역할: 버전·상수, 숫자/문자 유틸, 재질·나사 표, 소재 좌표계, 공구·장비 기본 데이터,
 *       기하 계산(선분-사각형 교차). 모든 모듈이 이 파일을 공유한다.
 * 의존: 없음 (가장 먼저 로드)
 * 공개: PCAM.* (아래 Object.assign 목록)
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM = root.PCAM || {};
  const VERSION = 'V0.4';
  const BUILD_DATE = '2026-11-27';
  const EPS = 1e-6;
  const CLAMP_MARGIN = 2;      // 클램프 위 최소 통과 여유(mm)
  const MAX_HOLES = 5000;      // 프로젝트당 최대 홀 수
  const FANUC_MAX = 99999.999; // FANUC 좌표 최대 입력값(mm, 소수 3자리 기준)
  const TOOL_TYPES = { center: '센터/스팟 드릴', drill: '드릴', tap: '탭', endmill: '평 엔드밀' };

  // 재질별 참고 절삭 조건 (일반 공구 카탈로그 범위의 보수적 대표값, 공구 제조사 값 우선)
  const MATERIALS = {
    AL6061: { label: '알루미늄 (AL6061 등)', vcHss: 70, vcCarb: 150, fFactor: 1.3, vcTap: 15, emHss: 90, emCarb: 300 },
    C3604:  { label: '황동 (C3604)', vcHss: 45, vcCarb: 120, fFactor: 1.2, vcTap: 12, emHss: 60, emCarb: 200 },
    SS400:  { label: '일반 구조용강 (SS400)', vcHss: 25, vcCarb: 80, fFactor: 1.0, vcTap: 8, emHss: 30, emCarb: 120 },
    S45C:   { label: '기계 구조용 탄소강 (S45C)', vcHss: 20, vcCarb: 70, fFactor: 0.9, vcTap: 7, emHss: 25, emCarb: 100 },
    SCM440: { label: '합금강 (SCM440)', vcHss: 15, vcCarb: 60, fFactor: 0.8, vcTap: 5, emHss: 20, emCarb: 80 },
    SUS304: { label: '스테인리스 (SUS304)', vcHss: 12, vcCarb: 45, fFactor: 0.7, vcTap: 4, emHss: 15, emCarb: 70 },
    FC250:  { label: '회주철 (FC250)', vcHss: 20, vcCarb: 70, fFactor: 1.1, vcTap: 8, emHss: 25, emCarb: 110 }
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
  // ISO 미터 암나사 최소 내경 D1 = D − 1.0825·P (기초 드릴이 이보다 작으면 나사산 물림 100% 초과 → 탭 파손)
  const minorD1 = (d, p) => d - 1.0825 * p;
  function standardPitch(d, p) {
    return METRIC_COARSE.some(r => Math.abs(r[0] - d) < 1e-9 && Math.abs(r[1] - p) < 1e-9) ||
      METRIC_FINE.some(r => Math.abs(r[0] - d) < 1e-9 && Math.abs(r[1] - p) < 1e-9);
  }


  /* ---------------- 장비·공구 ---------------- */
  function toolMap(machine) { const m = new Map(); (machine.tools || []).forEach(t => { if (!m.has(t.no)) m.set(t.no, t); }); return m; }
  function toolLabel(t) {
    if (!t) return '(없음)';
    if (t.type === 'tap') return 'T' + pad(t.no, 2) + ' 탭 M' + t.dia + '×' + t.pitch;
    if (t.type === 'endmill') return 'T' + pad(t.no, 2) + ' 엔드밀 Ø' + t.dia + ' ' + (t.z || 3) + '날';
    return 'T' + pad(t.no, 2) + ' ' + TOOL_TYPES[t.type] + ' Ø' + t.dia;
  }

  /* ---------------- 기본 데이터 ---------------- */
  function defaultMachine() {
    return {
      id: uid('m'), name: 'MC-1 FANUC 3축', control: 'FANUC',
      travel: { x: 800, y: 450, z: 500 }, maxRpm: 8000, maxTapRpm: 3000, maxFeed: 10000, magazine: 24,
      rigidTap: true, rigidM03: false, endY: true, helical: true, rapid: 12000, tcSec: 6, verified: false, verifiedBy: '', verifiedAt: '', verifyNote: '',
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
        { no: 15, type: 'tap', name: '스파이럴 탭', dia: 10, pitch: 1.5, mat: 'HSS', flute: 35 },
        { no: 16, type: 'endmill', name: '평 엔드밀', dia: 10, z: 3, mat: 'CARBIDE', flute: 25 },
        { no: 17, type: 'endmill', name: '평 엔드밀', dia: 8, z: 3, mat: 'CARBIDE', flute: 20 },
        { no: 18, type: 'endmill', name: '평 엔드밀', dia: 6, z: 3, mat: 'CARBIDE', flute: 15 },
        { no: 19, type: 'endmill', name: '평 엔드밀', dia: 4, z: 2, mat: 'CARBIDE', flute: 12 }
      ]
    };
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
    if (type === 'tap') o.pitch = toNum(t.pitch, 1);
    else if (type === 'endmill') o.z = Math.max(1, Math.min(12, Math.round(toNum(t.z, 3))));
    else o.angle = toNum(t && t.angle, type === 'center' ? 90 : 118);
    return o;
  }
  function normalizeMachine(m) {
    const d = defaultMachine();
    m = m || {};
    return {
      id: typeof m.id === 'string' ? m.id : uid('m'), name: String(m.name || d.name).slice(0, 60), control: m.control === 'FANUC' ? 'FANUC' : String(m.control || 'FANUC'),
      travel: { x: toNum(m.travel && m.travel.x, d.travel.x), y: toNum(m.travel && m.travel.y, d.travel.y), z: toNum(m.travel && m.travel.z, d.travel.z) },
      maxRpm: toNum(m.maxRpm, d.maxRpm), maxTapRpm: toNum(m.maxTapRpm, d.maxTapRpm), maxFeed: toNum(m.maxFeed, d.maxFeed), magazine: Math.round(toNum(m.magazine, d.magazine)),
      rigidTap: m.rigidTap !== false, rigidM03: !!m.rigidM03, endY: m.endY !== false, helical: m.helical !== false,
      rapid: Math.min(100000, Math.max(1000, toNum(m.rapid, d.rapid))), tcSec: Math.min(120, Math.max(0, toNum(m.tcSec, d.tcSec))), // 시간 추정용 (급속 mm/min, 공구 교환 초)
      verified: !!m.verified, verifiedBy: String(m.verifiedBy || '').slice(0, 40), verifiedAt: String(m.verifiedAt || '').slice(0, 40), verifyNote: String(m.verifyNote || '').slice(0, 200),
      tools: Array.isArray(m.tools) ? m.tools.slice(0, 300).map(normalizeTool) : d.tools
    };
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

  Object.assign(P, {
    VERSION, BUILD_DATE, EPS, CLAMP_MARGIN, MAX_HOLES, FANUC_MAX,
    TOOL_TYPES, MATERIALS, METRIC_COARSE, METRIC_FINE, ORIGIN_LABEL, ORIGIN_NC, GROUP_COLORS,
    uid, isNum, r3, deg, toNum, clone, fmt, fmtF, ncText, pad,
    stockRect, tipLength, spotDiameter, tapDrill, standardPitch, minorD1,
    toolMap, toolLabel, defaultMachine, newGroup, newProject, normalizeTool, normalizeMachine,
    segRectHit, clampRect, inRect
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
