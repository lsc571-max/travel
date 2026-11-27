/* =====================================================================
 * 푸른 AI CAM - [포스트프로세서 등록소] post/registry.js
 * 역할: 제어기별 포스트프로세서 등록·선택. 가공 모듈은 표준 가공 데이터만 만들고
 *       제어기 전용 G코드 변환은 이곳에 등록된 포스트프로세서만 담당한다.
 * 의존: engine/common.js, ops/registry.js
 *
 * ── 포스트프로세서 표준 규격 ──
 *   id          제어기 이름 (장비 설정 machine.control 값, 예 'FANUC')
 *   label       화면 이름          status  'ready' | 'planned'
 *   kinds       지원하는 표준 사이클 종류 배열 (drill, drillDwell, peck, deep, tap, rigidTap …)
 *   generate(project, machine, plan, opts) → { text, hits, lines }
 *       hits = 구멍별 [{ t, x, y, z, r, code }] (독립 검증기와 교차 비교용)
 *   verifier    같은 제어기용 독립 NC 검증기 이름 (PCAM.NCV 등록소)
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  const posts = new Map();
  function register(def) {
    if (!def || !def.id) throw new Error('포스트프로세서 id 가 없습니다.');
    if (posts.has(def.id)) throw new Error('포스트프로세서 중복 등록: ' + def.id);
    const d = Object.assign({ status: 'ready' }, def);
    if (d.status === 'ready' && (typeof d.generate !== 'function' || !Array.isArray(d.kinds))) throw new Error('포스트프로세서 ' + d.id + ': generate/kinds 누락');
    posts.set(d.id, Object.freeze(d));
  }
  const get = id => { const d = posts.get(id); return d && d.status === 'ready' ? d : null; };
  const all = () => [...posts.values()];

  // 공통 진입점: 장비 제어기에 맞는 포스트로 변환. 지원하지 않으면 생성 차단
  function generateNC(project, machine, plan, opts) {
    plan = plan || P.buildPlan(project, machine);
    const empty = why => ({ text: '', hits: [], lines: 0, blocked: why });
    const post = get(machine && machine.control);
    if (!post) return empty('지원하지 않는 제어기입니다: ' + (machine && machine.control));
    if (!plan.steps.length) return empty('가공할 홀/공정이 없습니다.');
    if (plan.steps.some(s => !s.tool || !P.OPS.get(s.type) || !P.OPS.get(s.type).toolTypes.includes(s.tool.type))) return empty('공구가 없거나 공정에 맞지 않는 공구가 있어 G코드를 만들 수 없습니다.');
    const bad = plan.steps.find(s => !post.kinds.includes(s.toolpath.kind));
    if (bad) return empty(post.label + ' 포스트가 지원하지 않는 사이클입니다: ' + bad.toolpath.kind);
    return post.generate(project, machine, plan, opts || {});
  }

  P.POST = Object.freeze({ register, get, all });
  P.generateNC = generateNC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
