// 자르기(TRIM): 선택한 부분을 경계 교차점 사이에서 제거
import { baseProps, entitySegs } from './entity';
import { angleOf, cleanPolyPts, closestOnSeg, DEG, normDeg, segPoint, type Seg } from './geom';
import { segIntersect } from './intersect';
import type { Entity, NewEntity, PVertex } from './types';

export interface TrimResult {
  ok: boolean;
  /** 대상 객체를 대체할 새 객체(0~2개) */
  pieces: NewEntity[];
  message?: string;
}

const UTOL = 1e-9;

/** 대상 객체의 전역 매개변수(u = 세그먼트번호 + t)로 표현된 절단점 */
export function cutParams(target: Entity, cutters: Seg[]): number[] {
  const segs = entitySegs(target);
  const us: number[] = [];
  segs.forEach((s, i) => {
    for (const c of cutters) for (const h of segIntersect(s, c)) us.push(i + h.t1);
  });
  // 폴리선 자기 교차 (인접 세그먼트 제외)
  if (target.type === 'polyline') {
    const n = segs.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (target.closed && i === 0 && j === n - 1) continue;
        for (const h of segIntersect(segs[i], segs[j])) us.push(i + h.t1, j + h.t2);
      }
    }
  }
  us.sort((a, b) => a - b);
  const out: number[] = [];
  for (const u of us) if (!out.length || u - out[out.length - 1] > UTOL) out.push(u);
  return out;
}

function pickParam(segs: Seg[], pick: { x: number; y: number }): number {
  let best = Infinity, u = 0;
  segs.forEach((s, i) => {
    const c = closestOnSeg(s, pick);
    if (c.d < best) {
      best = c.d;
      u = i + c.t;
    }
  });
  return u;
}

/** 폴리선의 [u0,u1] 구간 (u1은 n을 넘어 순환 가능) */
export function polyPiece(pts: PVertex[], closed: boolean, u0: number, u1: number): PVertex[] {
  const segs = entitySegsOfPoly(pts, closed);
  const n = segs.length;
  const out: PVertex[] = [];
  let i = Math.floor(u0 + UTOL);
  if (i > u0 + UTOL) i--;
  let last: PVertex | null = null;
  while (i < u1 - UTOL) {
    const si = ((i % n) + n) % n;
    const s = segs[si];
    const ta = Math.max(0, u0 - i);
    const tb = Math.min(1, u1 - i);
    if (tb - ta > UTOL) {
      const vi = pts[si];
      const a = ta < UTOL ? { x: vi.x, y: vi.y } : segPoint(s, ta);
      const b = Math.abs(vi.b) < 1e-15 ? 0 : Math.tan(Math.atan(vi.b) * (tb - ta));
      out.push({ x: a.x, y: a.y, b });
      const vn = pts[(si + 1) % pts.length];
      last = tb > 1 - UTOL ? { x: vn.x, y: vn.y, b: 0 } : { ...segPoint(s, tb), b: 0 };
    }
    i++;
  }
  if (last) out.push(last);
  return out;
}

function entitySegsOfPoly(pts: PVertex[], closed: boolean) {
  return entitySegs({ type: 'polyline', id: 0, layer: '0', pts, closed });
}

export function trimEntity(original: Entity, pick: { x: number; y: number }, cutters: Seg[]): TrimResult {
  if (original.type === 'text' || original.type === 'dimension') return { ok: false, pieces: [], message: '문자·치수는 자를 수 없습니다.' };
  // 길이 0 세그먼트(중복 정점)는 계산에서 제외
  const target: Entity = original.type === 'polyline' ? { ...original, pts: cleanPolyPts(original.pts, original.closed) } : original;
  if (target.type === 'polyline' && target.pts.length < 2) return { ok: false, pieces: [], message: '정점이 부족한 폴리선입니다.' };
  const segs = entitySegs(target);
  const n = segs.length;
  if (!n) return { ok: false, pieces: [], message: '자를 수 없는 객체입니다.' };
  const cyclic = target.type === 'circle' || (target.type === 'polyline' && target.closed);
  let cuts = cutParams(target, cutters);
  const up = pickParam(segs, pick);
  const base = baseProps(target);

  if (!cyclic) {
    cuts = cuts.filter((u) => u > UTOL && u < n - UTOL);
    if (!cuts.length) return { ok: false, pieces: [], message: '선택한 객체와 교차하는 경계가 없습니다.' };
    let lo = 0, hi = n;
    for (const u of cuts) {
      if (u < up - UTOL) lo = u;
      else if (u > up + UTOL) {
        hi = u;
        break;
      }
    }
    const ranges: [number, number][] = [];
    if (lo > UTOL) ranges.push([0, lo]);
    if (hi < n - UTOL) ranges.push([hi, n]);
    const pieces = ranges.map(([a, b]) => buildPiece(target, a, b, base)).filter((x): x is NewEntity => !!x);
    if (!pieces.length) return { ok: false, pieces: [], message: '남는 부분이 없어 자를 수 없습니다. (지우려면 ERASE를 사용하십시오)' };
    return { ok: true, pieces };
  }

  // 닫힌 객체: 시작점(u=0)과 끝점(u=n)은 같은 점이므로 하나로 합침
  {
    const w = cuts.map((u) => {
      let x = ((u % n) + n) % n;
      if (x > n - UTOL) x = 0;
      return x;
    });
    w.sort((a, b) => a - b);
    cuts = [];
    for (const u of w) if (!cuts.length || u - cuts[cuts.length - 1] > UTOL) cuts.push(u);
  }
  // 닫힌 객체: 절단점 2개 이상 필요
  if (target.type === 'circle') {
    // 원은 각도 기준 (세그먼트 1개, u = 0~1)
    if (cuts.length < 2) return { ok: false, pieces: [], message: '원을 자르려면 경계와의 교차점이 2개 이상 필요합니다.' };
  } else if (cuts.length < 2) {
    return { ok: false, pieces: [], message: '닫힌 폴리선을 자르려면 교차점이 2개 이상 필요합니다.' };
  }
  let lo = cuts[cuts.length - 1] - n, hi = cuts[0] + n;
  for (const u of cuts) {
    if (u < up) lo = u;
    else if (u > up) {
      hi = u;
      break;
    }
  }
  // 남길 구간: hi → lo + n
  const keep0 = hi, keep1 = lo + n;
  if (target.type === 'circle') {
    const s = segs[0];
    const pA = segPoint(s, keep0 % 1), pB = segPoint(s, keep1 % 1 === 0 ? 1 : keep1 % 1);
    const a0 = normDeg(angleOf(target.c, pA) / DEG);
    const a1 = normDeg(angleOf(target.c, pB) / DEG);
    return { ok: true, pieces: [{ type: 'arc', ...base, c: { ...target.c }, r: target.r, a0, a1 }] };
  }
  const piece = buildPiece(target, keep0, keep1, base);
  if (!piece) return { ok: false, pieces: [], message: '남는 부분이 없어 자를 수 없습니다. (지우려면 ERASE를 사용하십시오)' };
  return { ok: true, pieces: [piece] };
}

