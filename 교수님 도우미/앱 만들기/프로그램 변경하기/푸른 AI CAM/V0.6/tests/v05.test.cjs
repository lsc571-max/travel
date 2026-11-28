// V0.5 단위 테스트: 자유 형상 포켓(섬·관통)·윤곽·평면·모따기·DXF·검증기 확장
// 경로의 정확성은 생성기와 다른 방법(높이맵 시뮬레이션 + 독립 NC 검증기)으로 확인한다.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/load-node.cjs');
const G = C.GEOM;
const DATE = new Date(2026, 10, 27, 9, 0);
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function build(groups, opt) {
  opt = opt || {};
  const m = C.defaultMachine(); if (opt.machine) opt.machine(m);
  const p = C.newProject(m);
  Object.assign(p.stock, { sx: 150, sy: 100, sz: 20, material: opt.material || 'AL6061', origin: 'LL', under: opt.under || 0 });
  if (opt.clamps) p.clamps = opt.clamps;
  groups.forEach((sp, i) => { const g = C.newGroup('G' + i, i); g.spec = sp.spec; (sp.at || [[75, 50]]).forEach((xy, k) => g.holes.push({ id: 'h' + i + '_' + k, x: xy[0], y: xy[1] })); C.applyHoleSpec(g, m, p.stock); p.groups.push(g); });
  const V = C.validateProject(p, m);
  const gen = C.generateNC(p, m, V.plan, { date: DATE });
  const ctx = extra => Object.assign({ stock: p.stock, machine: m, clamps: p.clamps, settings: p.settings, pockets: C.pocketRegions(p, m) }, extra);
  const vr = gen.text ? C.verifyNC(gen.text, ctx({ expected: gen.hits, expectedCuts: gen.cuts })) : null;
  return { m, p, V, gen, vr, ctx };
}
const errs = V => V.issues.filter(i => i.level === 'error').map(i => i.msg);
function simOf(r, cells) {
  const sim = C.SIM.createSim(r.p.stock, { maxCells: cells || 250000 }), tm = C.toolMap(r.m);
  r.vr.motions.forEach(mv => C.SIM.cutMotion(sim, mv, tm.get(mv.t)));
  return sim;
}
// 무작위 별 모양 다각형 (중심 기준 상대 좌표)
function star(R, rnd, n) { const out = []; for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n, r = R * (0.6 + 0.4 * rnd()); out.push([r * Math.cos(a), r * Math.sin(a)]); } return out; }

test('자유 형상 포켓 무작위 60건: 모델·검증기 오류 0, 영역 밖 과삭 없음, 공구가 닿는 곳 남는 살 없음, 바닥 정확', () => {
  const R = rng(5501);
  let checked = 0;
  for (let n = 0; n < 60; n++) {
    const outer = star(14 + 10 * R(), R, 6 + Math.floor(R() * 8));
    const islands = R() < 0.4 ? [[[-2.5, -2.5], [2.5, -2.5], [2.5, 2.5], [-2.5, 2.5]]] : [];
    const spec = C.newPocketSpec({ shape: 'poly', poly: { outer, islands }, depth: 3 + Math.round(R() * 5), stepover: 30 + Math.round(R() * 45), finish: R() < 0.7 });
    const r = build([{ spec }], { material: ['AL6061', 'S45C', 'SUS304'][n % 3] });
    const e = errs(r.V);
    if (e.length) { assert.ok(e.every(m => /공구|진입|좁|커서|폭/.test(m)), '예상 밖 모델 오류 #' + n + ' ' + e.join(' | ')); continue; }
    assert.deepEqual(r.vr.errors, [], '검증기 #' + n + ' ' + JSON.stringify(r.vr.errors.slice(0, 2)));
    assert.equal(r.vr.match, true);
    const sim = simOf(r), tool = C.toolMap(r.m).get(r.p.groups[0].ops[0].toolNo), rt = tool.dia / 2;
    const reg = G.regionPaths({ outer, islands }, 75, 50);
    // 공구가 닿을 수 있는 곳 = 영역을 (rt + 남김 여유)만큼 줄였다가 rt 만큼 넓힌 것 (정삭 없으면 벽 여유가 남음), 격자 오차 0.35mm 제외
    const aw0 = spec.finish ? 0 : spec.allowWall;
    const opening = G.offsetEx([].concat(...G.offsetEx(reg, -(rt + aw0)).map(G.exPaths)), rt - 0.35).map(G.exPaths);
    const openPaths = [].concat(...opening), depth = spec.depth;
    for (let j = 0; j < sim.ny; j += 2) for (let i = 0; i < sim.nx; i += 2) {
      const x = sim.x0 + i * sim.dx, y = sim.y0 + j * sim.dx, h = sim.h[j * sim.nx + i];
      const inside = G.inPaths(reg, x, y), dEdge = G.distToPts([outer.map(p => [p[0] + 75, p[1] + 50])].concat(islands.map(a => a.map(p => [p[0] + 75, p[1] + 50]))), x, y);
      if (!inside && dEdge > 0.3) assert.ok(h > -1e-6, '#' + n + ' 영역 밖 과삭 (' + x.toFixed(2) + ',' + y.toFixed(2) + ') h=' + h);
      if (h < -depth - 0.03) assert.fail('#' + n + ' 바닥 아래 과삭 h=' + h);
      if (openPaths.length && G.inPaths(openPaths, x, y)) assert.ok(h <= -depth + (spec.finish ? 0.03 : spec.allowFloor + 0.03), '#' + n + ' 남는 살 (' + x.toFixed(2) + ',' + y.toFixed(2) + ') h=' + h + ' depth ' + depth);
    }
    checked++;
  }
  assert.ok(checked >= 40, '검사한 경우 ' + checked);
});

