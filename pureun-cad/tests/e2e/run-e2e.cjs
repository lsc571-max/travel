// 푸른캐드 화면·기능 통합 시험 (Playwright, 실제 브라우저에서 마우스·키보드 조작)
// 실행: npm run build && npm run e2e
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4174;
const results = [];

function startServer() {
  const p = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
  return p;
}

async function waitServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('서버 시작 실패');
}

(async () => {
  const srv = startServer();
  let browser;
  try {
    await waitServer();
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
    // 헤드리스 브라우저에는 파일 선택 창이 없으므로 내려받기/파일 입력 방식(대체 경로)으로 시험
    await ctx.addInitScript(() => {
      delete window.showSaveFilePicker;
      delete window.showOpenFilePicker;
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('dialog', (d) => d.accept());
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(600);

    const cmd = async (t) => {
      await page.fill('[data-testid=cmd-input]', t);
      await page.press('[data-testid=cmd-input]', 'Enter');
      await page.waitForTimeout(30);
    };
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const ents = () => ev(() => [...window.__pureunCad.eng.doc.entities.values()]);
    const reset = async () => {
      await ev(() => {
        const e = window.__pureunCad.eng;
        e.cancel(true);
        e.doc.clear();
        e.setSelection([]);
        e.view.fit({ minX: -20, minY: -20, maxX: 180, maxY: 120 });
        e.redrawAll();
      });
      await page.waitForTimeout(50);
    };
    const box = await page.locator('[data-testid=cad-canvas]').boundingBox();
    const scr = async (x, y) => {
      const s = await ev(([x, y]) => window.__pureunCad.eng.view.toScreen({ x, y }), [x, y]);
      return { x: box.x + s.x, y: box.y + s.y };
    };
    const click = async (x, y, opts = {}) => {
      const s = await scr(x, y);
      await page.mouse.move(s.x, s.y);
      await page.waitForTimeout(20);
      await page.mouse.click(s.x, s.y, opts);
      await page.waitForTimeout(30);
    };
    const test = async (name, fn) => {
      // 이전 시험에서 남은 대화상자 닫기
      for (let i = 0; i < 3 && (await page.locator('.modal-bg').count()); i++) await page.keyboard.press('Escape');
      try {
        await fn();
        results.push({ name, ok: true });
        console.log('✔', name);
      } catch (e) {
        results.push({ name, ok: false, err: String(e.message || e) });
        console.log('✘', name, '—', e.message);
        await page.screenshot({ path: path.join(OUT, `fail-${results.length}.png`) });
        await ev(() => window.__pureunCad.eng.cancel(true));
      }
    };
    const eq = (a, b, m = '') => {
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} 기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)}`);
    };
    const near = (a, b, tol = 1e-9, m = '') => {
      if (Math.abs(a - b) > tol) throw new Error(`${m} 기대 ${b} / 실제 ${a}`);
    };

    await test('명령창 작도: REC, CIRCLE, LINE (절대/상대/극좌표)', async () => {
      await reset();
      await cmd('REC');
      await cmd('0,0');
      await cmd('@120,80');
      await cmd('C');
      await cmd('30,40');
      await cmd('10');
      await cmd('C');
      await cmd('90,40');
      await cmd('D');
      await cmd('20');
      await cmd('L');
      await cmd('0,100');
      await cmd('@50<0');
      await cmd('@0,20');
      await cmd('');
      const es = await ents();
      eq(es.map((e) => e.type), ['polyline', 'circle', 'circle', 'line', 'line']);
      eq(es[2].r, 10, '지름 20 → 반지름');
      eq(es[3].p2, { x: 50, y: 100 }, '극좌표');
      eq(es[4].p2, { x: 50, y: 120 }, '상대좌표');
    });

    await test('객체 스냅(끝점·중심점)으로 정확한 좌표 지정', async () => {
      await cmd('L');
      await click(0.6, 0.4); // 사각형 모서리 근처 → 끝점 스냅
      await click(30 + 10 * Math.cos(1), 40 + 10 * Math.sin(1)); // 원 위 → 중심점 스냅
      await page.keyboard.press('Escape');
      const es = await ents();
      const l = es[es.length - 1];
      eq(l.p1, { x: 0, y: 0 }, '끝점 스냅');
      eq(l.p2, { x: 30, y: 40 }, '중심점 스냅');
      await cmd('U');
      eq((await ents()).length, 5, 'U 실행취소');
    });

    await test('직교(F8) + 직접 거리 입력', async () => {
      await cmd('L');
      await cmd('0,-10');
      await page.keyboard.press('F8');
      const s = await scr(40, -7);
      await page.mouse.move(s.x, s.y);
      await page.waitForTimeout(30);
      await cmd('35');
      await page.keyboard.press('Escape');
      await page.keyboard.press('F8');
      const l = (await ents()).pop();
      eq(l.p2, { x: 35, y: -10 });
      await cmd('U');
    });

    await test('창 선택(왼→오) / 걸치기 선택(오→왼)', async () => {
      // 창: 왼쪽 원만 완전히 포함
      let a = await scr(15, 25), b = await scr(45, 55);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 5 });
      await page.mouse.up();
      let n = await ev(() => window.__pureunCad.eng.sel.size);
      eq(n, 1, '창 선택 개수');
      await page.keyboard.press('Escape');
      // 걸치기: 오른쪽→왼쪽, 같은 영역 → 원 + 사각형(걸침 없음) ... 영역을 사각형 아래 변까지 확장
      a = await scr(45, 55);
      b = await scr(15, -5);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 5 });
      await page.mouse.up();
      n = await ev(() => window.__pureunCad.eng.sel.size);
      eq(n, 2, '걸치기 선택 개수(원+사각형)');
      await page.keyboard.press('Escape');
    });

    await test('MOVE (선택 후 실행) / COPY / ROTATE', async () => {
      await click(30 + 10, 40); // 왼쪽 원 선택
      await cmd('M');
      await cmd('30,40');
      await cmd('@0,-5');
      let c = (await ents())[1];
      eq(c.c, { x: 30, y: 35 }, 'MOVE');
      await cmd('U');
      await cmd('CO');
      await click(90 + 10, 40);
      await cmd('');
      await cmd('90,40');
      await cmd('@0,30');
      await cmd('@0,60');
      await cmd('');
      let es = await ents();
      eq(es.filter((e) => e.type === 'circle').length, 4, 'COPY 2회');
      await cmd('U');
      eq((await ents()).filter((e) => e.type === 'circle').length, 2, 'COPY 묶음 실행취소');
      await cmd('RO');
      await click(50, 100); // 선 선택
      await cmd('');
      await cmd('0,100');
      await cmd('90');
      es = await ents();
      const l = es[3];
      near(l.p2.x, 0, 1e-9, 'ROTATE x');
      near(l.p2.y, 150, 1e-9, 'ROTATE y');
      await cmd('U');
    });

    await test('TRIM: 두 원 사이 선 부분 제거', async () => {
      await cmd('L');
      await cmd('-10,40');
      await cmd('130,40');
      await cmd('');
      await cmd('TR');
      await click(60, 40); // 두 원 사이
      await cmd('');
      const ls = (await ents()).filter((e) => e.type === 'line' && e.p1.y === 40 && e.p2.y === 40);
      eq(ls.length, 2, '조각 수');
      const xs = ls.map((l) => [l.p1.x, l.p2.x]).sort((a, b) => a[0] - b[0]);
      near(xs[0][1], 40, 1e-9, '왼쪽 조각 끝');
      near(xs[1][0], 80, 1e-9, '오른쪽 조각 시작');
    });

    await test('OFFSET: 사각형 바깥쪽 5', async () => {
      await cmd('O');
      await cmd('5');
      await click(60, 0);
      await click(60, -3);
      await cmd('');
      const ps = (await ents()).filter((e) => e.type === 'polyline');
      eq(ps.length, 2);
      eq(ps[1].pts.map((p) => [p.x, p.y]), [[-5, -5], [125, -5], [125, 85], [-5, 85]], '오프셋 꼭짓점');
    });

    await test('치수: 선형(자동 수평/수직)·지름·반지름', async () => {
      await cmd('DLI');
      await cmd('0,0');
      await cmd('120,0');
      await cmd('60,-15');
      await cmd('DLI');
      await cmd('120,0');
      await cmd('120,80');
      await click(140, 40); // 오른쪽 → 수직
      await cmd('DDI');
      await click(100, 40);
      await click(110, 60);
      await cmd('DRA');
      await click(20, 40);
      await click(10, 55);
      const ds = (await ents()).filter((e) => e.type === 'dimension');
      eq(ds.map((d) => d.kind), ['linear', 'linear', 'diameter', 'radius']);
      eq(ds[1].rot, 90, '수직 치수 자동');
      const vals = await ev(() => {
        const e = window.__pureunCad.eng;
        return [...e.doc.entities.values()].filter((x) => x.type === 'dimension').map((d) => d.kind);
      });
      eq(vals.length, 4);
    });

    await test('동일 지름 원 일괄 변경 (중심 유지)', async () => {
      await cmd('HD');
      await page.getByRole('cell', { name: 'Ø20', exact: true }).click();
      await page.fill('#newdia', '16');
      await page.getByRole('button', { name: '일괄 변경', exact: true }).click();
      await page.keyboard.press('Escape');
      const cs = (await ents()).filter((e) => e.type === 'circle');
      eq(cs.map((c) => [c.c, c.r]), [[{ x: 30, y: 40 }, 8], [{ x: 90, y: 40 }, 8]]);
      await cmd('U');
      eq((await ents()).filter((e) => e.type === 'circle').map((c) => c.r), [10, 10], '일괄 변경 실행취소');
    });

    await test('레이어: 생성·현재·잠금 → 잠긴 객체 보호', async () => {
      await cmd('LA');
      await page.getByRole('button', { name: '새 레이어' }).click();
      const rows = page.locator('.grid-table tbody tr');
      eq(await rows.count(), 2);
      await rows.nth(1).locator('input[type=radio]').check();
      await page.keyboard.press('Escape');
      await cmd('C');
      await cmd('200,200');
      await cmd('5');
      let c = (await ents()).pop();
      eq(c.layer, '레이어1');
      await cmd('LA');
      await page.locator('.grid-table tbody tr').nth(1).getByTitle('잠금').click();
      await page.locator('.grid-table tbody tr').nth(0).locator('input[type=radio]').check();
      await page.keyboard.press('Escape');
      await ev(() => window.__pureunCad.eng.setSelection([]));
      await cmd('E');
      await cmd('ALL');
      await cmd('');
      const left = await ents();
      eq(left.length, 1, '잠긴 레이어 객체만 남음');
      eq(left[0].layer, '레이어1');
      await cmd('U');
    });

    await test('DXF 저장(R12) → 다시 열기 왕복 + ezdxf 검사', async () => {
      const [dl] = await Promise.all([page.waitForEvent('download'), (async () => {
        await cmd('SAVEAS');
        await page.getByRole('button', { name: '저장', exact: true }).click();
      })()]);
      const f = path.join(OUT, 'e2e-save.dxf');
      await dl.saveAs(f);
      const txt = fs.readFileSync(f, 'utf8');
      if (!txt.includes('AC1009')) throw new Error('R12 아님');
      const before = await ents();
      const audit = execFileSync('python3', [path.join(ROOT, 'tests/e2e/audit_dxf.py'), f]).toString();
      if (!audit.includes('AUDIT OK')) throw new Error('ezdxf 검사 실패: ' + audit);
      // 새 도면 후 열기
      await ev(() => (window.__pureunCad.eng.doc.modified = false));
      await cmd('NEW');
      const [fc] = await Promise.all([page.waitForEvent('filechooser'), cmd('OPEN')]);
      await fc.setFiles(f);
      await page.waitForTimeout(300);
      const after = await ents();
      eq(after.length, before.length, '객체 수');
      const canon = (o) => (Array.isArray(o) ? o.map(canon) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, canon(o[k])])) : o);
      const geo = (a) => a.filter((e) => e.type !== 'dimension').map(({ id, ...r }) => JSON.stringify(canon(r))).sort();
      eq(geo(after), geo(before), '기하 데이터 일치');
      console.log('   ezdxf:', audit.trim().split('\n').pop());
    });

    await test('실무 도면(flange_R2000.dxf, 한글 CP949): 열기 → 볼트 구멍 8-Ø14→Ø13.5 일괄 변경 → 잠금 보호 → 저장·감사', async () => {
      await ev(() => (window.__pureunCad.eng.doc.modified = false));
      const [fc] = await Promise.all([page.waitForEvent('filechooser'), cmd('OPEN')]);
      await fc.setFiles(path.join(ROOT, 'tests/fixtures/flange_R2000.dxf'));
      await page.getByRole('dialog', { name: 'DXF 열기 결과' }).waitFor();
      const warn = await page.getByRole('dialog').innerText();
      if (!/INSERT/.test(warn) || !/SPLINE/.test(warn)) throw new Error('미지원 객체 경고 누락: ' + warn);
      await page.keyboard.press('Escape');
      const t = (await ents()).find((e) => e.type === 'text');
      eq(t.text, '플랜지 8-%%c14 PCD150', '한글 문자');
      const before = (await ents()).filter((e) => e.type === 'circle' && e.r === 7).map((c) => c.c);
      eq(before.length, 8);
      await cmd('HD');
      await page.getByRole('cell', { name: 'Ø14', exact: true }).click();
      await page.fill('#newdia', '13.5');
      await page.getByRole('button', { name: '일괄 변경', exact: true }).click();
      await page.keyboard.press('Escape');
      const after = (await ents()).filter((e) => e.type === 'circle' && e.r === 6.75).map((c) => c.c);
      eq(after, before, '구멍 중심 유지');
      // 잠긴 레이어 객체 지우기 시도
      await ev(() => window.__pureunCad.eng.setSelection([]));
      const n0 = (await ents()).length;
      await cmd('E');
      await cmd('ALL');
      await cmd('');
      const left = await ents();
      if (!left.some((e) => e.layer === '잠금')) throw new Error('잠긴 레이어 객체가 지워짐');
      if (!left.some((e) => e.layer === '숨김')) throw new Error('숨김 레이어 객체가 지워짐');
      await cmd('U');
      eq((await ents()).length, n0, '실행취소 후 복원');
      const [dl] = await Promise.all([page.waitForEvent('download'), (async () => {
        await cmd('SAVEAS');
        await page.getByText('근사 형상(선·폴리선·문자)으로 변환하여 포함', { exact: false }).click();
        await page.getByRole('button', { name: '저장', exact: true }).click();
      })()]);
      const f = path.join(OUT, 'e2e-flange-modified.dxf');
      await dl.saveAs(f);
      const audit = execFileSync('python3', [path.join(ROOT, 'tests/e2e/audit_dxf.py'), f]).toString();
      if (!audit.includes('AUDIT OK')) throw new Error('ezdxf 검사 실패: ' + audit);
      console.log('   ezdxf:', audit.trim().split('\n')[0]);
      await page.screenshot({ path: path.join(OUT, 'flange.png') });
    });

    await test('설정 1회 클릭 → 일반 설정, 민감 정보 없음', async () => {
      await page.getByTestId('open-settings').click();
      await page.getByRole('dialog', { name: '설정' }).waitFor();
      const t = await page.getByRole('dialog').innerText();
      if (/비밀번호|API/i.test(t)) throw new Error('일반 설정에 민감 항목 노출');
    });

    await test('설정 아이콘 4회 클릭은 무반응, 3초 초과 시 초기화', async () => {
      await page.getByTestId('open-settings').click();
      const g = page.getByTestId('settings-gear');
      for (let i = 0; i < 4; i++) await g.click();
      await page.waitForTimeout(3100);
      await g.click();
      if (await page.getByRole('dialog', { name: /관리자/ }).count()) throw new Error('관리자 창이 열림');
    });

    await test('설정 아이콘 3초 안에 5회 → 비밀번호 등록 → 관리자 설정', async () => {
      await page.getByTestId('open-settings').click();
      const g = page.getByTestId('settings-gear');
      for (let i = 0; i < 5; i++) await g.click();
      await page.getByRole('dialog', { name: /관리자 비밀번호 등록/ }).waitFor();
      await page.fill('#apw', 'test-pass-1234');
      await page.fill('#apw2', 'test-pass-1234');
      await page.getByRole('button', { name: '등록' }).click();
      await page.getByRole('dialog', { name: '관리자 설정' }).waitFor();
      const stored = await ev(() => localStorage.getItem('pureun-cad.admin'));
      if (stored.includes('test-pass-1234')) throw new Error('비밀번호 원문 저장됨');
      await page.getByRole('button', { name: '관리자 설정 종료' }).click();
    });

    await test('관리자 인증: 오답 거부·5회 실패 잠금·5회 클릭만으로 통과 불가', async () => {
      await page.getByTestId('open-settings').click();
      const g = page.getByTestId('settings-gear');
      for (let i = 0; i < 5; i++) await g.click();
      await page.getByRole('dialog', { name: '관리자 인증' }).waitFor();
      for (let i = 0; i < 5; i++) {
        await page.fill('#apw', 'wrong-' + i);
        await page.getByRole('button', { name: '확인' }).click();
        await page.waitForTimeout(400);
      }
      const txt = await page.getByRole('dialog').innerText();
      if (!txt.includes('잠겼습니다') && !txt.includes('잠겨 있습니다')) throw new Error('잠금 안 됨: ' + txt);
      if (await page.getByRole('dialog', { name: '관리자 설정' }).count()) throw new Error('인증 없이 통과');
      await ev(() => localStorage.removeItem('pureun-cad.admin.fail'));
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    });

    await test('접근성 대체 경로: 설정 아이콘에 키보드 초점 + Enter 5회 → 관리자 인증 창', async () => {
      await page.getByTestId('open-settings').click();
      await page.getByTestId('settings-gear').focus();
      for (let i = 0; i < 5; i++) await page.keyboard.press('Enter');
      await page.getByRole('dialog', { name: '관리자 인증' }).waitFor({ timeout: 3000 });
      await page.keyboard.press('Escape');
    });

    await test('공유(링크·QR) / 버전 정보', async () => {
      await page.getByRole('button', { name: '공유', exact: true }).click();
      const img = page.locator('.qr img');
      await img.waitFor();
      const w = await img.evaluate((i) => i.naturalWidth);
      if (w < 200) throw new Error('QR 이미지 크기');
      await page.screenshot({ path: path.join(OUT, 'share.png') });
      await page.keyboard.press('Escape');
      await page.locator('.status .ver').click();
      await page.getByRole('button', { name: '업그레이드 확인' }).click();
      await page.getByText(/최신 버전입니다|새 버전/).waitFor();
      await page.keyboard.press('Escape');
    });

    await test('ESC 취소 시 원본 유지 / 계산 불가 오프셋 오류 메시지', async () => {
      await ev(() => (window.__pureunCad.eng.doc.modified = false));
      await reset();
      await cmd('C');
      await cmd('30,40');
      await cmd('10');
      const n0 = (await ents()).length;
      await cmd('O');
      await cmd('100');
      await click(30, 50); // 원 위쪽
      await click(30, 41); // 안쪽 → 반지름 초과
      const h = await page.getByTestId('cmd-history').innerText();
      if (!h.includes('반지름보다 커서')) throw new Error('오류 메시지 없음');
      await page.keyboard.press('Escape');
      eq((await ents()).length, n0, '객체 수 유지');
    });


    // ───── V1 사용성 기능 ─────
    await test('V1 명령 자동완성: "FI" 입력 → 목록에 FILLET, Tab으로 실행', async () => {
      await reset();
      await page.click('[data-testid=cmd-input]');
      await page.keyboard.type('FI');
      await page.getByRole('listbox', { name: '명령 자동완성' }).waitFor();
      const t = await page.getByRole('listbox').innerText();
      if (!t.includes('FILLET')) throw new Error('자동완성에 FILLET 없음: ' + t);
      await page.keyboard.press('Tab');
      eq(await ev(() => window.__pureunCad.eng.cmd?.name), 'FILLET');
      await page.keyboard.press('Escape');
      await cmd('모깎기');
      eq(await ev(() => window.__pureunCad.eng.cmd?.name), 'FILLET', '한글 명령 이름');
      await page.keyboard.press('Escape');
    });

    await test('V1 그립 편집: 선 끝점 그립을 끌어 @10,0 입력', async () => {
      await reset();
      await cmd('L');
      await cmd('0,0');
      await cmd('50,0');
      await cmd('');
      await click(25, 0); // 선 선택
      const g = await scr(50, 0);
      await page.mouse.move(g.x, g.y);
      await page.mouse.click(g.x, g.y); // 끝점 그립
      eq(await ev(() => window.__pureunCad.eng.cmd?.name), '그립 편집');
      await cmd('@10,0');
      const l = (await ents())[0];
      eq(l.p2, { x: 60, y: 0 });
      await cmd('U');
      eq((await ents())[0].p2, { x: 50, y: 0 }, '그립 편집 실행취소');
      await page.keyboard.press('Escape');
    });

    await test('V1 모깎기 R5 (선택 클릭) / 원형 배열 8개 / 대칭', async () => {
      await reset();
      await cmd('L');
      await cmd('0,0');
      await cmd('40,0');
      await cmd('');
      await cmd('L');
      await cmd('0,0');
      await cmd('0,40');
      await cmd('');
      await cmd('F');
      await cmd('R');
      await cmd('5');
      await click(30, 0);
      await click(0, 30);
      const es = await ents();
      const arc = es.find((e) => e.type === 'arc');
      if (!arc) throw new Error('모깎기 호 없음');
      near(arc.r, 5);
      near(arc.c.x, 5, 1e-9);
      near(arc.c.y, 5, 1e-9);
      await cmd('C');
      await cmd('75,0');
      await cmd('7');
      await click(82, 0);
      await cmd('AR');
      await cmd('P');
      await cmd('0,0');
      await cmd('8');
      await cmd('360');
      await cmd('');
      const holes = (await ents()).filter((e) => e.type === 'circle');
      eq(holes.length, 8, '원형 배열');
      await ev(() => window.__pureunCad.eng.setSelection([]));
      await cmd('MI');
      await click(20, 0);
      await cmd('');
      await cmd('0,0');
      await cmd('0,10');
      await cmd('N');
      eq((await ents()).filter((e) => e.type === 'line').length, 3, '대칭 복사');
    });

    await test('V1 극좌표 추적(F10): 30° 근처로 커서 → 정확히 30° 선 위의 점', async () => {
      await reset();
      await ev(() => {
        const e = window.__pureunCad.eng;
        e.settings.polar = true;
        e.settings.ortho = false;
        e.settings.osnap = false;
      });
      await cmd('L');
      await cmd('0,0');
      const a = (30.6 * Math.PI) / 180;
      const s = await scr(60 * Math.cos(a), 60 * Math.sin(a));
      await page.mouse.move(s.x, s.y);
      await page.waitForTimeout(50);
      await page.mouse.click(s.x, s.y);
      await page.keyboard.press('Escape');
      await ev(() => (window.__pureunCad.eng.settings.osnap = true));
      const l = (await ents())[0];
      near(Math.atan2(l.p2.y, l.p2.x) * (180 / Math.PI), 30, 1e-9, '각도');
      await page.screenshot({ path: path.join(OUT, 'polar.png') });
    });

    await test('V1 동적 입력 툴팁·오른쪽 클릭 메뉴·두 번 클릭 문자 편집', async () => {
      await reset();
      await cmd('DT');
      await cmd('10,10');
      await cmd('5');
      await cmd('0');
      await cmd('ABC');
      await cmd('');
      const s = await scr(13, 12);
      await page.mouse.dblclick(s.x, s.y);
      await page.waitForTimeout(100);
      eq(await page.inputValue('[data-testid=cmd-input]'), 'ABC', '기존 문자 미리 채움');
      await page.fill('[data-testid=cmd-input]', '구멍 4-%%c10');
      await page.press('[data-testid=cmd-input]', 'Enter');
      eq((await ents())[0].text, '구멍 4-%%c10');
      await page.keyboard.press('Escape');
      await click(13, 12);
      await page.mouse.click(s.x + 80, s.y + 80, { button: 'right' });
      await page.getByRole('menu').waitFor();
      const m = await page.getByRole('menu').innerText();
      if (!m.includes('대칭') || !m.includes('분해')) throw new Error('바로가기 메뉴 항목 누락');
      await page.screenshot({ path: path.join(OUT, 'contextmenu.png') });
      await page.keyboard.press('Escape');
      await cmd('L');
      await cmd('0,0');
      const t = await scr(30, 20);
      await page.mouse.move(t.x, t.y);
      await page.waitForTimeout(60);
      await page.screenshot({ path: path.join(OUT, 'dyninput.png') });
      await page.keyboard.press('Escape');
    });

    await test('V1 가공 검사·중복 정리', async () => {
      await reset();
      await cmd('L');
      await cmd('0,0');
      await cmd('10,0');
      await cmd('');
      await cmd('L');
      await cmd('10,0');
      await cmd('0,0');
      await cmd('');
      await cmd('CC');
      const h = await page.getByTestId('cmd-history').innerText();
      if (!/중복 1개/.test(h)) throw new Error('가공 검사 결과: ' + h.split('\n').pop());
      await cmd('OV');
      await cmd('ALL');
      await cmd('');
      eq((await ents()).length, 1, '중복 정리 후');
    });

    await ev(() => window.__pureunCad.eng.zoomExtents());
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(OUT, 'final.png') });
    if (errors.length) results.push({ name: '브라우저 콘솔 오류 없음', ok: false, err: errors.join(' | ') });
    else results.push({ name: '브라우저 콘솔 오류 없음', ok: true });
  } finally {
    if (browser) await browser.close();
    try { process.kill(-srv.pid); } catch {}
  }
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n결과: ${ok}/${results.length} 통과`);
  fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
  process.exit(ok === results.length ? 0 : 1);
})();