function buildPiece(target: Entity, u0: number, u1: number, base: ReturnType<typeof baseProps>): NewEntity | null {
  if (u1 - u0 < UTOL) return null;
  switch (target.type) {
    case 'line': {
      const s = entitySegs(target)[0];
      return {
        type: 'line',
        ...base,
        p1: u0 < UTOL ? { ...target.p1 } : segPoint(s, u0),
        p2: u1 > 1 - UTOL ? { ...target.p2 } : segPoint(s, u1),
      };
    }
    case 'arc': {
      const sw = normDeg(target.a1 - target.a0) || 360;
      return {
        type: 'arc',
        ...base,
        c: { ...target.c },
        r: target.r,
        a0: u0 < UTOL ? target.a0 : normDeg(target.a0 + sw * u0),
        a1: u1 > 1 - UTOL ? target.a1 : normDeg(target.a0 + sw * u1),
      };
    }
    case 'polyline': {
      const pts = polyPiece(target.pts, target.closed, u0, u1);
      if (pts.length < 2) return null;
      return { type: 'polyline', ...base, pts, closed: false };
    }
    default:
      return null;
  }
}

/**
 * 끊기(BREAK): 두 점 사이 부분 제거. 원은 첫 점에서 두 번째 점까지 반시계 방향 부분을 제거(AutoCAD와 같음).
 * pA와 pB가 같으면 그 점에서 둘로 나눔(열린 객체만).
 */
export function breakEntity(original: Entity, pA: { x: number; y: number }, pB: { x: number; y: number }): TrimResult {
  if (original.type === 'text' || original.type === 'dimension') return { ok: false, pieces: [], message: '문자·치수는 끊을 수 없습니다.' };
  const target: Entity = original.type === 'polyline' ? { ...original, pts: cleanPolyPts(original.pts, original.closed) } : original;
  const segs = entitySegs(target);
  const n = segs.length;
  if (!n) return { ok: false, pieces: [], message: '끊을 수 없는 객체입니다.' };
  const base = baseProps(target);
  const cyclic = target.type === 'circle' || (target.type === 'polyline' && target.closed);
  const ua = pickParam(segs, pA), ub = pickParam(segs, pB);
  if (!cyclic) {
    const u0 = Math.min(ua, ub), u1 = Math.max(ua, ub);
    const pieces = [buildPiece(target, 0, u0, base), buildPiece(target, u1, n, base)].filter((x): x is NewEntity => !!x);
    if (!pieces.length) return { ok: false, pieces: [], message: '남는 부분이 없습니다. (지우려면 ERASE)' };
    return { ok: true, pieces };
  }
  if (Math.abs(ua - ub) < UTOL) return { ok: false, pieces: [], message: '닫힌 객체는 서로 다른 두 점이 필요합니다.' };
  // 제거: ua → ub (진행 방향), 남김: ub → ua(+n)
  const keep0 = ub, keep1 = ua <= ub ? ua + n : ua;
  if (target.type === 'circle') {
    const s = segs[0];
    const a0 = normDeg(angleOf(target.c, segPoint(s, keep0 % 1)) / DEG);
    const a1 = normDeg(angleOf(target.c, segPoint(s, keep1 % 1)) / DEG);
    return { ok: true, pieces: [{ type: 'arc', ...base, c: { ...target.c }, r: target.r, a0, a1 }] };
  }
  const piece = buildPiece(target, keep0, keep1, base);
  return piece ? { ok: true, pieces: [piece] } : { ok: false, pieces: [], message: '남는 부분이 없습니다.' };
}
