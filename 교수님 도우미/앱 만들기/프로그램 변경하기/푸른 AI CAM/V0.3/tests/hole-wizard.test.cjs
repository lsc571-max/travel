// V0.3 구멍·탭 간편 입력(process/hole-wizard.js) 단위 테스트
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/load-node.cjs');

function project(m, stock) { const p = C.newProject(m); Object.assign(p.stock, stock || {}); return p; }
function run(spec, opts) {
  opts = opts || {};
  const m = opts.machine || C.defaultMachine();
  const p = project(m, opts.stock);
  const res = C.planHoleSpec(spec, m, p.stock);
  if (opts.addMissing) { res.missing.forEach(x => C.addMissingTool(m, x)); }
  const g = C.newGroup('A', 0); g.holes = [{ id: 'a', x: 40, y: 40 }, { id: 'b', x: 90, y: 60 }]; g.spec = spec; C.applyHoleSpec(g, m, p.stock); p.groups = [g];
  const v = C.validateProject(p, m);
  return { m, p, g, res, v, errs: v.issues.filter(i => i.level === 'error') };
}

test('M6 탭 간편 입력 → 센터·Ø5 드릴(G81, 직경부 15)·M6 리지드 탭 12, 오류 0', () => {
  const r = run(C.newHoleSpec('tap', { tapD: 6, tapP: 1, tapDepth: 12 }));
  assert.deepEqual(r.g.ops.map(o => o.type + ':T' + o.toolNo), ['center:T1', 'drill:T4', 'rigid:T13']);
  const d = r.g.ops[1];
  assert.equal(d.depthMode, 'full'); assert.equal(d.depth, 15); // 12 + max(3×1, 2) = 15
  assert.equal(r.g.ops[2].depth, 12); assert.equal(r.g.ops[2].r, 5);
  assert.deepEqual(r.errs, []);
});

test('기초 드릴 깊이 = 탭 깊이 + max(3P, 2) 를 0.5 단위 올림', () => {
  const cases = [[8, 1.25, 15, 19], [5, 0.8, 10, 12.5], [3, 0.5, 6, 8], [10, 1.5, 18, 22.5], [12, 1.75, 20, 25.5]];
  cases.forEach(([d, p, td, want]) => {
    const r = run(C.newHoleSpec('tap', { tapD: d, tapP: p, tapDepth: td }), { addMissing: true, stock: { sz: 60 } });
    const drill = r.g.ops.find(o => C.isDrillOp(o.type));
    assert.equal(drill.depth, want, 'M' + d);
  });
});

test('드릴 사이클 자동: 깊이/직경 ≤3 G81, ≤5 G73, >5 G83 (직접 지정 시 그대로)', () => {
  assert.equal(C.autoCycle(15, 5), 'drill');
  assert.equal(C.autoCycle(15.5, 5), 'peck');
  assert.equal(C.autoCycle(25, 5), 'peck');
  assert.equal(C.autoCycle(25.5, 5), 'deep');
  const r = run(C.newHoleSpec('drill', { dia: 5, depth: 30 }), { stock: { sz: 40 } });
  assert.equal(r.g.ops[1].type, 'deep'); assert.equal(r.g.ops[1].q, 5);
  const r2 = run(C.newHoleSpec('drill', { dia: 5, depth: 30, cycle: 'peck' }), { stock: { sz: 40 } });
  assert.equal(r2.g.ops[1].type, 'peck');
});

test('모든 표준 나사(보통·가는) 간편 입력: 공구 추가 후 오류 0, 생성 NC 독립 검증 오류 0·교차 일치', () => {
  let n = 0;
  C.threadList().forEach(t => [false, true].forEach(thru => {
    const r = run(C.newHoleSpec('tap', { tapD: t.d, tapP: t.p, tapDepth: Math.max(2, Math.round(t.d * 1.5)), thru }), { addMissing: true, stock: { sz: 80, under: 30, sx: 300, sy: 200 } });
    r.m.tools.forEach(x => { x.flute = 300; }); r.m.magazine = 99;
    const v = C.validateProject(r.p, r.m), e = v.issues.filter(i => i.level === 'error');
    assert.deepEqual(e.map(i => i.msg), [], t.label + (thru ? ' 관통' : ''));
    const g = C.generateNC(r.p, r.m, v.plan);
    const vr = C.verifyNC(g.text, { stock: r.p.stock, machine: r.m, clamps: [], settings: r.p.settings, expected: g.hits });
    assert.deepEqual(vr.errors, [], t.label); assert.equal(vr.match, true);
    n++;
  }));
  assert.ok(n > 60, '시험한 나사 ' + n);
});

test('없는 공구: 해당 공정을 만들지 않고 오류 안내 → [공구 추가] 후 정상', () => {
  const m = C.defaultMachine();
  const r = run(C.newHoleSpec('tap', { tapD: 12, tapP: 1.75, tapDepth: 20 }), { machine: m, stock: { sz: 40 } });
  assert.deepEqual(r.g.ops.map(o => o.type), ['center']);
  assert.equal(r.res.missing.length, 2);
  assert.ok(r.errs.length > 0, '불완전 공정은 검증 오류로 차단');
  r.res.missing.forEach(x => C.addMissingTool(m, x));
  const r2 = run(C.newHoleSpec('tap', { tapD: 12, tapP: 1.75, tapDepth: 20 }), { machine: m, stock: { sz: 40 } });
  assert.deepEqual(r2.g.ops.map(o => o.type), ['center', 'drill', 'rigid']);
  const added = m.tools.filter(t => t.no > 15 || ![1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15].includes(t.no));
  assert.ok(added.some(t => t.type === 'drill' && t.dia === 10.2) && added.some(t => t.type === 'tap' && t.dia === 12 && t.pitch === 1.75));
  assert.equal(new Set(m.tools.map(t => t.no)).size, m.tools.length, 'T번호 중복 없음');
});

