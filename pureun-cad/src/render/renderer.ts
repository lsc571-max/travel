// Canvas 2D 렌더러
// - 기본 도면 캔버스: 도면·뷰·레이어가 바뀔 때만 다시 그림
// - 선택 캔버스 / 오버레이 캔버스: 선택 강조, 미리보기, 커서, 스냅 표시 (부분 갱신)
// 좌표는 64비트로 화면 좌표로 변환한 뒤 그려 원거리 좌표에서도 떨림이 없도록 한다.
import type { Drawing } from '../core/document';
import { dimGeometry } from '../core/dimension';
import { getDimFormatter, textAnchor } from '../core/entity';
import { displayText } from '../core/format';
import { DEG, normDeg, polySegs, type Seg } from '../core/geom';
import type { Entity, Vec2 } from '../core/types';
import { aciColor } from './aci';
import type { View } from './view';

export interface Theme {
  name: 'dark' | 'light';
  bg: string;
  fg7: string;
  grid: string;
  gridMajor: string;
  select: string;
  hover: string;
  preview: string;
  snap: string;
  cursor: string;
  windowFill: string;
  windowStroke: string;
  crossFill: string;
  crossStroke: string;
  locked: string;
}

export const THEMES: Record<'dark' | 'light', Theme> = {
  dark: {
    name: 'dark',
    bg: '#1f2329',
    fg7: '#ffffff',
    grid: 'rgba(255,255,255,0.06)',
    gridMajor: 'rgba(255,255,255,0.13)',
    select: '#4aa3ff',
    hover: '#ffd24a',
    preview: '#9fe3b5',
    snap: '#33ff66',
    cursor: '#e8e8e8',
    windowFill: 'rgba(70,130,255,0.15)',
    windowStroke: '#5b8cff',
    crossFill: 'rgba(60,200,90,0.15)',
    crossStroke: '#4fd16b',
    locked: 'rgba(31,35,41,0.45)',
  },
  light: {
    name: 'light',
    bg: '#fbfbf8',
    fg7: '#111111',
    grid: 'rgba(0,0,0,0.05)',
    gridMajor: 'rgba(0,0,0,0.12)',
    select: '#0b6bd3',
    hover: '#d48a00',
    preview: '#1c8a45',
    snap: '#0a9e3a',
    cursor: '#333333',
    windowFill: 'rgba(40,90,220,0.12)',
    windowStroke: '#2e62d9',
    crossFill: 'rgba(30,150,60,0.12)',
    crossStroke: '#249442',
    locked: 'rgba(251,251,248,0.5)',
  },
};

const FONT = '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';

/** 세그먼트를 화면 경로에 추가 */
function traceSeg(path: Path2D, s: Seg, view: View, move: boolean) {
  if (s.kind === 'line') {
    if (move) path.moveTo(view.sx(s.a.x), view.sy(s.a.y));
    path.lineTo(view.sx(s.b.x), view.sy(s.b.y));
    return;
  }
  const R = s.r * view.scale;
  const cx = view.sx(s.c.x), cy = view.sy(s.c.y);
  const a0 = s.start, a1 = s.start + s.sweep;
  if (move) path.moveTo(cx + R * Math.cos(a0), cy - R * Math.sin(a0));
  if (R > 2e6) {
    // 매우 큰 반지름: 정밀도 문제를 피하기 위해 다각선으로 근사(표시 전용)
    const n = 512;
    for (let k = 1; k <= n; k++) {
      const a = a0 + (s.sweep * k) / n;
      path.lineTo(cx + R * Math.cos(a), cy - R * Math.sin(a));
    }
    return;
  }
  path.arc(cx, cy, R, -a0, -a1, s.sweep > 0);
}

/** 객체 외곽선(문자 제외)을 경로에 추가 */
export function traceEntity(path: Path2D, e: Entity, view: View) {
  switch (e.type) {
    case 'line':
      path.moveTo(view.sx(e.p1.x), view.sy(e.p1.y));
      path.lineTo(view.sx(e.p2.x), view.sy(e.p2.y));
      return;
    case 'circle': {
      const cx = view.sx(e.c.x), cy = view.sy(e.c.y), R = e.r * view.scale;
      if (R < 0.4) {
        path.rect(cx, cy, 0.5, 0.5);
        return;
      }
      path.moveTo(cx + R, cy);
      path.arc(cx, cy, R, 0, Math.PI * 2);
      return;
    }
    case 'arc': {
      const s0 = normDeg(e.a0) * DEG;
      let sw = normDeg(e.a1 - e.a0);
      if (sw === 0) sw = 360;
      traceSeg(path, { kind: 'arc', c: e.c, r: e.r, start: s0, sweep: sw * DEG }, view, true);
      return;
    }
    case 'polyline': {
      const segs = polySegs(e.pts, e.closed);
      // 닫힌 폴리선은 마지막→첫 세그먼트가 이미 포함됨. (Path2D.closePath는 큰 경로에서 매우 느려 사용하지 않음)
      segs.forEach((s, i) => traceSeg(path, s, view, i === 0));
      return;
    }
    case 'dimension': {
      const g = dimGeometry(e, getDimFormatter());
      for (const l of g.lines) traceSeg(path, l, view, true);
      return;
    }
    case 'text':
      return;
  }
}

