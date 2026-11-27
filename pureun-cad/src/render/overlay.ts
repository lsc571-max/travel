// 선택 강조 캔버스와 오버레이(미리보기·커서·스냅) 캔버스
import type { Engine } from '../commands/engine';
import type { Entity, NewEntity } from '../core/types';
import { fmtNum } from '../core/format';
import { snapNameKo } from '../core/snap';
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
  // 그립 (파란 사각형)
  const grips = eng.grips();
  if (grips.length) {
    ctx.fillStyle = '#2f7cf6';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    for (const g of grips) {
      const q = view.toScreen(g.p);
      ctx.fillRect(Math.round(q.x) - 4, Math.round(q.y) - 4, 9, 9);
      ctx.strokeRect(Math.round(q.x) - 4.5, Math.round(q.y) - 4.5, 10, 10);
    }
  }
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
  // 확인용 표시점 (가공 검사 열린 끝점)
  if (eng.marks.length) {
    ctx.strokeStyle = '#ff4d4d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const m of eng.marks) {
      const q = view.toScreen(m);
      ctx.moveTo(q.x + 9, q.y);
      ctx.arc(q.x, q.y, 9, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  const cur = eng.cursorS;
  if (!cur) return;
  const p = eng.effectivePoint();
  // 그립 위에 있으면 강조
  if (!req) {
    const g = eng.gripAt(cur);
    if (g) {
      const q = view.toScreen(g.p);
      ctx.fillStyle = '#ff5a36';
      ctx.fillRect(Math.round(q.x) - 5, Math.round(q.y) - 5, 11, 11);
    }
  }
  // 극좌표 추적선
  if (eng.track) {
    const a = view.toScreen(eng.track.base);
    const ang = -eng.track.ang * (Math.PI / 180);
    const far = Math.hypot(view.w, view.h) * 2;
    ctx.strokeStyle = theme.snap;
    ctx.setLineDash([2, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(a.x + Math.cos(ang) * far, a.y + Math.sin(ang) * far);
    ctx.stroke();
    ctx.setLineDash([]);
  }
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
  if (eng.settings.dyn) drawTooltip(ctx, eng, theme, c, p);
}

/** 동적 입력: 커서 옆에 프롬프트·길이·각도·입력 중인 값 표시 */
function drawTooltip(ctx: CanvasRenderingContext2D, eng: Engine, theme: Theme, c: { x: number; y: number }, p: { x: number; y: number }) {
  const req = eng.req;
  const dec = Math.min(eng.settings.decimals, 4);
  const f = (n: number) => fmtNum(n, dec);
  const lines: string[] = [];
  if (req) {
    lines.push(req.prompt.length > 28 ? req.prompt.slice(0, 27) + '…' : req.prompt);
    const base = eng.reqBase();
    if (base && (req.kind === 'point' || req.kind === 'dist' || req.kind === 'angle')) {
      const L = Math.hypot(p.x - base.x, p.y - base.y);
      const ang = ((Math.atan2(p.y - base.y, p.x - base.x) * 180) / Math.PI + 360) % 360;
      lines.push(`길이 ${f(L)}  <  ${f(ang)}°${eng.track ? '  (극좌표)' : ''}`);
    } else if (eng.needsPoint()) lines.push(`X ${f(p.x)}   Y ${f(p.y)}`);
  } else if (eng.typing) lines.push('명령');
  if (eng.typing) lines.push('▶ ' + eng.typing);
  if (eng.snap) lines.push(snapNameKo[eng.snap.kind]);
  if (!lines.length) return;
  ctx.font = '12px "Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14;
  const h = lines.length * 17 + 8;
  let x = c.x + 22, y = c.y + 22;
  if (x + w > eng.view.w) x = c.x - 22 - w;
  if (y + h > eng.view.h) y = c.y - 22 - h;
  ctx.fillStyle = theme.name === 'dark' ? 'rgba(40,44,52,0.92)' : 'rgba(255,255,255,0.94)';
  ctx.strokeStyle = theme.name === 'dark' ? '#5a6270' : '#b9c0c8';
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.fillStyle = theme.name === 'dark' ? '#e8eaed' : '#1d2228';
  lines.forEach((l, i) => ctx.fillText(l, x + 7, y + 18 + i * 17));
}
