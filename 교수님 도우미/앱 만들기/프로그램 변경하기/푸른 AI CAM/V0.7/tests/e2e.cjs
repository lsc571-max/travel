// 푸른 AI CAM 브라우저 통합 테스트 (Playwright, Chromium)
// 실행: node tests/e2e.cjs [스크린샷 폴더]
//  - 선택: 환경변수 JSQR=jsqr 모듈 경로 → QR코드 실제 판독 검사
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'pureun-ai-cam.html');
const SHOT = process.argv[2] || null;
const results = [];
function ok(name, cond, detail) { results.push({ name, ok: !!cond, detail: cond ? '' : (detail || '') }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' :: ' + (detail || ''))); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
// [V0.7] 모두 펼쳐 보기 (접힌 줄·⋯ 안의 버튼을 처음부터 표시) — 기존 기능 검사용
const dense = async pg => { await pg.waitForFunction(() => !!window.__PCAM_UI__); await pg.evaluate(() => window.__PCAM_UI__.setDense(true)); };

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(ROOT, u === '/' ? 'pureun-ai-cam.html' : u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': f.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8' });
      fs.createReadStream(f).pipe(rsp);
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }); // 3D(WebGL) 시험용 소프트웨어 렌더링
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const consoleErr = [];
  page.on('console', m => { if (m.type() === 'error') consoleErr.push(m.text()); });
  page.on('pageerror', e => consoleErr.push('pageerror: ' + e.message));
  page.on('dialog', d => { page.__lastDialog = d.message(); if (d.type() === 'prompt') d.accept(page.__promptAnswer || ''); else d.accept(); });
  const openCode = async (pg) => { pg = pg || page; if (!(await pg.locator('#ncText').count())) await pg.click('#status button:has-text("G코드")'); await sleep(120); };
  const openCheck = async (pg) => { pg = pg || page; if (!(await pg.locator('#bottomBody .todo').count())) await pg.click('#status button:has-text("검증 결과")'); await sleep(120); };
  // [V0.4] NC 저장 대화상자: 점검 항목을 모두 체크해야 저장
  const confirmSave = async (pg, opt) => {
    pg = pg || page; await pg.waitForSelector('#dlg[open] #ncFileName');
    const txt = await pg.textContent('#dlg');
    if (opt && opt.rename) { await pg.fill('#ncFileName', opt.rename); }
    if (opt && opt.skipChecks) { await pg.click('#dlg .dfoot button.primary'); return txt; }
    for (const c of await pg.locator('#dlg .ncChk').all()) await c.check();
    await pg.click('#dlg .dfoot button.primary'); return txt;
  };
  const st = () => page.evaluate(() => { const U = window.__PCAM_UI__; return { holes: U.P.groups.map(g => g.holes.length), ds: U.downloadState(), edited: U.S.nc.edited, errs: U.S.V.issues.filter(i => i.level === 'error').length }; });

  // 1. 로드
  await page.goto('file://' + HTML);
  await dense(page); // [V0.7] 기존 기능 검사는 '모두 펼쳐 보기'로 (접힌 기본 화면은 맨 아래 V0.7 검사에서 따로 확인)
  await page.waitForSelector('#cv');
  await sleep(500);
  ok('로컬 파일(file://) 실행, 콘솔 오류 없음', consoleErr.length === 0, consoleErr.join(' | '));
  const VER = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).version;
  ok('버전 ' + VER + ' 작은 글씨 표시', (await page.textContent('#verTag')) === VER);
  let s = await st();
  ok('예제 프로젝트 로드 (홀 6+4)', JSON.stringify(s.holes) === '[6,4]', JSON.stringify(s.holes));
  ok('예제: 오류 0, 다운로드 가능(검증용)', s.errs === 0 && s.ds.ok && s.ds.test, JSON.stringify(s));
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'e2e-1-desktop.png') });

  // 2. 개별 홀 추가 (폼)
  await page.click('#rightBody button:has-text("개별")');
  const sx = page.locator('#rightBody .subtabs + div input').nth(0), sy = page.locator('#rightBody .subtabs + div input').nth(1);
  await sx.fill('130'); await sx.press('Tab'); await sleep(50);
  await sy.fill('50'); await sy.press('Tab'); await sleep(50);
  await page.click('#rightBody button:has-text("위치 추가")');
  await sleep(150);
  s = await st();
  ok('좌표 직접 입력으로 홀 추가', s.holes[0] === 7, JSON.stringify(s.holes));
  // 3. 되돌리기
  await page.click('#btnUndo'); await sleep(100);
  s = await st(); ok('되돌리기(Undo)', s.holes[0] === 6);
  await page.click('#btnRedo'); await sleep(100);
  s = await st(); ok('다시 하기(Redo)', s.holes[0] === 7);

  // 4. 캔버스 클릭으로 홀 추가 (스냅)
  await page.click('#vtools button:has-text("위치 추가")');
  const box = await page.locator('#cv').boundingBox();
  const target = await page.evaluate(() => { const U = window.__PCAM_UI__; return { cx: U.S.view.cx, cy: U.S.view.cy, sc: U.S.view.scale }; });
  // 월드 (100.2, 30.1) 위치 클릭 → 5mm 스냅 → (100, 30)
  const px = box.x + box.width / 2 + (100.2 - target.cx) * target.sc, py = box.y + box.height / 2 - (30.1 - target.cy) * target.sc;
  await page.mouse.click(px, py); await sleep(150);
  const last = await page.evaluate(() => { const g = window.__PCAM_UI__.P.groups[0]; return g.holes[g.holes.length - 1]; });
  ok('마우스 클릭 홀 추가 + 5mm 스냅', last.x === 100 && last.y === 30, JSON.stringify(last));
  await page.click('#vtools button:has-text("선택")');

  // 5. 소재 이탈 → 생성 차단
  const lastRowX = page.locator('#rightBody table.tbl tr').last().locator('input').first();
  await lastRowX.fill('149'); await lastRowX.press('Enter'); await page.locator('#projName').click(); await sleep(150);
  s = await st();
  ok('소재 이탈 홀 → 오류로 NC 차단', !s.ds.ok && s.errs > 0, JSON.stringify(s));
  await openCheck();
  ok('차단 배너 표시 (검증 결과 서랍)', await page.locator('.banner.err').count() === 1);
  ok('상태 표시줄에 오류·NC 차단 표시', /NC 차단/.test(await page.textContent('#status')));
  let dl = null; const dlp = page.waitForEvent('download', { timeout: 1500 }).then(d => { dl = d; }).catch(() => { });
  await page.click('#btnDownload', { force: true }); await dlp;
  ok('차단 상태에서 다운로드 버튼 → 파일 생성 안 됨', dl === null);
  await page.click('#btnUndo'); await sleep(150);
  s = await st(); ok('수정 후 차단 해제', s.ds.ok, JSON.stringify(s.ds));

  // 6. NC 다운로드 (검증용 파일명·CRLF·내용)
  await page.click('#btnDownload');
  let dlNone = null; const wNone = page.waitForEvent('download', { timeout: 800 }).then(d => { dlNone = d; }).catch(() => { });
  const saveTxt = await confirmSave(page, { skipChecks: true }); await wNone;
  ok('[V0.4] 점검 항목 미확인 시 저장 안 됨', dlNone === null && (await page.locator('#dlg[open]').count()) === 1);
  const dl2 = page.waitForEvent('download');
  for (const c of await page.locator('#dlg .ncChk').all()) await c.check();
  await page.click('#dlg .dfoot button.primary');
  const d2 = await dl2;
  const fn = d2.suggestedFilename(); const fp = await d2.path(); const txt = fs.readFileSync(fp, 'utf8');
  ok('NC 다운로드 파일명 TEST_O0001_*.nc', /^TEST_O0001_.*\.nc$/.test(fn), fn);
  ok('NC 내용: CRLF·%·O0001·M30·TEST ONLY', txt.includes('\r\n') && txt.startsWith('%\r\nO0001') && txt.includes('M30\r\n%') && txt.includes('TEST ONLY'));
  ok('저장 전 안전 점검 대화상자 (드라이런·TEST 안내)', /드라이런/.test(saveTxt) && /검증용\(TEST\)/.test(saveTxt));

  // 7. G코드 직접 수정 → 재검증 전 차단 → 재검증 통과 → 결함 수정본 차단
  await openCode();
  await page.click('#bottomBody button:has-text("직접 수정")'); await sleep(100);
  s = await st(); ok('직접 수정 시 기존 검증 무효화(다운로드 차단)', s.edited && !s.ds.ok, JSON.stringify(s.ds));
  await page.click('#bottomBody button:has-text("재검증")'); await sleep(150);
  s = await st(); ok('수정본(변경 없음) 재검증 통과 → 다운로드 가능', s.ds.ok, JSON.stringify(s.ds));
  const ta = page.locator('#ncText');
  const val = await ta.inputValue();
  const bad = val.replace(/(G98 G8[1-4][^\n]* Z-\d+)\.\d*/, '$1'); if (bad === val) throw new Error('소수점 제거 실패');
  await ta.fill(bad);
  s = await st(); ok('텍스트 수정 즉시 재검증 필요 상태', !s.ds.ok);
  await page.click('#bottomBody button:has-text("재검증")'); await sleep(150);
  s = await st(); ok('소수점 누락 수정본 → 재검증 오류로 차단', !s.ds.ok && /오류/.test(s.ds.why), JSON.stringify(s.ds));
  await ta.fill(val.replace('M30', 'M30\n'));
  await page.click('#bottomBody button:has-text("재검증")'); await sleep(150);
  const dl3 = page.waitForEvent('download'); await page.click('#bottomBody button:has-text("NC 저장")'); await page.waitForSelector('#dlg[open] #ncFileName'); const defName = await page.inputValue('#ncFileName'); await confirmSave(page, { rename: 'MYPART' }); const d3 = await dl3;
  ok('[V0.4] 파일 이름 변경해도 TEST_ 접두·확장자 유지', d3.suggestedFilename() === 'TEST_MYPART.nc', d3.suggestedFilename());
  const t3 = fs.readFileSync(await d3.path(), 'utf8');
  ok('수정본 저장: USER EDITED 표시, 기본 파일명 _EDIT', t3.includes('(USER EDITED') && /^TEST_O0001_.*_EDIT\.nc$/.test(defName), defName);
  await page.click('#bottomBody button:has-text("다시 생성")'); await sleep(100);
  s = await st(); ok('다시 생성 → 수정 상태 해제', !s.edited && s.ds.ok);
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'e2e-2-code.png') });

  // 8. [V0.3] 탭 그룹 간편 입력: 나사 규격·깊이만 입력 → 공정 자동 구성
  await page.click('#bottomTabs #drawerClose'); await sleep(100);
  await page.click('#tree .addbtn.k-tap'); await sleep(150);
  await page.locator('#rightBody .wiz select').first().selectOption('8|1.25'); await sleep(150);
  const tdep = page.locator('#rightBody .wiz input[type=number]').first();
  await tdep.fill('15'); await tdep.press('Tab'); await sleep(150);
  const ops = await page.evaluate(() => window.__PCAM_UI__.P.groups[2].ops.map(o => o.type + ':' + o.toolNo + ':' + o.depth).join(','));
  ok('[V0.3] 탭 간편 입력 M8 깊이 15 → 센터·Ø6.8 드릴 19·리지드 탭 15', /^center:1:[\d.]+,drill:5:19,rigid:14:15$/.test(ops), ops);
  ok('[V0.3] 자동 구성 공정 이름 표시', (await page.textContent('#rightBody .gen')).includes('T14 M8×1.25 리지드 탭'));
  await page.click('#rightBody button:has-text("PCD")');
  const pin = page.locator('#rightBody .subtabs + div input');
  const vals = ['75', '50', '70', '6', '0'];
  for (let i = 0; i < 5; i++) { await pin.nth(i).fill(vals[i]); await pin.nth(i).press('Tab'); await sleep(30); }
  await page.click('#rightBody button:has-text("위치 추가")'); await sleep(150);
  s = await st(); ok('PCD 6개 추가', s.holes[2] === 6, JSON.stringify(s.holes));
  // 두께 20 → M8 드릴 21 은 바닥 관통 → 차단 / 두께 30 → 통과
  ok('두께 부족 시 M8 묶음 차단(하부 여유 0)', !s.ds.ok);
  await page.click('#tree .titem >> nth=0'); await sleep(100);
  const thick = page.locator('#rightBody .grid3 input').nth(2);
  await thick.fill('30'); await thick.press('Tab'); await sleep(150);
  s = await st(); ok('두께 30 으로 변경 시 통과', s.ds.ok, JSON.stringify(s.ds));

  // 8-2. [V0.3] 직접 구성 + 공정 묶음 적용 (기존 기능 유지 확인) 후 탭 간편 입력으로 복귀
  await page.click('#tree .titem >> nth=4'); await sleep(100);
  await page.click('#rightBody .kindgrid button:has-text("직접")'); await sleep(150);
  await page.locator('#rightBody select').first().selectOption({ label: 'M8 탭 (깊이 15)' });
  await page.click('#rightBody button:text-is("적용")'); await sleep(150);
  const ops2 = await page.evaluate(() => window.__PCAM_UI__.P.groups[2].ops.map(o => o.type + ':' + o.toolNo).join(','));
  ok('직접 구성: 공정 묶음 적용 유지 (M8: 스팟→심공→리지드탭)', ops2 === 'center:1,deep:5,rigid:14', ops2);
  await page.click('#rightBody .kindgrid button:has-text("탭")'); await sleep(150);
  await page.locator('#rightBody .wiz select').first().selectOption('8|1.25');
  const tdep2 = page.locator('#rightBody .wiz input[type=number]').first(); await tdep2.fill('15'); await tdep2.press('Tab'); await sleep(150);
  // 9. 클램프 그리기 → 홀과 겹치면 차단
  await page.click('#vtools button:has-text("클램프")');
  const box2 = await page.locator('#cv').boundingBox();
  const v2 = await page.evaluate(() => { const U = window.__PCAM_UI__; return { cx: U.S.view.cx, cy: U.S.view.cy, sc: U.S.view.scale }; });
  const W = (x, y) => [box2.x + box2.width / 2 + (x - v2.cx) * v2.sc, box2.y + box2.height / 2 - (y - v2.cy) * v2.sc];
  let [a1, b1] = W(15, 15), [a2, b2] = W(25, 25);
  await page.mouse.move(a1, b1); await page.mouse.down(); await page.mouse.move(a2, b2, { steps: 5 }); await page.mouse.up(); await sleep(150);
  s = await st();
  const ncl = await page.evaluate(() => window.__PCAM_UI__.P.clamps.length);
  ok('드래그로 클램프 추가 → 홀과 겹쳐 차단', ncl === 1 && !s.ds.ok, ncl + ' ' + JSON.stringify(s.ds));
  await page.click('#btnUndo'); await sleep(100);
  await page.click('#vtools button:has-text("선택")');

  // 10. 설정: 1회 클릭 → 일반 설정, 관리자 정보 숨김
  await page.click('#btnSettings'); await sleep(100);
  const dlgTxt = await page.textContent('#dlg');
  ok('설정 버튼 1회 → 일반 설정창', (await page.locator('#dlg[open]').count()) === 1 && dlgTxt.includes('테마'));
  ok('일반 설정에 관리자·비밀번호 항목 없음', !/비밀번호|검증 승인/.test(dlgTxt));
  // 4회 + 3.1초 대기 + 1회 → 열리지 않음
  for (let i = 0; i < 4; i++) await page.click('#gsGear');
  await sleep(3100); await page.click('#gsGear'); await sleep(100);
  ok('3초 초과 시 횟수 초기화 (관리자 창 안 열림)', (await page.locator('#dlg2[open]').count()) === 0);
  await sleep(3100); // 위 1회 클릭이 새 3초 구간을 시작했으므로 대기
  for (let i = 0; i < 5; i++) await page.click('#gsGear');
  await sleep(150);
  ok('3초 내 5회 → 관리자 비밀번호 등록 창', (await page.locator('#dlg2[open]').count()) === 1 && (await page.textContent('#dlg2')).includes('비밀번호 등록'));
  await page.fill('#apw1', 'short'); await page.fill('#apw2', 'short'); await page.click('#dlg2 .dfoot button'); await sleep(100);
  ok('약한 비밀번호 거부', (await page.textContent('#dlg2')).includes('비밀번호 등록'));
  await page.fill('#apw1', 'Pureun2026'); await page.fill('#apw2', 'Pureun2026'); await page.click('#dlg2 .dfoot button'); await sleep(800);
  ok('등록 후 관리자 설정 표시', (await page.textContent('#dlg2')).includes('관리자 모드'));
  const rec = await page.evaluate(() => localStorage.getItem('pcam.admin.v1'));
  ok('비밀번호 원문 미저장 (PBKDF2 해시)', rec && !rec.includes('Pureun2026') && rec.includes('"iter":150000'));
  // 승인: 체크 없이 → 거부, 체크 후 승인
  // [V0.6] 승인은 가공 종류 × 버전: 이 프로젝트 가공 종류가 미리 체크됨
  await page.locator('#dlg2 button:has-text("선택한 가공 승인")').first().click(); await sleep(100);
  ok('실장비 시험 체크 없이 승인 불가', (await page.evaluate(() => window.__PCAM_UI__.DB.machines[0].approvals.length)) === 0);
  for (const k of [1, 2, 3]) await page.locator('#dlg2 input[id^="vc' + k + '"]').first().check();
  await page.locator('#dlg2 input[id^="vby"]').first().fill('홍길동');
  await page.locator('#dlg2 input[id^="vno"]').first().fill('시편 측정 OK');
  await page.locator('#dlg2 button:has-text("선택한 가공 승인")').first().click(); await sleep(150);
  s = await st();
  const ap = await page.evaluate(() => { const m = window.__PCAM_UI__.DB.machines[0]; return { n: m.approvals.length, ver: m.approvals[0] && m.approvals[0].ver, hist: m.history.length }; });
  ok('[V0.6] 관리자 승인(이 프로젝트 가공 종류·현재 버전) 후 TEST 표시 해제 · 이력 남김', ap.n === 1 && ap.hist >= 1 && s.ds.ok && !s.ds.test, JSON.stringify([ap, s.ds]));
  // 관리자 창 닫기 → 재진입 시 비밀번호 필요
  await page.click('#dlg2 .dhead button[aria-label="닫기"]'); await sleep(100);
  for (let i = 0; i < 5; i++) await page.click('#gsGear');
  await sleep(150);
  ok('관리자 종료 후 재진입 시 재인증 요구', (await page.textContent('#dlg2')).includes('관리자 인증'));
  for (let i = 1; i <= 5; i++) { await page.fill('#apw', 'wrong' + i); await page.click('#dlg2 .dfoot button'); await sleep(450); }
  ok('5회 실패 → 잠금', (await page.textContent('#dlg2')).includes('잠겨'));
  await page.fill('#apw', 'Pureun2026'); await page.click('#dlg2 .dfoot button'); await sleep(500);
  ok('잠금 중에는 올바른 비밀번호도 거부', !(await page.textContent('#dlg2')).includes('관리자 모드'));
  await page.click('#dlg2 .dhead button[aria-label="닫기"]');
  // 장비 설정 변경 시 승인 자동 해제
  await page.click('#dlg .dhead button[aria-label="닫기"]');
  await page.click('#btnTools'); await sleep(150);
  const mr = page.locator('#dlg .grid3 input').nth(3);
  await mr.fill('9000'); await mr.press('Tab'); await sleep(150);
  ok('[V0.4] 장비·공구 창: 평 엔드밀 공구 목록', (await page.textContent('#dlg')).includes('엔드밀'));
  ok('장비 설정 변경 시 실가공 승인 자동 해제', !(await page.evaluate(() => window.__PCAM_UI__.DB.machines[0].verified)));
  ok('[V0.4] 장비·공구 창은 변경 후에도 열린 상태 유지', (await page.locator('#dlg[open]').count()) === 1);
  await page.click('#dlg .dhead button[aria-label="닫기"]');

  // 11. 다크 테마·글자 크기
  await page.click('#btnSettings'); await sleep(100);
  await page.locator('#dlg select').first().selectOption('dark'); await sleep(100);
  ok('다크 테마 적용', (await page.getAttribute('html', 'data-theme')) === 'dark');
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'e2e-3-dark-settings.png') });
  await page.locator('#dlg select').first().selectOption('light');
  // 로컬 파일 공유 안내
  await page.click('#dlg button:has-text("공유 링크")'); await sleep(100);
  ok('로컬 파일 실행 시 공유 제한 안내', (await page.textContent('#dlg2')).includes('로컬 파일'));
  await page.click('#dlg2 .dhead button[aria-label="닫기"]');
  // 전체 백업
  const dlb = page.waitForEvent('download'); await page.click('#dlg button:has-text("전체 백업")'); const db = await dlb;
  const bak = fs.readFileSync(await db.path(), 'utf8');
  ok('전체 백업 JSON (관리자 해시 제외)', bak.includes('"pcam-backup"') && !bak.includes('pcam.admin') && !bak.includes('"salt"') && !bak.includes('"iter"') /* [V0.6] NC 해시(승인·기록)는 남고 관리자 비밀번호 해시·솔트는 없어야 함 */);
  await page.click('#dlg .dhead button[aria-label="닫기"]');

  // 12. 새로 고침 후 데이터 유지
  const before = await st();
  await page.reload(); await page.waitForSelector('#cv'); await sleep(400);
  const after = await st();
  ok('새로 고침 후 로컬 저장 데이터 유지', JSON.stringify(before.holes) === JSON.stringify(after.holes), JSON.stringify([before.holes, after.holes]));

  // 13. 백업 복원 (파일 선택)
  await page.click('#btnSettings');
  const fc = page.waitForEvent('filechooser'); await page.click('#dlg button:has-text("백업 복원")'); const ch = await fc;
  const dlAuto = page.waitForEvent('download');
  await ch.setFiles(await db.path()); await dlAuto; await sleep(300);
  ok('백업 복원 성공 (복원 전 자동 백업 포함)', (await st()).holes.length === 3);
  ok('복원 시 장비 실가공 승인 해제', !(await page.evaluate(() => window.__PCAM_UI__.DB.machines.some(m => m.verified))));

  ok('전체 과정 콘솔 오류 없음', consoleErr.length === 0, consoleErr.join(' | '));

  // 14-0. V0.2 안전 수정 (새 브라우저 컨텍스트 = 새 저장소)
  {
    const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const p2 = await c2.newPage(); const e2 = [];
    p2.on('pageerror', e => e2.push(e.message)); p2.on('dialog', d => d.accept());
    await p2.goto('file://' + HTML); await sleep(400);
    await dense(p2); // [V0.7] 기존 기능 검사는 '모두 펼쳐 보기'로 (접힌 기본 화면은 맨 아래 V0.7 검사에서 따로 확인)
    const st2 = () => p2.evaluate(() => window.__PCAM_UI__.downloadState());
    // 개발 예정 가공: 공정 추가 목록에 표시되지만 선택 불가
    const planned = await p2.$$eval('#rightBody select option', os => os.filter(o => /개발 예정/.test(o.textContent)).map(o => o.disabled));
    ok('개발 예정 가공 2종(나사 밀링·각인) 표시·선택 불가', planned.length === 2 && planned.every(Boolean), JSON.stringify(planned));
    // [검증 2] 재검증한 수정본 → 소재 축소 → 다운로드 다시 차단
    await openCode(p2);
    await p2.click('#bottomBody button:has-text("직접 수정")'); await sleep(100);
    const ta2 = p2.locator('#ncText'); const v0 = await ta2.inputValue();
    await ta2.fill(v0.replace(/(G81[^\n]*\n)/, '$1X140. Y50.\n'));
    await p2.click('#bottomBody button:has-text("재검증")'); await sleep(150);
    ok('수정본(X140) 재검증 통과', (await st2()).ok, JSON.stringify(await st2()));
    await p2.click('#tree .titem >> nth=0'); await sleep(100);
    const sx = p2.locator('#rightBody .grid3 input').nth(0); await sx.fill('136'); await sx.press('Tab'); await sleep(200);
    const s3 = await st2();
    ok('[검증 2] 소재 변경 후 수정본 자동 재검사 → 차단', !s3.ok && /수정한 G코드 검증 오류/.test(s3.why), JSON.stringify(s3));
    let dlx = null; const w = p2.waitForEvent('download', { timeout: 1200 }).then(d => { dlx = d; }).catch(() => { });
    await p2.click('#btnDownload', { force: true }); await w;
    ok('[검증 2] 차단된 수정본 다운로드 안 됨', dlx === null);
    // [검증 9] 차단 상태에서 복사 거부
    await p2.evaluate(() => { window.__copied = null; navigator.clipboard && (navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }); document.execCommand = () => { window.__copied = 'exec'; return true; }; });
    await openCode(p2);
    await p2.click('#bottomBody button:has-text("복사")', { force: true }); await sleep(150);
    ok('[검증 9] 차단 상태 G코드 복사 거부', (await p2.evaluate(() => window.__copied)) === null);
    // [V0.3 검증 1] 되돌리기 후 간편 입력 공정을 현재 장비 기준으로 다시 구성 (오래된 공구로 출력 금지)
    await p2.click('#bottomBody button:has-text("다시 생성")'); await sleep(100);
    await p2.click('#mnav button[data-m=right]').catch(() => { });
    await p2.click('#tree .addbtn.k-drill'); await sleep(150);
    const dep = p2.locator('#rightBody .wiz input[type=number]').nth(1); await dep.fill('12'); await dep.press('Tab'); await sleep(150);
    await p2.evaluate(() => { const U = window.__PCAM_UI__, m = U.DB.machines[0]; m.tools.find(t => t.no === 7).dia = 9; m.tools.find(t => t.no === 8).dia = 6.6; });
    await p2.click('#btnUndo'); await sleep(200);
    const st3 = await p2.evaluate(() => { const U = window.__PCAM_UI__, g = U.P.groups[U.P.groups.length - 1]; return { ops: g.ops.map(o => o.toolNo), ds: U.downloadState(), errs: U.S.V.issues.filter(i => i.level === 'error').length }; });
    ok('[V0.3] 되돌리기 후 간편 입력 공정 재구성 (Ø6.6 = T08)', st3.ops[1] === 8 && st3.errs === 0, JSON.stringify(st3));
    ok('V0.2 안전 수정 화면 오류 없음', e2.length === 0, e2.join('|'));
    await c2.close();
  }

  // 14-1. [V0.4] 포켓 가공 · 3D 시뮬레이션 · 깊이 단면도 · 작업지시서
  {
    const c3 = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const p3 = await c3.newPage(); const e3 = [];
    p3.on('pageerror', e => e3.push(e.message)); p3.on('console', m => { if (m.type() === 'error') e3.push(m.text()); }); p3.on('dialog', d => d.accept());
    await p3.goto('file://' + HTML); await sleep(400);
    await dense(p3); // [V0.7] 기존 기능 검사는 '모두 펼쳐 보기'로 (접힌 기본 화면은 맨 아래 V0.7 검사에서 따로 확인)
    await p3.click('#btnProjects'); await p3.click('#dlg button:has-text("새 프로젝트")'); await sleep(200);
    ok('[V0.4] 새 프로젝트: 소재가 먼저 선택되고 가공 추가 안내', (await p3.textContent('#propHead')).includes('소재') && (await p3.textContent('#tree')).includes('가공을 추가'));
    await p3.click('#tree .addbtn.k-pocket'); await sleep(200);
    const pk = await p3.evaluate(() => { const U = window.__PCAM_UI__, g = U.P.groups[0]; return { ops: g.ops.map(o => o.type + ':' + o.toolNo).join(','), holes: g.holes.length, ds: U.downloadState(), match: U.S.nc.verify && U.S.nc.verify.match, nerr: U.S.nc.verify ? U.S.nc.verify.errors.length : -1 }; });
    ok('[V0.4] + 포켓 → 소재 중앙 1개, 황삭·바닥 정삭·측벽 정삭(T16 Ø10) 자동 구성', pk.ops === 'pocketRough:16,pocketFloor:16,pocketWall:16' && pk.holes === 1, JSON.stringify(pk));
    ok('[V0.4] 포켓 NC 독립 검증 오류 0 · 생성기 경로와 일치', pk.ds.ok && pk.nerr === 0 && pk.match === true, JSON.stringify(pk));
    ok('[V0.4] 깊이 단면도 표시 (초기점·R점·Z0·바닥 Z)', /초기점 Z50/.test(await p3.textContent('#rightBody .depth')) && /바닥 Z-5/.test(await p3.textContent('#rightBody .depth')));
    await openCode(p3);
    const code = await p3.locator('#ncText').inputValue();
    ok('[V0.4] 포켓 G코드: 헬리컬 G03 + I·J, 공구 주석 FLAT ENDMILL', /G03 X[-\d.]+ Y[-\d.]+ Z-[\d.]+ I[-\d.]+ J[-\d.]+/.test(code) && /FLAT ENDMILL D10\./.test(code));
    // 원형 포켓으로 변경 → 공정 재구성
    await p3.click('#rightBody .wiz .seg button:has-text("원형")'); await sleep(200);
    ok('[V0.4] 원형 포켓 전환 → 공정 모양 원형', await p3.evaluate(() => window.__PCAM_UI__.P.groups[0].ops.every(o => o.shape === 'circle')));
    // 너무 깊은 포켓 → 차단
    const dIn = p3.locator('#rightBody .wiz .grid2 input').nth(1); await dIn.fill('30'); await dIn.press('Tab'); await sleep(200);
    ok('[V0.4] 소재 두께 이상 포켓 깊이 → NC 차단', !(await p3.evaluate(() => window.__PCAM_UI__.downloadState().ok)));
    await p3.click('#btnUndo'); await sleep(150);
    // 3D 시뮬레이션
    await p3.click('#tab3d'); await sleep(1200);
    const v3 = await p3.evaluate(() => { const U = window.__PCAM_UI__; return { ok: !!(U.V3 && U.V3.ok), total: U.S.sim.total, n: U.S.sim.motions.length }; });
    ok('[V0.4] 3D 시뮬레이션 화면 (WebGL) · 이동 데이터 로드', v3.ok && v3.total > 0 && v3.n > 10, JSON.stringify(v3));
    await p3.evaluate(() => { const U = window.__PCAM_UI__; U.V3.seek(U.S.sim.total * 0.3); }); await sleep(200);
    const hud = await p3.textContent('#hudTool');
    ok('[V0.4] 3D HUD: 현재 공구·X·Y·Z·G코드 행 표시', /T16/.test(hud) && /Z -?[\d.]+/.test(hud) && /행/.test(hud), hud);
    await p3.click('#simPlay'); await sleep(500);
    const playing = await p3.evaluate(() => window.__PCAM_UI__.V3.isPlaying());
    await p3.click('#simPlay'); await sleep(100);
    ok('[V0.4] 재생·일시정지', playing && !(await p3.evaluate(() => window.__PCAM_UI__.V3.isPlaying())));
    const bands = await p3.locator('#simbar .bands span').count();
    ok('[V0.4] 타임라인 공구별 색 구간', bands >= 1, String(bands));
    // 작업지시서
    await p3.click('#btnSheet'); await sleep(200);
    const sh = await p3.textContent('#dlg');
    ok('[V0.4] 작업지시서: 공구표·가공 순서·예상 시간·검증용 표시', /공구표/.test(sh) && /가공 순서/.test(sh) && /예상 시간/.test(sh) && /검증용\(TEST\)/.test(sh));
    await p3.click('#dlg .dhead button[aria-label="닫기"]');
    ok('[V0.4] 상태 표시줄 예상 가공 시간', /예상 시간 약/.test(await p3.textContent('#status')));
    if (SHOT) { await p3.screenshot({ path: path.join(SHOT, 'e2e-8-pocket-3d.png') }); }
    ok('[V0.4] 포켓·3D 과정 콘솔 오류 없음', e3.length === 0, e3.join('|'));
    await c3.close();
  }

  // 14-2. [V0.5] 도면(DXF) 불러오기 · 윤곽·평면·모따기 · 목록 편집(복사·붙여넣기·삭제·메뉴) · 패널 크기 조절
  {
    const os = require('os');
    const tmpDxf = path.join(os.tmpdir(), 'pcam-sample-' + process.pid + '.dxf'); // 브라우저 파일 선택 시험은 ASCII 경로 사용
    fs.copyFileSync(path.join(ROOT, 'examples', '샘플_브라켓.dxf'), tmpDxf);
    const c5 = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const p5 = await c5.newPage(); const e5 = []; let dlg5 = '';
    p5.on('pageerror', e => e5.push(e.message)); p5.on('console', m => { if (m.type() === 'error') e5.push(m.text()); }); p5.on('dialog', d => { dlg5 = d.message(); d.accept(); });
    await p5.goto('file://' + HTML); await sleep(400);
    await dense(p5); // [V0.7] 기존 기능 검사는 '모두 펼쳐 보기'로 (접힌 기본 화면은 맨 아래 V0.7 검사에서 따로 확인)
    await p5.click('#btnProjects'); await p5.click('#dlg button:has-text("새 프로젝트")'); await sleep(200);
    const fc5 = p5.waitForEvent('filechooser'); await p5.click('#tree .dxfbtn'); const ch5 = await fc5; await ch5.setFiles(tmpDxf); await sleep(500);
    const dtxt = await p5.textContent('#dlg');
    ok('[V0.5] DXF 불러오기 창: 닫힌 윤곽 3·원 7, Ø6.8 → 탭 M8 추천', /닫힌 윤곽 3개/.test(dtxt) && /원 7개/.test(dtxt) && (await p5.locator('#dlg select').first().inputValue()) === 'tap', dtxt.slice(0, 120));
    await p5.click('#dlg .dfoot button.primary'); await sleep(900);
    const d5 = await p5.evaluate(() => { const U = window.__PCAM_UI__; return { st: [U.P.stock.sx, U.P.stock.sy, U.P.stock.origin], g: U.P.groups.map(g => g.spec && g.spec.kind), ds: U.downloadState(), ne: U.S.nc.verify ? U.S.nc.verify.errors.length : -1, match: U.S.nc.verify && U.S.nc.verify.match, errs: U.S.V.issues.filter(i => i.level === 'error').map(i => i.msg) }; });
    ok('[V0.5] DXF → 소재 124×84(여유 2) LL, 탭·구멍·원형 포켓·자유 포켓(섬)·바깥 윤곽(마지막)', JSON.stringify(d5.st) === '[124,84,"LL"]' && JSON.stringify(d5.g) === '["tap","drill","pocket","pocket","contour"]', JSON.stringify(d5));
    ok('[V0.5] DXF 가공 전체 검증 통과 · NC 해석 오류 0 · 생성기 경로 일치', d5.ds.ok && d5.ne === 0 && d5.match === true, JSON.stringify(d5));
    // 목록 편집
    const n0 = await p5.evaluate(() => window.__PCAM_UI__.P.groups.length);
    await p5.locator('#tree .titem[data-gid]').nth(1).click(); await p5.keyboard.press('Control+c'); await p5.keyboard.press('Control+v'); await sleep(200);
    const n1 = await p5.evaluate(() => window.__PCAM_UI__.P.groups.length);
    ok('[V0.5] Ctrl+C / Ctrl+V 로 가공 복사·붙여넣기 (X+10mm)', n1 === n0 + 1, n0 + '→' + n1);
    await p5.locator('#tree .titem.sel').focus(); await p5.keyboard.press('Delete'); await sleep(200);
    ok('[V0.5] Delete 키로 삭제 (확인 창)', (await p5.evaluate(() => window.__PCAM_UI__.P.groups.length)) === n0 && /삭제할까요/.test(dlg5), dlg5);
    await p5.click('#toasts .toast:has-text("삭제") button'); await sleep(200);
    ok('[V0.5] 삭제 알림의 [되돌리기] 로 복구', (await p5.evaluate(() => window.__PCAM_UI__.P.groups.length)) === n0 + 1);
    await p5.keyboard.press('Control+z'); await sleep(150);
    const it5 = p5.locator('#tree .titem[data-gid]').first(), b5 = await it5.boundingBox();
    await p5.mouse.click(b5.x + 80, b5.y + 15, { button: 'right' }); await sleep(150);
    const menu = await p5.textContent('#ctxmenu').catch(() => '');
    ok('[V0.5] 오른쪽 버튼 메뉴: 복사·붙여넣기·복제·이름 바꾸기·위로·아래로·삭제', ['복사', '붙여넣기', '복제', '이름 바꾸기', '위로', '아래로', '삭제'].every(w => menu.includes(w)), menu);
    await p5.click('#ctxmenu button:has-text("복제")'); await sleep(200);
    ok('[V0.5] 메뉴 [복제]', (await p5.evaluate(() => window.__PCAM_UI__.P.groups.length)) === n0 + 1);
    await p5.keyboard.press('Control+z'); await sleep(150);
    // 끌어서 순서 바꾸기 (첫 항목을 셋째 뒤로)
    const name0 = await p5.evaluate(() => window.__PCAM_UI__.P.groups[0].name);
    await p5.locator('#tree .titem[data-gid]').nth(0).dragTo(p5.locator('#tree .titem[data-gid]').nth(2), { targetPosition: { x: 40, y: 40 } }); await sleep(200);
    ok('[V0.5] 끌어서 순서 바꾸기', (await p5.evaluate(n => window.__PCAM_UI__.P.groups.findIndex(g => g.name === n), name0)) > 0, name0);
    // 패널 크기 조절 + 새로 고침 후 유지 + 접기
    const sr = await p5.locator('#splitR').boundingBox();
    await p5.mouse.move(sr.x + 5, sr.y + 300); await p5.mouse.down(); await p5.mouse.move(sr.x - 120, sr.y + 300, { steps: 6 }); await p5.mouse.up(); await sleep(200);
    const wr = await p5.evaluate(() => window.__PCAM_UI__.DB.settings.layout.wr);
    ok('[V0.5] 오른쪽 패널 경계 끌어서 넓히기', wr >= 480 && wr <= 520, String(wr));
    await p5.reload(); await sleep(500);
    const w2 = await p5.evaluate(() => getComputedStyle(document.getElementById('right')).width);
    ok('[V0.5] 패널 크기 새로 고침 후 유지', Math.abs(parseFloat(w2) - wr) < 3, w2 + ' vs ' + wr);
    await p5.click('#togL'); await sleep(150);
    ok('[V0.5] 작업 목록 숨기기 버튼', !(await p5.locator('#left').isVisible()));
    await p5.click('#togL'); await sleep(100);
    await p5.dblclick('#splitR'); await sleep(100);
    ok('[V0.5] 경계 더블클릭 = 기본 폭', (await p5.evaluate(() => window.__PCAM_UI__.DB.settings.layout.wr)) === 384);
    // 윤곽·평면·모따기 추가
    for (const k of ['contour', 'face', 'chamfer']) { await p5.click('#tree .addbtn.k-' + k); await sleep(250); }
    const d6 = await p5.evaluate(() => { const U = window.__PCAM_UI__; return { g: U.P.groups.slice(-3).map(g => g.ops.map(o => o.type).join('+')), e: U.S.V.issues.filter(i => i.level === 'error').map(i => i.msg) }; });
    ok('[V0.5] + 윤곽 / + 평면 / + 모따기 → 공정 자동 구성', JSON.stringify(d6.g) === '["contourRough+contourFinish","faceMill","chamferMill"]', JSON.stringify(d6));
    await p5.click('#tab3d'); await sleep(1800);
    ok('[V0.5] 3D 시뮬레이션 (윤곽·평면·모따기 포함) 로드', await p5.evaluate(() => window.__PCAM_UI__.V3 && window.__PCAM_UI__.V3.ok && window.__PCAM_UI__.S.sim.total > 0));
    if (SHOT) await p5.screenshot({ path: path.join(SHOT, 'e2e-9-v05.png') });
    ok('[V0.5] 과정 전체 콘솔 오류 없음', e5.length === 0, e5.join('|'));
    fs.unlinkSync(tmpDxf);
    await c5.close();
  }

  // 14-3. [V0.5 2차] 포켓 단계·다각·측벽 형상 · 2D 크기 손잡이 · 단면도 · 패널 바꾸기 · 아이콘/탭 끌어 옮기기
  {
    const c7 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p7 = await c7.newPage(); const e7 = [];
    p7.on('pageerror', e => e7.push(e.message)); p7.on('console', m => { if (m.type() === 'error') e7.push(m.text()); }); p7.on('dialog', d => d.accept());
    await p7.goto('file://' + HTML); await sleep(400);
    await dense(p7); // [V0.7] 기존 기능 검사는 '모두 펼쳐 보기'로 (접힌 기본 화면은 맨 아래 V0.7 검사에서 따로 확인)
    await p7.click('#btnProjects'); await p7.click('#dlg button:has-text("새 프로젝트")'); await sleep(200);
    ok('[V0.5] 작업 순서: 다음 할 일 안내 (가공 추가)', /다음 할 일/.test(await p7.textContent('#tree .nextstep')) && /가공을 추가/.test(await p7.textContent('#tree .nextstep')));
    await p7.click('#tree .addbtn.k-pocket'); await sleep(250);
    ok('[V0.5] 포켓 가공 단계 표시 (황삭 → 중삭 → 정삭)', (await p7.locator('#rightBody .stages .stg').count()) === 3);
    await p7.click('#rightBody .stages .stg[data-stg="semi"]'); // [V0.7] 단계 칩을 눌러 켜고 끔 await sleep(250);
    const q1 = await p7.evaluate(() => { const U = window.__PCAM_UI__, g = U.P.groups[0]; return { ops: g.ops.map(o => o.type).join(','), ok: U.downloadState().ok, ne: U.S.nc.verify.errors.length }; });
    ok('[V0.5] 중삭 체크 → 황삭·중삭·바닥 정삭·측벽 정삭, 검증 통과', q1.ops === 'pocketRough,pocketSemi,pocketFloor,pocketWall' && q1.ok && q1.ne === 0, JSON.stringify(q1));
    await p7.click('#rightBody .seg button:has-text("다각")'); await sleep(250);
    const q2 = await p7.evaluate(() => { const U = window.__PCAM_UI__, g = U.P.groups[0]; return { shape: g.spec.shape, op: g.ops[0].shape, ok: U.downloadState().ok }; });
    ok('[V0.5] 다각(육각) 포켓 → 자유 형상 경로, 검증 통과', q2.shape === 'ngon' && q2.op === 'poly' && q2.ok, JSON.stringify(q2));
    await p7.evaluate(() => { const U = window.__PCAM_UI__, g = U.P.groups[0]; U.mutate(() => { g.spec.shape = 'rect'; g.spec.draft = 5; g.spec.floorR = 1; }); });
    await sleep(400);
    const q3 = await p7.evaluate(() => { const U = window.__PCAM_UI__, g = U.P.groups[0]; return { ops: g.ops.map(o => o.type).join(','), ok: U.downloadState().ok, ne: U.S.nc.verify.errors.length, m: U.S.nc.verify.match }; });
    ok('[V0.5] 구배 5°·바닥 R1 → 측벽 형상 공정, 검증기 형상 판정 통과', /pocketProfile/.test(q3.ops) && q3.ok && q3.ne === 0 && q3.m === true, JSON.stringify(q3));
    // 2D 크기 손잡이
    await p7.evaluate(() => { const U = window.__PCAM_UI__, g = U.P.groups[0]; U.S.sel = { kind: 'group', gid: g.id, hid: g.holes[0].id }; U.renderAll(); });
    const hp = await p7.evaluate(() => { const U = window.__PCAM_UI__, g = U.P.groups[0], h = g.holes[0], r = document.querySelector('#cv').getBoundingClientRect(); const [x, y] = U.G.w2s(h.x + g.spec.w / 2, h.y); return { x: r.left + x, y: r.top + y, w0: g.spec.w }; });
    await p7.mouse.move(hp.x, hp.y); await p7.mouse.down(); await p7.mouse.move(hp.x + 30, hp.y, { steps: 5 }); await p7.mouse.up(); await sleep(400);
    const w1 = await p7.evaluate(() => window.__PCAM_UI__.P.groups[0].spec.w);
    ok('[V0.5] 2D 손잡이 끌기 → 포켓 가로 커짐', w1 > hp.w0 + 5, hp.w0 + '→' + w1);
    await p7.click('#vtools button:has-text("단면도")'); await sleep(300);
    ok('[V0.5] 단면도 켜기', await p7.evaluate(() => window.__PCAM_UI__.S.sec.on === true));
    if (SHOT) await p7.screenshot({ path: path.join(SHOT, 'e2e-10-section.png') });
    // 패널 바꾸기·아이콘/탭 끌어 옮기기 (저장 후 다시 열어도 유지)
    await p7.click('#togSwap'); await sleep(200);
    const sw = await p7.evaluate(() => document.querySelector('#left').getBoundingClientRect().left > document.querySelector('#right').getBoundingClientRect().left);
    ok('[V0.5] 왼쪽·오른쪽 패널 자리 바꾸기', sw);
    await p7.locator('#btnSheet').dragTo(p7.locator('#btnUndo')); await sleep(150);
    await p7.locator('#tab3d').dragTo(p7.locator('#tab2d')); await sleep(150);
    await p7.reload(); await sleep(500);
    const ar = await p7.evaluate(() => ({ g0: [...document.querySelector('#top .hgroup').children].map(x => x.id)[0], t0: document.querySelector('#view .vtabs button').id, sw: document.querySelector('#app').classList.contains('swap') }));
    ok('[V0.5] 머리글 아이콘·화면 탭 끌어 옮기기 · 다시 열어도 유지', ar.g0 === 'btnSheet' && ar.t0 === 'tab3d' && ar.sw, JSON.stringify(ar));
    await p7.click('#togSwap'); await p7.click('#togR'); await sleep(150);
    ok('[V0.5] 속성 패널 숨기면 그 폭이 0 (빈 칸 없음)', await p7.evaluate(() => getComputedStyle(document.querySelector('#app')).getPropertyValue('--wr').trim() === '0px'));
    ok('[V0.5 2차] 화면 오류 없음', e7.length === 0, e7.join('|'));
    await c7.close();
  }

  // 14-4. [V0.6] 작업 순서 ✓·입력칸 오류·바로 고치기·도움말·리머/보링·첫 가공 모드·공구별 분할 저장·가공 기록·작업지시서
  {
    const c8 = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const p8 = await c8.newPage(); const e8 = [];
    p8.on('pageerror', e => e8.push(e.message)); p8.on('console', m => { if (m.type() === 'error') e8.push(m.text()); }); p8.on('dialog', d => d.accept());
    await p8.goto('file://' + HTML); await sleep(400);
    await dense(p8); // [V0.7] 기존 기능 검사는 '모두 펼쳐 보기'로 (접힌 기본 화면은 맨 아래 V0.7 검사에서 따로 확인)
    await p8.click('#btnProjects'); await p8.click('#dlg button:has-text("새 프로젝트")'); await sleep(200);
    await p8.click('#tree .addbtn.k-pocket'); await sleep(300);
    const fl = async () => p8.evaluate(() => [...document.querySelectorAll('#tree .flow .fl')].map(x => x.className.replace('fl ', '')));
    let f = await fl();
    ok('[V0.6] 가공만 추가하면 ④ 확인·⑤ 저장은 아직 ✓ 아님 (예전 오표시 수정)', f[3] === 'todo' && f[4] === 'todo' && /3D 시뮬레이션/.test(await p8.textContent('#tree .nextstep')), JSON.stringify(f));
    await p8.evaluate(() => { const U = window.__PCAM_UI__, g = U.P.groups[0]; U.mutate(() => { g.spec.depth = 30; }); }); await sleep(250);
    ok('[V0.6] 입력칸 옆 오류 표시 (깊이 칸 빨강 + 이유)', await p8.locator('#rightBody .fld.ferr').count() >= 1 && /두께|날 길이/.test(await p8.textContent('#rightBody .fld.ferr .fmsg')));
    await p8.click('#rightBody .qfix button:has-text("두께")'); await sleep(250);
    ok('[V0.6] 바로 고치기 → 깊이 = 두께 − 1', await p8.evaluate(() => window.__PCAM_UI__.P.groups[0].spec.depth) === 19);
    await p8.evaluate(() => { const U = window.__PCAM_UI__, g = U.P.groups[0]; U.mutate(() => { g.spec.depth = 8; }); }); await sleep(200);
    await p8.click('#rightBody .gi >> nth=0'); await sleep(100);
    ok('[V0.6] ⓘ 누르면 용어 풀이 풍선', await p8.locator('#tippop').count() === 1);
    await p8.keyboard.press('Escape'); await p8.keyboard.press('F1'); await sleep(200);
    ok('[V0.6] F1 도움말·용어집', /용어집/.test(await p8.textContent('#dlg')) && (await p8.locator('#dlg .gloss dt').count()) > 30);
    await p8.click('#dlg .dhead button[aria-label="닫기"]');
    await p8.click('#tree .addbtn.k-bore'); await sleep(300);
    await p8.evaluate(() => { const U = window.__PCAM_UI__, g = U.P.groups[1]; U.mutate(() => { g.holes.push({ id: 'hb1', x: 35, y: 30 }); }); }); await sleep(250);
    const bo = await p8.evaluate(() => { const U = window.__PCAM_UI__, g = U.P.groups[1]; return { ops: g.ops.map(o => o.type).join(','), ok: U.downloadState().ok, g76: /G76 /.test(U.S.nc.text) }; });
    ok('[V0.6] + 보링 → 센터·원형 포켓 밑구멍·G76 보링, 검증 통과', bo.ops === 'center,pocketRough,bore' && bo.ok && bo.g76, JSON.stringify(bo));
    await p8.click('#tree .addbtn.k-ream'); await sleep(300);
    ok('[V0.6] + 리머(H7) → 밑구멍 드릴 없으면 [공구 추가] 안내', /공구 추가|Ø5\.8/.test(await p8.textContent('#rightBody')));
    await p8.click('#rightBody button:has-text("공구 추가")').catch(() => {}); await sleep(300);
    await p8.evaluate(() => { const U = window.__PCAM_UI__, g = U.P.groups[2]; U.mutate(() => { g.holes.push({ id: 'hr1', x: 120, y: 75 }); }); }); await sleep(250);
    const re = await p8.evaluate(() => { const U = window.__PCAM_UI__, g = U.P.groups[2]; return { ops: g.ops.map(o => o.type).join(','), ds: U.downloadState(), nc: /G85 /.test(U.S.nc.text) }; });
    ok('[V0.6] 리머 공구 추가 후 센터·드릴·리머(G85), 검증 통과', re.ops === 'center,drill,ream' && re.ds.ok && re.nc, JSON.stringify(re));
    // 첫 가공 모드 + 재시작 블록
    await p8.evaluate(() => { const U = window.__PCAM_UI__; U.mutate(() => { U.P.settings.firstRun = true; U.P.settings.restart = true; }); }); await sleep(300);
    const fr = await p8.evaluate(() => { const t = window.__PCAM_UI__.S.nc.text; return { m00: (t.match(/^M00$/gm) || []).length, n: (t.match(/^N\d00 /gm) || []).length, ok: window.__PCAM_UI__.downloadState().ok }; });
    ok('[V0.6] 첫 가공 모드: 공정마다 M00 · 공구별 재시작 블록 N100…, 검증 통과', fr.m00 >= 5 && fr.n >= 4 && fr.ok, JSON.stringify(fr));
    // 3D 를 보면 ④ ✓
    await p8.click('#tab3d'); await sleep(1800);
    ok('[V0.6] 3D 를 처음 열면 0초(가공 전)부터 · 공정 자막', (await p8.inputValue('#simRange')) === '0' && (await p8.locator('#simbar .tick').count()) >= 1);
    await p8.click('#tab2d'); await sleep(200);
    f = await fl();
    ok('[V0.6] 3D 확인 뒤 ④ 확인 단계 완료 표시', f[3] === 'ok' || f[3] === 'warn', JSON.stringify(f));
    // 공구별 분할 저장
    await p8.click('#btnDownload'); await sleep(200);
    for (const cb of await p8.locator('#dlg .ncChk').all()) await cb.check();
    const dls = []; p8.on('download', d => dls.push(d.suggestedFilename()));
    await p8.click('#dlg button:has-text("공구별로 나눠 저장")'); await sleep(5000);
    const nTools = await p8.evaluate(() => window.__PCAM_UI__.S.V.plan.steps.filter(s => s.toolChange).length);
    ok('[V0.6] 공구별로 나눠 저장 → 공구 수만큼 파일 (TEST_…_01_T..)', dls.length === nTools && dls.every(n => /^TEST_.*_\d\d_T\d\d\.nc$/.test(n)), JSON.stringify(dls));
    f = await fl();
    ok('[V0.6] 저장 뒤 ⑤ NC 저장 완료 표시 · 가공 기록 남음', f[4] === 'ok' && (await p8.evaluate(() => window.__PCAM_UI__.DB.records.length)) === nTools, JSON.stringify(f));
    await p8.click('#btnSettings'); await p8.click('#dlg button:has-text("가공 기록")'); await sleep(200);
    ok('[V0.6] 가공 기록 창: 저장 기록·NC 해시', (await p8.locator('#dlg table.tbl tr').count()) > nTools && /NC 저장/.test(await p8.textContent('#dlg')));
    await p8.click('#dlg .dhead button[aria-label="닫기"]');
    await p8.click('#btnSheet'); await sleep(300);
    const sh = await p8.textContent('#dlg');
    ok('[V0.6] 작업지시서: 배치도·좌표표·NC 해시·첫 가공 확인 서명란', /배치도/.test(sh) && /NC 해시/.test(sh) && /첫 가공 확인/.test(sh) && (await p8.locator('#dlg svg.sh-lay').count()) === 1);
    if (SHOT) await p8.screenshot({ path: path.join(SHOT, 'e2e-11-sheet.png') });
    ok('[V0.6] 과정 전체 화면 오류 없음', e8.length === 0, e8.join('|'));
    await c8.close();
  }

  // 14. 모바일 화면
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await mob.newPage(); const mErr = [];
  mp.on('pageerror', e => mErr.push(e.message));
  await mp.goto('file://' + HTML); await sleep(500);
  await dense(mp); // [V0.7] 기존 기능 검사는 '모두 펼쳐 보기'로 (접힌 기본 화면은 맨 아래 V0.7 검사에서 따로 확인)
  ok('모바일: 하단 탭 4개 표시', await mp.locator('#mnav button').count() === 4 && await mp.locator('#mnav').isVisible());
  ok('모바일: 기본 화면=그래픽, 다른 패널 숨김', await mp.locator('#view').isVisible() && !(await mp.locator('#right').isVisible()));
  if (SHOT) await mp.screenshot({ path: path.join(SHOT, 'e2e-4-mobile-view.png') });
  await mp.click('#mnav button[data-m=right]'); await sleep(150);
  ok('모바일: 속성 패널 전환', await mp.locator('#right').isVisible() && !(await mp.locator('#view').isVisible()));
  if (SHOT) await mp.screenshot({ path: path.join(SHOT, 'e2e-5-mobile-right.png') });
  await mp.click('#mnav button[data-m=bottom]'); await sleep(150);
  if (SHOT) await mp.screenshot({ path: path.join(SHOT, 'e2e-6-mobile-check.png') });
  const hscroll = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('모바일: 가로 스크롤 없음', !hscroll);
  // 터치로 홀 추가
  await mp.click('#mnav button[data-m=view]'); await sleep(100);
  await mp.click('#vtools button:has-text("위치 추가")');
  const mb = await mp.locator('#cv').boundingBox();
  const n0 = await mp.evaluate(() => window.__PCAM_UI__.P.groups[0].holes.length);
  await mp.touchscreen.tap(mb.x + mb.width / 2, mb.y + mb.height / 2); await sleep(200);
  const n1 = await mp.evaluate(() => window.__PCAM_UI__.P.groups[0].holes.length);
  ok('모바일: 터치로 홀 추가', n1 === n0 + 1, n0 + '→' + n1);
  await mp.click('#btnMore'); await sleep(150);
  ok('[V0.6] 모바일: 머리글 한 줄 · ⋯ 더보기로 아이콘 표시', await mp.locator('#top.more .hgroup').first().isVisible());
  ok('모바일: 오류 없음', mErr.length === 0, mErr.join('|'));
  await mob.close();

  // 15. 웹 서버 배포 상태: 공유 링크·QR·최신 버전 확인
  const srv = await serve();
  const port = srv.address().port;
  const wp = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  const wErr = []; wp.on('pageerror', e => wErr.push(e.message)); wp.on('console', m => { if (m.type() === 'error') wErr.push(m.text()); });
  const url = 'http://127.0.0.1:' + port + '/pureun-ai-cam.html';
  await wp.goto(url); await sleep(400);
  await dense(wp); // [V0.7] 기존 기능 검사는 '모두 펼쳐 보기'로 (접힌 기본 화면은 맨 아래 V0.7 검사에서 따로 확인)
  await wp.click('#btnShare'); await sleep(200);
  const linkVal = await wp.locator('#dlg input[type=text]').inputValue();
  ok('http 배포 시 공유 링크 = 실제 주소', linkVal === url, linkVal);
  const qr = await wp.evaluate(() => { const c = document.getElementById('qrCanvas'); const x = c.getContext('2d'); return { w: c.width, h: c.height, data: Array.from(x.getImageData(0, 0, c.width, c.height).data) }; });
  ok('QR코드 크게 표시 (≥ 200px)', qr.w >= 200, String(qr.w));
  if (process.env.JSQR) {
    const jsQR = require(process.env.JSQR);
    const code = jsQR(Uint8ClampedArray.from(qr.data), qr.w, qr.h);
    ok('QR코드 판독 결과 = 앱 주소 (jsQR)', code && code.data === url, code ? code.data : '판독 실패');
  }
  if (SHOT) await wp.screenshot({ path: path.join(SHOT, 'e2e-7-share-qr.png') });
  await wp.click('#dlg .dhead button[aria-label="닫기"]');
  await wp.click('#btnSettings'); await wp.click('#dlg button:has-text("업그레이드")'); await sleep(600);
  ok('업그레이드: version.json 으로 최신 버전 확인', (await wp.textContent('#latestVer')).includes(VER + ' (최신)'), await wp.textContent('#latestVer'));
  ok('웹 배포판 오류 없음', wErr.length === 0, wErr.join('|'));
  srv.close();

  // 16. [V0.7] 간단히 보기 (기본 화면): 처음에는 적게, 누르면 펼침 — 기능은 그대로
  {
    const c9 = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const p9 = await c9.newPage(); const e9 = [];
    p9.on('pageerror', e => e9.push(e.message)); p9.on('console', m => { if (m.type() === 'error') e9.push(m.text()); });
    p9.on('dialog', d => d.accept());
    await p9.goto('file://' + HTML); await sleep(500);
    const vis = sel => p9.locator(sel).first().isVisible().catch(() => false);
    ok('[V0.7] 처음 화면: 추가 버튼은 [+ 가공 추가] 하나, 선택판은 접힘', await vis('#tree .addmain') && !(await p9.locator('#tree .addpal').count()));
    ok('[V0.7] 머리글: 설정·도움말·NC 저장은 바로 보이고, 작업지시서·공유·밝기는 ⋯ 안', await vis('#btnSettings') && await vis('#btnHelp') && await vis('#btnDownload') && !(await vis('#btnSheet')) && !(await vis('#btnShare')) && !(await vis('#btnTheme')) && await vis('#btnMore'));
    const x0 = (await p9.locator('#btnProjects').boundingBox()).x;
    await p9.click('#btnMore'); await sleep(150);
    const hm = await p9.textContent('#ctxmenu').catch(() => '');
    ok('[V0.7] 머리글 ⋯ → 이름이 있는 메뉴(작업지시서·공유·밝기), 다른 버튼은 밀리지 않음', /작업지시서/.test(hm) && /공유/.test(hm) && /보기/.test(hm) && (await p9.locator('#btnProjects').boundingBox()).x === x0, hm);
    await p9.click('#ctxmenu button:has-text("작업지시서")'); await sleep(300);
    ok('[V0.7] ⋯ 메뉴의 [작업지시서 인쇄] → 작업지시서 창', await p9.locator('#dlg[open] .sheet').count() > 0 && !(await p9.locator('#ctxmenu').count()));
    await p9.click('#dlg .dhead button[aria-label="닫기"]'); await sleep(150);
    ok('[V0.7] 다음 할 일 버튼: 큰 글씨 한 줄 (예제 = 3D로 확인하기)', /다음 할 일/.test(await p9.textContent('#tree .nextstep')) && /3D로 확인하기/.test(await p9.textContent('#tree .nextstep b')), await p9.textContent('#tree .nextstep'));
    // 추가 선택판
    await p9.click('#tree .addmain'); await sleep(150);
    const pal = await p9.evaluate(() => [...document.querySelectorAll('#tree .addpal button')].map(b => { const t = b.querySelector('.tile').getBoundingClientRect(); return Math.round(Math.min(t.width, t.height)); }));
    ok('[V0.7] [+ 가공 추가] → 큰 아이콘 선택판 9칸 (가공 8 + 도면), 아이콘 44px 이상', pal.length === 9 && pal.every(x => x >= 44) && (await p9.locator('#tree .addpal .addbtn').count()) === 8 && (await p9.locator('#tree .addpal .dxfbtn').count()) === 1, JSON.stringify(pal));
    await p9.click('#tree .addpal .addbtn.k-pocket'); await sleep(300);
    const s1 = await p9.evaluate(() => { const U = window.__PCAM_UI__, rb = document.querySelector('#rightBody'); return { n: U.P.groups.length, kind: U.P.groups[U.P.groups.length - 1].spec.kind, pal: !!document.querySelector('#tree .addpal'), grid: !!document.querySelector('#rightBody .kindgrid'), chip: !!document.querySelector('#rightBody .kindchip'), acc: [...document.querySelectorAll('#rightBody details.acc')].map(d => d.dataset.sec + (d.open ? '+' : '-') + ':' + d.querySelector('summary .v').textContent), inputs: [...document.querySelectorAll('#rightBody .basic input[type=number]')].filter(i => i.getBoundingClientRect().height > 0).length, ratio: rb.scrollHeight / rb.clientHeight }; });
    ok('[V0.7] 포켓 추가 → 선택판 닫힘, 가공 방법은 칩 하나', s1.n === 3 && s1.kind === 'pocket' && !s1.pal && !s1.grid && s1.chip, JSON.stringify(s1));
    ok('[V0.7] 포켓 속성: 기본 치수(가로·세로·코너R·깊이·X·Y)만 보이고 나머지는 접힌 줄 + 현재 값 요약', s1.inputs === 6 && ['pos-m-', 'opt-', 'dd-', 'gen-', 'adv-'].every(k => s1.acc.some(a => a.startsWith(k + ':') && a.length > k.length + 1)), JSON.stringify(s1.acc));
    ok('[V0.7] 포켓 속성이 한 화면 안 (스크롤 없이)', s1.ratio <= 1.01, String(s1.ratio));
    // 옵션 펼치기 → 단계 칩으로 중삭 켜기
    await p9.click('#rightBody details[data-sec="opt"] > summary'); await sleep(150);
    ok('[V0.7] [옵션] 누르면 공구·진입·가공 단계가 펼쳐짐', await vis('#rightBody .stages .stg[data-stg="semi"]') && (await p9.locator('#rightBody .stages .stg').count()) === 3);
    await p9.click('#rightBody .stages .stg[data-stg="semi"]'); await sleep(250);
    const s2 = await p9.evaluate(() => { const g = window.__PCAM_UI__.P.groups[2]; return { semi: g.spec.semi, ops: g.ops.map(o => o.type), open: document.querySelector('#rightBody details[data-sec="opt"]').open, sum: document.querySelector('#rightBody details[data-sec="opt"] summary .v').textContent }; });
    ok('[V0.7] 단계 칩 [중삭]을 누르면 켜지고 공정에 반영, 펼친 줄은 그대로 유지', s2.semi === true && s2.ops.includes('pocketSemi') && s2.open && /중삭/.test(s2.sum), JSON.stringify(s2));
    // 오류가 든 접힌 줄은 저절로 펼쳐짐 + 목록·NC 저장에 표시
    await p9.click('#rightBody details[data-sec="opt"] > summary'); await sleep(100);
    await p9.evaluate(() => { const U = window.__PCAM_UI__; U.mutate(() => { U.P.groups[2].spec.draft = 80; }); }); await sleep(300);
    const s3 = await p9.evaluate(() => ({ adv: document.querySelector('#rightBody details[data-sec="adv"]').open, mark: !!document.querySelector('#rightBody details[data-sec="adv"] summary .am.err'), ferr: !!document.querySelector('#rightBody details[data-sec="adv"] .fld.ferr'), row: document.querySelector('#tree .titem.sel').classList.contains('s-err'), blocked: document.querySelector('#btnDownload').classList.contains('blocked'), next: document.querySelector('#tree .nextstep').className + '|' + document.querySelector('#tree .nextstep b').textContent }));
    ok('[V0.7] 오류가 있는 접힌 줄(고급 설정)은 저절로 펼쳐지고 ! 표시', s3.adv && s3.mark && s3.ferr, JSON.stringify(s3));
    ok('[V0.7] 오류는 숨기지 않음: 목록 줄 빨간 표시 · NC 저장 차단 · 다음 할 일 = 오류 고치기', s3.row && s3.blocked && /err/.test(s3.next) && /오류/.test(s3.next), JSON.stringify(s3));
    await p9.click('#rightBody details[data-sec="adv"] > summary'); await sleep(200);
    ok('[V0.7] 오류가 있는 줄은 닫아도 다시 펼쳐짐 (다시 그릴 때)', await p9.evaluate(() => { window.__PCAM_UI__.renderAll(); return document.querySelector('#rightBody details[data-sec="adv"]').open; }));
    await p9.evaluate(() => { const U = window.__PCAM_UI__; U.mutate(() => { U.P.groups[2].spec.draft = 0; }); }); await sleep(300);
    ok('[V0.7] 오류를 고쳐도 그 가공을 보는 동안은 줄이 열려 있음 (입력하던 칸이 사라지지 않음) · NC 저장 가능', await p9.evaluate(() => document.querySelector('#rightBody details[data-sec="adv"]').open && !document.querySelector('#rightBody details[data-sec="adv"] summary .am') && !document.querySelector('#btnDownload').classList.contains('blocked')));
    await p9.click('#tree .titem[data-gid] >> nth=0'); await sleep(150); await p9.click('#tree .titem[data-gid] >> nth=2'); await sleep(200);
    ok('[V0.7] 다른 가공을 골랐다 돌아오면 다시 접힘', await p9.evaluate(() => !document.querySelector('#rightBody details[data-sec="adv"]').open));
    // [독립 검증 반영] 오류는 알맞은 칸·줄에, 접힌 안쪽 칸이 가져가지 않음
    await p9.evaluate(() => { const U = window.__PCAM_UI__; U.mutate(() => { U.P.groups[2].spec.stepover = 5; }); }); await sleep(300);
    const sA = await p9.evaluate(() => { const adv = document.querySelector('#rightBody details[data-sec="adv"]'), f = adv.querySelector('.fld.ferr'); return { adv: adv.open, lbl: f ? f.querySelector('span').textContent : '', opt: document.querySelector('#rightBody details[data-sec="opt"]').open }; });
    ok('[V0.7] 경로 간격 오류 → [고급 설정]이 펼쳐지고 [경로 간격] 칸에 표시 ([옵션]의 공구 칸이 아님)', sA.adv && /경로 간격/.test(sA.lbl) && !sA.opt, JSON.stringify(sA));
    await p9.evaluate(() => { const U = window.__PCAM_UI__; U.mutate(() => { U.P.groups[2].spec.stepover = 50; U.P.clamps.push({ id: 'ct', x: 60, y: 35, w: 30, h: 30, height: 30 }); }); }); await sleep(300);
    const sB = await p9.evaluate(() => ({ al: [...document.querySelectorAll('#rightBody .alerts')].map(a => a.textContent).join(' '), edit: document.querySelector('#rightBody details.adv').open }));
    ok('[V0.7] 클램프와 겹침 오류 → 기본 치수 아래에 바로 표시 (접힌 공정 상세 편집 안에 숨지 않음)', /클램프/.test(sB.al) && !sB.edit, JSON.stringify(sB));
    await p9.evaluate(() => { const U = window.__PCAM_UI__; U.mutate(() => { U.P.clamps.pop(); }); }); await sleep(250);
    // 입력칸에 붙지 않는 오류도 기본 치수 아래에 보임
    await p9.evaluate(() => { const U = window.__PCAM_UI__; U.mutate(() => { U.P.groups[2].spec.toolNo = 99; }); }); await sleep(250);
    ok('[V0.7] 접힌 옵션 안의 잘못된 공구 → 기본 치수 바로 아래에 오류 안내', /T99/.test(await p9.textContent('#rightBody .alerts').catch(() => '')));
    await p9.evaluate(() => { const U = window.__PCAM_UI__; U.mutate(() => { U.P.groups[2].spec.toolNo = 0; }); }); await sleep(250);
    // 가공 방법 칩
    await p9.click('#rightBody .kindchip'); await sleep(150);
    ok('[V0.7] 가공 방법 칩을 누르면 9가지 선택판', (await p9.locator('#rightBody .kindgrid button').count()) === 9);
    await p9.click('#rightBody .kindgrid button:has-text("윤곽")'); await sleep(250);
    ok('[V0.7] 선택판에서 [윤곽] → 종류가 바뀌고 선택판 닫힘 (형상 이어받음)', await p9.evaluate(() => { const g = window.__PCAM_UI__.P.groups[2]; return g.spec.kind === 'contour' && g.spec.w === 40 && !document.querySelector('#rightBody .kindgrid'); }));
    // 구멍: 위치 줄은 처음부터 펼침
    await p9.click('#tree .addmain'); await sleep(100); await p9.click('#tree .addpal .addbtn.k-drill'); await sleep(250);
    const s4 = await p9.evaluate(() => { const d = document.querySelector('#rightBody details[data-sec="pos-h"]'); return { open: d && d.open, warn: d && !!d.querySelector('summary .am.warn'), basic: document.querySelectorAll('#rightBody .basic input[type=number]').length, tabs: document.querySelectorAll('#rightBody .subtabs button').length, verb: document.querySelector('#tree .nextstep b').textContent }; });
    ok('[V0.7] 구멍 추가: 지름·깊이 + 위치 입력이 바로 보이고, 위치가 없으면 ! 표시 · 다음 할 일 = 위치 넣기', s4.open && s4.warn && s4.basic === 2 && s4.tabs === 4 && /위치 넣기/.test(s4.verb), JSON.stringify(s4));
    // [독립 검증 반영] 관통 여유 오류·깊이 기준 안내는 항상 보임
    await p9.evaluate(() => { const U = window.__PCAM_UI__, g = U.P.groups[U.P.groups.length - 1]; U.mutate(() => { g.holes.push({ id: 'hx1', x: 75, y: 50 }); g.spec.thru = true; g.spec.brk = 8; }); }); await sleep(300);
    const sC = await p9.evaluate(() => { const f = [...document.querySelectorAll('#rightBody .basic .fld')].find(x => /관통 여유/.test(x.textContent)); return { has: !!f, err: !!f && f.classList.contains('ferr'), msg: f ? f.textContent.slice(0, 80) : '' }; });
    ok('[V0.7] 관통 여유가 하부 여유보다 크면 [관통 여유] 칸이 빨갛게 되고 이유 표시', sC.has && sC.err, JSON.stringify(sC));
    await p9.evaluate(() => { const U = window.__PCAM_UI__, g = U.P.groups[U.P.groups.length - 1]; U.mutate(() => { g.spec.thru = false; g.spec.brk = 2; g.spec.depth = 5; }); }); await sleep(300);
    const sD = await p9.evaluate(() => { const U = window.__PCAM_UI__, n = document.querySelector('#rightBody .note.info .reflist'); return { inFloor: U.P.groups.length, vis: !!n && !n.closest('details:not([open])'), txt: n ? n.textContent.slice(0, 90) : '' }; });
    ok('[V0.7] 다른 가공 바닥 안의 구멍: "먼저 가공된 바닥 기준 … 실제 끝 Z" 안내가 접힌 줄 밖에 보임', sD.vis && /실제 끝/.test(sD.txt), JSON.stringify(sD));
    await p9.evaluate(() => { const U = window.__PCAM_UI__, g = U.P.groups[U.P.groups.length - 1]; U.mutate(() => { g.holes = []; g.spec.depth = 10; }); }); await sleep(250);
    // 2D 도구 막대
    const vt = await p9.evaluate(() => { const v = document.querySelector('#vtools'), r = v.getBoundingClientRect(); return { n: [...v.querySelectorAll(':scope > button, :scope > details > summary')].filter(b => b.getBoundingClientRect().width > 0).length, h: Math.round(r.height), clamp: [...v.querySelectorAll('button')].some(b => /클램프/.test(b.textContent) && !b.closest('details:not([open])')), hint: document.querySelector('#viewHint').hidden }; });
    ok('[V0.7] 2D 도구 막대: 한 줄 · 6개 이하 (선택·위치 추가·맞춤·단면도·⋯), 안내 글 숨김', vt.n <= 6 && vt.h <= 46 && !vt.clamp && vt.hint, JSON.stringify(vt));
    await p9.click('#vtools details.pop > summary'); await sleep(150);
    ok('[V0.7] 도구 막대 ⋯ → 클램프·확대/축소·공정 순서·격자', await vis('#vtools .popbody button:has-text("클램프")') && await vis('#vtools .popbody select'));
    await p9.click('#vtools .popbody button:has-text("클램프")'); await sleep(150);
    ok('[V0.7] ⋯ 의 [클램프] → 클램프 도구가 켜지고 막대에 표시, 안내 글 표시', await p9.evaluate(() => window.__PCAM_UI__.S.mode === 'clamp' && !document.querySelector('#viewHint').hidden && !document.querySelector('#vtools details.pop').open && [...document.querySelectorAll('#vtools > button.on')].some(b => /클램프/.test(b.textContent))));
    await p9.click('#vtools button:has-text("선택")'); await sleep(100);
    await p9.click('#vtools details.pop > summary'); await sleep(100); await p9.mouse.click(700, 500); await sleep(150);
    ok('[V0.7] ⋯ 펼침은 바깥을 누르면 닫힘', await p9.evaluate(() => !document.querySelector('#vtools details.pop').open));
    await p9.click('#vtools details.pop > summary'); await sleep(100); await p9.keyboard.press('Escape'); await sleep(150);
    ok('[V0.7] ⋯ 펼침은 Esc 로도 닫힘', await p9.evaluate(() => !document.querySelector('#vtools details.pop').open));
    await p9.click('#tree .addmain'); await sleep(100); await p9.keyboard.press('Escape'); await sleep(150);
    ok('[V0.7] 가공 추가 선택판도 Esc 로 닫힘', !(await p9.locator('#tree .addpal').count()));
    // 소재·원점 NC
    await p9.click('#tree .titem[data-node="nc"]'); await sleep(200);
    const s5 = await p9.evaluate(() => [...document.querySelectorAll('#rightBody details.acc')].map(d => d.dataset.sec + (d.open ? '+' : '-')).join(' '));
    ok('[V0.7] 원점·NC: 번호·좌표계·높이만 보이고 순서·출력 옵션·첫 가공은 접힌 줄', s5 === 'nc-order- nc-out- nc-first-' && await vis('#rightBody input[type=number]'), s5);
    await p9.click('#rightBody details[data-sec="nc-first"] > summary'); await sleep(100);
    await p9.click('#rightBody details[data-sec="nc-first"] label:has-text("첫 가공 모드")'); await sleep(300);
    ok('[V0.7] 접힌 줄 안의 [첫 가공 모드]도 그대로 동작 (M00 정지 NC)', await p9.evaluate(() => { const U = window.__PCAM_UI__; return U.P.settings.firstRun === true && /M00/.test(U.S.nc.text) && document.querySelector('#rightBody details[data-sec="nc-first"]').open; }));
    await p9.evaluate(() => { const U = window.__PCAM_UI__; U.mutate(() => { U.P.settings.firstRun = false; }); });
    // 3D 도구 막대 · 다음 할 일 버튼 동작
    await p9.evaluate(() => { const U = window.__PCAM_UI__; U.mutate(() => { U.P.groups.pop(); }); }); await sleep(300); // 위치 없는 구멍 그룹 제거
    await p9.click('#tree .nextstep'); await sleep(1500);
    const s6 = await p9.evaluate(() => { const v = document.querySelector('#vtools'); return { mode: window.__PCAM_UI__.S.vmode, h: Math.round(v.getBoundingClientRect().height), n: [...v.querySelectorAll('button, details > summary')].filter(b => b.getBoundingClientRect().width > 0 && !b.closest('.popbody')).length }; });
    ok('[V0.7] 다음 할 일 [3D로 확인하기] → 3D 화면, 도구 막대 한 줄 (보기 4 + 단면 + ⋯)', s6.mode === '3d' && s6.h <= 46 && s6.n === 6, JSON.stringify(s6));
    // 글씨·누르는 곳 크기
    const sz = await p9.evaluate(() => {
      let minF = 99, t = ''; const tw = document.createTreeWalker(document.querySelector('#app'), NodeFilter.SHOW_TEXT);
      while (tw.nextNode()) { const n = tw.currentNode, el = n.parentElement; if (!n.textContent.trim() || !el || el.closest('svg,canvas,.bands') || !el.getBoundingClientRect().width) continue; const f = parseFloat(getComputedStyle(el).fontSize); if (f < minF) { minF = f; t = n.textContent.trim().slice(0, 12); } }
      const small = [...document.querySelectorAll('#left button, #left [role=button], #right button, #right summary, #top button, #vtools button, #vtools summary')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && !b.closest('details:not([open])') && Math.min(r.width, r.height) < 28 && !b.classList.contains('gi'); }).map(b => (b.title || b.textContent).slice(0, 12));
      return { minF, t, small };
    });
    ok('[V0.7] 화면 글씨 13px 이상 (시뮬레이션 눈금 제외)', sz.minF >= 12.9, JSON.stringify(sz));
    ok('[V0.7] 버튼·접힌 줄 크기 28px 이상', sz.small.length === 0, JSON.stringify(sz.small));
    // 설정: 모두 펼쳐 보기
    await p9.click('#tab2d'); await sleep(200);
    await p9.click('#tree .titem[data-gid] >> nth=0'); await sleep(150);
    await p9.click('#btnSettings'); await sleep(150);
    ok('[V0.7] 설정은 한 번에 열림 · [모두 펼쳐 보기] 스위치', await vis('#dlg label:has-text("모두 펼쳐 보기")'));
    await p9.click('#dlg label:has-text("모두 펼쳐 보기")'); await sleep(250);
    await p9.click('#dlg .dhead button[aria-label="닫기"]'); await sleep(150);
    const s7 = await p9.evaluate(() => ({ attr: document.documentElement.dataset.dense, grid: !!document.querySelector('#rightBody .kindgrid'), allOpen: [...document.querySelectorAll('#rightBody details.acc')].every(d => d.open), pal: !!document.querySelector('#tree .addpal'), sheet: document.querySelector('#btnSheet').getBoundingClientRect().width > 0, saved: JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => /pcam|pureun/i.test(k)))).settings.dense }));
    ok('[V0.7] 모두 펼쳐 보기 → 접힌 줄·선택판·머리글 버튼이 모두 보이고 저장됨', s7.attr === '1' && s7.grid && s7.allOpen && s7.pal && s7.sheet && s7.saved === true, JSON.stringify(s7));
    await p9.reload(); await sleep(500);
    ok('[V0.7] 새로 고침 후에도 펼쳐 보기 유지', await p9.evaluate(() => document.documentElement.dataset.dense === '1' && !!document.querySelector('#tree .addpal')));
    await p9.evaluate(() => window.__PCAM_UI__.setDense(false)); await sleep(150);
    // 새 프로젝트: 선택판이 처음부터
    await p9.click('#btnProjects'); await p9.click('#dlg button:has-text("새 프로젝트")'); await sleep(300);
    ok('[V0.7] 가공이 없으면 선택판이 처음부터 펼쳐짐 · 다음 할 일 = 가공 추가하기', await vis('#tree .addpal') && /가공 추가하기/.test(await p9.textContent('#tree .nextstep b')));
    // 어두운 화면에서 아이콘 대비
    const con = async () => p9.evaluate(() => {
      const lum = c => { const m = c.match(/[\d.]+/g).map(Number), f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
      return [...document.querySelectorAll('#tree .tile')].filter(t => getComputedStyle(t).backgroundColor !== 'rgba(0, 0, 0, 0)').map(t => { const cs = getComputedStyle(t), a = lum(cs.color), b = lum(cs.backgroundColor); return +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2); });
    });
    const cL = await con();
    await p9.evaluate(() => { const U = window.__PCAM_UI__; U.DB.settings.theme = 'dark'; U.setDense(false); }); await sleep(200);
    const cD = await con();
    ok('[V0.7] 색 타일 아이콘 대비 4.5:1 이상 (밝게·어둡게)', cL.length >= 9 && cL.every(x => x >= 4.5) && cD.every(x => x >= 4.5), JSON.stringify([cL, cD]));
    ok('[V0.7] 간단히 보기 화면 오류 없음', e9.length === 0, e9.join('|'));
    if (SHOT) await p9.screenshot({ path: path.join(SHOT, 'e2e-8-v07-simple.png') });
    await c9.close();
    // 휴대폰
    const m9 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const q9 = await m9.newPage(); const me9 = []; q9.on('pageerror', e => me9.push(e.message));
    await q9.goto('file://' + HTML); await sleep(500);
    await q9.click('#mnav button[data-m=left]'); await sleep(150);
    await q9.click('#tree .addmain'); await sleep(150);
    await q9.click('#tree .addpal .addbtn.k-pocket'); await sleep(300);
    const ms = await q9.evaluate(() => ({ kind: window.__PCAM_UI__.P.groups[2].spec.kind, right: document.querySelector('#right').getBoundingClientRect().width > 0, hs: document.documentElement.scrollWidth > innerWidth + 1, small: [...document.querySelectorAll('#right button, #right summary, #top button')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && !b.closest('details:not([open])') && Math.min(r.width, r.height) < 40 && !b.classList.contains('gi'); }).map(b => (b.title || b.textContent).slice(0, 10)), save: document.querySelector('#btnDownload').getBoundingClientRect().height }));
    ok('[V0.7] 휴대폰: [+ 가공 추가] → 포켓 → 속성 화면, 가로 스크롤 없음, NC 저장 한 줄', ms.kind === 'pocket' && ms.right && !ms.hs && ms.save <= 50, JSON.stringify(ms));
    ok('[V0.7] 휴대폰: 누르는 곳 40px 이상', ms.small.length === 0, JSON.stringify(ms.small));
    ok('[V0.7] 휴대폰: 오류 없음', me9.length === 0, me9.join('|'));
    await m9.close();
  }

  await browser.close();
  const fail = results.filter(r => !r.ok);
  console.log('\n결과: ' + (results.length - fail.length) + ' / ' + results.length + ' 통과');
  if (fail.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