test('추천 기초 드릴이 없으면 허용 범위 안 보유 드릴 사용 + 경고, 범위 밖이면 사용 안 함', () => {
  const m = C.defaultMachine(); m.tools = m.tools.filter(t => t.dia !== 6.8); // M8 추천 Ø6.8 제거
  const r = C.planHoleSpec(C.newHoleSpec('tap', { tapD: 8, tapP: 1.25, tapDepth: 12 }), m, { sz: 30 });
  assert.ok(r.notes.some(n => n.level === 'warn' && /보유 드릴/.test(n.msg)) || r.missing.some(x => x.type === 'drill'));
  const dr = r.ops.find(o => C.isDrillOp(o.type));
  if (dr) { const t = C.toolMap(m).get(dr.toolNo); assert.ok(t.dia >= 8 - 1.25 * 1.25 && t.dia < 8 - 0.5 * 1.25); }
});

test('관통: 하부 여유 부족이면 간편 입력 단계에서 필요 여유를 안내 (검증도 차단)', () => {
  const r = run(C.newHoleSpec('drill', { dia: 6.6, thru: true }), { stock: { sz: 20, under: 0 } });
  assert.ok(r.res.notes.some(n => n.level === 'error' && /최소 [\d.]+mm/.test(n.msg)));
  assert.ok(r.errs.length > 0);
  const ok = run(C.newHoleSpec('drill', { dia: 6.6, thru: true }), { stock: { sz: 20, under: 5 } });
  assert.deepEqual(ok.errs, []);
});

test('막힌 구멍이 소재를 뚫고 나가면 안내', () => {
  const r = C.planHoleSpec(C.newHoleSpec('drill', { dia: 5, depth: 19 }), C.defaultMachine(), { sz: 20, under: 0 });
  assert.ok(r.notes.some(n => /소재 두께|뚫고/.test(n.msg)));
});

test('탭 방식: 장비 리지드 탭 미지원이면 자동=일반 탭, 직접 지정 우선', () => {
  const m = C.defaultMachine(); m.rigidTap = false;
  const r = C.planHoleSpec(C.newHoleSpec('tap', { tapD: 6, tapP: 1, tapDepth: 10 }), m, { sz: 30 });
  assert.equal(r.ops[2].type, 'tap');
  const m2 = C.defaultMachine();
  const r2 = C.planHoleSpec(C.newHoleSpec('tap', { tapD: 6, tapP: 1, tapDepth: 10, tapMode: 'tap' }), m2, { sz: 30 });
  assert.equal(r2.ops[2].type, 'tap');
});

test('센터 드릴 모따기 직경은 공구 직경 이내 (검증 오류 없음)', () => {
  [3, 6.6, 9, 16].forEach(d => {
    const r = run(C.newHoleSpec('drill', { dia: d, depth: d * 2 }), { addMissing: true, stock: { sz: 50 } });
    const c = r.g.ops[0], t = C.toolMap(r.m).get(c.toolNo);
    assert.ok(C.spotDiameter(t, c.depth) <= t.dia, 'Ø' + d);
  });
});

test('간편 입력 정규화: 손상 값 방어, 기존 프로젝트(spec 없음) 호환', () => {
  assert.equal(C.normalizeHoleSpec({ kind: 'evil' }), null);
  const s = C.normalizeHoleSpec({ kind: 'tap', tapD: 'x', cycle: 'rm -rf', tapMode: 1 });
  assert.equal(s.tapD, 8); assert.equal(s.cycle, 'auto'); assert.equal(s.tapMode, 'auto');
  const p = C.normalizeProject({ groups: [{ name: 'A', holes: [], ops: [{ type: 'drill' }] }, { name: 'B', spec: { kind: 'drill', dia: 5 } }] });
  assert.equal(p.groups[0].spec, null);
  assert.equal(p.groups[1].spec.kind, 'drill'); assert.equal(p.groups[1].spec.dia, 5);
});

test('간편 입력 공정 이름 표시', () => {
  const m = C.defaultMachine();
  assert.equal(C.opLabel(C.newOp('peck', 5), m), 'T05 Ø6.8 고속 펙 드릴 G73');
  assert.equal(C.opLabel(C.newOp('rigid', 14), m), 'T14 M8×1.25 리지드 탭 M29+G84');
  assert.match(C.opLabel(C.newOp('drill', 99), m), /공구 없음/);
});

test('탭 공정 앞 오버라이드 100% 안내 주석 출력, 드릴만 있으면 없음', () => {
  const r = run(C.newHoleSpec('tap', { tapD: 6, tapP: 1, tapDepth: 12 }));
  const t = C.generateNC(r.p, r.m, r.v.plan).text;
  assert.match(t, /\(OP3 RIGID TAP [^\n]*\)\n\(TAP - SET FEED AND SPINDLE OVERRIDE TO 100 PERCENT\)/);
  const r2 = run(C.newHoleSpec('drill', { dia: 5, depth: 10 }));
  assert.ok(!/OVERRIDE/.test(C.generateNC(r2.p, r2.m, r2.v.plan).text));
});
