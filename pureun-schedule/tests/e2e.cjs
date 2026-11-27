// 실제 브라우저 기능 테스트 (Playwright). Google 로그인·캘린더 서버는 가짜로 대체해 외부 요청 없이 실행한다.
// 사용: npm run build && npm run e2e   (스크린샷: test-results/)
const { chromium, devices } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;
const OUT = path.join(__dirname, '..', 'test-results');
fs.mkdirSync(OUT, { recursive: true });

let passed = 0;
const failures = [];
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.log(`  ✗ ${name}\n      ${String(e.message || e).split('\n').slice(0,6).join(' / ')}`); }
}
function assert(c, msg) { if (!c) throw new Error(msg); }

// ───── 가짜 Google Calendar 서버 ─────
function makeFakeCalendar() {
  let seq = 1, etagSeq = 1;
  const cals = { primary: new Map(), 'ko.south_korea#holiday@group.v.calendar.google.com': new Map() };
  const overrides = new Map(); // instanceId -> event | {status:'cancelled'}
  const state = { owner: 'owner@example.com' };
  const newEtag = () => `"e${etagSeq++}"`;
  const hol = cals['ko.south_korea#holiday@group.v.calendar.google.com'];
  hol.set('h1', { id: 'h1', etag: newEtag(), summary: '성탄절', start: { date: '2026-12-25' }, end: { date: '2026-12-26' } });
  hol.set('h2', { id: 'h2', etag: newEtag(), summary: '테스트 휴일', start: { date: '2026-11-27' }, end: { date: '2026-11-28' } });

  const withOffset = (dt) => (dt && !/[+-]\d\d:\d\d$|Z$/.test(dt) ? `${dt}+09:00` : dt);
  const norm = (ev) => ({ ...ev, start: { ...ev.start, dateTime: withOffset(ev.start.dateTime) }, end: { ...ev.end, dateTime: withOffset(ev.end.dateTime) } });
  const startMs = (ev) => (ev.start.date ? Date.parse(`${ev.start.date}T00:00:00+09:00`) : Date.parse(withOffset(ev.start.dateTime)));
  const endMs = (ev) => (ev.end.date ? Date.parse(`${ev.end.date}T00:00:00+09:00`) : Date.parse(withOffset(ev.end.dateTime)));
  const ymd = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

  function expand(m) {
    const rule = Object.fromEntries(m.recurrence[0].slice(6).split(';').map((x) => x.split('=')));
    const count = Number(rule.COUNT || 30);
    const byDay = rule.BYDAY ? rule.BYDAY.split(',') : null;
    const s0 = startMs(m), dur = endMs(m) - s0;
    const out = [];
    for (let d = 0, n = 0; n < count && d < 400; d++) {
      const s = s0 + d * 86400e3;
      const dow = DAYS[new Date(s + 9 * 3600e3).getUTCDay()];
      if (rule.FREQ === 'WEEKLY' && !(byDay || [DAYS[new Date(s0 + 9 * 3600e3).getUTCDay()]]).includes(dow)) continue;
      if (rule.FREQ !== 'DAILY' && rule.FREQ !== 'WEEKLY') break;
      n++;
      const id = `${m.id}_${ymd(s)}`;
      const toDT = (ms) => (m.start.date ? { date: new Date(ms + 9 * 3600e3).toISOString().slice(0, 10) } : { dateTime: new Date(ms + 9 * 3600e3).toISOString().slice(0, 19) + '+09:00', timeZone: 'Asia/Seoul' });
      const base = { ...m, id, recurringEventId: m.id, etag: m.etag, start: toDT(s), end: toDT(s + dur), originalStartTime: toDT(s) };
      delete base.recurrence;
      const ov = overrides.get(id);
      if (ov?.status === 'cancelled') continue;
      out.push(ov ? { ...ov } : base);
    }
    return out;
  }
  function all(cal) {
    const res = [];
    for (const ev of cals[cal].values()) res.push(...(ev.recurrence ? expand(ev) : [ev]));
    return res;
  }
  function findAny(cal, id) {
    if (cals[cal].has(id)) return cals[cal].get(id);
    return all(cal).find((e) => e.id === id);
  }

  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const m = /\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(url.pathname);
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });
    if (req.headers().authorization !== 'Bearer fake-token') return json(401, { error: { message: 'no auth' } });
    if (!m) return json(404, { error: { message: 'nf' } });
    const cal = decodeURIComponent(m[1]);
    const id = m[2] && decodeURIComponent(m[2]);
    if (!cals[cal]) return json(404, { error: { message: 'no cal' } });
    const method = req.method();
    const ifMatch = req.headers()['if-match'];
    if (method === 'GET' && !id) {
      const a = Date.parse(url.searchParams.get('timeMin')), b = Date.parse(url.searchParams.get('timeMax'));
      const items = all(cal).filter((e) => (Number.isNaN(b) || startMs(e) < b) && endMs(e) > a).map(norm);
      return json(200, { summary: cal === 'primary' ? state.owner : '대한민국의 휴일', items });
    }
    if (method === 'GET') { const e = findAny(cal, id); return e ? json(200, norm(e)) : json(404, { error: { message: 'nf' } }); }
    if (method === 'POST') {
      const body = req.postDataJSON();
      const ev = { ...body, id: `ev${seq++}`, etag: newEtag(), status: 'confirmed' };
      cals[cal].set(ev.id, ev);
      return json(200, norm(ev));
    }
    if (method === 'PUT') {
      const cur = findAny(cal, id);
      if (!cur) return json(404, { error: { message: 'nf' } });
      if (ifMatch && ifMatch !== cur.etag) return json(412, { error: { message: 'Precondition Failed' } });
      const body = { ...req.postDataJSON(), id, etag: newEtag() };
      if (cals[cal].has(id)) cals[cal].set(id, body); else overrides.set(id, body);
      return json(200, norm(body));
    }
    if (method === 'DELETE') {
      const cur = findAny(cal, id);
      if (!cur) return json(410, { error: { message: 'gone' } });
      if (ifMatch && ifMatch !== cur.etag) return json(412, { error: { message: 'Precondition Failed' } });
      if (cals[cal].has(id)) cals[cal].delete(id); else overrides.set(id, { status: 'cancelled' });
      return json(204);
    }
    return json(400, {});
  }
  return { handle, cals, overrides, all, state, bump: (id) => { const e = cals.primary.get(id); e.summary += ' (다른 기기)'; e.etag = newEtag(); } };
}

