// V0.4 포켓 가공·원호 검증·과삭 검사·높이맵 시뮬레이션 단위 테스트
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/load-node.cjs');
const DATE = new Date(2026, 10, 27, 9, 0);

// 포켓 하나(또는 여러 개)를 가진 프로젝트를 만들고 생성·검증
function build(specs, opt) {
  opt = opt || {};
  const m = C.defaultMachine(); if (opt.machine) opt.machine(m);
  const p = C.newProject(m);
  Object.assign(p.stock, { sx: 150, sy: 100, sz: 20, material: opt.material || 'AL6061', origin: 'LL' });
  specs.forEach((sp, i) => {
    const g = C.newGroup('P' + i, i);
    g.spec = C.newPocketSpec(sp.spec);
    (sp.at || [[75, 50]]).forEach((xy, k) => g.holes.push({ id: 'h' + i + '_' + k, x: xy[0], y: xy[1] }));
    C.applyHoleSpec(g, m, p.stock);
    p.groups.push(g);
  });
  const V = C.validateProject(p, m);
  const g = C.generateNC(p, m, V.plan, { date: DATE });
  const ctx = extra => Object.assign({ stock: p.stock, machine: m, clamps: p.clamps, settings: p.settings, pockets: C.pocketRegions(p, m) }, extra);
  const vr = g.text ? C.verifyNC(g.text, ctx({ expected: g.hits, expectedCuts: g.cuts })) : null;
  return { m, p, V, g, vr, ctx };
}
const errs = V => V.issues.filter(i => i.level === 'error').map(i => i.msg);

test('사각·원형 포켓: 모델 오류 0, NC 검증 오류 0, 생성기 경로 = 해석 경로', () => {
  const cases = [
    { shape: 'rect', w: 40, h: 30, cr: 5, depth: 5 },
    { shape: 'rect', w: 60, h: 20, cr: 0, depth: 8 },
    { shape: 'rect', w: 25, h: 25, cr: 12.5, depth: 3 },
    { shape: 'circle', dia: 30, depth: 5 },
    { shape: 'circle', dia: 12, depth: 6 }
  ];
  for (const spec of cases) for (const mat of ['AL6061', 'S45C', 'SUS304']) {
    const r = build([{ spec }], { material: mat });
    assert.deepEqual(errs(r.V), [], JSON.stringify(spec) + mat);
    assert.ok(r.g.text, '생성됨');
    assert.deepEqual(r.vr.errors, [], JSON.stringify(spec) + mat + ' ' + JSON.stringify(r.vr.errors.slice(0, 3)));
    assert.equal(r.vr.match, true);
    assert.ok(r.vr.cuts.length > 10);
  }
});

test('포켓 G코드 형식: 헬리컬 G03(I·J), R 원호 미사용, F 소수점 없는 정수, 끝 M30', () => {
  const r = build([{ spec: { shape: 'rect', w: 40, h: 30, cr: 5, depth: 5 } }]);
  const t = r.g.text;
  assert.match(t, /G03 X[-\d.]+ Y[-\d.]+ Z-[\d.]+ I[-\d.]+ J[-\d.]+/);
  assert.doesNotMatch(t, /G0[23][^\n]* R[-\d.]/);
  assert.match(t, /\(T16 FLAT ENDMILL D10\. Z3\)/);
  assert.match(t, /M30\n%$/);
  // 포켓 안 이동은 소재 위 Z0 아래에서만 G01/G03, 급속 하강은 R점까지만
  t.split('\n').forEach(l => { if (/^G00/.test(l) && /Z-/.test(l)) assert.fail('급속으로 소재 아래 이동: ' + l); });
});

test('공구 자동 선택: 코너 R 이하 반경의 가장 큰 엔드밀, 작은 포켓은 작은 공구, 없으면 공구 추가 요청', () => {
  const m = C.defaultMachine(), st = { sz: 20, material: 'S45C' };
  const pick = sp => { const r = C.planPocketSpec(C.newPocketSpec(sp), m, st); return { t: r.ops.length ? r.ops[0].toolNo : 0, miss: r.missing }; };
  assert.equal(pick({ shape: 'rect', w: 40, h: 30, cr: 5 }).t, 16);   // Ø10 (반경 5 ≤ R5)
  assert.equal(pick({ shape: 'rect', w: 40, h: 30, cr: 3 }).t, 18);   // Ø6 (반경 3 ≤ R3)
  assert.equal(pick({ shape: 'rect', w: 8, h: 30, cr: 4 }).t, 18);    // 폭 8 → Ø6
  assert.equal(pick({ shape: 'circle', dia: 7 }).t, 19);              // Ø4
  const r = pick({ shape: 'circle', dia: 3 });
  assert.equal(r.t, 0); assert.equal(r.miss.length, 1); assert.equal(r.miss[0].type, 'endmill');
  assert.ok(r.miss[0].dia <= 3 * 0.6 + 1e-9 || r.miss[0].dia === 1);
});

