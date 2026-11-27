// 푸른 AI CAM 계산 엔진 단위 테스트 — Node.js 내장 테스트 러너 사용 (설치 불필요)
// 실행: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/load-node.cjs');

// ---------- 공용 준비 ----------
function setup(opts) {
  opts = opts || {};
  const m = C.defaultMachine();
  const p = C.newProject(m);
  Object.assign(p.stock, opts.stock || {});
  Object.assign(p.settings, opts.settings || {});
  const b = C.defaultBundles(m);
  const g = C.newGroup('G1', 0);
  g.holes = (opts.holes || C.genGrid({ x: 20, y: 20, px: 30, py: 30, nx: 3, ny: 2 })).map(h => ({ id: C.uid('h'), x: h.x, y: h.y }));
  g.ops = C.applyBundle(b[opts.bundle == null ? 1 : opts.bundle], m).ops;
  p.groups = [g];
  return { m, p, g, b };
}
const errs = (v, cat) => v.issues.filter(i => i.level === 'error' && (cat == null || i.cat === cat));
const warns = (v, cat) => v.issues.filter(i => i.level === 'warn' && (cat == null || i.cat === cat));
function gen(p, m) { const v = C.validateProject(p, m); const g = C.generateNC(p, m, v.plan, { date: new Date(2026, 10, 27, 9, 0) }); return { v, g }; }
function ver(text, p, m, expected) { return C.verifyNC(text, { stock: p.stock, machine: m, clamps: p.clamps, expected: expected || null }); }

// ---------- 1. 기본 계산식 ----------
test('FANUC 숫자 형식: 항상 소수점 포함, 3자리 반올림', () => {
  assert.equal(C.fmt(10), '10.');
  assert.equal(C.fmt(10.5), '10.5');
  assert.equal(C.fmt(-2.5), '-2.5');
  assert.equal(C.fmt(0), '0.');
  assert.equal(C.fmt(-0.0001), '0.');
  assert.equal(C.fmt(1.23456), '1.235');
  assert.equal(C.fmt(-17.0004), '-17.');
  assert.equal(C.fmt(99999.999), '99999.999');
});
test('미터 나사 기초 드릴 추천 (보통·가는 나사)', () => {
  const cases = [[3, 0.5, 2.5], [4, 0.7, 3.3], [5, 0.8, 4.2], [6, 1, 5.0], [8, 1.25, 6.8], [10, 1.5, 8.5], [12, 1.75, 10.2], [16, 2, 14], [20, 2.5, 17.5], [24, 3, 21], [30, 3.5, 26.5],
    [8, 1, 7], [10, 1.25, 8.75], [12, 1.5, 10.5], [16, 1.5, 14.5]];
  cases.forEach(([d, p, want]) => assert.equal(C.tapDrill(d, p).dia, want, 'M' + d + 'x' + p));
  assert.equal(C.tapDrill(8).pitch, 1.25, '피치 생략 시 보통 나사');
  assert.equal(C.tapDrill(0, 1), null);
  assert.equal(C.tapDrill(7), null, '표에 없는 호칭경 + 피치 없음');
  assert.equal(C.tapDrill(8, 1.25).kind, '보통 나사');
});
test('드릴 끝 원뿔 길이: Ø10 118° = 3.004', () => {
  assert.equal(C.r3(C.tipLength({ type: 'drill', dia: 10, angle: 118 })), 3.004);
  assert.equal(C.r3(C.tipLength({ type: 'drill', dia: 6, angle: 140 })), 1.092);
  assert.equal(C.tipLength({ type: 'tap', dia: 10 }), 0);
});
test('깊이 계산: 공구 끝 / 직경부 / 관통', () => {
  const st = { sz: 20 }, t = { type: 'drill', dia: 10, angle: 118 };
  assert.equal(C.opDepth({ type: 'drill', depth: 15, depthMode: 'tip' }, t, st).z, -15);
  assert.equal(C.opDepth({ type: 'drill', depth: 15, depthMode: 'full' }, t, st).z, -18.004);
  assert.equal(C.opDepth({ type: 'peck', thru: true, brk: 1 }, t, st).z, -24.004);
  assert.equal(C.opDepth({ type: 'rigid', thru: true, brk: 1.5 }, { type: 'tap', dia: 10, pitch: 1.5 }, st).z, -21.5);
});
test('스팟 모따기 직경 = 2·깊이·tan(각/2)', () => {
  assert.equal(C.r3(C.spotDiameter({ angle: 90 }, 3)), 6);
  assert.equal(C.r3(C.spotDiameter({ angle: 120 }, 1)), 3.464);
});
test('탭 이송 G94: F = S × P (자동 계산, 수동 입력 무시)', () => {
  const m = C.defaultMachine(), t = { type: 'tap', dia: 8, pitch: 1.25, mat: 'HSS' };
  const c1 = C.opConditions({ type: 'rigid', auto: false, rpm: 500, feed: 999 }, t, 'S45C', m);
  assert.equal(c1.feed, 625);
  const c2 = C.opConditions({ type: 'tap', auto: false, rpm: 637, feed: 1 }, t, 'S45C', m);
  assert.equal(c2.feed, 796.25);
  const c3 = C.opConditions({ type: 'rigid', auto: true }, t, 'S45C', m);
  assert.equal(c3.feed, C.r3(c3.rpm * 1.25));
});
test('추천 회전수: Vc·1000/(πD), 장비 최대값 제한', () => {
  const m = C.defaultMachine();
  const r = C.recommend('drill', { type: 'drill', dia: 10, mat: 'HSS' }, 'S45C', m);
  assert.equal(r.rpm, 640); // 20*1000/(π*10)=636.6 → 10단위 반올림
  const small = C.recommend('drill', { type: 'drill', dia: 0.5, mat: 'CARBIDE' }, 'AL6061', m);
  assert.equal(small.rpm, 8000); assert.equal(small.limited, true);
  const rt = C.recommend('rigid', { type: 'tap', dia: 3, pitch: 0.5, mat: 'CARBIDE' }, 'AL6061', m);
  assert.ok(rt.rpm <= m.maxTapRpm);
});

