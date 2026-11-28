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

// ---------- V0.3 독립 검증 지적 사항 (수정 확인) ----------
test('[검증 1] 공구 지름이 바뀌었는데 공정이 갱신되지 않은 간편 입력 그룹 → 차단 (개수뿐 아니라 내용 비교)', () => {
  const r = run(C.newHoleSpec('drill', { dia: 6.6, depth: 12 }));
  assert.deepEqual(r.errs, []);
  const t7 = r.m.tools.find(t => t.no === 7), t8 = r.m.tools.find(t => t.no === 8);
  t7.dia = 9; t8.dia = 6.6; // 장비에서 공구 교체, 공정은 아직 T7 (갱신 안 됨)
  const v = C.validateProject(r.p, r.m);
  assert.ok(v.issues.some(i => i.level === 'error' && /일치하지 않습니다/.test(i.msg)));
  C.applyHoleSpec(r.g, r.m, r.p.stock); // 화면은 regenSpecs 로 갱신
  assert.equal(r.g.ops[1].toolNo, 8);
  assert.ok(!C.validateProject(r.p, r.m).issues.some(i => i.level === 'error'));
});

test('[검증 2] 기초 드릴 하한 = 최소 내경 D1: 대체 선택·모델 검증·NC 검증기 모두 적용, 같은 거리면 큰 드릴', () => {
  const m = C.defaultMachine();
  m.tools = m.tools.filter(t => t.type !== 'drill' && t.no < 20).concat([{ no: 21, type: 'drill', dia: 2.4, angle: 118, mat: 'HSS', flute: 30 }, { no: 22, type: 'drill', dia: 2.6, angle: 118, mat: 'HSS', flute: 30 }]);
  m.tools.push({ no: 23, type: 'tap', dia: 3, pitch: 0.5, mat: 'HSS', flute: 15 });
  const r = C.planHoleSpec(C.newHoleSpec('tap', { tapD: 3, tapP: 0.5, tapDepth: 6 }), m, { sz: 20 });
  assert.equal(C.toolMap(m).get(r.ops[1].toolNo).dia, 2.6, 'Ø2.4 (D1 2.459 미만) 대신 Ø2.6');
  // 직접 구성으로 Ø2.4 를 쓰면 모델 검증 오류
  const p = C.newProject(m); const g = C.newGroup('A', 0); g.holes = [{ id: 'a', x: 40, y: 40 }];
  g.ops = [C.newOp('drill', 21, { depth: 10 }), C.newOp('rigid', 23, { depth: 6 })]; p.groups = [g];
  const v = C.validateProject(p, m);
  assert.ok(v.issues.some(i => i.level === 'error' && /최소 내경 D1/.test(i.msg)));
  // NC 검증기도 Ø2.4 기초 구멍을 인정하지 않음
  const nc = C.generateNC(p, m, v.plan);
  const vr = C.verifyNC(nc.text, { stock: p.stock, machine: m, clamps: [], settings: p.settings, expected: null });
  assert.ok(vr.errors.some(e => /기초 드릴 구멍/.test(e.msg)));
  // 같은 거리(±0.1)면 큰 드릴
  const m2 = C.defaultMachine(); m2.tools = m2.tools.filter(t => t.dia !== 6.8 || t.type !== 'drill').concat([{ no: 30, type: 'drill', dia: 6.9, angle: 118, mat: 'HSS', flute: 70 }, { no: 31, type: 'drill', dia: 6.7, angle: 118, mat: 'HSS', flute: 70 }]);
  const r2 = C.planHoleSpec(C.newHoleSpec('tap', { tapD: 8, tapP: 1.25, tapDepth: 12 }), m2, { sz: 30 });
  assert.equal(C.toolMap(m2).get(r2.ops[1].toolNo).dia, 6.9);
});