test('바깥·안쪽 윤곽 무작위 40건: 부품 과삭 없음, 검증기 오류 0, 생성기 경로 일치', () => {
  const R = rng(5502);
  let checked = 0;
  for (let n = 0; n < 40; n++) {
    const side = n % 2 ? 'in' : 'out';
    const outer = star(side === 'out' ? 25 + 10 * R() : 15 + 8 * R(), R, 5 + Math.floor(R() * 7));
    const spec = C.newMillSpec('contour', { shape: 'poly', poly: { outer, islands: [] }, side, depth: 3 + Math.round(R() * 7), sideWidth: side === 'out' ? Math.round(R() * 6) : 0, finish: R() < 0.7 });
    const r = build([{ spec }]);
    const e = errs(r.V);
    if (e.length) { assert.ok(e.every(m => /공구|윤곽|커서|들어가지/.test(m)), '#' + n + ' ' + e.join(' | ')); continue; }
    assert.deepEqual(r.vr.errors, [], '#' + n + ' ' + JSON.stringify(r.vr.errors.slice(0, 2)));
    assert.equal(r.vr.match, true);
    const sim = simOf(r, 200000), part = outer.map(p => [p[0] + 75, p[1] + 50]);
    for (let j = 0; j < sim.ny; j += 2) for (let i = 0; i < sim.nx; i += 2) {
      const x = sim.x0 + i * sim.dx, y = sim.y0 + j * sim.dx, h = sim.h[j * sim.nx + i];
      const inPart = G.inPaths([G.toPath(G.ccw(part))], x, y), d = G.distToPts([part], x, y);
      if (side === 'out' && inPart && d > 0.3) assert.ok(h > -1e-6, '#' + n + ' 바깥 윤곽이 부품을 깎음 (' + x.toFixed(2) + ',' + y.toFixed(2) + ')');
      if (side === 'in' && !inPart && d > 0.3) assert.ok(h > -1e-6, '#' + n + ' 안쪽 윤곽이 바깥을 깎음');
      assert.ok(h >= -spec.depth - 0.03, '#' + n + ' 깊이 초과');
    }
    checked++;
  }
  assert.ok(checked >= 30, '검사한 경우 ' + checked);
});

test('평면 가공: 소재 전체가 정확히 깊이만큼 깎임 (남는 살 없음), 공구 하강은 소재 밖', () => {
  for (const sd of [0, 0.3]) {
    const r = build([{ spec: C.newMillSpec('face', { depth: 0.8, stepdown: sd }) }]);
    assert.deepEqual(errs(r.V), []); assert.deepEqual(r.vr.errors, []); assert.equal(r.vr.match, true);
    const sim = simOf(r, 150000);
    let worst = 0; for (let k = 0; k < sim.h.length; k++) worst = Math.max(worst, Math.abs(sim.h[k] + 0.8));
    assert.ok(worst < 0.01, '평면 오차 ' + worst);
    // 모든 Z 하강 이동은 공구 전체가 소재 밖
    const sr = C.stockRect(r.p.stock), rt = C.toolMap(r.m).get(r.p.groups[0].ops[0].toolNo).dia / 2;
    r.vr.motions.filter(mv => mv.k === 'feed' && mv.x0 === mv.x1 && mv.y0 === mv.y1 && mv.z1 < mv.z0 && mv.z1 < 0).forEach(mv => assert.ok(mv.x1 + rt < sr.x0 || mv.x1 - rt > sr.x1, '소재 위 하강'));
  }
});

