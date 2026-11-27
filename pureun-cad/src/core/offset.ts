// 간격띄우기(OFFSET)
import { baseProps, entitySegs } from './entity';
import {
  add, angleOf, closestOnSeg, cross, dist, dot, mul, norm, normAng, perpL, samePt, segEnd, segStart, segTangent,
  sub, TAU, type ArcSeg, type Seg,
} from './geom';
import { curveIntersect } from './intersect';
import type { Entity, NewEntity, PVertex, Vec2 } from './types';

export interface OffsetResult {
  ok: boolean;
  entity?: NewEntity;
  message?: string;
}

/** 지정 점이 객체의 왼쪽(+1)인지 오른쪽(-1)인지. 원/호는 바깥쪽 +1 */
export function offsetSide(e: Entity, p: Vec2): number {
  if (e.type === 'circle' || e.type === 'arc') return dist(p, e.c) > e.r ? 1 : -1;
  const segs = entitySegs(e);
  let best = Infinity, side = 1;
  for (const s of segs) {
    const c = closestOnSeg(s, p);
    if (c.d < best) {
      best = c.d;
      const t = segTangent(s, c.t);
      side = cross(t, sub(p, c.p)) >= 0 ? 1 : -1;
    }
  }
  return side;
}

/** 점에서 객체까지 거리 (통과점 지정용) */
export function distanceToCurve(e: Entity, p: Vec2): number {
  let best = Infinity;
  for (const s of entitySegs(e)) best = Math.min(best, closestOnSeg(s, p).d);
  return best;
}

const wrapPi = (a: number) => {
  let r = normAng(a);
  if (r > Math.PI) r -= TAU;
  return r;
};

function offsetSeg(s: Seg, d: number): Seg | null {
  if (s.kind === 'line') {
    const n = mul(perpL(norm(sub(s.b, s.a))), d);
    return { kind: 'line', a: add(s.a, n), b: add(s.b, n) };
  }
  // 진행방향 왼쪽: 반시계 호는 중심 쪽
  const r = s.r - d * Math.sign(s.sweep);
  if (r <= 1e-9 * Math.max(1, s.r)) return null;
  return { kind: 'arc', c: s.c, r, start: s.start, sweep: s.sweep };
}

function setStart(s: Seg, p: Vec2): Seg {
  if (s.kind === 'line') return { ...s, a: p };
  const ns = angleOf(s.c, p);
  return { ...s, start: ns, sweep: s.sweep + wrapPi(s.start - ns) };
}
function setEnd(s: Seg, p: Vec2): Seg {
  if (s.kind === 'line') return { ...s, b: p };
  const oe = s.start + s.sweep;
  return { ...s, sweep: s.sweep + wrapPi(angleOf(s.c, p) - oe) };
}

function sameDirection(orig: Seg, now: Seg): boolean {
  if (orig.kind === 'line' && now.kind === 'line') {
    const L = dist(now.a, now.b);
    return L > 1e-9 && dot(sub(orig.b, orig.a), sub(now.b, now.a)) > 0;
  }
  if (orig.kind === 'arc' && now.kind === 'arc') {
    return Math.sign(orig.sweep) === Math.sign(now.sweep) && Math.abs(now.sweep) > 1e-9 && Math.abs(now.sweep) < TAU;
  }
  return false;
}

export function offsetPolySegs(segs: Seg[], closed: boolean, d: number): { segs: Seg[] } | { error: string } {
  const n = segs.length;
  const off: Seg[] = [];
  for (const s of segs) {
    const o = offsetSeg(s, d);
    if (!o) return { error: '간격이 호의 반지름보다 커서 계산할 수 없습니다.' };
    off.push(o);
  }
  const out: Seg[] = [];
  // 연결부 처리: 교점으로 연장/절단, 교점이 없으면 원호로 연결
  const joins: (Seg | null)[] = new Array(n).fill(null); // i번 뒤에 삽입할 연결호
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % n;
    const A = off[i], B = off[j];
    const ea = segEnd(A), sb = segStart(B);
    if (samePt(ea, sb, 1e-9 * Math.max(1, Math.abs(d)))) continue;
    const V = segStart(segs[j]);
    const cands = curveIntersect(A, B);
    let I: Vec2 | null = null;
    let bd = Infinity;
    for (const c of cands) {
      const dd = dist(c, V);
      if (dd < bd) {
        bd = dd;
        I = c;
      }
    }
    // 바깥 모서리의 교점이 지나치게 멀면(접선에 가까운 경우) 원호 연결
    if (I && bd <= Math.abs(d) * 50) {
      off[i] = setEnd(off[i], I);
      off[j] = setStart(off[j], I);
    } else {
      const a0 = angleOf(V, ea), a1 = angleOf(V, sb);
      const fillet: ArcSeg = { kind: 'arc', c: V, r: Math.abs(d), start: a0, sweep: wrapPi(a1 - a0) };
      joins[i] = fillet;
    }
  }
  for (let i = 0; i < n; i++) {
    if (!sameDirection(segs[i], off[i])) {
      return { error: '간격띄우기 결과가 자기 교차하거나 세그먼트가 소멸하여 계산할 수 없습니다. 더 작은 간격을 사용하십시오.' };
    }
    out.push(off[i]);
    const jn = joins[i];
    if (jn) out.push(jn);
  }
  return { segs: out };
}

export function offsetEntity(e: Entity, d: number, side: number): OffsetResult {
  if (!(d > 0) || !Number.isFinite(d)) return { ok: false, message: '간격은 0보다 커야 합니다.' };
  const base = baseProps(e);
  const sd = d * side;
  switch (e.type) {
    case 'line': {
      const n = mul(perpL(norm(sub(e.p2, e.p1))), sd);
      return { ok: true, entity: { type: 'line', ...base, p1: add(e.p1, n), p2: add(e.p2, n) } };
    }
    case 'circle': {
      const r = e.r + sd;
      if (r <= 0) return { ok: false, message: '간격이 반지름보다 커서 안쪽으로 띄울 수 없습니다.' };
      return { ok: true, entity: { type: 'circle', ...base, c: { ...e.c }, r } };
    }
    case 'arc': {
      const r = e.r + sd;
      if (r <= 0) return { ok: false, message: '간격이 반지름보다 커서 안쪽으로 띄울 수 없습니다.' };
      return { ok: true, entity: { type: 'arc', ...base, c: { ...e.c }, r, a0: e.a0, a1: e.a1 } };
    }
    case 'polyline': {
      const segs = entitySegs(e);
      if (!segs.length) return { ok: false, message: '정점이 부족한 폴리선입니다.' };
      const r = offsetPolySegs(segs, e.closed, sd);
      if ('error' in r) return { ok: false, message: r.error };
      const pts: PVertex[] = r.segs.map((s) => ({ ...segStart(s), b: s.kind === 'arc' ? Math.tan(s.sweep / 4) : 0 }));
      if (!e.closed) pts.push({ ...segEnd(r.segs[r.segs.length - 1]), b: 0 });
      return { ok: true, entity: { type: 'polyline', ...base, pts, closed: e.closed } };
    }
    default:
      return { ok: false, message: '문자·치수는 간격띄우기를 할 수 없습니다.' };
  }
}


