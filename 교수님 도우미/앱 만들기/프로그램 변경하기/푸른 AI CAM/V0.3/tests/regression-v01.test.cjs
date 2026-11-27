// 모듈화 전후 비교 회귀 테스트: V0.1 단일 엔진(core.js) vs V0.2 모듈 엔진
// 같은 입력 1,000+ 건으로 G코드 텍스트·구멍 목록·검증 결과·계산값이 같은지 확인한다.
// 의도적으로 바꾼 동작(안전 수정)은 KNOWN_CHANGES 로 명시하고 그 차이만 허용한다.
// 실행: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

// V0.3 부터 '프로그램 변경하기' 폴더에 있으므로 '프로그램 만들기'의 V0.1 을 참조
const V01_PATH = path.resolve(__dirname, '../../../../프로그램 만들기/푸른 AI CAM/V0.1/src/core.js');
const hasV01 = fs.existsSync(V01_PATH);
const NEW = require('../src/load-node.cjs');
const OLD = hasV01 ? (() => { const saved = globalThis.PCAM; const m = require(V01_PATH); globalThis.PCAM = saved; return m; })() : null;

// V0.2 에서 의도적으로 바꾼 출력 (안전 수정). 비교 전에 V0.1 결과에 같은 변환을 적용한다.
const KNOWN_CHANGES = [
  // [검증 6] 안전 블록에 G94(분당 이송) 추가
  { id: 'G94', apply: t => t.replace(/^((?:N\d+ )?G00 G17 G40 G49 G80 G90)$/m, '$1 G94') },
  // [V0.3] 탭 공정 앞 오버라이드 100% 안내 주석
  { id: 'TAPNOTE', apply: t => t.replace(/^(\(OP\d+ (?:RIGID TAP|TAP) [^\n]*\))$/gm, '$1\n(TAP - SET FEED AND SPINDLE OVERRIDE TO 100 PERCENT)') }
];
// [검증 7] 같은 공구로 일반 탭 후 리지드 탭: M29 전에 M05 추가 → 해당 경우는 텍스트 비교 제외 (별도 단위 테스트)
function spindleOnBeforeM29(text) {
  let on = false;
  for (const l of text.split('\n')) { if (/M03/.test(l)) on = true; if (/M05/.test(l)) on = false; if (/M29/.test(l) && on) return true; }
  return false;
}
const normText = t => t.replace(/\(PUREUN AI CAM V[\d.]+ [^)]*\)/, '(PUREUN AI CAM)');
function applyKnown(oldText, ctx) { return KNOWN_CHANGES.reduce((t, k) => k.apply(t, ctx), oldText); }

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function randomProject(R, bad) {
  const m = OLD.defaultMachine();
  const b = OLD.defaultBundles(m);
  const p = OLD.newProject(m);
  Object.assign(p.stock, { sx: 60 + Math.round(R() * 300), sy: 60 + Math.round(R() * 200), sz: 10 + Math.round(R() * 40), material: Object.keys(OLD.MATERIALS)[Math.floor(R() * 7)], origin: ['LL', 'UL', 'LR', 'UR', 'C'][Math.floor(R() * 5)], under: Math.round(R() * 6) });
  Object.assign(p.settings, { retract: R() < 0.5 ? 'G98' : 'G99', pathOrder: ['nearest', 'zigzag', 'input'][Math.floor(R() * 3)], toolOrder: R() < 0.5 ? 'tool' : 'group', seqNo: R() < 0.3, coolant: R() < 0.8, m01: R() < 0.5 });
  if (R() < 0.2) m.rigidM03 = true;
  if (R() < 0.1) m.verified = true;
  const r = OLD.stockRect(p.stock);
  const ng = 1 + Math.floor(R() * 3);
  for (let gi = 0; gi < ng; gi++) {
    const g = OLD.newGroup('G' + gi, gi);
    const nh = 1 + Math.floor(R() * 15);
    for (let k = 0; k < nh; k++) g.holes.push({ id: 'h' + gi + '_' + k, x: OLD.r3(r.x0 + 8 + R() * (p.stock.sx - 16)), y: OLD.r3(r.y0 + 8 + R() * (p.stock.sy - 16)) });
    g.ops = OLD.applyBundle(b[Math.floor(R() * b.length)], m).ops;
    if (R() < 0.3) g.ops.push(OLD.newOp(['center', 'drill', 'peck', 'deep', 'tap', 'rigid'][Math.floor(R() * 6)], [1, 2, 3, 4, 5, 6, 13, 14][Math.floor(R() * 8)], { depth: Math.round(R() * 30) }));
    if (R() < 0.2) g.ops.forEach(o => { if (o.type === 'drill' || o.type === 'center') o.dwell = Math.round(R() * 800); });
    g.ops.forEach((o, i) => { o.id = 'o' + gi + '_' + i; });
    p.groups.push(g);
  }
  if (R() < 0.3) p.clamps.push({ id: 'c1', x: r.x0 - 15, y: r.y0 + 10, w: 12, h: 20, height: 10 + Math.round(R() * 50) });
  if (bad) {
    const pick = () => [NaN, -1, 0, 1e6, 0.05, 5, 50, 9000][Math.floor(R() * 8)];
    const g = p.groups[0], op = g.ops[Math.floor(R() * g.ops.length)];
    const key = ['depth', 'r', 'q', 'rpm', 'feed', 'dwell', 'brk', 'toolNo'][Math.floor(R() * 8)];
    op[key] = key === 'toolNo' ? [1, 9, 13, 30][Math.floor(R() * 4)] : pick();
    if (R() < 0.5) op.auto = false;
    if (R() < 0.3) g.holes[0].x = pick();
    if (R() < 0.2) p.settings.initialZ = pick();
    if (R() < 0.2) p.programNo = [0, 8001, 10000][Math.floor(R() * 3)];
  }
  return { p, m };
}
const issueKey = i => i.level + '|' + i.cat + '|' + i.msg + '|' + JSON.stringify(i.ref);
const sortIssues = v => v.issues.map(issueKey).sort();
const DATE = new Date(2026, 10, 27, 9, 0);