test('평면 가공: 클램프가 범위에 있으면 차단', () => {
  const r = build([{ spec: C.newMillSpec('face', { depth: 0.5 }) }], { clamps: [{ id: 'c', x: -15, y: 40, w: 12, h: 20, height: 20 }] });
  assert.ok(errs(r.V).some(m => /클램프/.test(m)));
});

test('모따기: 윤곽 뒤 바깥 C0.5 → 윗면에서 모서리 안쪽 0.5mm 폭으로 경사, 검증 통과 / 깎이지 않은 소재 진입은 차단', () => {
  const r = build([{ spec: C.newMillSpec('contour', { w: 100, h: 60, cr: 5, depth: 8 }) }, { spec: C.newMillSpec('chamfer', { w: 100, h: 60, cr: 5, cw: 0.5 }) }]);
  assert.deepEqual(errs(r.V), []); assert.deepEqual(r.vr.errors, []); assert.equal(r.vr.match, true);
  const sim = simOf(r, 400000); // 0.19mm 격자
  const zAt = x => C.SIM.heightAt(sim, x, 50);
  // 오른쪽 모서리 X125 (격자 0.2mm 위 점으로 검사): 안쪽 0.2mm 는 -(0.5-0.2) = -0.3, 안쪽 0.8mm 는 깎이지 않음
  assert.ok(Math.abs(zAt(124.8) + 0.3) < 0.06, 'z@0.2 ' + zAt(124.8));
  assert.ok(Math.abs(zAt(124.6) + 0.1) < 0.06, 'z@0.4 ' + zAt(124.6));
  assert.ok(zAt(124.2) > -1e-6, 'z@0.8 ' + zAt(124.2));
  const only = build([{ spec: C.newMillSpec('chamfer', { w: 100, h: 60, cr: 5, cw: 0.5 }) }]);
  assert.ok(only.vr.errors.some(e => /모따기 공구 T21 가 깎이지 않은 소재로/.test(e.msg)), JSON.stringify(only.vr.errors));
});

test('구멍 입구 모따기: 드릴 뒤 원형 안쪽 C0.5 → 검증 통과', () => {
  const at = [[30, 30], [60, 30], [90, 70]];
  const r = build([{ spec: C.newHoleSpec('drill', { dia: 8.5, depth: 10 }), at }, { spec: C.newMillSpec('chamfer', { shape: 'circle', dia: 8.5, side: 'in', cw: 0.5 }), at }]);
  assert.deepEqual(errs(r.V), []); assert.deepEqual(r.vr.errors, []); assert.equal(r.vr.match, true);
});

test('관통 포켓·관통 윤곽: 하부 여유가 관통 여유보다 작으면 차단, 충분하면 통과', () => {
  const pk = C.newPocketSpec({ shape: 'rect', w: 30, h: 20, cr: 5, thru: true, brk: 1 });
  assert.ok(errs(build([{ spec: pk }], { under: 0 }).V).some(m => /하부 여유/.test(m)));
  const ok = build([{ spec: pk }], { under: 3 });
  assert.deepEqual(errs(ok.V), []); assert.deepEqual(ok.vr.errors, []);
  const ct = C.newMillSpec('contour', { w: 120, h: 80, cr: 5, thru: true, brk: 1 });
  assert.ok(errs(build([{ spec: ct }], { under: 0 }).V).some(m => /하부 여유/.test(m)));
  const ok2 = build([{ spec: ct }], { under: 3 });
  assert.deepEqual(errs(ok2.V), []); assert.deepEqual(ok2.vr.errors, []);
  assert.ok(ok2.gen.text.includes('Z-21.'), '관통 깊이 Z-21');
});