test('자동 절입: 재질 계수 × 직경, 날 길이 90% 이하', () => {
  const m = C.defaultMachine();
  const ap = mat => C.planPocketSpec(C.newPocketSpec({ shape: 'rect', w: 40, h: 30, cr: 5, depth: 10 }), m, { sz: 30, material: mat }).ops[0].stepdown;
  assert.equal(ap('AL6061'), 5);
  assert.equal(ap('S45C'), 3);
  assert.equal(ap('SUS304'), 2);
  m.tools.find(t => t.no === 16).flute = 4;
  assert.equal(ap('AL6061'), 3.6);
});

test('잘못된 입력 차단: 소재 두께 이상 깊이, 정삭만 선택, 날 길이보다 깊은 포켓, 엔드밀 아닌 공구 지정', () => {
  assert.ok(errs(build([{ spec: { shape: 'rect', w: 40, h: 30, cr: 5, depth: 20 } }]).V).length > 0);
  const fin = C.planPocketSpec(C.newPocketSpec({ rough: false, finish: true }), C.defaultMachine(), { sz: 20, material: 'S45C' });
  assert.ok(fin.notes.some(n => n.level === 'error' && /황삭/.test(n.msg)));
  const deep = build([{ spec: { shape: 'rect', w: 60, h: 40, cr: 5, depth: 18 } }], { machine: m => { m.tools.find(t => t.no === 16).flute = 12; } });
  assert.ok(errs(deep.V).length > 0 || deep.V.issues.some(i => /날 길이/.test(i.msg)));
  const wrong = C.planPocketSpec(C.newPocketSpec({ toolNo: 5 }), C.defaultMachine(), { sz: 20, material: 'S45C' });
  assert.ok(wrong.notes.some(n => n.level === 'error' && /엔드밀이 아닙니다/.test(n.msg)));
});

test('포켓이 소재 밖으로 나가면 모델 오류', () => {
  const r = build([{ spec: { shape: 'rect', w: 40, h: 30, cr: 5, depth: 5 }, at: [[10, 50]] }]);
  assert.ok(errs(r.V).length > 0, '소재 밖 포켓 차단');
});

test('검증기: 수정한 NC 의 벽 과삭·바닥 과삭·R 원호·I/J 반경 불일치 검출', () => {
  const r = build([{ spec: { shape: 'rect', w: 40, h: 30, cr: 10, depth: 5 } }]); // 코너 R10 > 공구 반경 → 모서리 원호 출력
  const base = r.g.text;
  const check = (t, re, why) => { const v = C.verifyNC(t, r.ctx({ expected: null })); assert.ok(v.errors.some(e => re.test(e.msg)), why + ' :: ' + JSON.stringify(v.errors.slice(0, 3))); };
  // 1) 벽 과삭: 첫 G01 X 값을 +6mm 바깥으로
  const lines = base.split('\n');
  const i1 = lines.findIndex(l => /^G01 X/.test(l));
  const wall = lines.slice(); wall[i1] = wall[i1].replace(/X([-\d.]+)/, (a, v) => 'X' + (parseFloat(v) + 30).toFixed(3));
  check(wall.join('\n'), /포켓|영역|과삭/, '벽 과삭');
  // 2) 바닥 과삭: 첫 Z- 값을 2mm 더 깊게
  const floor = base.replace(/(G03 [^\n]*Z-)([\d.]+)/, (a, p, v) => p + (parseFloat(v) + 6).toFixed(3));
  check(floor, /바닥|깊|과삭/, '바닥 과삭');
  // 3) R 지정 원호
  const rarc = base.replace(/(G03 X[-\d.]+ Y[-\d.]+ Z-[\d.]+) I[-\d.]+ J[-\d.]+/, '$1 R5.');
  check(rarc, /원호|R/, 'R 원호');
  // 4) I·J 반경 불일치
  // (모서리 원호 = 시작점과 끝점이 다른 원호. 전체 원은 중심을 옮겨도 유효한 원이므로 제외)
  const bad = base.replace(/^(G03 X[-\d.]+ Y[-\d.]+ I)([-\d.]+)(?= J[-\d.]+$)/m, (a, p, v) => p + (parseFloat(v) + 1.5).toFixed(3));
  assert.notEqual(bad, base);
  check(bad, /반경|원호/, 'I/J 반경 불일치');
});