// ───── 가짜 Google 할 일(Tasks) 서버 ─────
function makeFakeTasks() {
  let seq = 1;
  const lists = [{ id: 'L1', title: '내 할 일' }];
  const store = new Map([['L1', new Map()]]);
  const L1 = store.get('L1');
  L1.set('t1', { id: 't1', title: '성적 입력', status: 'needsAction', due: '2026-11-23T00:00:00.000Z', position: '001' });
  L1.set('t2', { id: 't2', title: '강의자료 준비', status: 'needsAction', due: '2026-11-26T00:00:00.000Z', position: '002' });
  L1.set('t3', { id: 't3', title: '책 반납', status: 'needsAction', position: '003' });
  L1.set('t4', { id: 't4', title: '출장 보고서', status: 'completed', completed: '2026-11-20T01:00:00.000Z', due: '2026-11-20T00:00:00.000Z', position: '004' });
  L1.set('t5', { id: 't5', title: '숨긴 완료 항목', status: 'completed', hidden: true, completed: '2026-11-01T01:00:00.000Z', position: '005' });
  const patches = [];

  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });
    if (req.headers().authorization !== 'Bearer fake-token') return json(401, { error: { message: 'no auth' } });
    const p = decodeURIComponent(url.pathname);
    if (req.method() === 'GET' && p === '/tasks/v1/users/@me/lists') return json(200, { items: lists });
    const m = /^\/tasks\/v1\/lists\/([^/]+)\/tasks(?:\/([^/]+))?$/.exec(p);
    if (!m || !store.has(m[1])) return json(404, { error: { message: 'nf' } });
    const tasks = store.get(m[1]);
    const id = m[2];
    const method = req.method();
    if (method === 'GET' && !id) {
      const showHidden = url.searchParams.get('showHidden') === 'true';
      return json(200, { items: [...tasks.values()].filter((t) => showHidden || !t.hidden) });
    }
    if (method === 'POST' && !id) {
      const t = { ...req.postDataJSON(), id: `n${seq++}`, position: '900' };
      if (t.status === 'completed') t.completed = new Date().toISOString();
      tasks.set(t.id, t);
      return json(200, t);
    }
    const cur = id && tasks.get(id);
    if (!cur) return json(404, { error: { message: 'nf' } });
    if (method === 'PATCH') {
      const body = req.postDataJSON();
      patches.push(body);
      for (const [k, v] of Object.entries(body)) { if (v === null) delete cur[k]; else cur[k] = v; }
      if (body.status === 'completed' && !cur.completed) cur.completed = new Date().toISOString();
      return json(200, cur);
    }
    if (method === 'DELETE') { tasks.delete(id); return json(204); }
    return json(400, {});
  }
  return { handle, L1, patches };
}

const FAKE_GIS = `window.google = { accounts: { oauth2: {
  initTokenClient(cfg) { window.__gisInit = cfg.client_id; window.__gisScope = cfg.scope; return { requestAccessToken() { setTimeout(() => cfg.callback({ access_token: 'fake-token', expires_in: 3600, scope: cfg.scope }), 20); } }; },
  hasGrantedAllScopes() { return true; },
  hasGrantedAnyScope(r, s) { return !(window.__denyTasks && /tasks/.test(s)); },
  revoke(t, cb) { window.__revoked = t; cb && cb(); }
} } };`;

