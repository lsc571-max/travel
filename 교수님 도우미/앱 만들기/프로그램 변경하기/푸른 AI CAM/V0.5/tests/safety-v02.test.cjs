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
  assert.match(errs(ver(s, bad)), /G01 로 소재 상면|G01 XY 이동/);
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
  s.p.groups.unshift(g2); s.p.settings.toolOrder = 'tool'; // 일반 탭과 리지드 탭이 같은 T12 로 연속
  const { v, g } = gen(s);
  assert.equal(v.issues.filter(i => i.level === 'error').length, 0, JSON.stringify(v.issues.filter(i => i.level === 'error')));
  assert.equal((g.text.match(/T12 M06/g) || []).length, 1, '공구 교환 없이 연속');
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
  // [V0.5] 평면·윤곽은 구현됨 → 개발 예정 예시를 나사 밀링(threadMill)으로 바꿔 같은 규칙 확인
  assert.equal(C.OPS.get('threadMill'), null);
  assert.ok(C.OPS.planned().some(d => d.id === 'threadMill'));
  assert.equal(C.OP_TYPES.threadMill, undefined);
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

// ---------- 2차 독립 검증 지적 사항 (V0.2 에서 수정) ----------
test('[2차-1 중대] 같은 모달 그룹 G코드 동시 지령 차단 (G43 G49, G73 G80, G00+사이클)', () => {
  const s = setup(); const { g } = gen(s);
  assert.match(errs(ver(s, g.text.replace('G43 Z50. H03 M08', 'G43 G49 Z50. H03 M08'))), /같은 그룹/);
  assert.match(errs(ver(s, g.text.replace(/G98 G73 /, 'G98 G73 G80 '))), /같은 그룹/);
  assert.match(errs(ver(s, g.text.replace(/G98 G73 /, 'G98 G00 G73 '))), /G00~G03 과 고정 사이클/);
  assert.deepEqual(ver(s, g.text, g.hits).errors, [], '생성 NC 의 G00 G17 G40 G49 G80 G90 G94 는 허용');
});
test('[2차-2 중대] G00 이후 리지드 탭 모드 해제 → 주축 정지 상태 G84 는 오류', () => {
  const s = setup(); const { g } = gen(s);
  const bad = g.text.replace(/(G84[^\n]*\n(?:X[^\n]*\n)*)X([\d.]+) Y([\d.]+)\nG80/, '$1G00 Z50.\nG98 G84 X$2 Y$3 Z-10. R5. F360.\nG80');
  assert.notEqual(bad, g.text);
  assert.match(errs(ver(s, bad)), /주축 정지 상태에서 일반 탭|탭 이송/);
});
test('[2차-3] 좌표계를 별도 줄에서 바꿔도 이동 시 오류, 기초 구멍 기록은 좌표계별', () => {
  const s = setup(); const { g } = gen(s);
  const bad = g.text.replace('(OP2', 'G55\n(OP2').replace(/(T03 M06\nG00 G90) G54/, '$1');
  assert.notEqual(bad, g.text);
  assert.match(errs(ver(s, bad)), /G55 이\(가\) 프로젝트 설정 G54 와 다른/);
});
test('[2차-4] M06 후 주축 정지로 간주 → M03 없이 드릴 사이클은 오류', () => {
  const s = setup(); const { g } = gen(s);
  const bad = g.text.replace(/M05\nG91 G28 Z0\.\nG90\nM01\n(\(OP2[^\n]*\n)T03 M06\nG00 G90 G54 (X[\d.]+ Y[\d.]+) S\d+ M03/, 'G91 G28 Z0.\nG90\nM01\n$1T03 M06\nG00 G90 G54 $2');
  assert.notEqual(bad, g.text);
  assert.match(errs(ver(s, bad)), /주축 정지 상태에서 드릴 사이클/);
});
test('[2차-5] G01 로 소재 아래 절입 → 오류', () => {
  const s = setup(); const { g } = gen(s);
  assert.match(errs(ver(s, g.text.replace('G43 Z50. H12 M08', 'G43 Z50. H12 M08\nG01 Z-10. F2000.\nG00 Z50.'))), /G01 로 소재 상면/);
});
test('[2차-6] XY 를 모르는 상태에서 Z 하강 → 오류', () => {
  const s = setup(); const { g } = gen(s);
  assert.match(errs(ver(s, g.text.replace(/G00 G90 G54 X[\d.]+ Y[\d.]+ S(\d+) M03\nG43 Z50\. H01/, 'G00 G90 G54 S$1 M03\nG43 Z-5. H01'))), /XY 위치를 모르는 상태/);
  assert.match(errs(ver(s, g.text.replace('G43 Z50. H01 M08', 'G43 Z50. H01 M08\nG91 G28 X0. Y0.\nG90\nG00 Z-15.'))), /XY 위치를 모르는 상태/);
});
test('[2차-7] 모델 검증도 스팟 드릴 등 가장 큰 공구 반경으로 소재·클램프 검사 (검증기와 일치)', () => {
  const s = setup({ holes: [{ x: 40, y: 50 }] });
  s.p.clamps.push({ id: 'c', x: 44, y: 40, w: 10, h: 20, height: 20 });
  assert.ok(C.validateProject(s.p, s.m).issues.some(i => i.level === 'error' && /클램프 1 영역/.test(i.msg)), 'Ø6 스팟이 클램프에 닿음');
  const s2 = setup({ holes: [{ x: 2.6, y: 50 }] });
  assert.ok(C.validateProject(s2.p, s2.m).issues.some(i => i.level === 'error' && /공구\(Ø6\)이 소재 밖/.test(i.msg)));
});
test('[2차] 미지원 가공: 공정 묶음 가져오기 경고, 묶음 적용 시 드릴로 바꾸지 않음', () => {
  const b = C.normalizeBundle({ name: 'X', ops: [{ type: 'ream' }, { type: 'drill', toolNo: 4 }] });
  assert.match(b.importWarnings[0], /1개 제외/);
  const r = C.applyBundle({ ops: [{ type: 'ream', toolNo: 4 }, { type: 'drill', toolNo: 4 }] }, C.defaultMachine());
  assert.deepEqual(r.ops.map(o => o.type), ['drill']);
  assert.ok(r.notes.some(n => /ream/.test(n)));
  assert.equal(C.normalizeOp({ type: 'ream' }), null);
});
test('[2차] 리지드 탭 중 G84 블록에서 S 변경 → 오류', () => {
  const s = setup(); const { g } = gen(s);
  assert.match(errs(ver(s, g.text.replace(/(G98 G84 [^\n]*) F/, '$1 S900 F'))), /S를 바꿀 수 없습니다/);
});

test('일관성: 무작위 2,000건 — 모델 오류 0 이면 생성 NC 도 독립 검증 오류 0·교차 일치 (클램프·좌표계·옵션 포함)', () => {
  let seed = 4242; const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let ok = 0;
  for (let n = 0; n < 2000; n++) {
    const m = C.defaultMachine(); m.rigidM03 = R() < 0.3; m.endY = R() < 0.7;
    const p = C.newProject(m), b = C.defaultBundles(m);
    Object.assign(p.stock, { sx: 80 + Math.round(R() * 250), sy: 60 + Math.round(R() * 150), sz: 25 + Math.round(R() * 20), origin: ['LL', 'UL', 'LR', 'UR', 'C'][Math.floor(R() * 5)], under: Math.round(R() * 5), material: Object.keys(C.MATERIALS)[Math.floor(R() * 7)] });
    Object.assign(p.settings, { retract: R() < 0.5 ? 'G98' : 'G99', wcs: ['G54', 'G55', 'G59'][Math.floor(R() * 3)], seqNo: R() < 0.3, coolant: R() < 0.8, m01: R() < 0.5, toolOrder: R() < 0.5 ? 'tool' : 'group', pathOrder: ['nearest', 'zigzag', 'input'][Math.floor(R() * 3)] });
    const r = C.stockRect(p.stock);
    for (let gi = 0; gi < 1 + Math.floor(R() * 3); gi++) {
      const g = C.newGroup('G' + gi, gi);
      for (let k = 0; k < 1 + Math.floor(R() * 10); k++) g.holes.push({ id: gi + '_' + k, x: C.r3(r.x0 + 6 + R() * (p.stock.sx - 12)), y: C.r3(r.y0 + 6 + R() * (p.stock.sy - 12)) });
      g.ops = C.applyBundle(b[Math.floor(R() * b.length)], m).ops;
      if (R() < 0.3) g.ops.forEach(o => { if (o.type === 'rigid' && R() < 0.5) o.type = 'tap'; if (o.type === 'center' && R() < 0.5) o.dwell = 300; });
      p.groups.push(g);
    }
    if (R() < 0.5) p.clamps.push({ id: 'c', x: r.x0 + R() * p.stock.sx, y: r.y0 - 5, w: 15, h: 12, height: 5 + Math.round(R() * 40) });
    const v = C.validateProject(p, m);
    if (v.issues.some(i => i.level === 'error')) continue;
    const g = C.generateNC(p, m, v.plan);
    const res = C.verifyNC(g.text, { stock: p.stock, machine: m, clamps: p.clamps, settings: p.settings, expected: g.hits });
    assert.deepEqual(res.errors, [], '#' + n + '\n' + JSON.stringify(p.settings));
    assert.equal(res.match, true);
    ok++;
  }
  assert.ok(ok > 500, '통과 건수 ' + ok);
});