test('[검증 3] 관통 탭은 소재 아래로 max(관통 여유, 3P), 하부 여유가 모자라면 경고', () => {
  const r = run(C.newHoleSpec('tap', { tapD: 10, tapP: 1.5, thru: true }), { stock: { sz: 20, under: 8 } });
  const tap = r.g.ops[2];
  assert.equal(tap.brk, 4.5); // 3P = 4.5
  assert.deepEqual(r.errs, []);
  const r2 = run(C.newHoleSpec('tap', { tapD: 10, tapP: 1.5, thru: true }), { stock: { sz: 20, under: 4 } });
  assert.equal(r2.g.ops[2].brk, 4); // 하부 여유 4mm 안으로 제한
  assert.ok(r2.res.notes.some(n => n.level === 'warn' && /권장 4.5mm/.test(n.msg)));
  assert.deepEqual(r2.errs, []);
  // 모델 검증: 관통 탭 출구가 2피치 미만이면 경고 (직접 구성 포함)
  const m = C.defaultMachine(), p = C.newProject(m); Object.assign(p.stock, { sz: 20, under: 5 });
  const g = C.newGroup('B', 0); g.holes = [{ id: 'a', x: 40, y: 40 }];
  g.ops = [C.newOp('peck', 6, { thru: true, brk: 1, q: 3 }), C.newOp('rigid', 15, { thru: true, brk: 1 })]; p.groups = [g];
  assert.ok(C.validateProject(p, m).issues.some(i => i.level === 'warn' && /불완전 나사부/.test(i.msg)));
});

test('[검증 4] 관통 여유 0.5mm 미만(음수 포함) → 차단', () => {
  [-5, 0, 0.2].forEach(brk => {
    const r = run(C.newHoleSpec('tap', { tapD: 8, tapP: 1.25, thru: true, brk }), { stock: { sz: 20, under: 10 } });
    assert.ok(r.errs.some(i => /관통 여유는 0.5mm/.test(i.msg)), 'brk ' + brk);
  });
});

test('[검증 5] 펙 Q ≤ 드릴 직경, 스테인리스·소경(Ø3 미만)은 0.5D', () => {
  const cases = [[5, 'S45C', 5], [5, 'SUS304', 2.5], [1.25, 'S45C', 0.6], [2.05, 'AL6061', 1], [6.8, 'AL6061', 6.8]];
  cases.forEach(([dia, mat, q]) => {
    const r = run(C.newHoleSpec('drill', { dia, depth: dia * 4.5 }), { addMissing: true, stock: { sz: 60, material: mat } });
    const d = r.g.ops[1];
    assert.equal(d.q, q, 'Ø' + dia + ' ' + mat);
    assert.ok(d.q <= dia);
  });
});

test('[검증 6] 센터 공구가 작아 모따기가 구멍보다 작으면 안내', () => {
  const r = C.planHoleSpec(C.newHoleSpec('tap', { tapD: 10, tapP: 1.5, tapDepth: 15 }), C.defaultMachine(), { sz: 30 });
  assert.ok(r.notes.some(n => n.level === 'info' && /위치 표시용/.test(n.msg)));
});

test('[검증 7] 구멍이 없는 간편 입력 그룹의 공구 부족은 전체 NC 를 막지 않음', () => {
  const m = C.defaultMachine(); const p = C.newProject(m);
  const a = C.newGroup('A', 0); a.holes = [{ id: 'a', x: 40, y: 40 }]; a.spec = C.newHoleSpec('tap', { tapD: 6, tapP: 1, tapDepth: 10 }); C.applyHoleSpec(a, m, p.stock);
  const b = C.newGroup('B', 1); b.spec = C.newHoleSpec('tap', { tapD: 20, tapP: 2.5, tapDepth: 20 }); C.applyHoleSpec(b, m, p.stock); // 공구 없음, 구멍 없음
  p.groups = [a, b];
  assert.ok(!C.validateProject(p, m).issues.some(i => i.level === 'error'));
});

test('[검증 8] 공구 날 길이보다 깊으면 간편 입력 단계에서 안내', () => {
  const m = C.defaultMachine(); m.tools.find(t => t.no === 4).flute = 10;
  const r = C.planHoleSpec(C.newHoleSpec('drill', { dia: 5, depth: 15 }), m, { sz: 30 });
  assert.ok(r.notes.some(n => n.level === 'error' && /날 길이/.test(n.msg)));
});
