// 교차점 계산 (직선·원호 세그먼트)
import { arcParam, cross, dist, dot, EPS, sub, type ArcSeg, type LineSeg, type Seg } from './geom';
import type { Vec2 } from './types';

export interface Hit {
  p: Vec2;
  /** 첫 번째 세그먼트 매개변수 */
  t1: number;
  /** 두 번째 세그먼트 매개변수 */
  t2: number;
}

const PT = 1e-9;
const inRange = (t: number) => t >= -PT && t <= 1 + PT;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** 무한 직선(a,b) 두 개의 교점 매개변수 */
export function lineLineParams(a1: Vec2, b1: Vec2, a2: Vec2, b2: Vec2): { t1: number; t2: number } | null {
  const d1 = sub(b1, a1), d2 = sub(b2, a2);
  const den = cross(d1, d2);
  const scale = Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y);
  if (scale < EPS || Math.abs(den) <= 1e-12 * scale) return null; // 평행
  const w = sub(a2, a1);
  return { t1: cross(w, d2) / den, t2: cross(w, d1) / den };
}

/** 무한 직선과 원의 교점 (직선 매개변수) */
export function lineCircleParams(a: Vec2, b: Vec2, c: Vec2, r: number): number[] {
  const d = sub(b, a);
  const f = sub(a, c);
  const A = dot(d, d);
  if (A < EPS * EPS) return [];
  const B = 2 * dot(f, d);
  const C = dot(f, f) - r * r;
  let disc = B * B - 4 * A * C;
  const tolDisc = 1e-10 * Math.max(1, B * B, Math.abs(4 * A * C));
  if (disc < -tolDisc) return [];
  if (disc < tolDisc) disc = 0;
  if (disc === 0) return [-B / (2 * A)];
  const s = Math.sqrt(disc);
  return [(-B - s) / (2 * A), (-B + s) / (2 * A)];
}

/** 두 원의 교점 */
export function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const d = dist(c1, c2);
  if (d < EPS) return []; // 동심원
  if (d > r1 + r2 + 1e-9 * Math.max(1, d) || d < Math.abs(r1 - r2) - 1e-9 * Math.max(1, d)) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  let h2 = r1 * r1 - a * a;
  if (h2 < 0) h2 = 0;
  const h = Math.sqrt(h2);
  const ux = (c2.x - c1.x) / d, uy = (c2.y - c1.y) / d;
  const px = c1.x + a * ux, py = c1.y + a * uy;
  if (h < 1e-12 * Math.max(1, r1)) return [{ x: px, y: py }];
  return [
    { x: px - h * uy, y: py + h * ux },
    { x: px + h * uy, y: py - h * ux },
  ];
}

/** 수평/수직 선이 관련된 교점은 축 좌표를 그대로 사용하여 부동소수 오차 제거 */
function exactAxis(p: Vec2, ...ls: LineSeg[]): Vec2 {
  let { x, y } = p;
  for (const l of ls) {
    if (l.a.x === l.b.x) x = l.a.x;
    if (l.a.y === l.b.y) y = l.a.y;
  }
  return { x, y };
}

function lineLine(s1: LineSeg, s2: LineSeg): Hit[] {
  const r = lineLineParams(s1.a, s1.b, s2.a, s2.b);
  if (!r || !inRange(r.t1) || !inRange(r.t2)) return [];
  const t1 = clamp01(r.t1);
  return [{ p: exactAxis({ x: s1.a.x + (s1.b.x - s1.a.x) * t1, y: s1.a.y + (s1.b.y - s1.a.y) * t1 }, s1, s2), t1, t2: clamp01(r.t2) }];
}

function lineArc(l: LineSeg, a: ArcSeg): Hit[] {
  const out: Hit[] = [];
  for (const t of lineCircleParams(l.a, l.b, a.c, a.r)) {
    if (!inRange(t)) continue;
    const p = { x: l.a.x + (l.b.x - l.a.x) * t, y: l.a.y + (l.b.y - l.a.y) * t };
    const ta = arcParam(a, Math.atan2(p.y - a.c.y, p.x - a.c.x));
    if (!inRange(ta)) continue;
    out.push({ p, t1: clamp01(t), t2: clamp01(ta) });
  }
  return out;
}

function arcArc(a1: ArcSeg, a2: ArcSeg): Hit[] {
  const out: Hit[] = [];
  for (const p of circleCircle(a1.c, a1.r, a2.c, a2.r)) {
    const t1 = arcParam(a1, Math.atan2(p.y - a1.c.y, p.x - a1.c.x));
    const t2 = arcParam(a2, Math.atan2(p.y - a2.c.y, p.x - a2.c.x));
    if (inRange(t1) && inRange(t2)) out.push({ p, t1: clamp01(t1), t2: clamp01(t2) });
  }
  return out;
}

/** 두 유한 세그먼트의 교점 */
export function segIntersect(s1: Seg, s2: Seg): Hit[] {
  if (s1.kind === 'line' && s2.kind === 'line') return lineLine(s1, s2);
  if (s1.kind === 'line' && s2.kind === 'arc') return lineArc(s1, s2);
  if (s1.kind === 'arc' && s2.kind === 'line') return lineArc(s2, s1).map((h) => ({ p: h.p, t1: h.t2, t2: h.t1 }));
  return arcArc(s1 as ArcSeg, s2 as ArcSeg);
}

/** 연장된 곡선(무한 직선/완전한 원)끼리의 교점. 오프셋 모서리 연결용 */
export function curveIntersect(s1: Seg, s2: Seg): Vec2[] {
  if (s1.kind === 'line' && s2.kind === 'line') {
    const r = lineLineParams(s1.a, s1.b, s2.a, s2.b);
    if (!r) return [];
    return [exactAxis({ x: s1.a.x + (s1.b.x - s1.a.x) * r.t1, y: s1.a.y + (s1.b.y - s1.a.y) * r.t1 }, s1, s2)];
  }
  if (s1.kind === 'arc' && s2.kind === 'arc') return circleCircle(s1.c, s1.r, s2.c, s2.r);
  const l = (s1.kind === 'line' ? s1 : s2) as LineSeg;
  const a = (s1.kind === 'arc' ? s1 : s2) as ArcSeg;
  return lineCircleParams(l.a, l.b, a.c, a.r).map((t) => ({ x: l.a.x + (l.b.x - l.a.x) * t, y: l.a.y + (l.b.y - l.a.y) * t }));
}