test('검증기: 수정 NC 결함 주입 — 윤곽이 부품 안으로, 평면 바닥 아래, 자유 포켓 섬 침범은 차단', () => {
  // 바깥 윤곽: X 를 부품 안쪽으로
  const c = build([{ spec: C.newMillSpec('contour', { w: 100, h: 60, cr: 0, depth: 5 }) }]);
  const L = c.gen.text.split('\n'), i = L.findIndex(l => /^G01 X[-\d.]+ Y[-\d.]+ Z-/.test(l) || /^G01 X[-\d.]+ Y[-\d.]+$/.test(l) && false);
  const k = L.findIndex((l, j) => j > i + 3 && /^G01 X[-\d.]+ Y[-\d.]+$/.test(l));
  L[k] = 'G01 X75. Y50.';
  const v1 = C.verifyNC(L.join('\n'), c.ctx({ expected: null }));
  assert.ok(v1.errors.some(e => /가공 영역/.test(e.msg)), JSON.stringify(v1.errors.slice(0, 2)));
  // 평면: 깊이를 2mm 더
  const f = build([{ spec: C.newMillSpec('face', { depth: 0.5 }) }]);
  const v2 = C.verifyNC(f.gen.text.replace(/Z-0\.5\b/g, 'Z-2.5'), f.ctx({ expected: null }));
  assert.ok(v2.errors.some(e => /가공 영역|바닥/.test(e.msg)), JSON.stringify(v2.errors.slice(0, 2)));
  // 섬 침범: 섬 중심으로 직선 이동
  const poly = { outer: [[-20, -15], [20, -15], [20, 15], [-20, 15]], islands: [[[-4, -4], [4, -4], [4, 4], [-4, 4]]] };
  const pk = build([{ spec: C.newPocketSpec({ shape: 'poly', poly, depth: 4 }) }]);
  assert.deepEqual(pk.vr.errors, []);
  const T = pk.gen.text.split('\n'), q = T.findIndex(l => /^G01 X[-\d.]+ Y[-\d.]+$/.test(l));
  T.splice(q + 1, 0, 'G01 X75. Y50.');
  const v3 = C.verifyNC(T.join('\n'), pk.ctx({ expected: null }));
  assert.ok(v3.errors.some(e => /가공 영역/.test(e.msg)), JSON.stringify(v3.errors.slice(0, 2)));
});

test('공구 자동 선택: 평면=페이스밀, 모따기=90° 모따기 공구, 윤곽=날 길이 충분한 엔드밀, 없으면 공구 추가 요청', () => {
  const m = C.defaultMachine(), st = { sz: 30, material: 'S45C' };
  assert.equal(C.planMillSpec(C.newMillSpec('face', { depth: 1 }), m, st).ops[0].toolNo, 20);
  assert.equal(C.planMillSpec(C.newMillSpec('chamfer', { cw: 1 }), m, st).ops[0].toolNo, 21);
  const ct = C.planMillSpec(C.newMillSpec('contour', { depth: 22 }), m, st);
  assert.ok(ct.ops.length && C.toolMap(m).get(ct.ops[0].toolNo).flute >= 22, '날 길이 22 이상');
  const big = C.planMillSpec(C.newMillSpec('chamfer', { cw: 6 }), m, st);
  assert.equal(big.ops.length, 0); assert.equal(big.missing[0].type, 'chamfer');
  const m2 = C.defaultMachine(); m2.tools = m2.tools.filter(t => t.type !== 'facemill');
  const f2 = C.planMillSpec(C.newMillSpec('face', { depth: 1 }), m2, st);
  assert.equal(C.toolMap(m2).get(f2.ops[0].toolNo).type, 'endmill'); assert.ok(f2.notes.some(n => /엔드밀로 평면/.test(n.msg)));
  const added = C.addMissingTool(m2, { type: 'facemill', dia: 50 });
  assert.equal(added.type, 'facemill');
});