test('모듈화 전후 동일 결과: 정상·비정상 입력 1,200건', { skip: !hasV01 && 'V0.1 폴더 없음' }, () => {
  const R = rng(20261127);
  let same = 0, generated = 0, m29cases = 0, stricter = 0;
  for (let n = 0; n < 1200; n++) {
    const { p, m } = randomProject(R, n % 3 === 2);
    const pa = JSON.parse(JSON.stringify(p)), pb = JSON.parse(JSON.stringify(p));
    const va = OLD.validateProject(pa, m), vb = NEW.validateProject(pb, m);
    // [2차 검증 7] V0.2 는 소재 범위·클램프를 가장 큰 공구(스팟 포함) 반경으로 검사 → 더 엄격해질 수만 있음
    const geo = i => (i.cat === 2) || (i.cat === 10 && /클램프 \d+ 영역과 겹칩니다/.test(i.msg));
    // [V0.3] 의도한 안전 강화: 관통 여유 0.5mm 이상, 기초 드릴 하한 = 최소 내경 D1, 관통 탭 출구 경고 (완화는 금지)
    const v3new = i => /관통 여유는 0\.5mm|최소 내경 D1|불완전 나사부/.test(i.msg), v3old = i => /기초 드릴 Ø[\d.]+ 가 (너무 작습니다|추천값 Ø)/.test(i.msg);
    assert.ok(va.issues.filter(v3old).length <= vb.issues.filter(i => /최소 내경 D1/.test(i.msg)).length, '기초 드릴 하한 완화 금지 #' + n);
    const strip = v => ({ issues: v.issues.filter(i => !geo(i) && !v3new(i) && !v3old(i)) });
    assert.deepEqual(sortIssues(strip(vb)), sortIssues(strip(va)), '검증 결과 차이 #' + n);
    const geoErrRefs = v => new Set(v.issues.filter(i => geo(i) && i.level === 'error').map(i => JSON.stringify(i.ref)));
    const oldGeo = geoErrRefs(va), newGeo = geoErrRefs(vb);
    oldGeo.forEach(r => assert.ok(newGeo.has(r), '모듈화 후 소재/클램프 오류 누락 #' + n));
    if (newGeo.size > oldGeo.size) stricter++;
    assert.equal(vb.plan.steps.length, va.plan.steps.length);
    vb.plan.steps.forEach((s, k) => { const o = va.plan.steps[k]; assert.equal(s.key, o.key); assert.deepEqual(s.holes, o.holes); });
    const ga = OLD.generateNC(pa, m, va.plan, { date: DATE }), gb = NEW.generateNC(pb, m, vb.plan, { date: DATE });
    assert.equal(!!gb.blocked, !!ga.blocked, '차단 여부 차이 #' + n);
    if (ga.text) {
      generated++;
      if (spindleOnBeforeM29(ga.text) && !m.rigidM03) { m29cases++; assert.ok(/M05\n(N\d+ )?M29/.test(gb.text), 'M29 전 M05 #' + n); }
      else assert.equal(normText(gb.text), normText(applyKnown(ga.text, { p: pa, m })), 'G코드 차이 #' + n);
      assert.deepEqual(gb.hits, ga.hits);
      const ctx = { stock: pa.stock, machine: m, clamps: pa.clamps, expected: ga.hits };
      const ra = OLD.verifyNC(ga.text, ctx), rb = NEW.verifyNC(gb.text, Object.assign({}, ctx, { settings: pb.settings }));
      if (!KNOWN_CHANGES.length) { assert.deepEqual(rb.errors, ra.errors); assert.deepEqual(rb.warnings, ra.warnings); }
      assert.equal(rb.match, ra.match);
    }
    same++;
  }
  assert.ok(generated > 300, 'G코드 생성 건수 ' + generated);
  console.log('  비교 ' + same + '건, G코드 생성 ' + generated + '건 (의도한 변경: G94 추가, M29 전 M05 ' + m29cases + '건, 공구 반경 기준 소재/클램프 검사 강화 ' + stricter + '건)');
});