test('검증기: 드릴 공구로 소재 아래 G01 절삭 금지', () => {
  const m = C.defaultMachine(), p = C.newProject(m);
  const g = C.newGroup('d', 0); g.spec = C.newHoleSpec('drill', { dia: 6.8, depth: 10 }); g.holes.push({ id: 'h', x: 30, y: 30 }); C.applyHoleSpec(g, m, p.stock); p.groups.push(g);
  const V = C.validateProject(p, m), gen = C.generateNC(p, m, V.plan, { date: DATE });
  const t = gen.text.replace(/(G98 G8\d[^\n]*\n)/, '$1G01 X35. Y30. Z-2. F100\n');
  const v = C.verifyNC(t, { stock: p.stock, machine: m, clamps: [], settings: p.settings, pockets: [], expected: null });
  assert.ok(v.errors.some(e => /G0?1 로 소재 상면|고정 사이클만/.test(e.msg)), JSON.stringify(v.errors.slice(0, 3)));
});

test('높이맵 시뮬레이션: 사각 포켓(코너 R) 제거 부피가 해석해와 2% 이내, 바닥 깊이 정확, 남는 살 없음', () => {
  for (const so of [30, 50, 75]) {
    const r = build([{ spec: { shape: 'rect', w: 40, h: 30, cr: 5, depth: 5, stepover: so } }]);
    assert.equal(r.vr.errors.length, 0);
    const sim = C.SIM.createSim(r.p.stock, { maxCells: 250000 });
    const tm = C.toolMap(r.m);
    r.vr.motions.forEach(mv => C.SIM.cutMotion(sim, mv, tm.get(mv.t)));
    const vol = C.SIM.removedVolume(sim), exact = (40 * 30 - (4 - Math.PI) * 25) * 5;
    assert.ok(Math.abs(vol - exact) / exact < 0.02, 'stepover ' + so + ': ' + vol.toFixed(0) + ' vs ' + exact.toFixed(0));
    // 포켓 안쪽(벽에서 0.5mm 안)은 모두 바닥 깊이 -5, 바깥(벽에서 0.5mm 밖)은 손대지 않음
    for (let x = 55.5; x <= 94.5; x += 0.7) for (let y = 35.5; y <= 64.5; y += 0.7) {
      const dx = Math.max(0, Math.abs(x - 75) - 15), dy = Math.max(0, Math.abs(y - 50) - 10);
      if (Math.hypot(dx, dy) > 4.5) continue; // 코너 R5 부근 제외
      const z = C.SIM.heightAt(sim, x, y);
      assert.ok(Math.abs(z + 5) < 0.02, 'stepover ' + so + ' 남은 살 (' + x.toFixed(1) + ',' + y.toFixed(1) + ') z=' + z);
    }
    for (const [x, y] of [[54, 50], [96, 50], [75, 34], [75, 66]]) assert.ok(C.SIM.heightAt(sim, x, y) > -1e-6, '벽 밖 과삭 (' + x + ',' + y + ')');
  }
});

test('높이맵 시뮬레이션: 원형 포켓·드릴 구멍', () => {
  const r = build([{ spec: { shape: 'circle', dia: 30, depth: 4 } }]);
  const sim = C.SIM.createSim(r.p.stock, { maxCells: 250000 }), tm = C.toolMap(r.m);
  r.vr.motions.forEach(mv => C.SIM.cutMotion(sim, mv, tm.get(mv.t)));
  const exact = Math.PI * 15 * 15 * 4, vol = C.SIM.removedVolume(sim);
  assert.ok(Math.abs(vol - exact) / exact < 0.02, vol + ' vs ' + exact);
  // 드릴: 구멍 중심 깊이 = 공구 끝 Z
  const m = C.defaultMachine(), p = C.newProject(m);
  const g = C.newGroup('d', 0); g.spec = C.newHoleSpec('drill', { dia: 6.8, depth: 10, center: false }); g.holes.push({ id: 'h', x: 30, y: 30 }); C.applyHoleSpec(g, m, p.stock); p.groups.push(g);
  const V = C.validateProject(p, m), gen = C.generateNC(p, m, V.plan, { date: DATE });
  const v = C.verifyNC(gen.text, { stock: p.stock, machine: m, clamps: [], settings: p.settings, pockets: [], expected: gen.hits });
  const s2 = C.SIM.createSim(p.stock, { maxCells: 250000 });
  v.motions.forEach(mv => C.SIM.cutMotion(s2, mv, C.toolMap(m).get(mv.t)));
  const tipZ = V.plan.steps[0].z;
  assert.ok(Math.abs(C.SIM.heightAt(s2, 30, 30) - tipZ) < 0.1, C.SIM.heightAt(s2, 30, 30) + ' vs ' + tipZ);
  assert.ok(C.SIM.heightAt(s2, 30 + 3.4 + 0.6, 30) > -1e-6, '구멍 밖은 그대로');
});

