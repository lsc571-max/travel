// 성능 측정: 1천 / 1만 / 5만 객체 (헤드리스 Chromium, 이 실행 환경의 실제 측정값)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4175;
(async () => {
  const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(500);
  const rows = [];
  for (const n of [1000, 10000, 50000]) {
    // 3회 측정 후 중앙값
    const runs = [];
    for (let k = 0; k < 3; k++) runs.push(await page.evaluate((n) => window.__pureunCad.runBenchmark(window.__pureunCad.eng, n), n));
    const med = {};
    for (const key of Object.keys(runs[0])) med[key] = runs.map((r) => r[key]).sort((a, c) => a - c)[1];
    // 실제 화면 프레임: 화면 이동 30회 동안 requestAnimationFrame 간격
    const frame = await page.evaluate(async () => {
      const e = window.__pureunCad.eng;
      e.zoomExtents();
      const ts = [];
      for (let i = 0; i < 30; i++) {
        e.view.panPx(10, 5);
        e.redrawAll();
        await new Promise((r) => requestAnimationFrame(() => r()));
        ts.push(performance.now());
      }
      const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
      return { medianFrameMs: d[Math.floor(d.length / 2)], maxFrameMs: d[d.length - 1] };
    });
    // 사용자 화면 이동(가운데 버튼 드래그)과 같은 조건: 이동 중 비트맵 재사용, 멈춘 뒤 정밀 재그리기
    const drag = await page.evaluate(async () => {
      const e = window.__pureunCad.eng;
      e.zoomExtents();
      await new Promise((r) => setTimeout(r, 300));
      const ts = [];
      for (let i = 0; i < 30; i++) {
        e.view.panPx(10, 5);
        e.interactAt = performance.now();
        e.redrawAll();
        await new Promise((r) => requestAnimationFrame(() => r()));
        ts.push(performance.now());
      }
      const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
      return { dragMedianFrameMs: d[Math.floor(d.length / 2)], dragMaxFrameMs: d[d.length - 1] };
    });
    rows.push({ ...med, ...frame, ...drag });
    console.log('   drag', JSON.stringify(drag));
    console.log(n, JSON.stringify({ ...med, ...frame }));
  }
  await b.close();
  try { process.kill(-srv.pid); } catch {}
  const env = { date: new Date().toISOString(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, node: process.version, browser: 'Chromium (Playwright 내장, headless)', viewport: '1600x900' };
  fs.writeFileSync(path.join(OUT, 'perf-results.json'), JSON.stringify({ env, rows }, null, 2));
  console.log(JSON.stringify(env));
})();
