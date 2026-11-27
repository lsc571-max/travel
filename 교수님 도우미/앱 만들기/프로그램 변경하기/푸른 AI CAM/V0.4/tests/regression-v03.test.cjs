// 변경 전후 비교: V0.3 vs V0.4 (같은 폴더 '프로그램 변경하기/푸른 AI CAM')
// 포켓이 없는 구멍·탭 프로젝트 1,000건 → 검증 결과·G코드·독립 검증 결과가 같은지 확인한다.
// 허용하는 차이: NC 버전 주석, 소재 바닥 초과 오류의 해결 안내 문구(판정은 동일)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const V03 = path.resolve(__dirname, '../../V0.3/src/load-node.cjs');
const has = fs.existsSync(V03);
const NEW = require('../src/load-node.cjs');
const OLD = has ? require(V03) : null;
const DATE = new Date(2026, 10, 27, 9, 0);
const norm = t => t.replace(/\(PUREUN AI CAM V[\d.]+ [^)]*\)/, '(PUREUN AI CAM)');
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

test('V0.3 → V0.4 동일 결과 (포켓 없는 프로젝트): 1,000건', { skip: !has && 'V0.3 폴더 없음' }, () => {
  const R = rng(4404);
  let gen = 0, spec = 0;
  for (let n = 0; n < 1000; n++) {
    const m = OLD.defaultMachine(); m.rigidM03 = R() < 0.3;
    const b = OLD.defaultBundles(m), p = OLD.newProject(m);
    Object.assign(p.stock, { sx: 80 + Math.round(R() * 200), sy: 60 + Math.round(R() * 150), sz: 15 + Math.round(R() * 35), origin: ['LL', 'UL', 'LR', 'UR', 'C'][Math.floor(R() * 5)], under: Math.round(R() * 6), material: Object.keys(OLD.MATERIALS)[Math.floor(R() * 7)] });
    Object.assign(p.settings, { retract: R() < 0.5 ? 'G98' : 'G99', seqNo: R() < 0.3, toolOrder: R() < 0.5 ? 'tool' : 'group', pathOrder: ['nearest', 'zigzag', 'input'][Math.floor(R() * 3)] });
    const r = OLD.stockRect(p.stock);
    for (let gi = 0; gi < 1 + Math.floor(R() * 3); gi++) {
      const g = OLD.newGroup('G' + gi, gi);
      for (let k = 0; k < 1 + Math.floor(R() * 10); k++) g.holes.push({ id: gi + '_' + k, x: OLD.r3(r.x0 + 8 + R() * (p.stock.sx - 16)), y: OLD.r3(r.y0 + 8 + R() * (p.stock.sy - 16)) });
      if (R() < 0.5) {
        g.spec = R() < 0.5 ? OLD.newHoleSpec('drill', { dia: [3.3, 5, 6.6, 6.8, 8.5, 9, 7][Math.floor(R() * 7)], depth: 3 + Math.round(R() * 30), thru: R() < 0.3 }) : OLD.newHoleSpec('tap', { tapD: [4, 5, 6, 8, 10][Math.floor(R() * 5)], tapDepth: 5 + Math.round(R() * 15), thru: R() < 0.2 });
        OLD.applyHoleSpec(g, m, p.stock); spec++;
      } else g.ops = OLD.applyBundle(b[Math.floor(R() * b.length)], m).ops;
      g.ops.forEach((o, i) => { o.id = 'o' + gi + i; });
      p.groups.push(g);
    }
    if (R() < 0.3) p.clamps.push({ id: 'c', x: r.x0 - 15, y: r.y0 + 5, w: 12, h: 20, height: 10 + Math.round(R() * 50) });
    const pa = JSON.parse(JSON.stringify(p)), pb = NEW.normalizeProject(JSON.parse(JSON.stringify(p)));
    const mb = NEW.normalizeMachine(JSON.parse(JSON.stringify(m)));
    pb.groups.forEach(g => { if (g.spec) NEW.applyHoleSpec(g, mb, pb.stock); });
    const va = OLD.validateProject(pa, m), vb = NEW.validateProject(pb, mb);
    // [V0.4 의도한 변경] 소재 바닥 초과 오류의 해결 안내 문구만 구체화 (판정·수준·항목은 동일해야 함)
    const fixMsg = m => m.replace(/테이블\/지그 충돌 위험 → .*$/, '테이블/지그 충돌 위험 →');
    const key = v => v.issues.map(i => i.level + '|' + i.cat + '|' + fixMsg(i.msg)).sort();
    assert.deepEqual(key(vb), key(va), '검증 결과 #' + n);
    const ga = OLD.generateNC(pa, m, va.plan, { date: DATE }), gb = NEW.generateNC(pb, mb, vb.plan, { date: DATE });
    assert.equal(!!gb.blocked, !!ga.blocked, '차단 여부 #' + n);
    if (!ga.text) continue;
    gen++;
    assert.equal(norm(gb.text), norm(ga.text), 'G코드 #' + n);
    assert.deepEqual(gb.hits, ga.hits);
    const ctx = (q, mm) => ({ stock: q.stock, machine: mm, clamps: q.clamps, settings: q.settings, expected: null });
    const ra = OLD.verifyNC(ga.text, ctx(pa, m)), rb = NEW.verifyNC(gb.text, ctx(pb, mb));
    assert.deepEqual(rb.errors.map(e => e.msg), ra.errors.map(e => e.msg), '검증기 오류 #' + n);
    assert.deepEqual(rb.warnings.map(e => e.msg), ra.warnings.map(e => e.msg), '검증기 경고 #' + n);
  }
  assert.ok(gen > 300 && spec > 300, 'G코드 ' + gen + ', 간편 입력 ' + spec);
  console.log('  V0.3→V0.4 비교 1000건, G코드 ' + gen + '건 동일 (간편 입력 그룹 ' + spec + '개 포함)');
});
