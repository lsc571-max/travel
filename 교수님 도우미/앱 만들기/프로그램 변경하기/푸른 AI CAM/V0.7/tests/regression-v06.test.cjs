// 변경 전후 비교: V0.6 vs V0.7 — V0.7 은 화면 구성·디자인만 바꾼 버전이므로 가공 엔진 결과가 완전히 같아야 한다
//  ① 엔진·포스트·검증기·시뮬레이션 소스 파일이 V0.6 과 같은지 (버전 문자열 한 줄 제외)
//  ② 구멍·탭·리머·보링·포켓(단계·진입·다각·측벽 형상)·윤곽·평면·모따기 프로젝트 1,000건의 검증 결과·G코드·독립 검증 결과
// 허용하는 차이: NC 머리말의 버전 주석과 그에 따른 해시 줄
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const OLD_DIR = path.resolve(__dirname, '../../V0.6/src');
const NEW_DIR = path.resolve(__dirname, '../src');
const has = fs.existsSync(path.join(OLD_DIR, 'load-node.cjs'));
const NEW = require('../src/load-node.cjs');
const OLD = has ? require(path.join(OLD_DIR, 'load-node.cjs')) : null;
const DATE = new Date(2026, 10, 28, 9, 0);
const norm = t => t.replace(/\(PUREUN AI CAM V[\d.]+ [^)]*\)/, '(PUREUN AI CAM)').replace(/\n\(NC HASH [^)]*\)/, '');
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const pick = (R, a) => a[Math.floor(R() * a.length)];

test('V0.7 은 화면 파일만 변경: 엔진 모듈 소스가 V0.6 과 동일 (버전 문자열 제외)', { skip: !has && 'V0.6 폴더 없음' }, () => {
  const mods = JSON.parse(fs.readFileSync(path.join(NEW_DIR, 'modules.json'), 'utf8'));
  const oldMods = JSON.parse(fs.readFileSync(path.join(OLD_DIR, 'modules.json'), 'utf8'));
  assert.deepEqual(mods, oldMods, '모듈 목록');
  const core = mods.core || mods.engine || Object.values(mods)[0];
  assert.ok(Array.isArray(core) && core.length > 20, '엔진 모듈 목록');
  let n = 0;
  core.forEach(f => {
    const a = fs.readFileSync(path.join(OLD_DIR, f), 'utf8'), b = fs.readFileSync(path.join(NEW_DIR, f), 'utf8');
    assert.equal(b.replace("const VERSION = 'V0.7';", "const VERSION = 'V0.6';"), a, '엔진 파일 ' + f); n++;
  });
  console.log('  엔진 모듈 ' + n + '개 동일 (VERSION 한 줄 제외)');
});