function drawText(ctx: CanvasRenderingContext2D, p: Vec2, h: number, rotDeg: number, str: string, anchor: 'lb' | 'cb' | 'cm' | 'rb', view: View) {
  const px = h * view.scale;
  if (px < 1.5) {
    return;
  }
  if (px > 20000) return;
  ctx.save();
  ctx.translate(view.sx(p.x), view.sy(p.y));
  if (rotDeg) ctx.rotate(-rotDeg * DEG);
  ctx.font = `${px}px ${FONT}`;
  ctx.textAlign = anchor === 'lb' ? 'left' : anchor === 'rb' ? 'right' : 'center';
  ctx.textBaseline = anchor === 'cm' ? 'middle' : 'alphabetic';
  ctx.fillText(displayText(str), 0, 0);
  ctx.restore();
}

/** 객체의 문자·화살표(채우기) 부분 */
function fillParts(ctx: CanvasRenderingContext2D, e: Entity, view: View) {
  if (e.type === 'text') {
    const a = textAnchor(e);
    drawText(ctx, a.p, e.h, e.rot, e.text, a.anchor, view);
  } else if (e.type === 'dimension') {
    const g = dimGeometry(e, getDimFormatter());
    ctx.beginPath();
    for (const t of g.arrows) {
      ctx.moveTo(view.sx(t[0].x), view.sy(t[0].y));
      ctx.lineTo(view.sx(t[1].x), view.sy(t[1].y));
      ctx.lineTo(view.sx(t[2].x), view.sy(t[2].y));
      ctx.closePath();
    }
    ctx.fill();
    drawText(ctx, g.text.p, g.text.h, g.text.rot, g.text.str, g.text.anchor, view);
  }
}

export interface StyleInfo {
  color: string;
  dash: number[] | null;
}

export function resolveStyle(doc: Drawing, e: Entity, view: View, theme: Theme): StyleInfo {
  const layer = doc.layerOf(e);
  const aci = e.color === undefined || e.color === 256 ? layer.color : e.color === 0 ? 7 : e.color;
  let lt = e.ltype;
  if (!lt || lt.toUpperCase() === 'BYLAYER') lt = layer.ltype;
  let dash: number[] | null = null;
  if (lt && lt.toUpperCase() !== 'CONTINUOUS' && lt.toUpperCase() !== 'BYBLOCK') {
    const def = doc.ltypes.get(lt.toUpperCase());
    if (def && def.pattern.length) {
      const k = doc.ltscale * view.scale;
      const px = def.pattern.map((v) => (v === 0 ? 1 : Math.abs(v) * k));
      const total = px.reduce((a, b) => a + b, 0);
      if (total >= 4 && total < 1e5) dash = px.length % 2 ? [...px, ...px] : px;
    }
  }
  return { color: aciColor(aci, theme.fg7), dash };
}

/** 객체 묶음을 스타일별로 모아 한 번에 그림 (성능) */
export function drawEntities(ctx: CanvasRenderingContext2D, doc: Drawing, ents: Iterable<Entity>, view: View, theme: Theme, lineWidth = 1) {
  const groups = new Map<string, { style: StyleInfo; path: Path2D; fills: Entity[] }>();
  for (const e of ents) {
    const st = resolveStyle(doc, e, view, theme);
    const key = st.color + '|' + (st.dash ? st.dash.join(',') : '');
    let g = groups.get(key);
    if (!g) {
      g = { style: st, path: new Path2D(), fills: [] };
      groups.set(key, g);
    }
    traceEntity(g.path, e, view);
    if (e.type === 'text' || e.type === 'dimension') g.fills.push(e);
  }
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  for (const g of groups.values()) {
    ctx.strokeStyle = g.style.color;
    ctx.fillStyle = g.style.color;
    ctx.setLineDash(g.style.dash ?? []);
    ctx.stroke(g.path);
    if (g.fills.length) {
      ctx.setLineDash([]);
      for (const e of g.fills) fillParts(ctx, e, view);
    }
  }
  ctx.setLineDash([]);
}

