// V0.6 단위 테스트: 실가공 승인 범위·첫 가공 모드·NC 해시·재시작 블록·공구별 분할·돌출/홀더·머신 Z 행정·리머·보링
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/load-node.cjs');
const DATE = new Date(2026, 10, 28, 9, 0);
function build(groups, opt) {
  opt = opt || {};
  const m = C.defaultMachine(); if (opt.machine) opt.machine(m);
  const p = C.newProject(m);
  Object.assign(p.stock, { sx: 150, sy: 100, sz: 20, material: 'S45C', origin: 'LL', under: opt.under || 0 });
  if (opt.settings) Object.assign(p.settings, opt.settings);
  if (opt.clamps) p.clamps = opt.clamps;
  groups.forEach((sp, i) => { const g = C.newGroup('G' + i, i); g.spec = sp.spec; (sp.at || [[75, 50]]).forEach((xy, k) => g.holes.push({ id: 'h' + i + '_' + k, x: xy[0], y: xy[1] })); C.applyHoleSpec(g, m, p.stock); p.groups.push(g); });
  const V = C.validateProject(p, m);
  const gen = C.generateNC(p, m, V.plan, { date: DATE });
  const ctx = extra => Object.assign({ stock: p.stock, machine: m, clamps: p.clamps, settings: p.settings, pockets: C.pocketRegions(p, m) }, extra);
  const vr = gen.text ? C.verifyNC(gen.text, ctx({ expected: gen.hits, expectedCuts: gen.cuts })) : null;
  return { m, p, V, gen, vr, ctx };
}
const errs = V => V.issues.filter(i => i.level === 'error').map(i => i.msg);
const addDrill = (no, dia) => m => m.tools.push(C.normalizeTool({ no, type: 'drill', dia, flute: 100 }));

test('첫 가공 모드: 공정마다 M00 + 주축 재지령, 절삭 이송 % (탭은 그대로), 검증 통과', () => {
  const groups = [{ spec: C.newPocketSpec({ shape: 'rect', w: 40, h: 30, depth: 5 }) }, { spec: C.newHoleSpec('tap', { tapD: 8, tapP: 1.25, tapDepth: 12 }), at: [[20, 20]] }];
  const a = build(groups), b = build(groups, { settings: { firstRun: true, firstFeed: 50 } });
  assert.deepEqual(errs(b.V), []); assert.deepEqual(b.vr.errors, []); assert.equal(b.vr.match, true);
  const L = b.gen.text.split('\n'), m00 = L.filter(l => l === 'M00').length;
  assert.equal(m00, b.V.plan.steps.filter(s => s.toolChange || true).length, '공정마다 M00');
  L.forEach((l, i) => { if (l === 'M00' && !/M29/.test(L[i + 1] || '')) assert.ok(/^S\d+ M03$/.test(L[i + 1]) || /^G0[0-9]|^G98|^G99/.test(L[i + 1]), 'M00 뒤 주축 재지령 ' + L[i + 1]); });
  const f = t => [...t.matchAll(/G01[^\n]* F(\d+)/g)].map(x => +x[1]);
  assert.ok(Math.max(...f(b.gen.text)) <= Math.ceil(Math.max(...f(a.gen.text)) * 0.5) + 1, '포켓 이송 절반');
  const tapF = t => /G84[^\n]* F([\d.]+)/.exec(t)[1];
  assert.equal(tapF(b.gen.text), tapF(a.gen.text), '탭 이송은 동기 이송이라 그대로');
});

