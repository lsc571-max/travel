// 선택 강조 캔버스와 오버레이(미리보기·커서·스냅) 캔버스
import type { Engine } from '../commands/engine';
import type { Entity, NewEntity } from '../core/types';
import { drawHighlight, type Theme } from './renderer';

export function renderSelection(ctx: CanvasRenderingContext2D, eng: Engine, theme: Theme) {
  const { view, doc } = eng;
  ctx.clearRect(0, 0, view.w, view.h);
  if (!eng.sel.size) return;
  const bb = view.bbox(2);
  const ents: Entity[] = [];
  if (eng.sel.size > 2000) {
    // 대량 선택: 화면에 보이는 것만
    for (const id of doc.query(bb)) if (eng.sel.has(id)) ents.push(doc.get(id)!);
  } else for (const id of eng.sel) {
    const e = doc.get(id);
    if (e) ents.push(e);
  }
  drawHighlight(ctx, ents, view, theme.select, { dash: [6, 4], width: 2 });
}

let tmp = -1;
const withId = (e: NewEntity) => ({ ...e, id: tmp-- }) as Entity;

export function renderOverlay(ctx: CanvasRenderingContext2D, eng: Engine, theme: Theme) {
  const { view } = eng;
  ctx.clearRect(0, 0, view.w, view.h);
  const req = eng.req;
  // 마우스 위 객체 강조
  if (eng.hover !== null) {
    const e = eng.doc.get(eng.hover);
    if (e) drawHighlight(ctx, [e], view, theme.hover, { width: 2 });
  }
  const cur = eng.cursorS;
  if (!cur) return;
  const p = eng.effectivePoint();
  // 미리보기
  if (req && eng.needsPoint()) {
    const base = eng.reqBase();
    const noRubber = req.kind === 'point' && req.noRubber;
    if (base && !noRubber) {
      ctx.strokeStyle = theme.preview;
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      const a = view.toScreen(base), b = view.toScreen(p);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (req.preview) {
      try {
        const pv = req.preview(p).map(withId);
        drawHighlight(ctx, pv, view, theme.preview, { width: 1 });
      } catch {
        /* 계산할 수 없는 미리보기는 표시하지 않음 */
      }
    }
  }
  // 선택 창
  if (eng.win) {
    const a = eng.win.s;
    const crossing = cur.x < a.x;
    ctx.fillStyle = crossing ? theme.crossFill : theme.windowFill;
    ctx.strokeStyle = crossing ? theme.crossStroke : theme.windowStroke;
    ctx.setLineDash(crossing ? [5, 4] : []);
    const x = Math.min(a.x, cur.x), y = Math.min(a.y, cur.y), w = Math.abs(cur.x - a.x), h = Math.abs(cur.y - a.y);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setLineDash([]);
  }
  // 스냅 표시
  const s = eng.snap;
  if (s) {
    const q = view.toScreen(s.p);
    ctx.strokeStyle = theme.snap;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const r = 6;
    if (s.kind === 'end') ctx.rect(q.x - r, q.y - r, 2 * r, 2 * r);
    else if (s.kind === 'mid') {
      ctx.moveTo(q.x, q.y - r);
      ctx.lineTo(q.x + r, q.y + r);
      ctx.lineTo(q.x - r, q.y + r);
      ctx.closePath();
    } else if (s.kind === 'cen') ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    else if (s.kind === 'int') {
      ctx.moveTo(q.x - r, q.y - r);
      ctx.lineTo(q.x + r, q.y + r);
      ctx.moveTo(q.x + r, q.y - r);
      ctx.lineTo(q.x - r, q.y + r);
    } else {
      ctx.moveTo(q.x, q.y - r);
      ctx.lineTo(q.x + r, q.y);
      ctx.lineTo(q.x, q.y + r);
      ctx.lineTo(q.x - r, q.y);
      ctx.closePath();
    }
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  // 십자 커서
  const c = view.toScreen(p);
  const pointMode = !!req && eng.needsPoint();
  ctx.strokeStyle = theme.cursor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const L = pointMode ? 40 : 22;
  const cx = Math.round(c.x) + 0.5, cy = Math.round(c.y) + 0.5;
  ctx.moveTo(cx - L, cy);
  ctx.lineTo(cx + L, cy);
  ctx.moveTo(cx, cy - L);
  ctx.lineTo(cx, cy + L);
  if (!pointMode) {
    const b = eng.settings.pickbox;
    ctx.rect(cx - b, cy - b, 2 * b, 2 * b);
  }
  ctx.stroke();
}
