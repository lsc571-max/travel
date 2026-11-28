// 변경 전후 비교: V0.5 vs V0.6 — 구멍·탭·포켓(단계·진입·다각·측벽 형상)·윤곽·평면·모따기 프로젝트 1,000건
// 허용하는 차이 (의도한 변경): NC 머리말의 해시 줄·버전 주석, 돌출 길이 미입력 안내(참고)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const V05 = path.resolve(__dirname, '../../V0.5/src/load-node.cjs');
const has = fs.existsSync(V05);
const NEW = require('../src/load-node.cjs');
const OLD = has ? require(V05) : null;
const DATE = new Date(2026, 10, 28, 9, 0);
const norm = t => t.replace(/\(PUREUN AI CAM V[\d.]+ [^)]*\)/, '(PUREUN AI CAM)').replace(/\n\(NC HASH [^)]*\)/, '');
const skipMsg = i => /돌출 길이가 입력되지 않은/.test(i.msg);
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const pick = (R, a) => a[Math.floor(R() * a.length)];

test('V0.5 → V0.6 동일 결과 (밀링 포함): 1,000건', { skip: !has && 'V0.5 폴더 없음' }, () => {
  const R = rng(6606);
  let gen = 0, mill = 0;
  for (let n = 0; n < 1000; n++) {
    const m = OLD.defaultMachine(); m.helical = R() < 0.9;
    const p = OLD.newProject(m);
    Object.assign(p.stock, { sx: 100 + Math.round(R() * 150), sy: 80 + Math.round(R() * 100), sz: 15 + Math.round(R() * 25), origin: pick(R, ['LL', 'UL', 'LR', 'UR', 'C']), under: Math.round(R() * 5), material: pick(R, Object.keys(OLD.MATERIALS)) });
    Object.assign(p.settings, { retract: R() < 0.5 ? 'G98' : 'G99', seqNo: R() < 0.3, toolOrder: R() < 0.5 ? 'tool' : 'group', depthRef: R() < 0.7 ? 'auto' : 'top' });
    const r = OLD.stockRect(p.stock), cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    for (let gi = 0; gi < 1 + Math.floor(R() * 3); gi++) {
      const g = OLD.newGroup('G' + gi, gi), k = R();
      const at = [OLD.r3(cx + (R() - 0.5) * 30), OLD.r3(cy + (R() - 0.5) * 20)];
      if (k < 0.3) { g.spec = OLD.newPocketSpec({ shape: pick(R, ['rect', 'circle', 'ngon']), w: 20 + Math.round(R() * 30), h: 16 + Math.round(R() * 20), cr: Math.round(R() * 6), dia: 20 + Math.round(R() * 25), sides: 5 + Math.floor(R() * 4), depth: 2 + Math.round(R() * 8), semi: R() < 0.3, semiStep: pick(R, [0, 1]), finishMode: pick(R, ['split', 'both']), entry: pick(R, ['helix', 'ramp']), draft: R() < 0.2 ? 3 : 0, floorR: R() < 0.15 ? 1 : 0 }); g.holes.push({ id: 'p' + gi, x: at[0], y: at[1] }); mill++; }
      else if (k < 0.4) { g.spec = OLD.newMillSpec('contour', { w: p.stock.sx - 6, h: p.stock.sy - 6, cr: Math.round(R() * 5), depth: 3 + Math.round(R() * 5), sideWidth: 3 }); g.holes.push({ id: 'c' + gi, x: OLD.r3(cx), y: OLD.r3(cy) }); mill++; }
      else if (k < 0.47) { g.spec = OLD.newMillSpec('face', { depth: 0.5 }); g.holes.push({ id: 'f' + gi, x: OLD.r3(cx), y: OLD.r3(cy) }); mill++; }
      else if (k < 0.73) { g.spec = OLD.newHoleSpec('drill', { dia: pick(R, [3.3, 5, 6.6, 6.8, 8.5, 9]), depth: 3 + Math.round(R() * 15), thru: R() < 0.2 }); for (let i = 0; i < 1 + Math.floor(R() * 5); i++) g.holes.push({ id: 'd' + gi + i, x: OLD.r3(r.x0 + 8 + R() * (p.stock.sx - 16)), y: OLD.r3(r.y0 + 8 + R() * (p.stock.sy - 16)) }); }
      else { g.spec = OLD.newHoleSpec('tap', { tapD: pick(R, [4, 5, 6, 8, 10]), tapDepth: 5 + Math.round(R() * 10) }); for (let i = 0; i < 1 + Math.floor(R() * 5); i++) g.holes.push({ id: 't' + gi + i, x: OLD.r3(r.x0 + 8 + R() * (p.stock.sx - 16)), y: OLD.r3(r.y0 + 8 + R() * (p.stock.sy - 16)) }); }
      OLD.applyHoleSpec(g, m, p.stock);
      g.ops.forEach((o, i) => { o.id = 'o' + gi + i; });
      p.groups.push(g);
    }
    const pa = JSON.parse(JSON.stringify(p)), pb = NEW.normalizeProject(JSON.parse(JSON.stringify(p)));
    const mb = NEW.normalizeMachine(JSON.parse(JSON.stringify(m)));
    pb.groups.forEach(g => { if (g.spec) NEW.applyHoleSpec(g, mb, pb.stock); });
    const va = OLD.validateProject(pa, m), vb = NEW.validateProject(pb, mb);
    const key = v => v.issues.filter(i => i.level !== 'info' && !skipMsg(i)).map(i => i.level + '|' + i.cat + '|' + i.msg).sort();
    assert.deepEqual(key(vb), key(va), '검증 결과 #' + n);
    const ga = OLD.generateNC(pa, m, va.plan, { date: DATE }), gb = NEW.generateNC(pb, mb, vb.plan, { date: DATE });
    assert.equal(!!gb.blocked, !!ga.blocked, '차단 여부 #' + n);
    if (!ga.text) continue;
    gen++;
    assert.equal(norm(gb.text), norm(ga.text), 'G코드 #' + n);
    const ctx = (q, mm, C) => ({ stock: q.stock, machine: mm, clamps: q.clamps, settings: q.settings, pockets: C.pocketRegions(q, mm), expected: null });
    const ra = OLD.verifyNC(ga.text, ctx(pa, m, OLD)), rb = NEW.verifyNC(gb.text, ctx(pb, mb, NEW));
    assert.deepEqual(rb.errors.map(e => e.msg), ra.errors.map(e => e.msg), '검증기 오류 #' + n);
  }
  assert.ok(gen > 400 && mill > 300, 'G코드 ' + gen + ', 밀링 그룹 ' + mill);
  console.log('  V0.5→V0.6 비교 1000건, G코드 ' + gen + '건 동일 (밀링 그룹 ' + mill + '개)');
});
