// 성능 측정 도구 (관리자 설정·자동 테스트에서 사용). 측정값은 실행한 PC·브라우저에 따라 달라진다.
import type { Engine } from './commands/engine';
import type { NewEntity } from './core/types';
import { findSnap } from './core/snap';
import { readDxfText } from './dxf/reader';
import { writeDxf } from './dxf/writer';
import { renderBase, THEMES } from './render/renderer';

/** 재현 가능한 의사난수 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** n개 객체의 시험 도면 (선 40%, 원 25%, 호 20%, 폴리선 15%) */
export function generateTestDrawing(n: number): NewEntity[] {
  const r = rng(12345);
  const side = Math.sqrt(n) * 20;
  const out: NewEntity[] = [];
  for (let i = 0; i < n; i++) {
    const x = r() * side, y = r() * side, k = r();
    const layer = ['0', '외형', '구멍', '중심선'][i % 4];
    if (k < 0.4) out.push({ type: 'line', layer, p1: { x, y }, p2: { x: x + r() * 30 - 15, y: y + r() * 30 - 15 } });
    else if (k < 0.65) out.push({ type: 'circle', layer, c: { x, y }, r: 1 + r() * 8 });
    else if (k < 0.85) out.push({ type: 'arc', layer, c: { x, y }, r: 2 + r() * 10, a0: r() * 360, a1: r() * 360 });
    else
      out.push({
        type: 'polyline',
        layer,
        closed: r() < 0.5,
        pts: [
          { x, y, b: 0 },
          { x: x + 10, y, b: 0.3 },
          { x: x + 10, y: y + 8, b: 0 },
          { x, y: y + 8, b: 0 },
        ],
      });
  }
  return out;
}

export interface BenchResult {
  n: number;
  loadMs: number;
  renderFullMs: number;
  renderZoomMs: number;
  pan10Ms: number;
  hit100Ms: number;
  snap100Ms: number;
  dxfWriteMs: number;
  dxfReadMs: number;
  dxfBytes: number;
}

const now = () => performance.now();

export function runBenchmark(eng: Engine, n: number): BenchResult {
  const ents = generateTestDrawing(n);
  let t = now();
  eng.doc.load({ entities: ents, layers: [], fileName: `성능시험_${n}.dxf` });
  const loadMs = now() - t;

  const cv = document.createElement('canvas');
  cv.width = eng.view.w;
  cv.height = eng.view.h;
  const ctx = cv.getContext('2d')!;
  const theme = THEMES[eng.settings.theme];
  eng.zoomExtents();
  t = now();
  renderBase(ctx, eng.doc, eng.view, theme, { grid: false });
  const renderFullMs = now() - t;

  eng.view.zoomAt({ x: eng.view.w / 2, y: eng.view.h / 2 }, 8);
  t = now();
  renderBase(ctx, eng.doc, eng.view, theme, { grid: false });
  const renderZoomMs = now() - t;

  eng.zoomExtents();
  t = now();
  for (let i = 0; i < 10; i++) {
    eng.view.panPx(15, 7);
    renderBase(ctx, eng.doc, eng.view, theme, { grid: false });
  }
  const pan10Ms = now() - t;

  const r = rng(99);
  t = now();
  for (let i = 0; i < 100; i++) eng.pickAt({ x: r() * eng.view.w, y: r() * eng.view.h });
  const hit100Ms = now() - t;

  t = now();
  for (let i = 0; i < 100; i++) {
    const w = eng.view.toWorld({ x: r() * eng.view.w, y: r() * eng.view.h });
    findSnap(eng.doc, w, eng.settings.aperture / eng.view.scale, eng.settings.snapModes);
  }
  const snap100Ms = now() - t;

  t = now();
  const { text } = writeDxf(eng.doc);
  const dxfWriteMs = now() - t;
  t = now();
  readDxfText(text);
  const dxfReadMs = now() - t;
  eng.redrawAll();
  return { n, loadMs, renderFullMs, renderZoomMs, pan10Ms, hit100Ms, snap100Ms, dxfWriteMs, dxfReadMs, dxfBytes: text.length };
}