(async () => {
  // 시험은 "클라이언트 ID 없는 첫 실행"부터 확인하므로, ID를 비운 시험 전용 빌드를 따로 만든다 (배포용 dist/는 건드리지 않음).
  // npx 대신 node로 vite를 직접 실행한다 (Windows에서 npx.cmd 실행·종료 문제 방지).
  const root = path.join(__dirname, '..');
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const E2E_DIST = path.join('test-results', 'dist');
  execFileSync(process.execPath, [vite, 'build', '--outDir', E2E_DIST, '--emptyOutDir'], { cwd: root, stdio: 'ignore', env: { ...process.env, VITE_GOOGLE_CLIENT_ID: '' } });
  const server = spawn(process.execPath, [vite, 'preview', '--outDir', E2E_DIST, '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  const browser = await chromium.launch();
  const fake = makeFakeCalendar();
  const fakeTasks = makeFakeTasks();
  const errors = [];
  const external = [];

  async function newPage(opts = {}) {
    const ctx = await browser.newContext({ ...opts, timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
    await ctx.clock.install({ time: new Date('2026-11-24T10:00:00+09:00') });
    // 나중에 등록한 규칙이 먼저 적용되므로 '외부 차단'을 가장 먼저 등록
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => { external.push(r.request().url()); r.abort(); });
    await ctx.route('https://accounts.google.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_GIS }));
    await ctx.route('https://www.googleapis.com/calendar/v3/**', fake.handle);
    await ctx.route('https://tasks.googleapis.com/tasks/v1/**', fakeTasks.handle);
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    return { ctx, page };
  }

  const { ctx, page } = await newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(BASE);
  const dialogOpen = (id) => page.locator(`dialog#${id}[open]`);
  const tapGear = async (n) => { for (let i = 0; i < n; i++) await page.click('#settingsGear'); };

  console.log('PC 화면');
  await step('첫 실행: 처음 설정 안내 표시', async () => {
    await page.waitForSelector('#banner:not([hidden])');
    assert((await page.textContent('#bannerText')).includes('처음 설정'), '안내 문구 없음');
    assert((await page.textContent('#verBtn')) === 'V1.2', '버전 표시 없음');
  });

  await step('관리자 비밀번호 최초 등록 → 관리자 설정 열림', async () => {
    await page.click('#bannerBtn');
    await dialogOpen('adminAuth').waitFor();
    assert((await page.textContent('#aaTitle')).includes('등록'), '등록 화면 아님');
    await page.fill('#aaPw', 'blue1234');
    await page.fill('#aaPw2', 'blue9999');
    await page.click('#aaOk');
    assert((await page.textContent('#aaError')).includes('다릅니다'), '불일치 검사 실패');
    await page.fill('#aaPw2', 'blue1234');
    await page.click('#aaOk');
    await dialogOpen('admin').waitFor();
    const stored = await page.evaluate(() => localStorage.getItem('pc.admin.pw'));
    assert(stored && !stored.includes('blue1234'), '비밀번호 원문 저장됨');
  });

  await step('클라이언트 ID 형식 검사·저장·연결 테스트 성공', async () => {
    await page.fill('#adClientId', 'not-a-client-id');
    await page.click('#adminBody button:has-text("저장하기")');
    assert((await page.textContent('#adStatus')).includes('형식'), '형식 오류 미표시');
    await page.fill('#adClientId', '123456789-abcdef.apps.googleusercontent.com');
    await page.click('#adminBody button:has-text("저장하기")');
    await page.click('#adminBody button:has-text("연결 테스트")');
    await page.waitForFunction(() => document.querySelector('#adStatus')?.textContent?.includes('연결 성공'), null, { timeout: 5000 }).catch(async (e) => { throw new Error('status=' + await page.textContent('#adStatus') + ' errors=' + errors.join('|')); });
    await page.screenshot({ path: `${OUT}/01-admin.png` });
    await page.click('#admin [data-close]');
    await page.waitForSelector('#adminBody:empty', { state: 'attached' });
  });

  await step('연결 후 안내 배너 사라지고 공휴일 표시', async () => {
    await page.waitForSelector('#banner[hidden]', { state: 'attached' });
    await page.waitForSelector('.fc-event:has-text("테스트 휴일")');
  });

  console.log('할 일');
  const taskRow = (title) => page.locator('#taskList li.task', { hasText: title });
  await step('로그인 때 일정·할 일 권한을 함께 요청', async () => {
    const scope = await page.evaluate(() => window.__gisScope);
    assert(scope.includes('auth/calendar.events') && scope.includes('auth/tasks'), `요청 권한: ${scope}`);
  });

  await step('할 일 목록: 마감 빠른 순, 마감 지남 표시, 숨긴 완료 항목 제외', async () => {
    await page.waitForSelector('#taskList >> text=성적 입력');
    const titles = await page.locator('#taskList li.task .what').allTextContents();
    assert(titles.join(',') === '성적 입력,강의자료 준비,책 반납', `순서 오류: ${titles}`);
    assert(await taskRow('성적 입력').locator('.when.overdue').count() === 1, '마감 지남 표시 없음');
    assert((await page.textContent('#taskCount')) === '(3)', '할 일 개수 오류');
    assert((await page.textContent('#btnDoneToggle')).includes('1개'), '완료 항목 수 오류');
    assert(!(await page.textContent('.day-pane')).includes('숨긴 완료 항목'), '숨긴 완료 항목이 보임');
  });

  await step('마감일 있는 할 일은 달력에 표시 (마감 없는 할 일은 표시 안 함)', async () => {
    await page.waitForSelector('.fc-event.ev-task:has-text("성적 입력")');
    assert(await page.locator('.fc-event.ev-task:has-text("책 반납")').count() === 0, '마감 없는 할 일이 달력에 보임');
    await page.screenshot({ path: `${OUT}/08-tasks.png` });
  });

  await step('할 일 등록 (마감일 지정) → 구글에 날짜로 저장', async () => {
    await page.click('#btnAddTask');
    await dialogOpen('taskEditor').waitFor();
    await page.click('#tkSave');
    assert((await page.textContent('#tkError')).includes('제목'), '빈 제목 검사 실패');
    await page.fill('#tTitle', '논문 심사 서류');
    await page.fill('#tDue', '2026-11-27');
    await page.click('#tkSave');
    await page.waitForSelector('dialog#taskEditor:not([open])', { state: 'attached' });
    const t = [...fakeTasks.L1.values()].find((x) => x.title === '논문 심사 서류');
    assert(t && t.due === '2026-11-27T00:00:00.000Z' && t.status === 'needsAction', `저장 오류 ${JSON.stringify(t)}`);
    await page.waitForSelector('.fc-event.ev-task:has-text("논문 심사 서류")');
    await taskRow('논문 심사 서류').waitFor();
  });

  await step('체크하면 완료, 다시 누르면 되돌리기 (구글에 반영)', async () => {
    await taskRow('논문 심사 서류').locator('.tk-check').click();
    await page.waitForFunction(() => ![...document.querySelectorAll('#taskList .what')].some((e) => e.textContent === '논문 심사 서류'));
    const t = [...fakeTasks.L1.values()].find((x) => x.title === '논문 심사 서류');
    assert(t.status === 'completed' && t.completed, '완료 미반영');
    await page.waitForSelector('.fc-event.ev-task-done:has-text("논문 심사 서류")');
    await page.click('#btnDoneToggle');
    await page.locator('#doneList li', { hasText: '논문 심사 서류' }).locator('.tk-check').click();
    await taskRow('논문 심사 서류').waitFor();
    assert(t.status === 'needsAction' && !t.completed, `되돌리기 미반영 ${JSON.stringify(t)}`);
    await page.click('#btnDoneToggle');
  });

  await step('할 일 수정: 바뀐 칸만 보내고, 마감일을 지우면 달력에서 빠짐', async () => {
    await taskRow('논문 심사 서류').locator('.tk-body').click();
    await dialogOpen('taskEditor').waitFor();
    assert((await page.inputValue('#tDue')) === '2026-11-27', '마감일 안 불러옴');
    await page.fill('#tTitle', '논문 심사 서류 제출');
    await page.fill('#tDue', '');
    fakeTasks.patches.length = 0;
    await page.click('#tkSave');
    await page.waitForSelector('dialog#taskEditor:not([open])', { state: 'attached' });
    const sent = fakeTasks.patches[0];
    assert(JSON.stringify(Object.keys(sent).sort()) === '["due","title"]' && sent.due === null, `보낸 내용 ${JSON.stringify(sent)}`);
    const t = [...fakeTasks.L1.values()].find((x) => x.title === '논문 심사 서류 제출');
    assert(t && !('due' in t), '마감일 안 지워짐');
    await page.waitForFunction(() => !document.querySelector('.fc-event.ev-task')?.textContent?.includes('논문 심사 서류'));
    assert(await page.locator('.fc-event.ev-task:has-text("논문 심사 서류")').count() === 0, '달력에 남음');
  });

  await step('달력의 할 일을 눌러 수정 창 열기', async () => {
    await page.click('.fc-event.ev-task:has-text("강의자료 준비")');
    await dialogOpen('taskEditor').waitFor();
    assert((await page.inputValue('#tTitle')) === '강의자료 준비', '다른 할 일이 열림');
    await page.click('#taskEditor [data-close] >> nth=0');
  });

  await step('할 일 삭제 (확인 후)', async () => {
    await taskRow('논문 심사 서류 제출').locator('.tk-body').click();
    await page.click('#tkDelete');
    await page.click('#cfBtns >> text=삭제');
    await page.waitForSelector('dialog#taskEditor:not([open])', { state: 'attached' });
    assert(![...fakeTasks.L1.values()].some((x) => x.title === '논문 심사 서류 제출'), '서버에서 안 지워짐');
    assert(await taskRow('논문 심사 서류 제출').count() === 0, '목록에 남음');
  });

  await step('설정에서 할 일 표시 끄기/켜기', async () => {
    await page.click('#btnSettings');
    await page.uncheck('#sTasks');
    await page.click('#settings [data-close]');
    assert(await page.isHidden('#taskList'), '할 일 목록이 보임');
    assert(await page.locator('.fc-event.ev-task').count() === 0, '달력에 할 일이 보임');
    await page.click('#btnSettings');
    await page.check('#sTasks');
    await page.click('#settings [data-close]');
    await page.waitForSelector('.fc-event.ev-task:has-text("성적 입력")');
  });

  await step('새 일정 등록: 카테고리 선택 시 색상 자동, 중요도 표시', async () => {
    await page.click('#fab');
    await dialogOpen('editor').waitFor();
    await page.fill('#fTitle', '학과 회의');
    await page.fill('#fStartTime', '14:00');
    await page.dispatchEvent('#fStartTime', 'change');
    await page.click('#fCategory >> text=회의');
    await page.click('#fImportance >> text=★ 중요');
    await page.selectOption('#fReminder', '30');
    await page.fill('#fLocation', '본관 301호');
    await page.click('#edSave');
    await page.waitForSelector('dialog#editor:not([open])', { state: 'attached' });
    await page.waitForSelector('#dayList >> text=★ 학과 회의');
    const ev = [...fake.cals.primary.values()].find((e) => e.summary === '학과 회의');
    assert(ev, '서버에 저장 안 됨');
    assert(ev.colorId === '5', `회의 색(5) 아님: ${ev.colorId}`);
    assert(ev.extendedProperties.private.pcCategory === 'meeting' && ev.extendedProperties.private.pcImportance === '1', '카테고리/중요도 저장 안 됨');
    assert(ev.reminders.overrides[0].minutes === 30, '알림 저장 안 됨');
    assert(ev.start.dateTime === '2026-11-24T14:00:00' && ev.start.timeZone === 'Asia/Seoul', `시간 저장 오류 ${ev.start.dateTime}`);
    assert(await page.isVisible('.fc-event:has-text("학과 회의")'), '달력에 표시 안 됨');
  });

  await step('일정 수정', async () => {
    await page.click('#dayList >> text=학과 회의');
    await dialogOpen('editor').waitFor();
    assert((await page.inputValue('#fTitle')) === '학과 회의', '기존 값 안 불러옴');
    assert((await page.inputValue('#fReminder')) === '30', '알림 값 안 불러옴');
    await page.fill('#fTitle', '학과 회의 (변경)');
    await page.click('#edSave');
    await page.waitForSelector('#dayList >> text=학과 회의 (변경)');
  });

  await step('반복 일정 등록 (매주 화·목 6회)', async () => {
    await page.click('#fab');
    await page.fill('#fTitle', '전공 수업');
    await page.fill('#fStartTime', '09:00'); await page.dispatchEvent('#fStartTime', 'change');
    await page.click('#fCategory >> text=학교');
    await page.selectOption('#fRepeat', 'WEEKLY');
    await page.click('#fByDay >> text=목');
    await page.selectOption('#fRepeatEnd', 'count');
    await page.fill('#fCount', '6');
    await page.click('#edSave');
    await page.waitForSelector('dialog#editor:not([open])', { state: 'attached' });
    const master = [...fake.cals.primary.values()].find((e) => e.summary === '전공 수업');
    assert(master.recurrence[0] === 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=6', master.recurrence[0]);
    await page.waitForFunction(() => document.querySelectorAll('.fc-event').length >= 5);
    const n = await page.locator('.fc-event:has-text("전공 수업")').count();
    assert(n >= 3, `반복 회차 표시 부족: ${n}`);
  });

  await step('반복 일정 "이 일정만" 수정', async () => {
    await page.locator('.fc-event:has-text("전공 수업")').nth(1).click();
    await dialogOpen('editor').waitFor();
    await page.waitForFunction(() => document.querySelector('#fRepeat').value === 'WEEKLY'); // 원본 반복 규칙 불러옴
    await page.fill('#fTitle', '전공 수업 (보강)');
    await page.click('#edSave');
    await page.click('#cfBtns >> text=이 일정만');
    await page.waitForSelector('.fc-event:has-text("전공 수업 (보강)")');
    const n = await page.locator('.fc-event:has-text("전공 수업 (보강)")').count();
    assert(n === 1, `한 회차만 바뀌어야 함: ${n}`);
  });

  await step('반복 일정 "전체" 수정 (장소 추가)', async () => {
    await page.locator('.fc-event:has-text("전공 수업")').first().click();
    await page.waitForFunction(() => document.querySelector('#fRepeat').value === 'WEEKLY');
    await page.fill('#fLocation', '공학관 205호');
    await page.click('#edSave');
    await page.click('#cfBtns >> text=전체 반복 일정');
    await page.waitForSelector('dialog#editor:not([open])', { state: 'attached' });
    const master = [...fake.cals.primary.values()].find((e) => e.summary === '전공 수업');
    assert(master.location === '공학관 205호', '마스터 미수정');
    assert(master.start.dateTime.startsWith('2026-11-24T09:00'), `시작일 이동 오류 ${master.start.dateTime}`);
  });

  await step('지운 회차가 있는 반복 일정은 시간 전체 변경 차단', async () => {
    const master = [...fake.cals.primary.values()].find((e) => e.summary === '전공 수업');
    master.recurrence = [master.recurrence[0], 'EXDATE;TZID=Asia/Seoul:20261203T090000'];
    await page.locator('.fc-event:has-text("전공 수업")').first().click();
    await page.waitForFunction(() => document.querySelector('#fRepeat').value === 'WEEKLY');
    await page.fill('#fStartTime', '10:00');
    await page.fill('#fEndTime', '12:30');
    await page.click('#edSave');
    await page.click('#cfBtns >> text=전체 반복 일정');
    await page.waitForSelector('#edError:has-text("되살아날")');
    assert(master.start.dateTime.startsWith('2026-11-24T09:00'), '차단되지 않고 저장됨');
    await page.click('#editor [data-close] >> nth=0');
    master.recurrence = [master.recurrence[0]];
  });

  await step('반복 정보가 늦게 와도 입력 중인 제목 유지', async () => {
    await page.route('https://www.googleapis.com/calendar/v3/**', async (r) => { if (/events\/ev\d+$/.test(new URL(r.request().url()).pathname) && r.request().method() === 'GET') await new Promise((x) => setTimeout(x, 800)); return r.fallback(); });
    await page.locator('.fc-event:has-text("전공 수업")').first().click();
    await page.fill('#fTitle', '입력 중인 제목');
    await page.waitForFunction(() => document.querySelector('#fRepeat').value === 'WEEKLY');
    assert((await page.inputValue('#fTitle')) === '입력 중인 제목', '입력 내용이 지워짐');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.click('#editor [data-close] >> nth=0');
  });

  await step('반복 일정 한 회차 삭제', async () => {
    const before = await page.locator('.fc-event:has-text("전공 수업")').count();
    await page.locator('.fc-event:has-text("전공 수업")').last().click();
    await dialogOpen('editor').waitFor();
    await page.click('#edDelete');
    await page.click('#cfBtns >> text=이 일정만 삭제');
    await page.waitForFunction((b) => document.querySelectorAll('.fc-event').length > 0 && [...document.querySelectorAll('.fc-event')].filter((x) => x.textContent.includes('전공 수업')).length === b - 1, before);
  });

  await step('다른 기기에서 먼저 수정된 경우 충돌 확인창 → 덮어쓰기', async () => {
    const ev = [...fake.cals.primary.values()].find((e) => e.summary === '학과 회의 (변경)');
    await page.click('#dayList >> text=학과 회의 (변경)');
    await dialogOpen('editor').waitFor();
    fake.bump(ev.id);
    await page.fill('#fTitle', '학과 회의 (최종)');
    await page.click('#edSave');
    await page.waitForSelector('#cfText:has-text("먼저 수정")');
    await page.click('#cfBtns >> text=내 내용으로 덮어쓰기');
    await page.waitForSelector('#dayList >> text=학과 회의 (최종)');
  });

  await step('종일 일정 등록 (2일)', async () => {
    await page.click('#fab');
    await page.fill('#fTitle', '학회 출장');
    await page.check('#fAllDay');
    await page.fill('#fEndDate', '2026-11-25');
    await page.click('#fCategory >> text=출장');
    await page.click('#edSave');
    await page.waitForSelector('dialog#editor:not([open])', { state: 'attached' });
    const ev = [...fake.cals.primary.values()].find((e) => e.summary === '학회 출장');
    assert(ev.start.date === '2026-11-24' && ev.end.date === '2026-11-26', `종일 날짜 오류 ${JSON.stringify(ev.start)} ${JSON.stringify(ev.end)}`);
    assert(ev.colorId === '11', '출장 색 아님');
  });

  await step('잘못된 입력 검증 (종료가 시작보다 빠름)', async () => {
    await page.click('#fab');
    await page.fill('#fStartTime', '15:00');
    await page.fill('#fEndTime', '14:00');
    await page.click('#edSave');
    assert((await page.textContent('#edError')).includes('종료 시각'), '검증 오류 미표시');
    await page.click('#editor [data-close] >> nth=0');
  });

  await step('공휴일은 읽기 전용', async () => {
    await page.click('.fc-event:has-text("테스트 휴일")');
    await dialogOpen('editor').waitFor();
    assert(await page.isHidden('#edSave'), '저장 버튼 보임');
    assert(await page.isDisabled('#fTitle'), '편집 가능');
    await page.click('#editor [data-close] >> nth=0');
  });

  await step('주간·일간·목록 보기 전환', async () => {
    await page.click('.views >> text=주');
    await page.waitForSelector('.fc-timeGridWeek-view');
    await page.screenshot({ path: `${OUT}/02-week.png` });
    await page.click('.views >> text=목록');
    await page.waitForSelector('.fc-listWeek-view');
    await page.click('.views >> text=일');
    await page.waitForSelector('.fc-timeGridDay-view');
    await page.click('.views >> text=월');
    await page.waitForSelector('.fc-dayGridMonth-view');
  });

  await step('설정 1회 클릭으로 일반 설정, 민감정보 없음', async () => {
    await page.click('#btnSettings');
    await dialogOpen('settings').waitFor();
    const txt = await page.textContent('#settings');
    assert(!txt.includes('apps.googleusercontent.com'), '일반 설정에 클라이언트 ID 노출');
    await page.screenshot({ path: `${OUT}/03-settings.png` });
  });

  await step('톱니바퀴 4회로는 관리자 진입 안 됨, 3초 초과 시 초기화', async () => {
    await tapGear(4);
    assert(!(await dialogOpen('adminAuth').count()), '4회에 열림');
    await ctx.clock.runFor(3500);
    await tapGear(1);
    assert(!(await dialogOpen('adminAuth').count()), '시간 초과 후 5번째에 열림');
  });

  await step('톱니바퀴 5회 → 비밀번호 확인 → 틀리면 남은 횟수 표시', async () => {
    await ctx.clock.runFor(3500);
    await tapGear(5);
    await dialogOpen('adminAuth').waitFor();
    assert(!(await dialogOpen('admin').count()), '비밀번호 없이 관리자 열림');
    await page.fill('#aaPw', 'wrong');
    await page.click('#aaOk');
    await page.waitForSelector('#aaError:has-text("남은 시도 4회")');
    await page.fill('#aaPw', 'blue1234');
    await page.click('#aaOk');
    await dialogOpen('admin').waitFor();
    await page.click('#admin [data-close]');
  });

  await step('비밀번호 재설정: 다른 Google 계정이면 거부', async () => {
    if (!(await dialogOpen('settings').count())) await page.click('#btnSettings');
    await ctx.clock.runFor(3500);
    await tapGear(5);
    await dialogOpen('adminAuth').waitFor();
    fake.state.owner = 'stranger@example.com';
    await page.click('#aaForgot');
    await page.click('#cfBtns >> text=Google로 확인');
    await page.waitForSelector('#aaError:has-text("처음 이 기기에 연결한 Google 계정과 다릅니다")');
    assert(await page.evaluate(() => !!localStorage.getItem('pc.admin.pw')), '비밀번호가 지워짐');
    fake.state.owner = 'owner@example.com';
    await page.click('#adminAuth [data-close] >> nth=0');
    await page.click('#settings [data-close]');
    await page.click('#banner:not([hidden]) #bannerBtn');
    await page.waitForSelector('#banner[hidden]', { state: 'attached' });
  });

  await step('어두운 모드 적용', async () => {
    if (!(await dialogOpen('settings').count())) await page.click('#btnSettings');
    await page.selectOption('#sTheme', 'dark');
    assert((await page.getAttribute('html', 'data-theme')) === 'dark', '테마 미적용');
    await page.click('#settings [data-close]');
    await page.screenshot({ path: `${OUT}/04-dark.png` });
    await page.click('#btnSettings');
    await page.selectOption('#sTheme', 'light');
    await page.click('#settings [data-close]');
  });

  await step('카테고리 색 변경이 달력에 반영', async () => {
    await page.click('#btnSettings');
    await page.selectOption('#sCatColors select >> nth=1', '3'); // 학교 → 포도
    await page.click('#settings [data-close]');
    const bg = await page.locator('.fc-event:has-text("전공 수업")').first().evaluate((e) => getComputedStyle(e).backgroundColor);
    // 전공 수업은 colorId 10이 직접 저장되어 있으므로 바뀌지 않아야 함 (구글 캘린더와 같은 색 유지)
    const cls = await page.locator('.fc-event:has-text("전공 수업")').first().evaluate((e) => e.className + ' style=' + e.getAttribute('style'));
    assert(bg === 'rgb(11, 128, 67)', `저장된 색 유지 안 됨: ${bg} ${cls}`);
    await page.click('#btnSettings');
    await page.selectOption('#sCatColors select >> nth=1', '10');
    await page.click('#settings [data-close]');
  });

  await step('공유: 링크·QR코드 표시', async () => {
    await page.click('#btnShare');
    await dialogOpen('share').waitFor();
    assert((await page.textContent('#shareUrl')) === BASE, '공유 주소 오류');
    const dark = await page.evaluate(() => { const c = document.getElementById('qr'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 50) n++; return n; });
    assert(dark > 1000, 'QR코드가 비어 있음');
    assert(await page.isVisible('#shareWarn'), '로컬 주소 경고 없음');
    await page.screenshot({ path: `${OUT}/05-share.png` });
    await page.click('#share [data-close]');
  });

  await step('버전 정보 화면', async () => {
    await page.click('#verBtn');
    await page.waitForSelector('#versionBody:has-text("V1.2 (2026-11-27)")');
    assert(await page.isVisible('#versionBody >> text=최신 버전입니다'), '최신 버전 표시 오류');
    await page.click('#version [data-close]');
  });

  await step('연결 끊기 시 토큰 철회·이 기기 사본 삭제', async () => {
    await page.click('#btnSettings');
    await page.click('#sLogout');
    await page.waitForFunction(() => window.__revoked === 'fake-token');
    await page.waitForSelector('#banner:not([hidden])');
    await page.click('#settings [data-close]');
    assert((await page.locator('.fc-event:has-text("학과 회의")').count()) === 0, '연결 끊은 뒤 일정이 남음');
    assert((await page.locator('#taskList li.task').count()) === 0, '연결 끊은 뒤 할 일이 남음');
    assert(await page.evaluate(() => localStorage.getItem('pc.tasks') === null), '할 일 사본이 기기에 남음');
  });

  console.log('스마트폰 화면');
  const phone = await newPage({ ...devices['iPhone 13'] });
  const p2 = phone.page;
  await p2.goto(BASE);
  await step('스마트폰: 위 오늘 일정, 아래 달력, 일정 버튼', async () => {
    await p2.evaluate(() => { localStorage.setItem('pc.clientId', '123456789-abcdef.apps.googleusercontent.com'); });
    await p2.reload();
    await p2.evaluate(() => { window.__denyTasks = true; }); // 이 기기에서는 할 일 권한을 허용하지 않은 경우
    await p2.click('#bannerBtn');
    await p2.waitForSelector('#dayList >> text=학과 회의 (최종)');
    const dayTop = (await p2.locator('.day-pane').boundingBox()).y;
    const calTop = (await p2.locator('.cal-pane').boundingBox()).y;
    assert(dayTop < calTop, '오늘 일정이 위에 있지 않음');
    assert(await p2.isVisible('#fab'), '일정 버튼 없음');
    const sw = await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    assert(sw, '가로 스크롤 발생');
    await p2.screenshot({ path: `${OUT}/06-phone.png` });
    await p2.click('#fab');
    await p2.waitForSelector('dialog#editor[open]');
    const over = await p2.evaluate(() => [...document.querySelectorAll('#editor input, #editor select')].filter((x) => x.offsetParent && x.getBoundingClientRect().right > window.innerWidth + 1).map((x) => x.id));
    assert(over.length === 0, `화면 밖으로 넘친 입력칸: ${over.join(',')}`);
    await p2.screenshot({ path: `${OUT}/07-phone-editor.png` });
  });

  await step('할 일 권한을 허용하지 않아도 일정은 정상, 할 일 칸에 안내', async () => {
    await p2.waitForSelector('#taskNote:has-text("할 일 권한이 없습니다")');
    assert(await p2.isVisible('#dayList >> text=학과 회의 (최종)'), '일정이 안 보임');
    assert((await p2.locator('#taskList li.task').count()) === 0, '권한 없이 할 일이 보임');
  });

  await step('오프라인: 저장된 일정 표시, 등록 버튼 비활성', async () => {
    await p2.click('#editor [data-close] >> nth=0');
    await phone.ctx.setOffline(true);
    await p2.evaluate(() => window.dispatchEvent(new Event('offline')));
    await p2.waitForSelector('#bannerText:has-text("오프라인")');
    assert(await p2.isDisabled('#fab'), '오프라인인데 등록 가능');
    assert(await p2.isVisible('#dayList >> text=학과 회의 (최종)'), '저장된 일정 안 보임');
    await phone.ctx.setOffline(false);
  });

  await step('외부로 나간 요청 없음 (구글 외 서비스 전송 없음)', async () => {
    assert(external.length === 0, external.join(', '));
  });
  await step('브라우저 오류 없음', async () => {
    const real = errors.filter((e) => !e.includes('net::ERR_INTERNET_DISCONNECTED') && !e.includes('Failed to load resource'));
    assert(real.length === 0, real.join(' | '));
  });

  await browser.close();
  server.kill();
  console.log(`\n결과: ${passed}개 통과, ${failures.length}개 실패`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