test('DXF: LWPOLYLINE 볼록(bulge)·선분 잇기·원·단위(inch)·미지원 요소 경고', () => {
  const L = [];
  const add = (...p) => p.forEach(([c, v]) => L.push(String(c), String(v)));
  add([0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, 1], [0, 'ENDSEC'], [0, 'SECTION'], [2, 'ENTITIES']);
  // 반원 두 개로 된 원(지름 2inch): bulge 1
  add([0, 'LWPOLYLINE'], [90, 2], [70, 1], [10, 0], [20, 0], [42, 1], [10, 2], [20, 0], [42, 1]);
  // 선분 4개로 된 사각 (순서 뒤섞음, 방향 반대 포함)
  add([0, 'LINE'], [10, 3], [20, 0], [11, 4], [21, 0]); add([0, 'LINE'], [10, 4], [20, 1], [11, 4], [21, 0]); add([0, 'LINE'], [10, 4], [20, 1], [11, 3], [21, 1]); add([0, 'LINE'], [10, 3], [20, 1], [11, 3], [21, 0]);
  add([0, 'CIRCLE'], [10, 5], [20, 5], [40, 0.125]);
  add([0, 'SPLINE'], [10, 0], [20, 0]);
  add([0, 'ENDSEC'], [0, 'EOF']);
  const r = C.DXF.parse(L.join('\n'));
  assert.equal(r.units, 'inch'); assert.equal(r.loops.length, 2); assert.equal(r.circles.length, 1);
  const areas = r.loops.map(l => Math.abs(G.area(l))).sort((a, b) => a - b);
  assert.ok(Math.abs(areas[0] - 25.4 * 25.4) < 0.5, '사각 1inch² ' + areas[0]);
  assert.ok(Math.abs(areas[1] - Math.PI * 25.4 * 25.4) / (Math.PI * 645.16) < 0.002, '원 면적 ' + areas[1]);
  assert.ok(Math.abs(r.circles[0].r - 3.175) < 1e-9);
  assert.ok(r.warnings.some(w => /SPLINE/.test(w)));
  assert.ok(C.DXF.parse('hello').error);
});

test('DXF 예제 파일(샘플_브라켓): 외곽·L 포켓·섬·지름별 구멍 분류', () => {
  const fs = require('fs'), path = require('path');
  const r = C.DXF.parse(fs.readFileSync(path.join(__dirname, '../examples/샘플_브라켓.dxf'), 'utf8'));
  const c = C.DXF.classify(r);
  assert.deepEqual(c.items.map(i => i.depth), [0, 1, 2]);
  assert.ok(Math.abs(c.items[0].area - (9600 - (4 - Math.PI) * 36)) < 0.5);
  assert.equal(c.items[2].parent, c.items[1]);
  assert.deepEqual(c.holes.map(h => [h.dia, h.pts.length]), [[6.8, 4], [9, 2], [30, 1]]);
});

test('가져온 자유 형상 데이터 방어: 점이 3개 미만·숫자 아님·너무 큰 좌표는 버림', () => {
  assert.equal(C.normPoly({ outer: [[0, 0], [1, 1]] }), null);
  const p = C.normPoly({ outer: [[0, 0], ['a', 1], [10, 0], [10, 10], [1e9, 5]], islands: [[[1, 1]], 'x'] });
  assert.equal(p.outer.length, 3); assert.equal(p.islands.length, 0);
  const prj = C.normalizeProject({ groups: [{ name: 'x', holes: [{ id: 'h', x: 1, y: 1 }], ops: [{ type: 'pocketRough', toolNo: 16, shape: 'poly', poly: 'bad' }] }] });
  assert.equal(prj.groups[0].ops[0].shape, 'rect');
});

