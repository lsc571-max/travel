// 변경 전후 비교: V0.2(프로그램 만들기) vs V0.3(프로그램 변경하기)
// 같은 입력 1,000건 → 검증 결과·공정 계획·G코드·독립 검증 결과가 같은지 확인한다.
// 허용하는 차이: 탭 공정 앞 오버라이드 100% 안내 주석 1줄 (의도한 변경)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const V02 = path.resolve(__dirname, '../../../../프로그램 만들기/푸른 AI CAM/V0.2/src/load-node.cjs');
const has = fs.existsSync(V02);
const NEW = require('../src/load-node.cjs');
const OLD = has ? require(V02) : null;
const DATE = new Date(2026, 10, 27, 9, 0);
const norm = t => t.replace(/\(PUREUN AI CAM V[\d.]+ [^)]*\)/, '(PUREUN AI CAM)');
const tapNote = t => t.replace(/^(\(OP\d+ (?:RIGID TAP|TAP) [^\n]*\))$/gm, '$1\n(TAP - SET FEED AND SPINDLE OVERRIDE TO 100 PERCENT)');
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

test('V0.2 → V0.3 동일 결과 (탭 안내 주석만 차이): 1,000건', { skip: !has && 'V0.2 폴더 없음' }, () => {
  const R = rng(3303);
  let gen = 0, taps = 0;
  for (let n = 0; n < 1000; n++) {
    const m = OLD.defaultMachine(); m.rigidM03 = R() < 0.3;
    const b = OLD.defaultBundles(m), p = OLD.newProject(m);
    Object.assign(p.stock, { sx: 80 + Math.round(R() * 200), sy: 60 + Math.round(R() * 150), sz: 15 + Math.round(R() * 35), origin: ['LL', 'UL', 'LR', 'UR', 'C'][Math.floor(R() * 5)], under: Math.round(R() * 6), material: Object.keys(OLD.MATERIALS)[Math.floor(R() * 7)] });
    Object.assign(p.settings, { retract: R() < 0.5 ? 'G98' : 'G99', seqNo: R() < 0.3, toolOrder: R() < 0.5 ? 'tool' : 'group', pathOrder: ['nearest', 'zigzag', 'input'][Math.floor(R() * 3)] });
    const r = OLD.stockRect(p.stock);
    for (let gi = 0; gi < 1 + Math.floor(R() * 3); gi++) {
      const g = OLD.newGroup('G' + gi, gi);
      for (let k = 0; k < 1 + Math.floor(R() * 10); k++) g.holes.push({ id: gi + '_' + k, x: OLD.r3(r.x0 + 8 + R() * (p.stock.sx - 16)), y: OLD.r3(r.y0 + 8 + R() * (p.stock.sy - 16)) });
      g.ops = OLD.applyBundle(b[Math.floor(R() * b.length)], m).ops;
      if (R() < 0.3) g.ops[0].depth = [0, -1, 50, 3.3][Math.floor(R() * 4)];
      g.ops.forEach((o, i) => { o.id = 'o' + gi + i; });
      p.groups.push(g);
    }
    if (R() < 0.3) p.clamps.push({ id: 'c', x: r.x0 - 15, y: r.y0 + 5, w: 12, h: 20, height: 10 + Math.round(R() * 50) });
    const pa = JSON.parse(JSON.stringify(p)), pb = JSON.parse(JSON.stringify(p));
    const va = OLD.validateProject(pa, m), vb = NEW.validateProject(pb, m);
    // [V0.3] 의도한 안전 강화(관통 여유 0.5mm, 기초 드릴 하한 D1, 관통 탭 출구 경고)는 비교에서 제외하되 완화는 금지
    const v3new = i => /관통 여유는 0\.5mm|최소 내경 D1|불완전 나사부/.test(i.msg), v3old = i => /기초 드릴 Ø[\d.]+ 가 (너무 작습니다|추천값 Ø)/.test(i.msg);
    assert.ok(va.issues.filter(v3old).length <= vb.issues.filter(i => /최소 내경 D1/.test(i.msg)).length, '기초 드릴 하한 완화 금지 #' + n);
    const key = v => v.issues.filter(i => !v3new(i) && !v3old(i)).map(i => i.level + '|' + i.cat + '|' + i.msg.replace(/테이블\/지그 충돌 위험 → .*$/, '테이블/지그 충돌 위험 →') + '|' + JSON.stringify(i.ref)).sort(); // [V0.4] 해결 안내 문구만 구체화
    assert.deepEqual(key(vb), key(va), '검증 결과 #' + n);
    const ga = OLD.generateNC(pa, m, va.plan, { date: DATE }), gb = NEW.generateNC(pb, m, vb.plan, { date: DATE });
    assert.equal(!!gb.blocked, !!ga.blocked);
    if (!ga.text) continue;
    gen++; if (/G84/.test(ga.text)) taps++;
    if (!pa.settings.seqNo) assert.equal(norm(gb.text), norm(tapNote(ga.text)), 'G코드 #' + n);
    else assert.equal(gb.text.split('\n').filter(l => !/TAP - SET/.test(l)).map(l => l.replace(/^N\d+ /, '')).join('\n').replace(/\(PUREUN AI CAM V[\d.]+ [^)]*\)/, ''), ga.text.split('\n').map(l => l.replace(/^N\d+ /, '')).join('\n').replace(/\(PUREUN AI CAM V[\d.]+ [^)]*\)/, ''), 'G코드(N번호 제외) #' + n);
    assert.deepEqual(gb.hits, ga.hits);
    const ctx = q => ({ stock: q.stock, machine: m, clamps: q.clamps, settings: q.settings, expected: null });
    const ra = OLD.verifyNC(ga.text, ctx(pa)), rb = NEW.verifyNC(gb.text, ctx(pb));
    assert.deepEqual(rb.errors.map(e => e.msg), ra.errors.map(e => e.msg), '검증기 #' + n);
  }
  assert.ok(gen > 300 && taps > 100, 'G코드 ' + gen + ', 탭 포함 ' + taps);
  console.log('  V0.2→V0.3 비교 1000건, G코드 ' + gen + '건(탭 포함 ' + taps + '건) 동일');
});
