// 미지원(보존) DXF 객체의 "화면 표시 전용" 형상 생성
// 블록 참조(INSERT), 각도/좌표 치수, MTEXT, SPLINE, ELLIPSE, SOLID 등을 근사 형상으로 표시한다.
// 표시용 형상은 저장되지 않으며 원본 그룹코드만 보존·저장된다.
import { convertEntity, unescapeDxf, type RawEntity } from './reader';
import { entitySegs } from '../core/entity';
import { DEG, segPoint } from '../core/geom';
import type { DxfPair, Entity, NewEntity, PVertex, Vec2 } from '../core/types';

export interface BlockDef {
  name: string;
  base: Vec2;
  ents: RawEntity[];
}

const num = (s: string | undefined, d = 0) => {
  if (s === undefined) return d;
  const n = Number(s);
  return Number.isFinite(n) ? n : d;
};
const getv = (pairs: DxfPair[], code: number) => pairs.find((p) => p.code === code)?.value;
const all = (pairs: DxfPair[], code: number) => pairs.filter((p) => p.code === code).map((p) => num(p.value));

/** 2D 아핀 변환: x' = a x + b y + tx, y' = c x + d y + ty */
interface Xf {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}
const ID: Xf = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const ap = (m: Xf, p: Vec2): Vec2 => ({ x: m.a * p.x + m.b * p.y + m.tx, y: m.c * p.x + m.d * p.y + m.ty });
const compose = (m: Xf, n: Xf): Xf => ({
  // m ∘ n
  a: m.a * n.a + m.b * n.c,
  b: m.a * n.b + m.b * n.d,
  c: m.c * n.a + m.d * n.c,
  d: m.c * n.b + m.d * n.d,
  tx: m.a * n.tx + m.b * n.ty + m.tx,
  ty: m.c * n.tx + m.d * n.ty + m.ty,
});
const isIdentity = (m: Xf) => m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.tx === 0 && m.ty === 0;

let tmpId = -1;
const withId = (e: NewEntity): Entity => ({ ...e, id: tmpId-- }) as Entity;

function sampleSegs(e: Entity, perArc = 32): PVertex[] {
  const pts: PVertex[] = [];
  const segs = entitySegs(e);
  segs.forEach((s, i) => {
    const n = s.kind === 'line' ? 1 : Math.max(4, Math.ceil((Math.abs(s.sweep) / (Math.PI * 2)) * perArc));
    for (let k = 0; k < n; k++) pts.push({ ...segPoint(s, k / n), b: 0 });
    if (i === segs.length - 1) pts.push({ ...segPoint(s, 1), b: 0 });
  });
  return pts;
}

/** 표시 객체에 변환 적용 */
function transformEntity(e: Entity, m: Xf): Entity {
  if (isIdentity(m)) return e;
  const det = m.a * m.d - m.b * m.c;
  const sx = Math.hypot(m.a, m.c), sy = Math.hypot(m.b, m.d);
  const similar = Math.abs(sx - sy) < 1e-9 * Math.max(sx, sy) && Math.abs(m.a * m.b + m.c * m.d) < 1e-9 * sx * sy;
  const rot = Math.atan2(m.c, m.a) / DEG;
  switch (e.type) {
    case 'line':
      return { ...e, p1: ap(m, e.p1), p2: ap(m, e.p2) };
    case 'circle':
      if (similar) return { ...e, c: ap(m, e.c), r: e.r * sx };
      return { ...e, type: 'polyline', pts: sampleSegs(e, 64).map((p) => ({ ...ap(m, p), b: 0 })), closed: true } as Entity;
    case 'arc':
      if (similar && det > 0) return { ...e, c: ap(m, e.c), r: e.r * sx, a0: e.a0 + rot, a1: e.a1 + rot };
      return { id: e.id, layer: e.layer, color: e.color, type: 'polyline', pts: sampleSegs(e).map((p) => ({ ...ap(m, p), b: 0 })), closed: false };
    case 'polyline':
      if (similar) return { ...e, pts: e.pts.map((p) => ({ ...ap(m, p), b: det < 0 ? -p.b : p.b })) };
      return { ...e, pts: sampleSegs(e).map((p) => ({ ...ap(m, p), b: 0 })), closed: false };
    case 'text':
      return { ...e, p: ap(m, e.p), p2: e.p2 ? ap(m, e.p2) : undefined, h: e.h * sy, rot: e.rot + rot };
    case 'dimension':
      return e;
  }
}