/* ---------- [V0.5 2차] 포켓 단계(중삭·바닥/측벽 정삭)·진입 방식·모서리 릴리프 ---------- */
test('포켓 단계·진입 무작위 40건: 모델·검증기 오류 0, 영역 밖 과삭 없음, 최종 바닥 정확·남는 살 없음', () => {
  const R = rng(7707);
  let checked = 0;
  for (let n = 0; n < 40; n++) {
    const shape = ['rect', 'circle', 'poly'][n % 3];
    const geo = shape === 'rect' ? { w: 24 + Math.round(R() * 30), h: 18 + Math.round(R() * 20), cr: Math.round(R() * 6) } : shape === 'circle' ? { dia: 20 + Math.round(R() * 30) } : { poly: { outer: star(13 + 8 * R(), R, 6 + Math.floor(R() * 6)), islands: R() < 0.4 ? [[[-2, -2], [2, -2], [2, 2], [-2, 2]]] : [] } };
    const spec = C.newPocketSpec(Object.assign({ shape, depth: 3 + Math.round(R() * 6), semi: R() < 0.6, semiStep: R() < 0.5 ? 0 : [0.5, 1, 1.5][n % 3], semiWall: 0.1, semiFloor: 0.05, wallStep: R() < 0.5 ? 0 : 2, entry: ['helix', 'ramp', 'drill'][Math.floor(R() * 3)], finishMode: R() < 0.8 ? 'split' : 'both' }, geo));
    const r = build([{ spec }]);
    const e = errs(r.V);
    if (e.length) { assert.ok(e.every(m => /공구|진입|좁|커서|폭|드릴/.test(m)), '예상 밖 모델 오류 #' + n + ' ' + e.join(' | ')); continue; }
    assert.deepEqual(r.vr.errors, [], '검증기 #' + n + ' ' + JSON.stringify(r.vr.errors.slice(0, 2)));
    assert.equal(r.vr.match, true);
    const types = r.p.groups[0].ops.map(o => o.type);
    if (spec.semi) assert.ok(types.includes('pocketSemi'), types.join());
    if (spec.finishMode === 'split') assert.ok(types.includes('pocketFloor') && types.includes('pocketWall'), types.join());
    if (spec.entry === 'drill') assert.ok(types.includes('drill') || types.includes('peck'), types.join());
    const sim = simOf(r), em = r.p.groups[0].ops.find(o => o.type === 'pocketRough'), tool = C.toolMap(r.m).get(em.toolNo), rt = tool.dia / 2;
    const reg = G.regionPaths(G.shapeRegion(em), 75, 50), regPl = reg.map(G.fromPath);
    const opening = [].concat(...G.offsetEx([].concat(...G.offsetEx(reg, -rt).map(G.exPaths)), rt - 0.35).map(G.exPaths));
    const drilled = r.p.groups[0].ops.some(o => o.type === 'drill' || o.type === 'peck');
    for (let j = 0; j < sim.ny; j += 2) for (let i = 0; i < sim.nx; i += 2) {
      const x = sim.x0 + i * sim.dx, y = sim.y0 + j * sim.dx, h = sim.h[j * sim.nx + i];
      if (!G.inPaths(reg, x, y) && G.distToPts(regPl, x, y) > 0.3) assert.ok(h > -1e-6, '#' + n + ' 영역 밖 과삭 (' + x.toFixed(2) + ',' + y.toFixed(2) + ') h=' + h);
      if (!drilled && h < -spec.depth - 0.03) assert.fail('#' + n + ' 바닥 아래 과삭 h=' + h);
      if (opening.length && G.inPaths(opening, x, y) && !(drilled && h < -spec.depth)) assert.ok(Math.abs(h + spec.depth) <= 0.03, '#' + n + ' 최종 바닥 아님 (' + x.toFixed(2) + ',' + y.toFixed(2) + ') h=' + h);
    }
    checked++;
  }
  assert.ok(checked >= 28, '검사한 경우 ' + checked);
});

test('포켓 중삭: 단 깊이씩(측벽만) / 한 번에, 여유 순서가 틀리면 차단', () => {
  const r = build([{ spec: C.newPocketSpec({ shape: 'rect', w: 40, h: 30, cr: 4, depth: 8, semi: true, semiStep: 1, semiWall: 0.1, semiFloor: 0.05 }) }]);
  assert.deepEqual(errs(r.V), []);
  const g = r.p.groups[0], semi = g.ops.find(o => o.type === 'pocketSemi');
  assert.equal(semi.leaveWall, 0.1); assert.equal(semi.allowWall, 0.2);
  const st = C.pocketStage('pocketSemi', semi, 8);
  assert.equal(st.levels.length, 8); // 7.95 / 1 → 8단
  assert.ok(st.levels.slice(0, 7).every(L => L.wall) && !st.levels[7].wall, '마지막 단만 전체 면');
  // 다음 단계(바닥 정삭)의 앞 단계 여유가 중삭 여유와 다르면 차단
  g.spec = null; g.ops.find(o => o.type === 'pocketFloor').allowWall = 0.2;
  assert.ok(errs(C.validateProject(r.p, r.m)).some(m => /남긴 여유/.test(m)));
  const one = build([{ spec: C.newPocketSpec({ shape: 'circle', dia: 30, depth: 6, semi: true, semiStep: 0 }) }]);
  assert.deepEqual(errs(one.V), []); assert.deepEqual(one.vr.errors, []);
  assert.equal(C.pocketStage('pocketSemi', one.p.groups[0].ops[1], 6).levels.length, 1);
});