// ---------- 2. 홀 배열 ----------
test('배열: 직선·사각·PCD 좌표', () => {
  assert.deepEqual(C.genLine({ x: 0, y: 0, pitch: 10, angle: 90, count: 3 }), [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 20 }]);
  const g = C.genGrid({ x: 5, y: 5, px: 10, py: 20, nx: 2, ny: 2 });
  assert.deepEqual(g, [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 5, y: 25 }, { x: 15, y: 25 }]);
  const pcd = C.genPCD({ cx: 50, cy: 50, dia: 100, count: 4, start: 0 });
  assert.deepEqual(pcd, [{ x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }, { x: 50, y: 0 }]);
  const p6 = C.genPCD({ cx: 0, cy: 0, dia: 60, count: 6, start: 30 });
  p6.forEach(h => assert.ok(Math.abs(Math.hypot(h.x, h.y) - 30) < 0.001));
});
test('배열 입력값 한계 검사', () => {
  assert.ok(C.checkArrayParams('line', { x: 0, y: 0, pitch: 0, angle: 0, count: 5 }).length > 0, '간격 0');
  assert.ok(C.checkArrayParams('line', { x: 0, y: 0, pitch: 5, angle: 0, count: 0 }).length > 0, '개수 0');
  assert.ok(C.checkArrayParams('line', { x: 0, y: 0, pitch: 5, angle: 0, count: 2.5 }).length > 0, '개수 소수');
  assert.ok(C.checkArrayParams('grid', { x: 0, y: 0, px: 1, py: 1, nx: 100, ny: 100 }).length > 0, '5000개 초과');
  assert.ok(C.checkArrayParams('pcd', { cx: 0, cy: 0, dia: -5, count: 4, start: 0 }).length > 0, 'PCD 음수');
  assert.ok(C.checkArrayParams('single', { x: NaN, y: 0 }).length > 0, 'NaN');
  assert.equal(C.checkArrayParams('grid', { x: 0, y: 0, px: 10, py: 10, nx: 3, ny: 3 }).length, 0);
});
test('가공 순서: 최단 거리·지그재그·입력 순서', () => {
  const pts = [{ x: 30, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
  assert.deepEqual(C.orderHoles(pts, 'nearest', { x: 0, y: 0 }).map(p => p.x), [0, 10, 20, 30]);
  assert.deepEqual(C.orderHoles(pts, 'input').map(p => p.x), [30, 0, 10, 20]);
  const grid = C.genGrid({ x: 0, y: 0, px: 10, py: 10, nx: 3, ny: 2 });
  assert.deepEqual(C.orderHoles(grid, 'zigzag').map(p => p.x + ',' + p.y), ['0,0', '10,0', '20,0', '20,10', '10,10', '0,10']);
});

// ---------- 3. 정상 프로젝트: 생성 → 독립 검증 교차 확인 ----------
test('정상 프로젝트: 오류 0, NC 필수 구성 포함, 독립 검증 100% 일치', () => {
  const { m, p } = setup();
  const { v, g } = gen(p, m);
  assert.equal(errs(v).length, 0, JSON.stringify(errs(v)));
  const t = g.text;
  ['%', 'O0001', 'G21', 'G00 G17 G40 G49 G80 G90', 'G91 G28 Z0.', 'T01 M06', 'G43 Z50. H01 M08', 'G98 G81', 'G73', 'M29 S', 'G84', 'G80', 'M05', 'M09', 'M30'].forEach(k => assert.ok(t.includes(k), k + ' 누락'));
  assert.ok(t.startsWith('%\nO0001'), '% 다음 O번호');
  assert.ok(t.trim().endsWith('M30\n%'));
  assert.ok(t.includes('TEST ONLY'), '미검증 장비 표시');
  const r = ver(t, p, m, g.hits);
  assert.deepEqual(r.errors, []);
  assert.equal(r.match, true);
  assert.equal(r.hits.length, 18);
  // ASCII 전용
  assert.ok(/^[\n\x20-\x7E]*$/.test(t), 'NC에 ASCII 외 문자');
});
test('검증 완료 장비는 TEST 표시 없음', () => {
  const { m, p } = setup(); m.verified = true;
  const { g } = gen(p, m);
  assert.ok(!g.text.includes('TEST ONLY'));
});
test('리지드 탭: M29 S 가 G84 직전, 주축 M03 없음(기본) / 옵션 시 M03', () => {
  const { m, p } = setup();
  let L = gen(p, m).g.text.split('\n');
  const i = L.findIndex(l => l.includes('G84'));
  assert.match(L[i - 1], /^M29 S\d+$/);
  const S = +L[i - 1].split('S')[1];
  const F = +/F([\d.]+)/.exec(L[i])[1];
  assert.equal(F, S * 1.0, 'M6x1.0 탭: F=S×1.0');
  const tcIdx = L.findIndex(l => l === 'T13 M06');
  assert.ok(!L[tcIdx + 1].includes('M03'));
  m.rigidM03 = true;
  L = gen(p, m).g.text.split('\n');
  assert.ok(L[L.findIndex(l => l === 'T13 M06') + 1].includes('M03'));
});
test('일반 탭(G84): S M03 필수, F=S×P, 검증 통과', () => {
  const { m, p, g } = setup();
  g.ops[2].type = 'tap';
  const { v, g: n } = gen(p, m);
  assert.equal(errs(v).length, 0);
  assert.ok(!n.text.includes('M29'));
  const r = ver(n.text, p, m, n.hits);
  assert.deepEqual(r.errors, []);
});
test('공구 교환 최소화: 같은 공구·조건의 여러 그룹을 한 번에 가공', () => {
  const { m, p, b } = setup();
  const g2 = C.newGroup('G2', 1);
  g2.holes = [{ id: 'a', x: 120, y: 80 }, { id: 'b', x: 130, y: 80 }];
  g2.ops = C.applyBundle(b[1], m).ops;
  p.groups.push(g2);
  const { v, g } = gen(p, m);
  assert.equal(v.plan.steps.length, 3, '스팟/드릴/탭 3단계로 병합');
  assert.equal((g.text.match(/M06/g) || []).length, 3);
  p.settings.toolOrder = 'group';
  const g3 = gen(p, m);
  assert.equal((g3.g.text.match(/M06/g) || []).length, 6);
  assert.deepEqual(ver(g3.g.text, p, m, g3.g.hits).errors, []);
});
test('그룹 내부 공정 순서가 공구 순 정렬로 바뀌면 그룹 순서로 대체', () => {
  const { m, p } = setup();
  // 큰 드릴(T6)을 먼저, 작은 드릴(T5)을 나중에 → 다른 그룹에서 T5 먼저 등장
  const g0 = C.newGroup('A', 0); g0.holes = [{ id: 'x', x: 120, y: 20 }];
  g0.ops = [C.newOp('drill', 5, { depth: 5 })];
  const g1 = p.groups[0]; g1.ops = [C.newOp('drill', 6, { depth: 5 }), C.newOp('drill', 5, { depth: 5 })];
  p.groups = [g0, g1];
  const plan = C.buildPlan(p, m);
  assert.ok(plan.info.length > 0);
});
test('G99 + 시퀀스 번호 + 같은 공구 연속 공정에서도 검증 통과', () => {
  const { m, p, g } = setup({ settings: { retract: 'G99', seqNo: true } });
  g.ops.splice(2, 0, C.newOp('peck', 4, { depth: 10, q: 3 })); // 같은 T04 연속, 다른 조건
  const { v, g: n } = gen(p, m);
  assert.equal(errs(v).length, 0, JSON.stringify(errs(v)));
  assert.ok(/^N10 /m.test(n.text));
  const r = ver(n.text, p, m, n.hits);
  assert.deepEqual(r.errors, []);
  assert.equal(r.match, true);
});
test('모든 원점 위치(LL·UL·LR·UR·C)에서 생성·검증 통과', () => {
  for (const o of ['LL', 'UL', 'LR', 'UR', 'C']) {
    const { m, p, g } = setup({ stock: { origin: o } });
    const r = C.stockRect(p.stock);
    g.holes = C.genGrid({ x: r.x0 + 20, y: r.y0 + 20, px: 30, py: 30, nx: 3, ny: 2 }).map(h => ({ id: C.uid('h'), ...h }));
    const { v, g: n } = gen(p, m);
    assert.equal(errs(v).length, 0, o);
    assert.deepEqual(ver(n.text, p, m, n.hits).errors, [], o);
  }
});

// ---------- 4. 11개 검증 항목: 결함 주입 시 오류로 차단 ----------
test('1 좌표: NaN 좌표·장비 행정 초과 차단', () => {
  let { m, p, g } = setup(); g.holes[0].x = NaN;
  assert.ok(errs(C.validateProject(p, m), 1).length);
  ({ m, p } = setup({ stock: { sx: 900 } }));
  assert.ok(errs(C.validateProject(p, m), 1).length);
});
test('2 소재 범위: 소재 밖 홀 차단, 가장자리 근접 경고', () => {
  let { m, p, g } = setup(); g.holes[0].x = -5;
  assert.ok(errs(C.validateProject(p, m), 2).length);
  ({ m, p, g } = setup()); g.holes[0].x = 148; // Ø5 홀이 150 끝에 걸침
  assert.ok(errs(C.validateProject(p, m), 2).length);
  ({ m, p, g } = setup()); g.holes[0].x = 3.5; // 살 두께 1mm
  assert.ok(warns(C.validateProject(p, m), 2).length);
});
test('3 중복 홀: 같은 그룹·다른 그룹 중복 차단, 겹침 경고', () => {
  let { m, p, g, b } = setup(); g.holes.push({ id: 'dup', x: g.holes[0].x, y: g.holes[0].y });
  assert.ok(errs(C.validateProject(p, m), 3).length);
  ({ m, p, g, b } = setup());
  const g2 = C.newGroup('G2', 1); g2.holes = [{ id: 'z', x: g.holes[0].x + 0.001, y: g.holes[0].y }]; g2.ops = C.applyBundle(b[0], m).ops; p.groups.push(g2);
  assert.ok(errs(C.validateProject(p, m), 3).length);
  g2.holes[0].x = g.holes[0].x + 3;
  assert.ok(warns(C.validateProject(p, m), 3).length);
});
test('4 공구: 없는 번호·매거진 초과·종류 불일치·번호 중복 차단', () => {
  let { m, p, g } = setup(); g.ops[1].toolNo = 23;
  assert.ok(errs(C.validateProject(p, m), 4).length, '없는 공구');
  ({ m, p, g } = setup()); m.tools.push({ no: 30, type: 'drill', dia: 5, angle: 118, mat: 'HSS', flute: 50 }); g.ops[1].toolNo = 30;
  assert.ok(errs(C.validateProject(p, m), 4).length, '매거진 초과');
  ({ m, p, g } = setup()); g.ops[1].toolNo = 13;
  assert.ok(errs(C.validateProject(p, m), 4).length, '드릴 공정에 탭');
  assert.ok(C.generateNC(p, m).blocked, '생성기도 차단');
  ({ m, p } = setup()); m.tools.push({ no: 1, type: 'drill', dia: 5, angle: 118, mat: 'HSS', flute: 50 });
  assert.ok(errs(C.validateProject(p, m), 4).length, '번호 중복');
});
test('5 탭 기초 드릴: 누락·과소·과대 차단, 추천값 차이 경고', () => {
  let { m, p, g } = setup(); g.ops.splice(1, 1);
  assert.ok(errs(C.validateProject(p, m), 5).length, '기초 드릴 없음');
  ({ m, p, g } = setup()); g.ops[1].toolNo = 2; // Ø3.3 for M6
  assert.ok(errs(C.validateProject(p, m), 5).length, '너무 작음');
  ({ m, p, g } = setup()); m.tools.push({ no: 20, type: 'drill', dia: 5.6, angle: 118, mat: 'HSS', flute: 60 }); g.ops[1].toolNo = 20;
  assert.ok(errs(C.validateProject(p, m), 5).length, '너무 큼');
  ({ m, p, g } = setup()); m.tools.push({ no: 20, type: 'drill', dia: 5.2, angle: 118, mat: 'HSS', flute: 60 }); g.ops[1].toolNo = 20;
  const v = C.validateProject(p, m);
  assert.equal(errs(v, 5).length, 0); assert.ok(warns(v, 5).length, '추천과 다름 경고');
});
test('5 탭 기초 드릴: 단차 드릴(깊은 기초 드릴 + 얕은 큰 드릴)은 가장 깊은 적합 드릴로 판정', () => {
  const { m, p, g } = setup();
  g.ops.splice(2, 0, C.newOp('drill', 8, { depth: 3 })); // Ø9 얕은 카운터 (탭 기초로 부적합 직경)
  const v = C.validateProject(p, m);
  assert.equal(errs(v, 5).length + errs(v, 8).length, 0, JSON.stringify(errs(v)));
});
test('6 절삭 조건: 0·최대 초과·Vc 3배 초과·이송 과대 차단', () => {
  const cases = [{ rpm: 0, feed: 100 }, { rpm: 9000, feed: 100 }, { rpm: 1200, feed: 0 }, { rpm: 1200, feed: 20000 }, { rpm: 5000, feed: 300 }, { rpm: 1200, feed: 600 }];
  cases.forEach(c => {
    const { m, p, g } = setup(); Object.assign(g.ops[1], { auto: false }, c);
    assert.ok(errs(C.validateProject(p, m), 6).length, JSON.stringify(c));
  });
});
test('7 탭: 리지드 미지원 장비·탭 최대 회전수 초과 차단', () => {
  let { m, p } = setup(); m.rigidTap = false;
  assert.ok(errs(C.validateProject(p, m), 7).length);
  let s = setup(); Object.assign(s.g.ops[2], { auto: false, rpm: 3500 });
  assert.ok(errs(C.validateProject(s.p, s.m), 7).length);
});
test('8 깊이: 0·날장 초과·하부 여유 초과·탭이 드릴보다 깊음 차단', () => {
  let { m, p, g } = setup(); g.ops[1].depth = 0;
  assert.ok(errs(C.validateProject(p, m), 8).length, '깊이 0');
  ({ m, p, g } = setup({ stock: { sz: 80 } })); g.ops[1].depth = 60;
  assert.ok(errs(C.validateProject(p, m), 8).length, '날장 초과');
  ({ m, p, g } = setup()); g.ops[1].thru = true;
  assert.ok(errs(C.validateProject(p, m), 8).length, '관통인데 하부 여유 0');
  p.stock.under = 5; g.ops[2].thru = true;
  assert.equal(errs(C.validateProject(p, m), 8).length, 0, '하부 여유 5mm면 관통 허용');
  ({ m, p, g } = setup()); g.ops[2].depth = 16;
  assert.ok(errs(C.validateProject(p, m), 8).length, '탭이 드릴 직경부보다 깊음');
  ({ m, p, g } = setup()); g.ops[0].depth = 4;
  assert.ok(errs(C.validateProject(p, m), 8).length, '스팟 모따기 Ø8 > 공구 Ø6');
});
test('9 펙: Q 0 차단, Q≥깊이 경고, 드웰 범위', () => {
  let { m, p, g } = setup(); g.ops[1].q = 0;
  assert.ok(errs(C.validateProject(p, m), 9).length);
  g.ops[1].q = 30;
  assert.ok(warns(C.validateProject(p, m), 9).length);
  ({ m, p, g } = setup()); g.ops[0].dwell = 9000;
  assert.ok(errs(C.validateProject(p, m), 9).length);
});
test('10 안전 높이·충돌: R점·초기점·클램프 차단', () => {
  let { m, p, g } = setup(); g.ops[1].r = 0;
  assert.ok(errs(C.validateProject(p, m), 10).length, 'R=0');
  ({ m, p, g } = setup()); g.ops[1].r = 60;
  assert.ok(errs(C.validateProject(p, m), 10).length, 'R≥초기점');
  ({ m, p, g } = setup()); p.clamps.push({ id: 'c', x: 15, y: 15, w: 10, h: 10, height: 30 });
  assert.ok(errs(C.validateProject(p, m), 10).length, '홀이 클램프 위');
  ({ m, p } = setup()); p.clamps.push({ id: 'c', x: -30, y: 0, w: 20, h: 20, height: 49 });
  assert.ok(errs(C.validateProject(p, m), 10).length, '초기점 < 클램프+2');
  ({ m, p } = setup({ settings: { retract: 'G99' } })); p.clamps.push({ id: 'c', x: 30, y: 12, w: 10, h: 5, height: 10 });
  assert.ok(errs(C.validateProject(p, m), 10).some(e => e.msg.includes('G99')), 'G99 경로가 클램프 위');
  p.settings.retract = 'G98';
  assert.ok(!errs(C.validateProject(p, m), 10).length, 'G98 이면 초기점(50) 이동이라 통과');
});
test('11 NC 구조: 프로그램 번호·홀 없음·미검증 경고', () => {
  let { m, p } = setup(); p.programNo = 0;
  assert.ok(errs(C.validateProject(p, m), 11).length);
  p.programNo = 10000; assert.ok(errs(C.validateProject(p, m), 11).length);
  ({ m, p } = setup()); p.groups = [];
  assert.ok(errs(C.validateProject(p, m), 11).length);
  ({ m, p } = setup());
  assert.ok(warns(C.validateProject(p, m), 11).length, '미검증 장비 경고');
});

// ---------- 5. 독립 검증기: 수정된 NC 결함 탐지 ----------
function baseNC() { const s = setup(); const { g } = gen(s.p, s.m); return Object.assign(s, { text: g.text, hits: g.hits }); }
const mutateNC = [
  ['소수점 누락', t => t.replace(/(G73[^\n]*)Z-17\./, '$1Z-17'), /소수점/],
  ['I·J 없는 G02 원호 (V0.4부터 G02/G03 해석)', t => t.replace('G80\n', 'G80\nG02 X10. Y10.\n'), /원호에 I, J|검증할 수 없는 G코드/],
  ['인치 G20', t => t.replace('G21', 'G20'), /인치/],
  ['M30 누락', t => t.replace('M30\n', ''), /M30/],
  ['H 번호 불일치', t => t.replace('H04', 'H05'), /H05.*T4|H05/],
  ['G43 누락 Z이동', t => t.replace('G43 Z50. H04 M08', 'G00 Z50. M08'), /공구 길이 보정/],
  ['M29 누락(리지드)', t => t.replace(/M29 S\d+\n/, ''), /주축 정지|탭 이송/],
  ['탭 이송 불일치', t => t.replace(/(G84 [^\n]*F)([\d.]+)/, (a, b, c) => b + (parseFloat(c) + 50) + '.'), /탭 이송/],
  ['바닥 아래 Z', t => t.replace(/(G73[^\n]*)Z-17\./, '$1Z-25.'), /바닥|날 길이/],
  ['소재 밖 좌표', t => t.replace(/\nX50\. Y20\.\n/, '\nX250. Y20.\n'), /소재 범위/],
  ['R점 소재 아래', t => t.replace('R3. Q2.', 'R-1. Q2.'), /R점/],
  ['Q 누락', t => t.replace(' Q2.', ''), /Q/],
  ['G90 상태 G28', t => t.replace('G91 G28 Z0.\nG90\nM01', 'G90 G28 Z0.\nM01'), /G28/],
  ['G80 누락 후 공구 교환', t => t.replace(/G80\n(\(OP2|M09)/, '$1'), /G80/],
  ['급속 소재 진입', t => t.replace('G43 Z50. H04 M08', 'G43 Z0.5 H04 M08'), /급속|초기점/],
  ['주석 한글', t => t.replace('(MATERIAL:', '(재질:'), null],
  ['없는 공구 T99', t => t.replace('T04 M06', 'T99 M06'), /T99/],
  ['S 최대 초과', t => t.replace(/S1270 M03/, 'S12000 M03'), /최대 회전수/],
  ['해석 불가 문자', t => t.replace('G80\n', 'G80 ?\n'), /해석할 수 없는/],
  ['증분 이동', t => t.replace('G80\n', 'G80\nG91 G00 X10.\nG90\n'), /증분/]
];
mutateNC.forEach(([name, fn, re]) => {
  test('검증기 결함 탐지: ' + name, () => {
    const { m, p, text } = baseNC();
    const bad = fn(text);
    assert.notEqual(bad, text, '결함 주입 실패: ' + name);
    const r = ver(bad, p, m, null);
    if (re === null) { assert.ok(r.warnings.some(w => /주석/.test(w.msg)), '한글 주석 경고'); return; }
    assert.ok(r.errors.length > 0, name + ': 오류 미탐지');
    assert.ok(r.errors.some(e => re.test(e.msg)), name + ': ' + JSON.stringify(r.errors.map(e => e.msg)));
  });
});
test('검증기: 클램프 충돌 경로 탐지 (G99 R점 이동)', () => {
  const { m, p } = setup({ settings: { retract: 'G99' } });
  const { g } = gen(p, m);
  p.clamps.push({ id: 'c', x: 30, y: 12, w: 10, h: 5, height: 10 });
  const r = ver(g.text, p, m, null);
  assert.ok(r.errors.some(e => /클램프/.test(e.msg)));
});
test('검증기: 생성기 기대값과 불일치 시 교차 검증 오류', () => {
  const { m, p, text, hits } = baseNC();
  const h2 = hits.slice(); h2[0] = Object.assign({}, h2[0], { x: h2[0].x + 1 });
  const r = ver(text, p, m, h2);
  assert.equal(r.match, false);
  assert.ok(r.errors.some(e => /일치하지 않습니다/.test(e.msg)));
});

// ---------- 6. 입력값 한계·무작위 시험 (퍼징) ----------
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
test('무작위 정상 프로젝트 300개: 오류가 없으면 생성→독립 검증 100% 일치', () => {
  const R = rng(12345);
  let checked = 0, blocked = 0;
  for (let n = 0; n < 300; n++) {
    const origin = ['LL', 'UL', 'LR', 'UR', 'C'][Math.floor(R() * 5)];
    const s = setup({ bundle: Math.floor(R() * 4), stock: { sx: 60 + Math.round(R() * 300), sy: 60 + Math.round(R() * 200), sz: 20 + Math.round(R() * 30), material: Object.keys(C.MATERIALS)[Math.floor(R() * 7)], origin, under: Math.round(R() * 5) },
      settings: { retract: R() < 0.5 ? 'G98' : 'G99', pathOrder: ['nearest', 'zigzag', 'input'][Math.floor(R() * 3)], toolOrder: R() < 0.5 ? 'tool' : 'group', seqNo: R() < 0.3, coolant: R() < 0.8, m01: R() < 0.5 } });
    const r = C.stockRect(s.p.stock);
    const nh = 1 + Math.floor(R() * 25);
    s.g.holes = [];
    for (let k = 0; k < nh; k++) s.g.holes.push({ id: 'h' + k, x: C.r3(r.x0 + 12 + R() * (s.p.stock.sx - 24)), y: C.r3(r.y0 + 12 + R() * (s.p.stock.sy - 24)) });
    if (R() < 0.5) { const g2 = C.newGroup('B', 1); g2.holes = [{ id: 'q', x: C.r3(r.x0 + s.p.stock.sx / 2), y: C.r3(r.y0 + s.p.stock.sy / 2) }]; g2.ops = C.applyBundle(s.b[Math.floor(R() * 4)], s.m).ops; s.p.groups.push(g2); }
    const { v, g } = gen(s.p, s.m);
    if (errs(v).length) { blocked++; continue; }
    const res = ver(g.text, s.p, s.m, g.hits);
    assert.deepEqual(res.errors, [], 'seed case ' + n + '\n' + g.text);
    assert.equal(res.match, true);
    checked++;
  }
  assert.ok(checked > 100, '검사된 정상 케이스 수 ' + checked + ' (차단 ' + blocked + ')');
});
test('무작위 비정상 입력 300개: 예외 없이 처리되고 오류 시 생성 차단 유지', () => {
  const R = rng(777);
  const pick = () => [NaN, -1, 0, 1e9, -1e9, Infinity, 0.0001, 5, 50, 'abc', null, undefined][Math.floor(R() * 12)];
  for (let n = 0; n < 300; n++) {
    const s = setup();
    const op = s.g.ops[Math.floor(R() * 3)];
    ['depth', 'r', 'q', 'rpm', 'feed', 'dwell', 'brk'][Math.floor(R() * 7)] && (op[['depth', 'r', 'q', 'rpm', 'feed', 'dwell', 'brk'][Math.floor(R() * 7)]] = pick());
    if (R() < 0.3) op.auto = false;
    if (R() < 0.3) s.g.holes[0].x = pick();
    if (R() < 0.3) s.p.stock.sz = pick();
    const p2 = C.normalizeProject(JSON.parse(JSON.stringify(s.p)));
    let v;
    assert.doesNotThrow(() => { v = C.validateProject(p2, s.m); });
    const g = C.generateNC(p2, s.m, v.plan);
    if (g.text) assert.doesNotThrow(() => ver(g.text, p2, s.m, g.hits));
    // 오류가 없다면 반드시 검증기도 통과해야 함 (검사 누락 방지)
    if (!errs(v).length && g.text) assert.deepEqual(ver(g.text, p2, s.m, g.hits).errors, [], JSON.stringify(p2.groups[0].ops));
  }
});
test('대량 홀 5000개: 검증·생성 성능 (2초 이내)', () => {
  const s = setup({ stock: { sx: 700, sy: 440 } });
  s.g.holes = C.genGrid({ x: 10, y: 10, px: 8, py: 8, nx: 85, ny: 54 }).slice(0, 4590).map((h, i) => ({ id: 'h' + i, ...h }));
  const t0 = Date.now();
  const { v, g } = gen(s.p, s.m);
  const r = ver(g.text, s.p, s.m, g.hits);
  const ms = Date.now() - t0;
  assert.ok(ms < 2000, ms + 'ms');
  assert.equal(r.match, true);
  assert.ok(v.plan.steps.length === 3);
});
test('JSON 정규화: 악성·손상 데이터 방어', () => {
  const p = C.normalizeProject({ name: '<script>x</script>'.repeat(10), programNo: 'x', stock: { sx: 'a', origin: 'ZZ', material: 'XX' }, groups: [{ color: 'red;}', holes: [{ x: '1', y: {} }], ops: [{ type: 'evil', toolNo: 'q' }] }], settings: { wcs: 'G53' } });
  assert.equal(p.name.length, 60);
  assert.equal(p.stock.origin, 'LL'); assert.equal(p.stock.material, 'S45C'); assert.equal(p.stock.sx, 150);
  assert.equal(p.settings.wcs, 'G54');
  assert.match(p.groups[0].color, /^#[0-9a-f]{6}$/i);
  assert.equal(p.groups[0].ops.length, 0, 'V0.2: 미지원 가공(evil)은 드릴로 바꾸지 않고 제외'); assert.ok(p.importWarnings);
  assert.ok(Number.isNaN(p.groups[0].holes[0].y));
  const m = C.normalizeMachine({ tools: [{ type: 'laser', no: '3' }], verified: 'yes' });
  assert.equal(m.tools[0].type, 'drill');
});
test('공정 묶음: 장비 변경 시 사양 일치 공구로 자동 매칭·적합성 확인', () => {
  const m = C.defaultMachine(); const b = C.defaultBundles(m)[2]; // M8
  const m2 = C.clone(m); m2.tools.find(t => t.no === 5).no = 21; // Ø6.8 드릴 번호 변경
  const r = C.applyBundle(b, m2);
  assert.equal(r.ops[1].toolNo, 21);
  assert.ok(r.notes.length === 1);
  const m3 = C.clone(m); m3.tools = m3.tools.filter(t => t.dia !== 6.8);
  const fit = C.checkBundleFit(b, m3, C.newProject(m3).stock);
  assert.equal(fit.ok, false);
  // 두께 20mm·하부 여유 0: 드릴 21mm 가 바닥을 뚫음 → 적합성 확인이 잡아내야 함
  assert.equal(C.checkBundleFit(b, m, C.newProject(m).stock).ok, false);
  const st30 = Object.assign(C.newProject(m).stock, { sz: 30 });
  const fitOk = C.checkBundleFit(b, m, st30);
  assert.equal(fitOk.ok, true, JSON.stringify(fitOk));
  // 재질 변경: SUS304 에서도 자동 조건은 범위 안
  const st = Object.assign(C.newProject(m).stock, { material: 'SUS304', sz: 30 });
  assert.equal(C.checkBundleFit(b, m, st).ok, true);
  // 얇은 소재: 깊이 초과 → 경고/오류 보고
  const thin = Object.assign(C.newProject(m).stock, { sz: 8 });
  const f2 = C.checkBundleFit(b, m, thin);
  assert.ok(f2.issues.length > 0);
});
