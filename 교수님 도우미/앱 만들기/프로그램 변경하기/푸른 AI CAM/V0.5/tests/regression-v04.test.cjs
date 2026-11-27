// 변경 전후 비교: V0.4 vs V0.5 — 구멍·탭·사각/원형 포켓 프로젝트 1,000건
// 검증 결과·G코드·독립 검증 결과가 같은지 확인 (V0.5 는 기존 가공을 바꾸지 않고 새 가공만 추가)
// 허용하는 차이: NC 버전 주석, 포켓 깊이 ≥ 두께 오류의 안내 문구(관통 기능 안내), 소재 바닥 초과 안내 문구,
//   독립 검증기의 날 길이 판정을 '이미 깎인 면' 기준으로 (포켓 안 구멍만, 오류가 줄어드는 방향만 허용)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const V04 = path.resolve(__dirname, '../../V0.4/src/load-node.cjs');
const has = fs.existsSync(V04);
const NEW = require('../src/load-node.cjs');
const OLD = has ? require(V04) : null;
const DATE = new Date(2026, 10, 27, 9, 0);
const norm = t => t.replace(/\(PUREUN AI CAM V[\d.]+ [^)]*\)/, '(PUREUN AI CAM)');
const fixMsg = m => m.replace(/ \(관통 포켓은 지원하지 않음\)\.$/, '.').replace(/\. 끝까지 뚫으려면 \[관통\]을 체크하세요\.$/, '.').replace(/테이블\/지그 충돌 위험 → .*$/, '테이블/지그 충돌 위험 →');
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

test('V0.4 → V0.5 동일 결과 (구멍·탭·포켓): 1,000건', { skip: !has && 'V0.4 폴더 없음' }, () => {
  const R = rng(5505);
  let gen = 0, pk = 0, relaxed = 0;
  for (let n = 0; n < 1000; n++) {
    const m = OLD.defaultMachine(); m.rigidM03 = R() < 0.3; m.helical = R() < 0.9;
    const p = OLD.newProject(m);
    Object.assign(p.stock, { sx: 80 + Math.round(R() * 200), sy: 60 + Math.round(R() * 150), sz: 10 + Math.round(R() * 35), origin: ['LL', 'UL', 'LR', 'UR', 'C'][Math.floor(R() * 5)], under: Math.round(R() * 6), material: Object.keys(OLD.MATERIALS)[Math.floor(R() * 7)] });
    Object.assign(p.settings, { retract: R() < 0.5 ? 'G98' : 'G99', seqNo: R() < 0.3, toolOrder: R() < 0.5 ? 'tool' : 'group', pathOrder: ['nearest', 'zigzag', 'input'][Math.floor(R() * 3)] });
    const r = OLD.stockRect(p.stock);
    for (let gi = 0; gi < 1 + Math.floor(R() * 3); gi++) {
      const g = OLD.newGroup('G' + gi, gi), kind = R();
      const nh = kind < 0.35 ? 1 + Math.floor(R() * 2) : 1 + Math.floor(R() * 8);
      for (let k = 0; k < nh; k++) g.holes.push({ id: gi + '_' + k, x: OLD.r3(r.x0 + 25 + R() * Math.max(1, p.stock.sx - 50)), y: OLD.r3(r.y0 + 25 + R() * Math.max(1, p.stock.sy - 50)) });
      if (kind < 0.35) { g.spec = OLD.newPocketSpec({ shape: R() < 0.5 ? 'rect' : 'circle', w: 10 + Math.round(R() * 30), h: 8 + Math.round(R() * 25), cr: Math.round(R() * 6), dia: 8 + Math.round(R() * 30), depth: 1 + Math.round(R() * 12), finish: R() < 0.7, stepover: 30 + Math.round(R() * 45) }); pk++; }
      else if (kind < 0.7) g.spec = OLD.newHoleSpec('drill', { dia: [3.3, 5, 6.6, 6.8, 8.5, 9][Math.floor(R() * 6)], depth: 3 + Math.round(R() * 30), thru: R() < 0.3 });
      else g.spec = OLD.newHoleSpec('tap', { tapD: [4, 5, 6, 8, 10][Math.floor(R() * 5)], tapDepth: 5 + Math.round(R() * 15) });
      OLD.applyHoleSpec(g, m, p.stock);
      g.ops.forEach((o, i) => { o.id = 'o' + gi + i; });
      p.groups.push(g);
    }
    if (R() < 0.3) p.clamps.push({ id: 'c', x: r.x0 - 15, y: r.y0 + 5, w: 12, h: 20, height: 10 + Math.round(R() * 50) });
    const pa = JSON.parse(JSON.stringify(p)), pb = NEW.normalizeProject(JSON.parse(JSON.stringify(p)));
    const mb = NEW.normalizeMachine(JSON.parse(JSON.stringify(m)));
    pb.groups.forEach(g => { if (g.spec) NEW.applyHoleSpec(g, mb, pb.stock); });
    const va = OLD.validateProject(pa, m), vb = NEW.validateProject(pb, mb);
    const key = v => v.issues.filter(i => i.level !== 'info').map(i => i.level + '|' + i.cat + '|' + fixMsg(i.msg)).sort();
    assert.deepEqual(key(vb), key(va), '검증 결과 #' + n);
    const ga = OLD.generateNC(pa, m, va.plan, { date: DATE }), gb = NEW.generateNC(pb, mb, vb.plan, { date: DATE });
    assert.equal(!!gb.blocked, !!ga.blocked, '차단 여부 #' + n);
    if (!ga.text) continue;
    gen++;
    assert.equal(norm(gb.text), norm(ga.text), 'G코드 #' + n);
    const ctx = (q, mm, C) => ({ stock: q.stock, machine: mm, clamps: q.clamps, settings: q.settings, pockets: C.pocketRegions(q, mm), expected: null });
    const ra = OLD.verifyNC(ga.text, ctx(pa, m, OLD)), rb = NEW.verifyNC(gb.text, ctx(pb, mb, NEW));
    // [V0.5 의도한 변경] 날 길이 검사는 '이미 깎인 면'(포켓 바닥 등)부터 잰다 → 포켓 안 구멍의 날 길이 오류만 줄어들 수 있음 (늘어나면 안 됨)
    const flute = e => /유효 날 길이|날 길이 .* 를 넘습니다/.test(e.msg), nm = e => e.msg.replace('포켓 영역 밖', '가공 영역(포켓·윤곽·평면·모따기) 밖');
    assert.deepEqual(rb.errors.filter(e => !flute(e)).map(nm), ra.errors.filter(e => !flute(e)).map(nm), '검증기 오류 #' + n);
    assert.ok(rb.errors.filter(flute).length <= ra.errors.filter(flute).length, '날 길이 검사 강화·변경 금지 #' + n);
    if (ra.errors.filter(flute).length !== rb.errors.filter(flute).length) relaxed++;
  }
  assert.ok(gen > 300 && pk > 200, 'G코드 ' + gen + ', 포켓 그룹 ' + pk);
  console.log('  V0.4→V0.5 비교 1000건, G코드 ' + gen + '건 동일 (포켓 그룹 ' + pk + '개 포함), 포켓 바닥 기준 날 길이 판정 ' + relaxed + '건');
});