test('포켓 진입: 선가공 구멍(드릴 끝 = 황삭 바닥)·램프·모서리 릴리프 구멍', () => {
  const d = build([{ spec: C.newPocketSpec({ shape: 'rect', w: 14, h: 12, cr: 3, depth: 6, entry: 'drill' }) }]);
  assert.deepEqual(errs(d.V), []); assert.deepEqual(d.vr.errors, []);
  const dr = d.p.groups[0].ops.find(o => o.type === 'drill' || o.type === 'peck');
  assert.equal(dr.depthMode, 'tip'); assert.equal(dr.depth, 5.9);
  assert.ok(!/^G03/m.test(d.gen.text.split('POCKET ROUGH')[1].split('POCKET FLOOR')[0]), '선가공 구멍 진입이면 황삭에 헬리컬 없음');
  // 드릴을 지우면 모델이 차단, NC 를 고쳐 드릴을 빼면 검증기가 수직 하강을 차단
  const g = d.p.groups[0]; g.spec = null; g.ops = g.ops.filter(o => o.type !== 'drill' && o.type !== 'peck');
  assert.ok(errs(C.validateProject(d.p, d.m)).some(m => /선가공 구멍/.test(m)));
  const L = d.gen.text.split('\n'), a = L.findIndex(l => /^\(OP\d+ (PECK )?DRILL T/.test(l)), b = L.findIndex((l, i) => i > a && /^\(OP/.test(l));
  const cut = L.slice(0, a).concat(L.slice(b));
  assert.ok(C.verifyNC(cut.join('\n'), d.ctx({ expected: null })).errors.some(e => /수직 하강/.test(e.msg)));
  const rp = build([{ spec: C.newPocketSpec({ shape: 'rect', w: 30, h: 20, cr: 3, depth: 6, entry: 'ramp' }) }]);
  assert.deepEqual(errs(rp.V), []); assert.deepEqual(rp.vr.errors, []);
  const rf = build([{ spec: C.newPocketSpec({ shape: 'rect', w: 40, h: 30, cr: 0, depth: 6, relief: true }) }]);
  assert.deepEqual(errs(rf.V), []); assert.deepEqual(rf.vr.errors, []);
  const sim = simOf(rf, 400000);
  [[94.7, 64.7], [55.3, 64.7], [55.3, 35.3], [94.7, 35.3]].forEach(([x, y]) => assert.ok(C.SIM.heightAt(sim, x, y) <= -6 + 0.03, '모서리 (' + x + ',' + y + ') 깎임'));
});

test('이미 가공된 형상 인식: 포켓 안 구멍·단 포켓·평면 후 가공은 그 바닥에서 시작, 깊이는 완성 바닥 기준', () => {
  const groups = [
    { spec: C.newMillSpec('face', { depth: 0.5 }) },
    { spec: C.newPocketSpec({ shape: 'rect', w: 60, h: 40, cr: 5, depth: 10 }) },
    { spec: C.newPocketSpec({ shape: 'rect', w: 20, h: 14, cr: 4, depth: 4 }), at: [[60, 50]] },
    { spec: C.newHoleSpec ? C.newHoleSpec('drill', { dia: 6.8, depth: 5, depthMode: 'full' }) : { kind: 'drill', dia: 6.8, depth: 5, depthMode: 'full', thru: false, brk: 1, center: true, cycle: 'auto' }, at: [[90, 50], [10, 10]] }
  ];
  const r = build(groups);
  assert.equal(r.p.settings.depthRef, 'auto');
  assert.deepEqual(errs(r.V), []);
  assert.deepEqual(r.vr.errors, []); assert.equal(r.vr.match, true);
  const steps = r.V.plan.steps;
  const pk = steps.find(s => s.type === 'pocketRough' && s.holes.some(h => h.x === 75));
  assert.equal(pk.ref, -0.5); // 평면 바닥에서 깊이를 잼
  const inner = steps.find(s => s.type === 'pocketRough' && s.holes.some(h => h.x === 60));
  assert.equal(inner.ref, -10.5); assert.ok(inner.top <= -10.3 && inner.top >= -10.5, 'inner top ' + inner.top);
  const drIn = steps.find(s => s.type === 'drill' || s.type === 'peck' ? s.holes.some(h => h.x === 90) : false);
  const drOut = steps.find(s => (s.type === 'drill' || s.type === 'peck') && s.holes.some(h => h.x === 10));
  assert.ok(drIn && drOut && drIn !== drOut, '포켓 안·밖 구멍은 다른 공정');
  assert.equal(drIn.ref, -10.5); assert.ok(drIn.r <= -10.5 + 3 + 1e-9, 'R점은 포켓 바닥 위 ' + drIn.r);
  assert.ok(Math.abs(drIn.z - drOut.z - (-10)) < 1e-6, '포켓 안 구멍은 포켓 깊이만큼 더 깊음 ' + drIn.z + ' ' + drOut.z);
  // 시뮬레이션: 포켓 안 구멍의 직경부 바닥 = 평면 0.5 + 포켓 10 + 8
  const sim = simOf(r, 400000);
  assert.ok(C.SIM.heightAt(sim, 90, 50) <= -15.5 + 0.05);
  // 이전 버전 파일(깊이 기준 없음)은 Z0 기준 그대로
  const r2 = build(groups); r2.p.settings.depthRef = 'top';
  const V2 = C.validateProject(r2.p, r2.m);
  assert.ok(V2.plan.steps.every(s => !s.ref && !s.top));
});

test('[2차 검토] 관통은 기준면을 더하지 않음 · 좁은 틈 전체 깊이 정삭 차단 · 선가공 센터 깊이·드릴 크기 제한', () => {
  // 평면 1mm 뒤 관통 윤곽: 끝 Z = −(두께 + 관통 여유), 기준면(−1)을 더하지 않음
  const r = build([{ spec: C.newMillSpec('face', { depth: 1 }) }, { spec: C.newMillSpec('contour', { w: 100, h: 60, cr: 5, thru: true, brk: 1 }) }], { under: 3 });
  const ct = r.V.plan.steps.filter(s => /^contour/.test(s.type));
  assert.ok(ct.length && ct.every(s => s.z === -21), ct.map(s => s.z).join());
  // 섬과 벽 틈이 공구 + 측벽 여유보다 좁으면: 공구 지정 시 측벽 정삭 차단, 자동이면 작은 공구 선택
  const outer = [[-30, -20], [30, -20], [30, 20], [-30, 20]]; // 섬 위쪽과 벽 사이 틈 10.2mm (Ø10 + 여유 0.2×2 보다 좁음)
  const poly = { outer, islands: [[[-20, -12], [20, -12], [20, 9.8], [-20, 9.8]]] };
  const forced = build([{ spec: C.newPocketSpec({ shape: 'poly', poly, depth: 8, toolNo: 16 }) }]);
  assert.ok(errs(forced.V).some(m => /들어가지 못한 좁은 곳/.test(m)), JSON.stringify(errs(forced.V)));
  const auto = build([{ spec: C.newPocketSpec({ shape: 'poly', poly, depth: 8 }) }]);
  assert.deepEqual(errs(auto.V), []); assert.deepEqual(auto.vr.errors, []);
  assert.ok(C.toolMap(auto.m).get(auto.p.groups[0].ops[0].toolNo).dia < 10);
  // 얕은 포켓 선가공: 센터 드릴이 황삭 바닥을 넘지 않음
  const sh = build([{ spec: C.newPocketSpec({ shape: 'rect', w: 14, h: 12, cr: 3, depth: 1.5, entry: 'drill' }) }]);
  const cen = sh.p.groups[0].ops.find(o => o.type === 'center');
  assert.ok(cen && cen.depth <= 1.4 + 1e-9, cen && cen.depth);
  // 좁은 포켓: 벽을 넘는 큰 드릴은 고르지 않음
  const nr = build([{ spec: C.newPocketSpec({ shape: 'rect', w: 8.6, h: 30, cr: 3, depth: 4, entry: 'drill', toolNo: 18 }) }]);
  const dr = nr.p.groups[0].ops.find(o => o.type === 'drill' || o.type === 'peck');
  if (dr) assert.ok(C.toolMap(nr.m).get(dr.toolNo).dia / 2 <= 4.3 - 0.2 - 0.1 + 1e-9);
});
