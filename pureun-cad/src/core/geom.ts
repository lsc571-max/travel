// 기하 계산 기본 함수 (벡터, 각도, 세그먼트, 거리, 경계상자)
import type { BBox, PVertex, Vec2 } from './types';

export const EPS = 1e-9;
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
/** 왼쪽(반시계 90°) 법선 */
export const perpL = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
export const polar = (c: Vec2, r: number, ang: number): Vec2 => ({ x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) });
export const angleOf = (from: Vec2, to: Vec2) => Math.atan2(to.y - from.y, to.x - from.x);
export const rotatePt = (p: Vec2, base: Vec2, ang: number): Vec2 => {
  const c = Math.cos(ang), s = Math.sin(ang);
  const dx = p.x - base.x, dy = p.y - base.y;
  return { x: base.x + dx * c - dy * s, y: base.y + dx * s + dy * c };
};
export const samePt = (a: Vec2, b: Vec2, tol = 1e-9) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

/** [0, 2π) 범위로 정규화 */
export const normAng = (a: number) => {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
};
/** [0, 360) 범위로 정규화 (도) */
export const normDeg = (a: number) => {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
};

// ───────── 세그먼트 ─────────
// 모든 곡선은 직선 세그먼트 또는 원호 세그먼트의 열로 분해하여 계산한다.
export interface LineSeg {
  kind: 'line';
  a: Vec2;
  b: Vec2;
}
export interface ArcSeg {
  kind: 'arc';
  c: Vec2;
  r: number;
  /** 시작각(라디안) */
  start: number;
  /** 부호 있는 사이각(라디안). 양수=반시계 */
  sweep: number;
}
export type Seg = LineSeg | ArcSeg;

export function bulgeToArc(p: Vec2, q: Vec2, b: number): ArcSeg | null {
  const d = dist(p, q);
  if (Math.abs(b) < 1e-12 || d < EPS) return null;
  const sweep = 4 * Math.atan(b);
  const m = mid(p, q);
  const n = perpL(norm(sub(q, p)));
  const off = (d * (1 - b * b)) / (4 * b);
  const c = add(m, mul(n, off));
  const r = (d * (1 + b * b)) / (4 * Math.abs(b));
  return { kind: 'arc', c, r, start: angleOf(c, p), sweep };
}

export function polySegs(pts: PVertex[], closed: boolean): Seg[] {
  const segs: Seg[] = [];
  const n = pts.length;
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const arc = bulgeToArc(p, q, p.b);
    segs.push(arc ?? { kind: 'line', a: { x: p.x, y: p.y }, b: { x: q.x, y: q.y } });
  }
  return segs;
}

export const segStart = (s: Seg): Vec2 => (s.kind === 'line' ? s.a : polar(s.c, s.r, s.start));
export const segEnd = (s: Seg): Vec2 => (s.kind === 'line' ? s.b : polar(s.c, s.r, s.start + s.sweep));
export const segPoint = (s: Seg, t: number): Vec2 => (s.kind === 'line' ? lerp(s.a, s.b, t) : polar(s.c, s.r, s.start + s.sweep * t));
/** 진행 방향 접선(단위) */
export const segTangent = (s: Seg, t: number): Vec2 => {
  if (s.kind === 'line') return norm(sub(s.b, s.a));
  const a = s.start + s.sweep * t;
  const tan = { x: -Math.sin(a), y: Math.cos(a) };
  return s.sweep >= 0 ? tan : mul(tan, -1);
};

/** 원호 세그먼트 위에서 각도 ang의 매개변수(0~1). 범위 밖이면 범위 밖 값 */
export function arcParam(s: ArcSeg, ang: number): number {
  if (Math.abs(s.sweep) >= TAU - 1e-12) return normAng(ang - s.start) / TAU;
  const d = s.sweep >= 0 ? normAng(ang - s.start) : normAng(s.start - ang);
  const t = d / Math.abs(s.sweep);
  // 시작점 바로 앞(2π 근처)은 음수 쪽으로 해석
  if (t > 1) {
    const back = (TAU - d) / Math.abs(s.sweep);
    if (back < 1e-9) return -back;
  }
  return t;
}

/** 점 p에 대한 세그먼트 매개변수 (점이 세그먼트 곡선 위에 있다고 가정) */
export function segParamOf(s: Seg, p: Vec2): number {
  if (s.kind === 'line') {
    const d = sub(s.b, s.a);
    const l2 = dot(d, d);
    return l2 < EPS * EPS ? 0 : dot(sub(p, s.a), d) / l2;
  }
  return arcParam(s, angleOf(s.c, p));
}

export interface Closest {
  p: Vec2;
  t: number;
  d: number;
}

export function closestOnSeg(s: Seg, p: Vec2): Closest {
  if (s.kind === 'line') {
    let t = segParamOf(s, p);
    t = Math.max(0, Math.min(1, t));
    const q = lerp(s.a, s.b, t);
    return { p: q, t, d: dist(p, q) };
  }
  const ang = angleOf(s.c, p);
  const t = arcParam(s, ang);
  if (t >= 0 && t <= 1) {
    const q = polar(s.c, s.r, ang);
    return { p: q, t, d: dist(p, q) };
  }
  const a = segStart(s), b = segEnd(s);
  const da = dist(p, a), db = dist(p, b);
  return da <= db ? { p: a, t: 0, d: da } : { p: b, t: 1, d: db };
}

export function segBBox(s: Seg): BBox {
  if (s.kind === 'line') {
    return {
      minX: Math.min(s.a.x, s.b.x),
      minY: Math.min(s.a.y, s.b.y),
      maxX: Math.max(s.a.x, s.b.x),
      maxY: Math.max(s.a.y, s.b.y),
    };
  }
  const a = segStart(s), b = segEnd(s);
  const bb: BBox = {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
  // 사분점 포함 여부
  for (let k = 0; k < 4; k++) {
    const ang = (k * Math.PI) / 2;
    const t = arcParam(s, ang);
    if (t >= 0 && t <= 1) {
      const q = polar(s.c, s.r, ang);
      if (q.x < bb.minX) bb.minX = q.x;
      if (q.y < bb.minY) bb.minY = q.y;
      if (q.x > bb.maxX) bb.maxX = q.x;
      if (q.y > bb.maxY) bb.maxY = q.y;
    }
  }
  return bb;
}

export function unionBBox(a: BBox | null, b: BBox): BBox {
  if (!a) return { ...b };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export const bboxOfPts = (pts: Vec2[]): BBox => {
  let bb: BBox | null = null;
  for (const p of pts) bb = unionBBox(bb, { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y });
  return bb ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
};

export const bboxInside = (inner: BBox, outer: BBox) =>
  inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
export const bboxOverlap = (a: BBox, b: BBox) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;



/** 다각형 면적 (bulge 포함, 부호 있음: 반시계 양수) */
export function polyArea(pts: PVertex[]): number {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += cross(p, q) / 2;
    if (Math.abs(p.b) > 1e-12) {
      const arc = bulgeToArc(p, q, p.b);
      if (arc) {
        const th = arc.sweep;
        // 원호와 현 사이 활꼴 면적(부호 포함)
        a += (arc.r * arc.r * (th - Math.sin(th))) / 2;
      }
    }
  }
  return a;
}
