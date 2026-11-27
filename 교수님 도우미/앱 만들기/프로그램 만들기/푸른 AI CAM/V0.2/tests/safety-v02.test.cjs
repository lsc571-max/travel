// V0.2 안전 수정 검증: 독립 검증 AI가 V0.1 에서 재현한 결함 9건 + 미지원 가공 방식 처리
// 각 테스트는 "수정 전에는 통과(미탐지)했던 위험 NC" 가 이제 오류로 차단되는지 확인한다.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/load-node.cjs');

function setup(opts) {
  opts = opts || {};
  const m = C.defaultMachine();
  const p = C.newProject(m);
  Object.assign(p.stock, opts.stock || {});
  Object.assign(p.settings, opts.settings || {});
  const b = C.defaultBundles(m);
  const g = C.newGroup('G1', 0);
  g.holes = (opts.holes || C.genGrid({ x: 20, y: 20, px: 30, py: 30, nx: 3, ny: 2 })).map(h => ({ id: C.uid('h'), x: h.x, y: h.y }));
  g.ops = C.applyBundle(b[opts.bundle == null ? 0 : opts.bundle], m).ops; // 기본: M5 (스팟 → Ø4.2 펙 14 → M5 리지드 10)
  p.groups = [g];
  return { m, p, g, b };
}
function gen(s) { const v = C.validateProject(s.p, s.m); return { v, g: C.generateNC(s.p, s.m, v.plan, { date: new Date(2026, 10, 27) }) }; }
const ctx = (s, exp) => ({ stock: s.p.stock, machine: s.m, clamps: s.p.clamps, settings: s.p.settings, expected: exp || null });
const ver = (s, text, exp) => C.verifyNC(text, ctx(s, exp));
const errs = r => r.errors.map(e => e.msg).join(' | ');
// 첫 G43 블록 뒤에 줄 삽입
const afterG43 = (t, ins) => t.replace(/(G43 Z50\. H\d+ M08\n)/, '$1' + ins);

test('기준: 생성된 NC 는 수정된 검증기에서도 오류 0 (교차 검증 일치)', () => {
  for (const bundle of [0, 1, 2, 3]) {
    const s = setup({ bundle, stock: { sz: 30 } });
    const { v, g } = gen(s);
    assert.equal(v.issues.filter(i => i.level === 'error').length, 0);
    const r = ver(s, g.text, g.hits);
    assert.deepEqual(r.errors, [], 'bundle ' + bundle);
    assert.equal(r.match, true);
  }
});

test('[검증 1·중대] 소재를 관통하는 급속 이동 → 오류 (끝점이 소재 밖이어도)', () => {
  const s = setup(); const { g } = gen(s);
  const bad = afterG43(g.text, 'G00 X-20. Y30.\nG00 Z-5.\nG00 X170. Y30.\nG00 Z50.\n');
  assert.match(errs(ver(s, bad)), /급속 XY 이동/);
});

test('[검증 5] 소재 높이에서 G01 측면 이동 → 오류', () => {
  const s = setup(); const { g } = gen(s);
  const bad = afterG43(g.text, 'G00 X-20. Y30.\nG00 Z-5.\nG01 X170. F500.\nG00 Z50.\n');
  assert.match(errs(ver(s, bad)), /G01 XY 이동/);
});