test('시간 추정: 급속 속도가 빠를수록 짧아지고 항상 양수', () => {
  const r = build([{ spec: { shape: 'rect', w: 40, h: 30, cr: 5, depth: 5 } }]);
  const a = C.SIM.timeline(r.vr.motions, { rapid: 5000 }), b = C.SIM.timeline(r.vr.motions, { rapid: 30000 });
  const ta = a[a.length - 1].t1, tb = b[b.length - 1].t1;
  assert.ok(ta > tb && tb > 0, ta + ' ' + tb);
  assert.ok(a.every(x => x.sec >= 0));
});

test('장비 값 정규화: 급속·공구 교환 시간 범위 제한, 이전 저장 데이터 기본값', () => {
  const m = C.normalizeMachine({ name: 'x', rapid: 'abc', tcSec: 999 });
  assert.equal(m.rapid, 12000); assert.equal(m.tcSec, 120);
  const old = C.normalizeMachine({ name: 'old' });
  assert.equal(old.rapid, 12000); assert.equal(old.tcSec, 6); assert.equal(old.helical, true);
});

test('여러 포켓 + 구멍 혼합: 검증 통과, 포켓 영역 밖 구멍은 과삭 검사에 걸리지 않음', () => {
  const m = C.defaultMachine(), p = C.newProject(m);
  Object.assign(p.stock, { sx: 150, sy: 100, sz: 20, material: 'S45C' });
  const a = C.newGroup('a', 0); a.spec = C.newPocketSpec({ shape: 'rect', w: 40, h: 30, cr: 5, depth: 5 }); a.holes.push({ id: 'a1', x: 40, y: 50 }); a.holes.push({ id: 'a2', x: 110, y: 50 });
  const b = C.newGroup('b', 1); b.spec = C.newHoleSpec('tap', { tapD: 6, tapP: 1, tapDepth: 10 }); [[15, 15], [75, 15], [135, 15], [75, 85]].forEach((xy, i) => b.holes.push({ id: 'b' + i, x: xy[0], y: xy[1] }));
  [a, b].forEach(g => { C.applyHoleSpec(g, m, p.stock); p.groups.push(g); });
  const V = C.validateProject(p, m);
  assert.deepEqual(errs(V), []);
  const gen = C.generateNC(p, m, V.plan, { date: DATE });
  const v = C.verifyNC(gen.text, { stock: p.stock, machine: m, clamps: [], settings: p.settings, pockets: C.pocketRegions(p, m), expected: gen.hits, expectedCuts: gen.cuts });
  assert.deepEqual(v.errors, []); assert.equal(v.match, true);
  assert.equal(v.hits.length, gen.hits.length);
});

