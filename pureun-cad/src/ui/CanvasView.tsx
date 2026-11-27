// 작업 영역: 3겹 캔버스(도면 / 선택 강조 / 오버레이)와 마우스 입력
import { useEffect, useRef } from 'react';
import type { Engine } from '../commands/engine';
import { renderOverlay, renderSelection } from '../render/overlay';
import { renderBase, THEMES } from '../render/renderer';

export interface FrameStats {
  baseMs: number;
  drawn: number;
}
/** 성능 측정용 (관리자 도구·자동 테스트에서 사용) */
export const frameStats: FrameStats = { baseMs: 0, drawn: 0 };

export function CanvasView({ eng }: { eng: Engine }) {
  const wrap = useRef<HTMLDivElement>(null);
  const c0 = useRef<HTMLCanvasElement>(null);
  const c1 = useRef<HTMLCanvasElement>(null);
  const c2 = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = wrap.current!;
    const canvases = [c0.current!, c1.current!, c2.current!];
    const ctxs = canvases.map((c) => c.getContext('2d', { alpha: c !== c0.current })!);
    let dpr = window.devicePixelRatio || 1;
    let first = true;
    const resize = () => {
      const r = el.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
      // 크기 변경 시 화면 중심 유지
      eng.view.w = w;
      eng.view.h = h;
      for (const c of canvases) {
        c.width = Math.floor(w * dpr);
        c.height = Math.floor(h * dpr);
      }
      ctxs.forEach((x) => x.setTransform(dpr, 0, 0, dpr, 0, 0));
      if (first && w > 50 && h > 50) {
        first = false;
        if (eng.doc.entities.size || eng.doc.preserved.length) eng.zoomExtents();
        else eng.view.fit({ minX: -10, minY: -10, maxX: 297, maxY: 210 });
      }
      eng.redrawAll();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // 대형 도면: 화면 이동·확대 중에는 직전 그림(비트맵)을 옮겨 보여 주고, 멈추면 정밀하게 다시 그림
    const cache = document.createElement('canvas');
    const cctx = cache.getContext('2d')!;
    let cacheView = { cx: 0, cy: 0, k: 1, valid: false, ver: -1 };
    let pendingFull = false;
    let lastMs = 0;
    let raf = 0;
    const full = (theme: (typeof THEMES)['dark']) => {
      const st = renderBase(ctxs[0], eng.doc, eng.view, theme, { grid: eng.settings.grid });
      frameStats.baseMs = lastMs = st.ms;
      frameStats.drawn = st.drawn;
      if (cache.width !== canvases[0].width || cache.height !== canvases[0].height) {
        cache.width = canvases[0].width;
        cache.height = canvases[0].height;
      }
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.drawImage(canvases[0], 0, 0);
      cacheView = { cx: eng.view.cx, cy: eng.view.cy, k: eng.view.scale, valid: true, ver: eng.doc.version };
      pendingFull = false;
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const theme = THEMES[eng.settings.theme];
      const interacting = performance.now() - eng.interactAt < 150;
      if (eng.dirty.base) {
        eng.dirty.base = false;
        if (interacting && lastMs > 20 && cacheView.valid && cacheView.ver === eng.doc.version) {
          const v = eng.view, r = v.scale / cacheView.k;
          const g = ctxs[0];
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          g.fillStyle = theme.bg;
          g.fillRect(0, 0, v.w, v.h);
          g.setTransform(dpr * r, 0, 0, dpr * r, dpr * (v.w / 2 - (v.w / 2) * r + (cacheView.cx - v.cx) * v.scale), dpr * (v.h / 2 - (v.h / 2) * r - (cacheView.cy - v.cy) * v.scale));
          g.drawImage(cache, 0, 0, cache.width / dpr, cache.height / dpr);
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          pendingFull = true;
        } else full(theme);
      } else if (pendingFull && !interacting) full(theme);
      if (eng.dirty.sel) {
        eng.dirty.sel = false;
        renderSelection(ctxs[1], eng, theme);
      }
      if (eng.dirty.over) {
        eng.dirty.over = false;
        renderOverlay(ctxs[2], eng, theme);
      }
    };
    raf = requestAnimationFrame(loop);

    const top = canvases[2];
    const pos = (e: { clientX: number; clientY: number }) => {
      const r = top.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      e.preventDefault();
      top.setPointerCapture(e.pointerId);
      eng.pointerDown(pos(e), e.button, e.shiftKey);
    };
    const move = (e: PointerEvent) => eng.pointerMove(pos(e));
    const up = (e: PointerEvent) => eng.pointerUp(pos(e), e.button, e.shiftKey);
    const leave = () => eng.pointerLeave();
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      eng.wheel(pos(e), e.deltaY);
    };
    const ctxmenu = (e: Event) => e.preventDefault();
    let lastMid = 0;
    const aux = (e: MouseEvent) => {
      // 가운데 버튼 두 번 클릭: 전체 보기
      if (e.button === 1) {
        const now = performance.now();
        if (now - lastMid < 350) eng.zoomExtents();
        lastMid = now;
      }
    };
    top.addEventListener('pointerdown', down);
    top.addEventListener('pointermove', move);
    top.addEventListener('pointerup', up);
    top.addEventListener('pointerleave', leave);
    top.addEventListener('wheel', wheel, { passive: false });
    top.addEventListener('contextmenu', ctxmenu);
    top.addEventListener('auxclick', aux);
    const dbl = (e: MouseEvent) => eng.doubleClick(pos(e));
    top.addEventListener('dblclick', dbl);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      top.removeEventListener('pointerdown', down);
      top.removeEventListener('pointermove', move);
      top.removeEventListener('pointerup', up);
      top.removeEventListener('pointerleave', leave);
      top.removeEventListener('wheel', wheel);
      top.removeEventListener('contextmenu', ctxmenu);
      top.removeEventListener('auxclick', aux);
      top.removeEventListener('dblclick', dbl);
    };
  }, [eng]);

  return (
    <div className="canvas-wrap" ref={wrap}>
      <canvas ref={c0} />
      <canvas ref={c1} />
      <canvas ref={c2} className="top" data-testid="cad-canvas" />
    </div>
  );
}