function drawGrid(ctx: CanvasRenderingContext2D, view: View, theme: Theme) {
  const bb = view.bbox();
  let step = Math.pow(10, Math.ceil(Math.log10(12 / view.scale)));
  if (step * view.scale > 60) step /= 2;
  const major = step * 10;
  const lines = (sp: number, color: string) => {
    const x0 = Math.ceil(bb.minX / sp) * sp, y0 = Math.ceil(bb.minY / sp) * sp;
    if ((bb.maxX - x0) / sp > 400 || (bb.maxY - y0) / sp > 400) return;
    ctx.beginPath();
    for (let x = x0; x <= bb.maxX; x += sp) {
      const s = Math.round(view.sx(x)) + 0.5;
      ctx.moveTo(s, 0);
      ctx.lineTo(s, view.h);
    }
    for (let y = y0; y <= bb.maxY; y += sp) {
      const s = Math.round(view.sy(y)) + 0.5;
      ctx.moveTo(0, s);
      ctx.lineTo(view.w, s);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  };
  lines(step, theme.grid);
  lines(major, theme.gridMajor);
}

function drawUcsIcon(ctx: CanvasRenderingContext2D, view: View, theme: Theme) {
  // 원점이 보이면 원점에, 아니면 왼쪽 아래에 표시
  let o = view.toScreen({ x: 0, y: 0 });
  if (o.x < 10 || o.y > view.h - 10 || o.x > view.w - 40 || o.y < 40) o = { x: 18, y: view.h - 18 };
  ctx.strokeStyle = theme.fg7;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(o.x + 28, o.y);
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(o.x, o.y - 28);
  ctx.stroke();
  ctx.fillStyle = theme.fg7;
  ctx.font = `10px ${FONT}`;
  ctx.fillText('X', o.x + 30, o.y + 4);
  ctx.fillText('Y', o.x - 3, o.y - 31);
  ctx.globalAlpha = 1;
}

export interface BaseStats {
  drawn: number;
  ms: number;
}

/** 기본 도면 그리기 */
export function renderBase(ctx: CanvasRenderingContext2D, doc: Drawing, view: View, theme: Theme, opts: { grid: boolean }): BaseStats {
  const t0 = performance.now();
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, view.w, view.h);
  if (opts.grid) drawGrid(ctx, view, theme);
  const bb = view.bbox(2);
  const visible: Entity[] = [];
  const lockedEnts: Entity[] = [];
  // 화면에서 1.5px보다 작은 객체는 점으로 표시 (세부 수준 조절, 데이터는 그대로)
  const tiny = new Map<string, number[]>();
  const lim = 1.5 / view.scale;
  for (const id of doc.query(bb)) {
    const e = doc.get(id)!;
    const l = doc.layerOf(e);
    if (!l.on) continue;
    const b = doc.bboxOf(id);
    if (b && b.maxX - b.minX < lim && b.maxY - b.minY < lim && e.type !== 'text') {
      const c = resolveStyle(doc, e, view, theme).color;
      let arr = tiny.get(c);
      if (!arr) tiny.set(c, (arr = []));
      arr.push(Math.floor(view.sx((b.minX + b.maxX) / 2)), Math.floor(view.sy((b.minY + b.maxY) / 2)));
      continue;
    }
    (l.locked ? lockedEnts : visible).push(e);
  }
  for (const [c, arr] of tiny) {
    const path = new Path2D();
    for (let i = 0; i < arr.length; i += 2) path.rect(arr[i], arr[i + 1], 1, 1);
    ctx.fillStyle = c;
    ctx.fill(path);
  }
  const disp: Entity[] = [];
  for (const p of doc.queryPreserved(bb)) {
    if (!doc.isVisible(p)) continue;
    for (const d of p.display ?? []) if (doc.isVisible(d)) disp.push(d);
  }
  drawEntities(ctx, doc, visible, view, theme);
  if (disp.length) drawEntities(ctx, doc, disp, view, theme);
  if (lockedEnts.length) {
    // 잠긴 레이어는 흐리게 표시
    ctx.globalAlpha = 0.45;
    drawEntities(ctx, doc, lockedEnts, view, theme);
    ctx.globalAlpha = 1;
  }
  drawUcsIcon(ctx, view, theme);
  let nt = 0;
  for (const a of tiny.values()) nt += a.length / 2;
  return { drawn: visible.length + disp.length + lockedEnts.length + nt, ms: performance.now() - t0 };
}

/** 강조(선택/미리보기) 그리기: 단일 색상 */
export function drawHighlight(ctx: CanvasRenderingContext2D, ents: Iterable<Entity>, view: View, color: string, opts: { dash?: number[]; width?: number } = {}) {
  const path = new Path2D();
  const fills: Entity[] = [];
  for (const e of ents) {
    traceEntity(path, e, view);
    if (e.type === 'text' || e.type === 'dimension') fills.push(e);
  }
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = opts.width ?? 1;
  ctx.setLineDash(opts.dash ?? []);
  ctx.stroke(path);
  ctx.setLineDash([]);
  for (const e of fills) fillParts(ctx, e, view);
}