/** MTEXT 서식 코드 제거 → 줄 배열 */
export function mtextLines(raw: string): string[] {
  let s = raw;
  s = s.replace(/\\P/g, '\n').replace(/\\~/g, ' ');
  s = s.replace(/\\[ACcFfHhQqTtWw][^;]*;/g, '');
  s = s.replace(/\\S([^;]*);/g, (_, x: string) => x.replace(/[#^]/g, '/'));
  s = s.replace(/\\[LlOoKk]/g, '');
  s = s.replace(/\\\\/g, '\\').replace(/[{}]/g, '');
  return s.split('\n');
}

interface Ctx {
  blocks: Map<string, BlockDef>;
  layer: string;
  color?: number;
  depth: number;
}

function inherit(e: NewEntity, ctx: Ctx): NewEntity {
  const out = { ...e };
  if (out.layer === '0') out.layer = ctx.layer;
  if (out.color === 0) out.color = ctx.color;
  return out;
}

function rawToDisplay(re: RawEntity, m: Xf, ctx: Ctx): Entity[] {
  const p = re.pairs;
  const g = (c: number) => getv(p, c);
  const n = (c: number, d = 0) => num(g(c), d);
  const layer = unescapeDxf(g(8) ?? '0');
  const colorRaw = g(62) !== undefined ? n(62) : undefined;
  const baseNew = (): { layer: string; color?: number } => {
    const b: { layer: string; color?: number } = { layer: layer === '0' ? ctx.layer : layer };
    if (colorRaw === 0) b.color = ctx.color;
    else if (colorRaw !== undefined && colorRaw !== 256) b.color = colorRaw;
    return b;
  };
  const out: Entity[] = [];
  const push = (e: NewEntity) => out.push(transformEntity(withId(e), m));

  switch (re.type) {
    case 'INSERT': {
      if (ctx.depth > 8) return out;
      const blk = ctx.blocks.get(unescapeDxf(g(2) ?? ''));
      if (!blk) return out;
      const sx = n(41, 1), sy = n(42, 1), rot = n(50) * DEG;
      const cols = Math.max(1, n(70, 1)), rows = Math.max(1, n(71, 1));
      const cs = n(44), rs = n(45);
      const b = baseNew();
      const child: Ctx = { blocks: ctx.blocks, layer: b.layer, color: b.color, depth: ctx.depth + 1 };
      for (let ci = 0; ci < Math.min(cols, 100); ci++) {
        for (let ri = 0; ri < Math.min(rows, 100); ri++) {
          const ox = ci * cs, oy = ri * rs;
          const cosr = Math.cos(rot), sinr = Math.sin(rot);
          // 이동(삽입점+배열 간격 회전) · 회전 · 축척 · (−기준점)
          const local: Xf = {
            a: cosr * sx,
            b: -sinr * sy,
            c: sinr * sx,
            d: cosr * sy,
            tx: n(10) + cosr * ox - sinr * oy,
            ty: n(20) + sinr * ox + cosr * oy,
          };
          const withBase = compose(local, { ...ID, tx: -blk.base.x, ty: -blk.base.y });
          const mm = compose(m, withBase);
          for (const be of blk.ents) out.push(...rawToDisplay(be, mm, child));
        }
      }
      // 속성(ATTRIB)
      for (const c of re.children) if (c.type === 'ATTRIB') out.push(...rawToDisplay(c, m, ctx));
      return out;
    }
    case 'ATTRIB':
    case 'ATTDEF': {
      if (re.type === 'ATTDEF' || (n(70) & 1)) return out;
      const ha = n(72), va = n(74);
      const t: NewEntity = { type: 'text', ...baseNew(), p: { x: n(10), y: n(20) }, h: n(40, 2.5), text: unescapeDxf(g(1) ?? ''), rot: n(50) };
      if (ha || va) Object.assign(t, { hAlign: ha, vAlign: va, p2: { x: n(11), y: n(21) } });
      push(t);
      return out;
    }
    case 'DIMENSION': {
      const blk = ctx.blocks.get(unescapeDxf(g(2) ?? ''));
      if (!blk || ctx.depth > 8) return out;
      const b = baseNew();
      const child: Ctx = { blocks: ctx.blocks, layer: b.layer, color: b.color, depth: ctx.depth + 1 };
      for (const be of blk.ents) out.push(...rawToDisplay(be, m, child));
      return out;
    }
    case 'MTEXT': {
      const h = n(40, 2.5);
      const txt = unescapeDxf(p.filter((q) => q.code === 3).map((q) => q.value).join('') + (g(1) ?? ''));
      const lines = mtextLines(txt);
      let rot = n(50) / DEG; // MTEXT 50은 라디안
      if (g(11) !== undefined) rot = Math.atan2(n(21), n(11)) / DEG;
      const att = n(71, 1);
      const col = (att - 1) % 3; // 0 왼쪽, 1 가운데, 2 오른쪽
      const row = Math.floor((att - 1) / 3); // 0 위, 1 중간, 2 아래
      const lh = h * 1.66;
      const total = (lines.length - 1) * lh + h;
      const top = row === 0 ? 0 : row === 1 ? total / 2 : total;
      const ins = { x: n(10), y: n(20) };
      const cr = Math.cos(rot * DEG), sr = Math.sin(rot * DEG);
      lines.forEach((ln, i) => {
        if (!ln.trim()) return;
        const dy = top - h - i * lh;
        const q = { x: ins.x - sr * dy, y: ins.y + cr * dy };
        const t: NewEntity = { type: 'text', ...baseNew(), p: q, h, text: ln, rot };
        if (col) Object.assign(t, { hAlign: col, vAlign: 0, p2: q });
        push(t);
      });
      return out;
    }
    case 'ELLIPSE': {
      const c = { x: n(10), y: n(20) }, mj = { x: n(11), y: n(21) };
      const ratio = n(40, 1);
      const t0 = n(41, 0);
      let t1 = n(42, Math.PI * 2);
      const flip = n(230, 1) < 0;
      if (t1 <= t0) t1 += Math.PI * 2;
      const steps = Math.max(8, Math.ceil(((t1 - t0) / (Math.PI * 2)) * 96));
      const mn = { x: -mj.y * ratio, y: mj.x * ratio };
      const pts: PVertex[] = [];
      for (let k = 0; k <= steps; k++) {
        const t = t0 + ((t1 - t0) * k) / steps;
        let x = c.x + mj.x * Math.cos(t) + mn.x * Math.sin(t);
        const y = c.y + mj.y * Math.cos(t) + mn.y * Math.sin(t);
        if (flip) x = -x;
        pts.push({ x, y, b: 0 });
      }
      push({ type: 'polyline', ...baseNew(), pts, closed: false });
      return out;
    }
    case 'SPLINE': {
      const pts = evalSpline(p);
      if (pts.length >= 2) push({ type: 'polyline', ...baseNew(), pts: pts.map((q) => ({ ...q, b: 0 })), closed: false });
      return out;
    }
    case 'SOLID':
    case 'TRACE':
    case '3DFACE': {
      const v = [10, 11, 12, 13].map((c) => ({ x: n(c), y: n(c + 10) }));
      const order = re.type === '3DFACE' ? [0, 1, 2, 3] : [0, 1, 3, 2];
      push({ type: 'polyline', ...baseNew(), pts: order.map((k) => ({ ...v[k], b: 0 })), closed: true });
      return out;
    }
    case 'POINT':
      return out;
    default: {
      const r = convertEntity(re, new Map());
      if (r.entity) push(inherit(r.entity, ctx));
      return out;
    }
  }
}

/** 비균일 유리 B-스플라인 평가 (de Boor). 제어점이 없으면 맞춤점 연결 */
export function evalSpline(p: DxfPair[]): Vec2[] {
  const deg = num(getv(p, 71), 3);
  const knots = all(p, 40);
  const xs = all(p, 10), ys = all(p, 20);
  const ctrl = xs.map((x, i) => ({ x, y: ys[i] ?? 0 }));
  const w = all(p, 41);
  if (ctrl.length < deg + 1 || knots.length !== ctrl.length + deg + 1) {
    // 맞춤점만 있는 경우: 맞춤점을 지나는 곡선(Catmull-Rom)으로 표시 근사
    const fx = all(p, 11), fy = all(p, 21);
    const fp = fx.map((x, i) => ({ x, y: fy[i] ?? 0 }));
    if (fp.length < 3) return fp;
    const out: Vec2[] = [];
    for (let i = 0; i < fp.length - 1; i++) {
      const p0 = fp[Math.max(0, i - 1)], p1 = fp[i], p2 = fp[i + 1], p3 = fp[Math.min(fp.length - 1, i + 2)];
      for (let k = 0; k < 16; k++) {
        const t = k / 16, t2 = t * t, t3 = t2 * t;
        const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
      }
    }
    out.push(fp[fp.length - 1]);
    return out;
  }
  const weights = w.length === ctrl.length ? w : ctrl.map(() => 1);
  const t0 = knots[deg], t1 = knots[ctrl.length];
  const steps = Math.min(2000, Math.max(16, ctrl.length * 12));
  const out: Vec2[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k === steps ? t1 : t0 + ((t1 - t0) * k) / steps;
    let s = deg;
    while (s < ctrl.length - 1 && knots[s + 1] <= t) s++;
    const d = [];
    for (let j = 0; j <= deg; j++) {
      const c = ctrl[s - deg + j], wt = weights[s - deg + j];
      d.push({ x: c.x * wt, y: c.y * wt, w: wt });
    }
    for (let r = 1; r <= deg; r++) {
      for (let j = deg; j >= r; j--) {
        const i = s - deg + j;
        const den = knots[i + deg - r + 1] - knots[i];
        const a = den === 0 ? 0 : (t - knots[i]) / den;
        d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y, w: (1 - a) * d[j - 1].w + a * d[j].w };
      }
    }
    const q = d[deg];
    out.push({ x: q.x / q.w, y: q.y / q.w });
  }
  return out;
}

/** 보존 객체의 표시 형상. 표시할 수 없으면 undefined */
export function buildDisplay(re: RawEntity, blocks: Map<string, BlockDef>): Entity[] | undefined {
  try {
    const layer = unescapeDxf(getv(re.pairs, 8) ?? '0');
    const c = getv(re.pairs, 62);
    const ctx: Ctx = { blocks, layer, color: c !== undefined && num(c) !== 256 ? num(c) : undefined, depth: 0 };
    const r = rawToDisplay(re, ID, ctx);
    return r.length ? r : undefined;
  } catch {
    return undefined;
  }
}