test('[검증 3] 수정 NC: 기초 구멍보다 깊은 탭 / 드릴하지 않은 위치의 탭 / 너무 작은 기초 드릴 → 오류', () => {
  const s = setup(); const { g } = gen(s);
  const tapLine = /(G98 G84 X[\d.]+ Y[\d.]+ Z)-10\./;
  assert.ok(tapLine.test(g.text));
  assert.match(errs(ver(s, g.text.replace(tapLine, '$1-20.'))), /탭 깊이 Z-20\. .*기초 드릴|바닥|날 길이/);
  assert.match(errs(ver(s, g.text.replace(tapLine, '$1-14.'))), /기초 드릴 직경부 깊이보다 깊습니다/);
  const moved = g.text.replace(/(G84[^\n]*\n)X[\d.]+ Y[\d.]+\n/, '$1X45. Y35.\n');
  assert.notEqual(moved, g.text);
  assert.match(errs(ver(s, moved)), /X45\. Y35\. 탭 위치에 맞는 기초 드릴 구멍/);
  const swapped = g.text.replace('T03 M06', 'T02 M06').replace('H03', 'H02');
  assert.match(errs(ver(s, swapped)), /기초 드릴 구멍\(Ø/);
});

test('[검증 3] 수정 NC: 비정상 절삭 조건(Vc·회전당 이송 3배 초과) → 오류', () => {
  const s = setup(); const { g } = gen(s);
  const bad = g.text.replace(/(T03 M06\nG00 G90 G54 X[\d.]+ Y[\d.]+ )S\d+ M03/, '$1S8000 M03').replace(/(G73[^\n]*F)[\d.]+/, '$15000.');
  assert.notEqual(bad, g.text);
  const e = errs(ver(s, bad));
  assert.match(e, /절삭속도 Vc/); assert.match(e, /회전당 이송/);
});

test('[검증 4] 좌표계 누락·다른 좌표계 → 오류', () => {
  const s = setup(); const { g } = gen(s);
  assert.match(errs(ver(s, g.text.split('G54').join('G59'))), /G59 .*G54/);
  assert.match(errs(ver(s, g.text.split(' G54').join(''))), /좌표계\(G54~G59\) 지정 없이/);
});

test('[검증 6] G94 출력, G94 없이 F 사용 → 오류', () => {
  const s = setup(); const { g } = gen(s);
  assert.ok(g.text.includes('G00 G17 G40 G49 G80 G90 G94'));
  assert.match(errs(ver(s, g.text.replace(' G94', ''))), /G94/);
});

test('[검증 7] 같은 공구로 일반 탭 → 리지드 탭: M29 전에 M05 출력, 회전 중 M29 는 오류', () => {
  const s = setup();
  const g2 = C.newGroup('G2', 1); g2.holes = [{ id: 'q1', x: 120, y: 80 }];
  g2.ops = C.applyBundle(s.b[0], s.m).ops; g2.ops[2].type = 'tap'; // 일반 탭(같은 T12)
  s.p.groups.unshift(g2); s.p.settings.toolOrder = 'group';
  const { v, g } = gen(s);
  assert.equal(v.issues.filter(i => i.level === 'error').length, 0, JSON.stringify(v.issues.filter(i => i.level === 'error')));
  const L = g.text.split('\n'), i29 = L.findIndex(l => l.startsWith('M29'));
  const lastSpin = L.slice(0, i29).map((l, k) => ({ l, k })).filter(x => /M03|M05/.test(x.l)).pop();
  assert.match(lastSpin.l, /M05/, 'M29 직전 주축 정지');
  assert.deepEqual(ver(s, g.text, g.hits).errors, []);
  const L2 = L.slice(); L2.splice(lastSpin.k, 1); // 그 M05 제거
  assert.match(errs(ver(s, L2.join('\n'))), /주축 회전 중 M29/);
});

test('[검증 8] 시퀀스 번호 N 은 99999 를 넘지 않음, 넘는 번호는 오류', () => {
  const s = setup({ settings: { seqNo: true }, stock: { sx: 700, sy: 440 }, holes: C.genGrid({ x: 10, y: 10, px: 10, py: 10, nx: 68, ny: 42 }) });
  const { g } = gen(s);
  const ns = (g.text.match(/^N(\d+)/gm) || []).map(x => +x.slice(1));
  assert.ok(ns.length > 8000, '번호 블록 수 ' + ns.length);
  assert.ok(Math.max(...ns) <= 99999, '최대 N' + Math.max(...ns));
  assert.deepEqual(ver(s, g.text, g.hits).errors, []);
  assert.match(errs(ver(s, g.text.replace(/^N\d+ G21/m, 'N100000 G21'))), /99999/);
});

test('[검증 2] 수정본 검증은 현재 소재 기준 (소재 축소 시 이전 통과본이 오류로 바뀜)', () => {
  const s = setup(); const { g } = gen(s);
  const edited = g.text.replace(/(G81[^\n]*\n)/, '$1X140. Y50.\n');
  assert.deepEqual(ver(s, edited).errors.filter(e => /소재 범위/.test(e.msg)), []);
  s.p.stock.sx = 136; // 화면은 recompute() 마다 현재 소재로 수정본을 다시 검증함
  assert.match(errs(ver(s, edited)), /X140\. Y50\. 가공 위치가 소재 범위/);
});

test('미지원 가공 방식(개발 예정·상위 버전)은 드릴로 바꾸지 않고 제외 + 경고', () => {
  const p = C.normalizeProject({ groups: [{ name: 'A', holes: [{ x: 10, y: 10 }], ops: [{ type: 'face', toolNo: 1 }, { type: 'center', toolNo: 1 }, { type: 'evil' }] }] });
  assert.deepEqual(p.groups[0].ops.map(o => o.type), ['center']);
  assert.match(p.importWarnings[0], /2개/);
  const b = C.normalizeBundle({ ops: [{ type: 'pocketRect' }, { type: 'drill' }] });
  assert.deepEqual(b.ops.map(o => o.type), ['drill']);
});

test('가공 모듈 등록소: 필수 규격 누락·중복 등록 거부, 개발 예정 모듈은 선택 불가', () => {
  assert.throws(() => C.OPS.register({ id: 'x1', label: 'X' }), /누락/);
  assert.throws(() => C.OPS.register(Object.assign({}, C.OPS.get('drill'), { id: 'center' })), /중복/);
  assert.equal(C.OPS.get('face'), null);
  assert.ok(C.OPS.planned().some(d => d.id === 'face'));
  assert.equal(C.OP_TYPES.face, undefined);
  assert.throws(() => C.POST.register({ id: 'X', kinds: [] }), /generate/);
  const s = setup(); s.m.control = 'SIEMENS';
  const { v, g } = gen(s);
  assert.ok(v.issues.some(i => i.level === 'error' && /제어기/.test(i.msg)));
  assert.match(g.blocked, /제어기/);
});

test('새 가공 모듈 등록 예: 다른 모듈 수정 없이 추가·사용 가능 (시험용 모듈)', () => {
  // 등록소 규격만 지키면 계획·포스트·검증이 자동 연결되는지 확인 (시험 후 다른 테스트에 영향 없도록 별도 로더)
  const C2 = (() => { const k = require.resolve('../src/load-node.cjs'); delete require.cache[k]; return require(k); })();
  const H = C2.HOLE;
  C2.OPS.register(H.defineHoleOp({ id: 'testSpot2', label: '시험 스팟', code: 'G81', ncName: 'TEST SPOT', stage: 1, role: 'spot', toolTypes: ['center'], defaults: { depth: 1, r: 3 }, ui: { q: false, dwell: true, thru: false, depthMode: false }, toolpath: () => ({ kind: 'drill', spindle: 'cw' }) }));
  const m = C2.defaultMachine(), p = C2.newProject(m), g = C2.newGroup('T', 0);
  g.holes = [{ id: 'a', x: 30, y: 30 }]; g.ops = [C2.newOp('testSpot2', 1)]; p.groups = [g];
  const v = C2.validateProject(p, m), n = C2.generateNC(p, m, v.plan);
  assert.equal(v.issues.filter(i => i.level === 'error').length, 0);
  assert.match(n.text, /\(OP1 TEST SPOT T01 Z-1\. 1 HOLES\)/);
  assert.deepEqual(C2.verifyNC(n.text, { stock: p.stock, machine: m, clamps: [], settings: p.settings, expected: n.hits }).errors, []);
});
