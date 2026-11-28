/* =====================================================================
 * 푸른 AI CAM - [가공 모듈 등록소] ops/registry.js
 * 역할: 가공 모듈(가공 블록)을 표준 규격으로 등록·조회한다.
 *       새 가공 기능은 이 등록소에 register() 하는 파일 하나만 추가하면 된다.
 * 의존: engine/common.js
 *
 * ── 가공 모듈 표준 규격 (status: 'ready' 일 때 모두 필수) ──
 *   id          'center' 등 고유 이름 (프로젝트 파일에 저장되는 값)
 *   label       화면 이름          code   화면 표시 코드 (예 'G81')
 *   ncName      NC 주석용 영문 이름 (ASCII)
 *   stage       공구 교환 최소화 정렬 단계 (1 센터 → 2 드릴 → 3 탭 …)
 *   role        'spot' | 'drill' | 'tap' (홀 계열 역할) — 다른 계열은 새 역할 추가
 *   toolTypes   사용 가능한 공구 종류 배열
 *   defaults    newOp 기본값 (depth, r 등)
 *   ui          화면 입력 항목 표시 여부 { q, dwell, thru, depthMode, feedFromPitch }
 *   depth(op, tool, stock)              → { depth, full, tip, z }
 *   ref(tool, matKey)                    → { vc, fpr } 참고 절삭 조건
 *   recommend(tool, matKey, machine)     → { rpm, feed, limited }
 *   conditions(op, tool, matKey, machine)→ { rpm, feed } 실제 사용 조건
 *   validate(ctx)                        모듈 전용 검증 (ctx.add 로 문제 등록)
 *   toolpath(params)                     → 표준 가공 데이터 { kind, z, r, q, dwell, feed, rpm, spindle }
 *                                          (제어기 전용 G코드를 만들지 않는다 → 포스트프로세서 담당)
 *   status      'ready' | 'planned' (개발 예정 모듈은 목록에만 표시, 선택 불가)
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  const { toNum, r3, uid } = P;
  const defs = new Map();
  const REQUIRED = ['id', 'label', 'code', 'ncName', 'stage', 'role', 'toolTypes', 'defaults', 'ui', 'depth', 'ref', 'recommend', 'conditions', 'validate', 'toolpath'];
  let cache = null;

  function register(def) {
    if (!def || typeof def.id !== 'string' || !def.id) throw new Error('가공 모듈 id 가 없습니다.');
    if (defs.has(def.id)) throw new Error('가공 모듈 중복 등록: ' + def.id);
    const d = Object.assign({ status: 'ready' }, def);
    if (d.status === 'ready') REQUIRED.forEach(k => { if (d[k] === undefined) throw new Error('가공 모듈 ' + d.id + ': ' + k + ' 누락'); });
    if (d.status === 'ready' && !/^[\x20-\x7E]+$/.test(d.ncName)) throw new Error('가공 모듈 ' + d.id + ': ncName 은 ASCII 만');
    defs.set(d.id, Object.freeze(d));
    cache = null;
  }
  const get = id => { const d = defs.get(id); return d && d.status === 'ready' ? d : null; };
  const all = () => [...defs.values()];
  const ready = () => all().filter(d => d.status === 'ready');
  const planned = () => all().filter(d => d.status === 'planned');

  // 기존 화면·검증 코드와 호환되는 요약 표 { id: { label, code, stage, tools } }
  function opTypes() {
    if (!cache) { cache = {}; ready().forEach(d => { cache[d.id] = Object.freeze({ label: d.label, code: d.code, stage: d.stage, tools: d.toolTypes }); }); Object.freeze(cache); }
    return cache;
  }
  const isDrillOp = t => { const d = get(t); return !!d && d.role === 'drill'; };
  const isTapOp = t => { const d = get(t); return !!d && d.role === 'tap'; };

  // ── 모듈 호출 위임 (모르는 가공은 안전한 기본값) ──
  function opDepth(op, tool, stock) {
    const d = get(op.type);
    if (d) return d.depth(op, tool, stock);
    const depth = toNum(op.depth, 0);
    return { depth: r3(depth), full: r3(depth), tip: 0, z: r3(-depth) };
  }
  function refConditions(type, tool, matKey) { const d = get(type); return d && tool ? d.ref(tool, matKey) : null; }
  function recommend(type, tool, matKey, machine) { const d = get(type); return d && tool && tool.dia > 0 ? d.recommend(tool, matKey, machine) : { rpm: 0, feed: 0, limited: false }; }
  function opConditions(op, tool, matKey, machine) { const d = get(op.type); return d ? d.conditions(op, tool, matKey, machine) : { rpm: 0, feed: 0 }; }

  // 공정(가공 블록) 새로 만들기: 공통 필드 + 모듈 기본값
  function newOp(type, toolNo, extra) {
    const d = get(type);
    const o = { id: uid('o'), type, toolNo: toolNo || 1, depth: 10, depthMode: 'tip', thru: false, brk: 1, r: 3, q: 2, dwell: 0, auto: true, rpm: 1000, feed: 100 };
    if (d) Object.assign(o, d.defaults);
    return Object.assign(o, extra || {});
  }

  P.OPS = Object.freeze({ register, get, all, ready, planned });
  Object.defineProperty(P, 'OP_TYPES', { get: opTypes, enumerable: true });
  Object.assign(P, { isDrillOp, isTapOp, opDepth, refConditions, recommend, opConditions, newOp });
})(typeof globalThis !== 'undefined' ? globalThis : this);