test('실가공 승인: 가공 종류·버전별, 해시 줄, 공구별 재시작 블록(N100…)은 공구 교환마다', () => {
  const r = build([{ spec: C.newHoleSpec('drill', { dia: 6.8, depth: 10 }) }], { settings: { restart: true, seqNo: true } });
  assert.deepEqual(r.vr.errors, []);
  const L = r.gen.text.split('\n');
  const ns = L.filter(l => /^N\d+ /.test(l));
  assert.deepEqual(ns.map(l => l.split(' ')[0]), ['N100', 'N200'], '공구 2개 → N100, N200 (순번 출력은 끔)');
  L.forEach((l, i) => { if (/^N\d00 /.test(l)) assert.match(L[i + 1], /^T\d+ M06$/); });
  assert.match(r.gen.text, /\(NC HASH [0-9A-F]{8} /);
  assert.equal(r.gen.hash, C.ncHash(r.gen.text.split('\n').filter(l => !/^\(NC HASH /.test(l)).join('\n')));
  assert.ok(r.V.issues.some(i => /실가공 검증 전/.test(i.msg)));
  r.m.approvals = [{ kinds: ['center', 'drill'], ver: C.VERSION }];
  assert.ok(!C.validateProject(r.p, r.m).issues.some(i => /실가공 검증 전/.test(i.msg)));
  C.revoke(r.m, '공구 변경');
  assert.equal(r.m.approvals.length, 0); assert.ok(r.m.history.some(h => /승인 해제/.test(h.what)));
});

test('공구별 분할 NC: 각 파일이 독립 프로그램, 앞 파일 상태를 이어받아 모두 검증 통과', () => {
  const r = build([{ spec: C.newPocketSpec({ shape: 'rect', w: 40, h: 30, depth: 6 }) }, { spec: C.newHoleSpec('tap', { tapD: 8, tapP: 1.25, tapDepth: 12 }), at: [[20, 20], [130, 80]] }]);
  const parts = C.planByTool(r.V.plan);
  assert.equal(parts.length, new Set(r.V.plan.steps.filter(s => s.toolChange).map(s => s.idx)).size);
  let carry = null, hits = 0;
  parts.forEach((pl, k) => {
    const g = C.generateNC(Object.assign({}, r.p, { programNo: r.p.programNo + k }), r.m, pl, { date: DATE });
    assert.match(g.text, /^%\nO\d{4}/); assert.match(g.text, /M30\n%$/);
    const v = C.verifyNC(g.text, r.ctx({ expected: g.hits, expectedCuts: g.cuts, carryIn: carry }));
    assert.deepEqual(v.errors, [], '파일 ' + k); assert.equal(v.match, true);
    carry = v.carry; hits += g.hits.length;
  });
  assert.equal(hits, r.gen.hits.length);
  // 이어받지 않으면 탭 기초 구멍이 없다고 막힘 (검증기가 실제로 확인한다는 증거)
  const last = parts[parts.length - 1], g = C.generateNC(r.p, r.m, last, { date: DATE });
  assert.ok(C.verifyNC(g.text, r.ctx({ expected: null })).errors.some(e => /기초 드릴/.test(e.msg)));
});

test('돌출 길이·홀더: 깊이 > 돌출 길이 차단, 홀더가 클램프 위로 지나가면 검증기 차단, H·G54 머신 Z 행정 검사', () => {
  const deep = build([{ spec: C.newPocketSpec({ shape: 'rect', w: 40, h: 30, depth: 15 }) }], { machine: m => { const t = m.tools.find(x => x.no === 16); t.stick = 14; } });
  assert.ok(errs(deep.V).some(m => /돌출 길이 14mm 로는/.test(m)), JSON.stringify(errs(deep.V)));
  const ok = build([{ spec: C.newPocketSpec({ shape: 'rect', w: 40, h: 30, depth: 10 }) }], { machine: m => { m.tools.forEach(t => { t.stick = 40; t.holderDia = 50; }); } });
  assert.deepEqual(errs(ok.V), []); assert.deepEqual(ok.vr.errors, []);
  // 낮은 클램프(높이 5)는 공구 끝은 피하지만 홀더(지름 50, 공구 끝 + 40)가 지나감 → 소재에서 공구를 일부러 짧게 물려 홀더가 낮아지게
  const cl = build([{ spec: C.newHoleSpec('drill', { dia: 6.8, depth: 12 }), at: [[20, 50]] }], { clamps: [{ id: 'c', x: -12, y: 40, w: 10, h: 20, height: 5 }], machine: m => { m.tools.forEach(t => { t.stick = 18; t.holderDia = 60; }); } });
  assert.ok(cl.vr.errors.some(e => /홀더/.test(e.msg)), JSON.stringify(cl.vr.errors.slice(0, 3)));
  // 홀더가 소재에 닿는 수정 NC (돌출 길이 입력 공구로 깊게 G01) → 검증기 차단
  const em = build([{ spec: C.newPocketSpec({ shape: 'rect', w: 40, h: 30, depth: 8 }) }], { machine: m => { const t = m.tools.find(x => x.no === 16); t.stick = 9; t.holderDia = 40; } });
  const L = em.gen.text.split('\n'), i = L.findIndex(l => /^G01 [^\n]*Z-8\./.test(l));
  L.splice(i + 1, 0, 'G01 Z-9.5'); // 돌출 9 → 홀더 밑면 Z-0.5 (소재 안)
  assert.ok(C.verifyNC(L.join('\n'), em.ctx({ expected: null })).errors.some(e => /홀더/.test(e.msg)));
  // 머신 좌표: G54 Z −300, H 250 → 초기점 50 이면 머신 Z 0 (경계), 초기점 60 이면 초과
  const mz = build([{ spec: C.newHoleSpec('drill', { dia: 6.8, depth: 10 }) }], { settings: { g54Z: -300, initialZ: 60 }, machine: m => { m.tools.forEach(t => { t.hVal = 250; }); } });
  assert.ok(errs(mz.V).some(m => /Z 행정 위쪽/.test(m)));
  const mz2 = build([{ spec: C.newHoleSpec('drill', { dia: 6.8, depth: 10 }) }], { settings: { g54Z: -300, initialZ: 50 }, machine: m => { m.tools.forEach(t => { t.hVal = 250; }); m.zMin = -55; } }); // 최저 Z−12.x → 머신 −62 < 하한 −55
  assert.ok(errs(mz2.V).some(m => /Z 행정 아래/.test(m)), JSON.stringify(errs(mz2.V)));
});

test('리머(H7): 센터 → 밑구멍 드릴(D−0.2) → G85, 밑구멍 없으면 모델·검증기 차단, 리머로 G81 차단', () => {
  const r = build([{ spec: C.newHoleSpec('ream', { dia: 6, depth: 12 }) }], { machine: addDrill(23, 5.8) });
  assert.deepEqual(r.p.groups[0].ops.map(o => o.type), ['center', 'drill', 'ream']);
  assert.deepEqual(errs(r.V), []); assert.deepEqual(r.vr.errors, []); assert.equal(r.vr.match, true);
  assert.match(r.gen.text, /G85 X75\. Y50\. Z-12\.5 R3\./);
  const no = build([{ spec: C.newHoleSpec('ream', { dia: 6, depth: 12 }) }]);
  assert.ok(errs(no.V).some(m => /밑구멍/.test(m)));
  const t = r.gen.text.replace(/G85 /, 'G81 ');
  assert.ok(C.verifyNC(t, r.ctx({ expected: null })).errors.some(e => /리머/.test(e.msg)));
  // 밑구멍 드릴 공정을 지운 수정 NC → 검증기 차단
  const L = r.gen.text.split('\n'), a = L.findIndex(l => /^\(OP\d+ DRILL T/.test(l)), b = L.findIndex((l, i) => i > a && /^\(OP/.test(l));
  assert.ok(C.verifyNC(L.slice(0, a).concat(L.slice(b)).join('\n'), r.ctx({ expected: null })).errors.some(e => /밑구멍/.test(e.msg)));
});

test('정밀 보링: 드릴 없으면 원형 포켓 밑구멍 → G76 Q, G76 미지원 장비는 G86, Q 범위 검사', () => {
  const r = build([{ spec: C.newHoleSpec('bore', { dia: 20, depth: 10 }) }]);
  assert.deepEqual(r.p.groups[0].ops.map(o => o.type), ['center', 'pocketRough', 'bore']);
  assert.deepEqual(errs(r.V), []); assert.deepEqual(r.vr.errors, []);
  assert.match(r.gen.text, /G76 X75\. Y50\. Z-10\. R3\. Q0\.2 F\d+/);
  const g86 = build([{ spec: C.newHoleSpec('bore', { dia: 20, depth: 10 }) }], { machine: m => { m.g76 = false; } });
  assert.match(g86.gen.text, /G86 X75\. Y50\. Z-10\. R3\. F\d+/); assert.deepEqual(g86.vr.errors, []);
  assert.ok(C.verifyNC(r.gen.text.replace(/Q0\.2/, 'Q2.'), r.ctx({ expected: null })).errors.some(e => /Q/.test(e.msg)));
  const dr = build([{ spec: C.newHoleSpec('bore', { dia: 20, depth: 10 }) }], { machine: addDrill(23, 18) });
  assert.deepEqual(dr.p.groups[0].ops.map(o => o.type), ['center', 'drill', 'bore']); assert.deepEqual(dr.vr.errors, []);
});
