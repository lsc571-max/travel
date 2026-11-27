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
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const consoleErr = [];
  page.on('console', m => { if (m.type() === 'error') consoleErr.push(m.text()); });
  page.on('pageerror', e => consoleErr.push('pageerror: ' + e.message));
  page.on('dialog', d => { page.__lastDialog = d.message(); if (d.type() === 'prompt') d.accept(page.__promptAnswer || ''); else d.accept(); });
  const st = () => page.evaluate(() => { const U = window.__PCAM_UI__; return { holes: U.P.groups.map(g => g.holes.length), ds: U.downloadState(), edited: U.S.nc.edited, errs: U.S.V.issues.filter(i => i.level === 'error').length }; });

  // 1. 로드
  await page.goto('file://' + HTML);
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
  await page.click('#rightBody button:has-text("홀 추가")');
  await sleep(150);
  s = await st();
  ok('좌표 직접 입력으로 홀 추가', s.holes[0] === 7, JSON.stringify(s.holes));
  // 3. 되돌리기
  await page.click('#btnUndo'); await sleep(100);
  s = await st(); ok('되돌리기(Undo)', s.holes[0] === 6);
  await page.click('#btnRedo'); await sleep(100);
  s = await st(); ok('다시 하기(Redo)', s.holes[0] === 7);

  // 4. 캔버스 클릭으로 홀 추가 (스냅)
  await page.click('#vtools button:has-text("홀 추가")');
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
  ok('차단 배너 표시', await page.locator('.banner.err').count() === 1);
  let dl = null; const dlp = page.waitForEvent('download', { timeout: 1500 }).then(d => { dl = d; }).catch(() => { });
  await page.click('#btnDownload', { force: true }); await dlp;
  ok('차단 상태에서 다운로드 버튼 → 파일 생성 안 됨', dl === null);
  await page.click('#btnUndo'); await sleep(150);
  s = await st(); ok('수정 후 차단 해제', s.ds.ok, JSON.stringify(s.ds));

  // 6. NC 다운로드 (검증용 파일명·CRLF·내용)
  const dl2 = page.waitForEvent('download');
  await page.click('#btnDownload');
  const d2 = await dl2;
  const fn = d2.suggestedFilename(); const fp = await d2.path(); const txt = fs.readFileSync(fp, 'utf8');
  ok('NC 다운로드 파일명 TEST_O0001_*.nc', /^TEST_O0001_.*\.nc$/.test(fn), fn);
  ok('NC 내용: CRLF·%·O0001·M30·TEST ONLY', txt.includes('\r\n') && txt.startsWith('%\r\nO0001') && txt.includes('M30\r\n%') && txt.includes('TEST ONLY'));
  ok('다운로드 전 안전 확인 대화상자', /드라이런/.test(page.__lastDialog || ''));

  // 7. G코드 직접 수정 → 재검증 전 차단 → 재검증 통과 → 결함 수정본 차단
  await page.click('#bottomTabs button[data-tab=code]');
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
  const dl3 = page.waitForEvent('download'); await page.click('#bottomBody button:has-text("NC 다운로드")'); const d3 = await dl3;
  const t3 = fs.readFileSync(await d3.path(), 'utf8');
  ok('수정본 다운로드: _EDIT 파일명, USER EDITED 표시', /_EDIT\.nc$/.test(d3.suggestedFilename()) && t3.includes('(USER EDITED'), d3.suggestedFilename());
  await page.click('#bottomBody button:has-text("다시 생성")'); await sleep(100);
  s = await st(); ok('다시 생성 → 수정 상태 해제', !s.edited && s.ds.ok);
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'e2e-2-code.png') });

  // 8. [V0.3] 탭 그룹 간편 입력: 나사 규격·깊이만 입력 → 공정 자동 구성
  await page.click('#rightBody button:has-text("+ 탭 그룹")'); await sleep(150);
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
  await page.click('#rightBody button:has-text("홀 추가")'); await sleep(150);
  s = await st(); ok('PCD 6개 추가', s.holes[2] === 6, JSON.stringify(s.holes));
  // 두께 20 → M8 드릴 21 은 바닥 관통 → 차단 / 두께 30 → 통과
  ok('두께 부족 시 M8 묶음 차단(하부 여유 0)', !s.ds.ok);
  await page.click('#leftTabs button[data-tab=stock]');
  const thick = page.locator('#leftBody .grid3 input').nth(2);
  await thick.fill('30'); await thick.press('Tab'); await sleep(150);
  s = await st(); ok('두께 30 으로 변경 시 통과', s.ds.ok, JSON.stringify(s.ds));

  // 8-2. [V0.3] 직접 구성 + 공정 묶음 적용 (기존 기능 유지 확인) 후 탭 간편 입력으로 복귀
  await page.click('#rightBody .seg button:has-text("직접 구성")'); await sleep(150);
  await page.locator('#rightBody select').first().selectOption({ label: 'M8 탭 (깊이 15)' });
  await page.click('#rightBody button:text-is("적용")'); await sleep(150);
  const ops2 = await page.evaluate(() => window.__PCAM_UI__.P.groups[2].ops.map(o => o.type + ':' + o.toolNo).join(','));
  ok('직접 구성: 공정 묶음 적용 유지 (M8: 스팟→심공→리지드탭)', ops2 === 'center:1,deep:5,rigid:14', ops2);
  await page.click('#rightBody .seg button:has-text("탭 (나사)")'); await sleep(150);
  await page.locator('#rightBody .wiz select').first().selectOption('8|1.25');
  const tdep2 = page.locator('#rightBody .wiz input[type=number]').first(); await tdep2.fill('15'); await tdep2.press('Tab'); await sleep(150);
  // 9. 클램프 그리기 → 홀과 겹치면 차단
  await page.click('#vtools button:has-text("클램프")');
  const v2 = await page.evaluate(() => { const U = window.__PCAM_UI__; return { cx: U.S.view.cx, cy: U.S.view.cy, sc: U.S.view.scale }; });
  const W = (x, y) => [box.x + box.width / 2 + (x - v2.cx) * v2.sc, box.y + box.height / 2 - (y - v2.cy) * v2.sc];
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
  await page.locator('#dlg2 button:has-text("검증 완료 승인")').first().click(); await sleep(100);
  ok('실장비 시험 체크 없이 승인 불가', !(await page.evaluate(() => window.__PCAM_UI__.DB.machines[0].verified)));
  await page.locator('#dlg2 input[type=checkbox]').nth(0).check(); await page.locator('#dlg2 input[type=checkbox]').nth(1).check(); await page.locator('#dlg2 input[type=checkbox]').nth(2).check();
  await page.locator('#dlg2 input[type=text]').first().fill('홍길동');
  await page.locator('#dlg2 button:has-text("검증 완료 승인")').first().click(); await sleep(150);
  s = await st();
  ok('관리자 승인 후 TEST 표시 해제', await page.evaluate(() => window.__PCAM_UI__.DB.machines[0].verified) && s.ds.ok && !s.ds.test, JSON.stringify(s.ds));
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
  await page.click('#leftTabs button[data-tab=machine]');
  const mr = page.locator('#leftBody .grid3 input').nth(3);
  await mr.fill('9000'); await mr.press('Tab'); await sleep(150);
  ok('장비 설정 변경 시 실가공 승인 자동 해제', !(await page.evaluate(() => window.__PCAM_UI__.DB.machines[0].verified)));

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
  ok('전체 백업 JSON (관리자 해시 제외)', bak.includes('"pcam-backup"') && !bak.includes('pcam.admin') && !bak.includes('"hash"'));
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
    const st2 = () => p2.evaluate(() => window.__PCAM_UI__.downloadState());
    // 개발 예정 가공: 공정 추가 목록에 표시되지만 선택 불가
    const planned = await p2.$$eval('#rightBody select option', os => os.filter(o => /개발 예정/.test(o.textContent)).map(o => o.disabled));
    ok('개발 예정 가공 4종 표시·선택 불가', planned.length === 4 && planned.every(Boolean), JSON.stringify(planned));
    // [검증 2] 재검증한 수정본 → 소재 축소 → 다운로드 다시 차단
    await p2.click('#bottomTabs button[data-tab=code]');
    await p2.click('#bottomBody button:has-text("직접 수정")'); await sleep(100);
    const ta2 = p2.locator('#ncText'); const v0 = await ta2.inputValue();
    await ta2.fill(v0.replace(/(G81[^\n]*\n)/, '$1X140. Y50.\n'));
    await p2.click('#bottomBody button:has-text("재검증")'); await sleep(150);
    ok('수정본(X140) 재검증 통과', (await st2()).ok, JSON.stringify(await st2()));
    await p2.click('#leftTabs button[data-tab=stock]');
    const sx = p2.locator('#leftBody .grid3 input').nth(0); await sx.fill('136'); await sx.press('Tab'); await sleep(200);
    const s3 = await st2();
    ok('[검증 2] 소재 변경 후 수정본 자동 재검사 → 차단', !s3.ok && /수정한 G코드 검증 오류/.test(s3.why), JSON.stringify(s3));
    let dlx = null; const w = p2.waitForEvent('download', { timeout: 1200 }).then(d => { dlx = d; }).catch(() => { });
    await p2.click('#btnDownload', { force: true }); await w;
    ok('[검증 2] 차단된 수정본 다운로드 안 됨', dlx === null);
    // [검증 9] 차단 상태에서 복사 거부
    await p2.evaluate(() => { window.__copied = null; navigator.clipboard && (navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }); document.execCommand = () => { window.__copied = 'exec'; return true; }; });
    await p2.click('#bottomTabs button[data-tab=code]'); await sleep(100);
    await p2.click('#bottomBody button:has-text("복사")', { force: true }); await sleep(150);
    ok('[검증 9] 차단 상태 G코드 복사 거부', (await p2.evaluate(() => window.__copied)) === null);
    ok('V0.2 안전 수정 화면 오류 없음', e2.length === 0, e2.join('|'));
    await c2.close();
  }

  // 14. 모바일 화면
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await mob.newPage(); const mErr = [];
  mp.on('pageerror', e => mErr.push(e.message));
  await mp.goto('file://' + HTML); await sleep(500);
  ok('모바일: 하단 탭 4개 표시', await mp.locator('#mnav button').count() === 4 && await mp.locator('#mnav').isVisible());
  ok('모바일: 기본 화면=그래픽, 다른 패널 숨김', await mp.locator('#view').isVisible() && !(await mp.locator('#right').isVisible()));
  if (SHOT) await mp.screenshot({ path: path.join(SHOT, 'e2e-4-mobile-view.png') });
  await mp.click('#mnav button[data-m=right]'); await sleep(150);
  ok('모바일: 홀·공정 패널 전환', await mp.locator('#right').isVisible() && !(await mp.locator('#view').isVisible()));
  if (SHOT) await mp.screenshot({ path: path.join(SHOT, 'e2e-5-mobile-right.png') });
  await mp.click('#mnav button[data-m=bottom]'); await sleep(150);
  if (SHOT) await mp.screenshot({ path: path.join(SHOT, 'e2e-6-mobile-check.png') });
  const hscroll = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('모바일: 가로 스크롤 없음', !hscroll);
  // 터치로 홀 추가
  await mp.click('#mnav button[data-m=view]'); await sleep(100);
  await mp.click('#vtools button:has-text("홀 추가")');
  const mb = await mp.locator('#cv').boundingBox();
  const n0 = await mp.evaluate(() => window.__PCAM_UI__.P.groups[0].holes.length);
  await mp.touchscreen.tap(mb.x + mb.width / 2, mb.y + mb.height / 2); await sleep(200);
  const n1 = await mp.evaluate(() => window.__PCAM_UI__.P.groups[0].holes.length);
  ok('모바일: 터치로 홀 추가', n1 === n0 + 1, n0 + '→' + n1);
  ok('모바일: 오류 없음', mErr.length === 0, mErr.join('|'));
  await mob.close();

  // 15. 웹 서버 배포 상태: 공유 링크·QR·최신 버전 확인
  const srv = await serve();
  const port = srv.address().port;
  const wp = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  const wErr = []; wp.on('pageerror', e => wErr.push(e.message)); wp.on('console', m => { if (m.type() === 'error') wErr.push(m.text()); });
  const url = 'http://127.0.0.1:' + port + '/pureun-ai-cam.html';
  await wp.goto(url); await sleep(400);
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

  await browser.close();
  const fail = results.filter(r => !r.ok);
  console.log('\n결과: ' + (results.length - fail.length) + ' / ' + results.length + ' 통과');
  if (fail.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