// ---------- 독립 안전 검토(V0.4) 지적 사항 재현 → 차단 확인 ----------
test('[검토 1] 정삭의 남김 여유가 황삭과 다르면 차단 (정삭 수직 하강 방지)', () => {
  const r = build([{ spec: { shape: 'rect', w: 40, h: 30, cr: 5, depth: 5 } }]);
  const g = r.p.groups[0]; g.spec = null; g.ops[0].allowFloor = 2; // 직접 구성으로 황삭 바닥 여유만 변경
  const V = C.validateProject(r.p, r.m);
  assert.ok(errs(V).some(m => /남김 여유가 같은/.test(m)), JSON.stringify(errs(V)));
});
test('[검토 1] 검증기: 깎이지 않은 소재로 엔드밀 수직 하강 차단 (헬리컬 삭제한 수정 NC)', () => {
  const r = build([{ spec: { shape: 'rect', w: 40, h: 30, cr: 5, depth: 5 } }]);
  const L = r.g.text.split('\n'), i = L.findIndex(l => /^G03 [^\n]*Z-/.test(l));
  let j = i; while (/^G03 [^\n]*Z-/.test(L[j + 1])) j++;
  const zf = /Z(-[\d.]+)/.exec(L[j])[1], xy = /X[-\d.]+ Y[-\d.]+/.exec(L[j])[0];
  L.splice(i, j - i + 1, 'G01 ' + xy + ' Z' + zf); // 첫 단의 헬리컬을 모두 수직 하강 한 줄로 바꿈
  const v = C.verifyNC(L.join('\n'), r.ctx({ expected: null }));
  assert.ok(v.errors.some(e => /수직 하강/.test(e.msg)), JSON.stringify(v.errors.slice(0, 3)));
});
test('[검토 2] 포켓이 공구보다 아주 조금 넓으면(헬리컬 공간 없음) 차단', () => {
  for (const spec of [{ shape: 'circle', dia: 6.45, toolNo: 18, depth: 5 }, { shape: 'rect', w: 40, h: 6.45, cr: 3, toolNo: 18, depth: 5 }, { shape: 'circle', dia: 6.401, toolNo: 18, depth: 5 }]) {
    const r = build([{ spec }]);
    assert.ok(errs(r.V).length > 0, JSON.stringify(spec));
  }
  // 자동 선택은 이런 공구를 고르지 않음
  const auto = C.planPocketSpec(C.newPocketSpec({ shape: 'circle', dia: 6.45 }), C.defaultMachine(), { sz: 20, material: 'S45C' });
  assert.ok(auto.ops.every(o => o.toolNo !== 18));
});
test('[검토 3·4·5] 검증기: G17 누락, 클램프를 지나는 원호, 엔드밀 드릴 사이클 차단', () => {
  const r = build([{ spec: { shape: 'rect', w: 40, h: 30, cr: 5, depth: 5 } }]);
  const v1 = C.verifyNC(r.g.text.replace(/ G17/, ''), r.ctx({ expected: null }));
  assert.ok(v1.errors.some(e => /G17/.test(e.msg)), 'G17');
  const clamp = [{ id: 'c', x: 132, y: 45, w: 10, h: 10, height: 15 }]; // 원호(중심 X107.5, 반경 30)의 오른쪽 끝(X137.5) 위치
  const t2 = r.g.text.replace(/(G00 Z50\.\n)(?![\s\S]*G00 Z50\.\n)/, '$1G00 X77.5 Y50.\nG01 Z2. F500.\nG03 X77.5 Y50. I30. J0.\nG00 Z50.\n');
  const v2 = C.verifyNC(t2, Object.assign(r.ctx({ expected: null }), { clamps: clamp }));
  assert.ok(v2.errors.some(e => /클램프/.test(e.msg)), JSON.stringify(v2.errors.slice(0, 3)));
  const t3 = r.g.text.replace(/(G00 Z50\.\n)(?![\s\S]*G00 Z50\.\n)/, '$1G98 G81 X20. Y20. Z-8. R3. F300.\nG80\n');
  const v3 = C.verifyNC(t3, r.ctx({ expected: null }));
  assert.ok(v3.errors.some(e => /엔드밀 T16 로 드릴 고정 사이클/.test(e.msg)), JSON.stringify(v3.errors.slice(0, 3)));
});
test('[검토 7] 간편 입력 포켓의 공정 값이 바뀌면(크기·여유) 불일치로 차단', () => {
  const r = build([{ spec: { shape: 'rect', w: 40, h: 30, cr: 5, depth: 5 } }]);
  r.p.groups[0].ops[0].w = 60;
  assert.ok(errs(C.validateProject(r.p, r.m)).some(m => /일치하지 않습니다/.test(m)));
});
test('[검토 기타] 포켓 R점 1mm 미만·절입 0.05mm 미만은 모델 오류', () => {
  const r = build([{ spec: { shape: 'rect', w: 40, h: 30, cr: 5, depth: 5 } }]);
  const g = r.p.groups[0]; g.spec = null; g.ops.forEach(o => { o.r = 0.8; }); g.ops[0].stepdown = 0.01;
  const e = errs(C.validateProject(r.p, r.m));
  assert.ok(e.some(m => /R점은 소재 상면 위 1mm/.test(m)) && e.some(m => /0\.05mm 이상/.test(m)), JSON.stringify(e));
});