test('V0.6 → V0.7 동일 결과: 1,000건 (리머·보링·첫 가공·재시작 블록 포함)', { skip: !has && 'V0.6 폴더 없음' }, () => {
  const R = rng(7707);
  let gen = 0, mill = 0, fine = 0;
  for (let n = 0; n < 1000; n++) {
    const m = OLD.defaultMachine(); m.helical = R() < 0.9;
    const p = OLD.newProject(m);
    Object.assign(p.stock, { sx: 100 + Math.round(R() * 150), sy: 80 + Math.round(R() * 100), sz: 15 + Math.round(R() * 25), origin: pick(R, ['LL', 'UL', 'LR', 'UR', 'C']), under: Math.round(R() * 5), material: pick(R, Object.keys(OLD.MATERIALS)) });
    Object.assign(p.settings, { retract: R() < 0.5 ? 'G98' : 'G99', seqNo: R() < 0.3, toolOrder: R() < 0.5 ? 'tool' : 'group', depthRef: R() < 0.7 ? 'auto' : 'top', firstRun: R() < 0.2, restart: R() < 0.2 });
    const r = OLD.stockRect(p.stock), cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    for (let gi = 0; gi < 1 + Math.floor(R() * 3); gi++) {
      const g = OLD.newGroup('G' + gi, gi), k = R();
      const at = [OLD.r3(cx + (R() - 0.5) * 30), OLD.r3(cy + (R() - 0.5) * 20)];
      const holes = (pre) => { for (let i = 0; i < 1 + Math.floor(R() * 5); i++) g.holes.push({ id: pre + gi + i, x: OLD.r3(r.x0 + 8 + R() * (p.stock.sx - 16)), y: OLD.r3(r.y0 + 8 + R() * (p.stock.sy - 16)) }); };
      if (k < 0.28) { g.spec = OLD.newPocketSpec({ shape: pick(R, ['rect', 'circle', 'ngon']), w: 20 + Math.round(R() * 30), h: 16 + Math.round(R() * 20), cr: Math.round(R() * 6), dia: 20 + Math.round(R() * 25), sides: 5 + Math.floor(R() * 4), depth: 2 + Math.round(R() * 8), semi: R() < 0.3, finishMode: R() < 0.5 ? 'split' : 'both', entry: pick(R, ['helix', 'ramp', 'drill']), draft: R() < 0.15 ? 5 : 0, topR: R() < 0.1 ? 1 : 0 }); g.holes.push({ id: 'p' + gi, x: at[0], y: at[1] }); mill++; }
      else if (k < 0.38) { g.spec = OLD.newMillSpec('contour', { w: p.stock.sx - 6, h: p.stock.sy - 6, cr: Math.round(R() * 5), depth: 3 + Math.round(R() * 5), sideWidth: 3 }); g.holes.push({ id: 'c' + gi, x: OLD.r3(cx), y: OLD.r3(cy) }); mill++; }
      else if (k < 0.44) { g.spec = OLD.newMillSpec('face', { depth: 0.5 }); g.holes.push({ id: 'f' + gi, x: OLD.r3(cx), y: OLD.r3(cy) }); mill++; }
      else if (k < 0.5) { g.spec = OLD.newMillSpec('chamfer', { shape: 'circle', dia: 12 + Math.round(R() * 10), side: 'in', cw: 0.5 }); g.holes.push({ id: 'h' + gi, x: at[0], y: at[1] }); mill++; }
      else if (k < 0.68) { g.spec = OLD.newHoleSpec('drill', { dia: pick(R, [3.3, 5, 6.6, 6.8, 8.5, 9]), depth: 3 + Math.round(R() * 15), thru: R() < 0.2 }); holes('d'); }
      else if (k < 0.78) { g.spec = OLD.newHoleSpec('ream', { dia: pick(R, [6, 8, 10]), depth: 5 + Math.round(R() * 8) }); holes('r'); fine++; }
      else if (k < 0.86) { g.spec = OLD.newHoleSpec('bore', { dia: pick(R, [20, 25]), depth: 5 + Math.round(R() * 8) }); g.holes.push({ id: 'b' + gi, x: at[0], y: at[1] }); fine++; }
      else { g.spec = OLD.newHoleSpec('tap', { tapD: pick(R, [4, 5, 6, 8, 10]), tapDepth: 5 + Math.round(R() * 10) }); holes('t'); }
      OLD.applyHoleSpec(g, m, p.stock);
      g.ops.forEach((o, i) => { o.id = 'o' + gi + i; });
      p.groups.push(g);
    }
    const pa = JSON.parse(JSON.stringify(p)), pb = NEW.normalizeProject(JSON.parse(JSON.stringify(p)));
    const mb = NEW.normalizeMachine(JSON.parse(JSON.stringify(m)));
    pb.groups.forEach(g => { if (g.spec) NEW.applyHoleSpec(g, mb, pb.stock); });
    const opsOf = q => JSON.parse(JSON.stringify(q.groups.map(g => g.ops.map(o => Object.assign({}, o, { id: 0 }))))); // JSON 으로 맞춰 비교 (undefined 칸 제외)
    assert.deepEqual(opsOf(pb), opsOf(pa), '자동 구성 공정 #' + n);
    const va = OLD.validateProject(pa, m), vb = NEW.validateProject(pb, mb);
    const key = v => v.issues.map(i => i.level + '|' + i.cat + '|' + i.msg.replace(/V0\.\d/g, 'V')).sort();
    assert.deepEqual(key(vb), key(va), '검증 결과 #' + n);
    const ga = OLD.generateNC(pa, m, va.plan, { date: DATE }), gb = NEW.generateNC(pb, mb, vb.plan, { date: DATE });
    assert.equal(!!gb.blocked, !!ga.blocked, '차단 여부 #' + n);
    if (!ga.text) continue;
    gen++;
    assert.equal(norm(gb.text), norm(ga.text), 'G코드 #' + n);
    const ctx = (q, mm, C) => ({ stock: q.stock, machine: mm, clamps: q.clamps, settings: q.settings, pockets: C.pocketRegions(q, mm), expected: null });
    const ra = OLD.verifyNC(ga.text, ctx(pa, m, OLD)), rb = NEW.verifyNC(gb.text, ctx(pb, mb, NEW));
    assert.deepEqual(rb.errors.map(e => e.msg), ra.errors.map(e => e.msg), '검증기 오류 #' + n);
    assert.deepEqual(rb.warnings.map(e => e.msg), ra.warnings.map(e => e.msg), '검증기 경고 #' + n);
  }
  assert.ok(gen > 300 && mill > 300 && fine > 100, 'G코드 ' + gen + ', 밀링 ' + mill + ', 리머·보링 ' + fine);
  console.log('  V0.6→V0.7 비교 1000건, G코드 ' + gen + '건 동일 (밀링 그룹 ' + mill + '개, 리머·보링 그룹 ' + fine + '개)');
});