test('모듈화 전후 동일 계산: 깊이·조건·추천·기초 드릴·배열', { skip: !hasV01 && 'V0.1 폴더 없음' }, () => {
  const m = OLD.defaultMachine(), st = { sz: 25 };
  const types = ['center', 'drill', 'peck', 'deep', 'tap', 'rigid'];
  m.tools.forEach(t => types.forEach(ty => Object.keys(OLD.MATERIALS).forEach(mat => {
    [{ depth: 12, depthMode: 'tip' }, { depth: 12, depthMode: 'full' }, { thru: true, brk: 1.5 }, { auto: false, rpm: 777, feed: 88 }].forEach(x => {
      const op = Object.assign(OLD.newOp(ty, t.no), x);
      assert.deepEqual(NEW.opDepth(op, t, st), OLD.opDepth(op, t, st));
      assert.deepEqual(NEW.opConditions(op, t, mat, m), OLD.opConditions(op, t, mat, m));
    });
    assert.deepEqual(NEW.refConditions(ty, t, mat), OLD.refConditions(ty, t, mat));
    assert.deepEqual(NEW.recommend(ty, t, mat, m), OLD.recommend(ty, t, mat, m));
  })));
  for (let d = 1; d <= 30; d += 0.5) for (const p of [undefined, 0.5, 1, 1.25, 1.5, 2]) assert.deepEqual(NEW.tapDrill(d, p), OLD.tapDrill(d, p));
  const a = { x: 3, y: 4, pitch: 7.5, angle: 33, count: 9, px: 6, py: 8, nx: 5, ny: 4, cx: 10, cy: -5, dia: 47, start: 12 };
  assert.deepEqual(NEW.genLine(a), OLD.genLine(a)); assert.deepEqual(NEW.genGrid(a), OLD.genGrid(a)); assert.deepEqual(NEW.genPCD(a), OLD.genPCD(a));
  ['input', 'nearest', 'zigzag'].forEach(mo => assert.deepEqual(NEW.orderHoles(NEW.genGrid(a), mo, { x: 0, y: 0 }), OLD.orderHoles(OLD.genGrid(a), mo, { x: 0, y: 0 })));
  const nb = NEW.defaultBundles(m).map(b => b.ops.map(o => JSON.stringify(o)));
  const ob = OLD.defaultBundles(m).map(b => b.ops.map(o => JSON.stringify(o)));
  assert.deepEqual(nb, ob);
});
