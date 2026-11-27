// 객체 공통 연산: 세그먼트 분해, 경계상자, 거리, 이동/회전
import {
  add, bboxOfPts, closestOnSeg, DEG, dist, normDeg, polySegs, rotatePt, segBBox, unionBBox, v,
  type Seg,
} from './geom';
import { dimGeometry } from './dimension';
import { textWidth } from './format';
import type { BBox, Entity, Vec2 } from './types';

/** 치수·문자 계산용 숫자 형식기 (도면 설정에서 주입) */
let dimFmt: (n: number) => string = (n) => String(n);
export function setDimFormatter(f: (n: number) => string) {
  dimFmt = f;
}
export const getDimFormatter = () => dimFmt;


/** 문자 외곽 4점 (회전 포함). 정렬값 반영 */
export function textCorners(p: Vec2, h: number, rotDeg: number, str: string, anchor: 'lb' | 'cb' | 'cm' | 'rb' = 'lb'): Vec2[] {
  const w = textWidth(str, h);
  let ox = 0, oy = 0;
  if (anchor === 'cb' || anchor === 'cm') ox = -w / 2;
  if (anchor === 'rb') ox = -w;
  if (anchor === 'cm') oy = -h / 2;
  const pts = [v(ox, oy), v(ox + w, oy), v(ox + w, oy + h), v(ox, oy + h)];
  const ang = rotDeg * DEG;
  return pts.map((q) => rotatePt(add(p, q), p, ang));
}

/** TEXT 정렬(72/73)을 화면 기준점으로 변환 */
export function textAnchor(e: Extract<Entity, { type: 'text' }>): { p: Vec2; anchor: 'lb' | 'cb' | 'cm' | 'rb' } {
  const h = e.hAlign ?? 0, va = e.vAlign ?? 0;
  if ((h === 0 && va === 0) || !e.p2) return { p: e.p, anchor: 'lb' };
  if (h === 4) return { p: e.p2, anchor: 'cm' }; // Middle
  if (h === 1) return { p: e.p2, anchor: va === 2 ? 'cm' : 'cb' };
  if (h === 2) return { p: e.p2, anchor: 'rb' };
  return { p: e.p, anchor: 'lb' };
}

const boxSegs = (pts: Vec2[]): Seg[] => pts.map((a, i) => ({ kind: 'line', a, b: pts[(i + 1) % pts.length] }) as Seg);

/** 기하 세그먼트 (편집·스냅·교차 계산 대상) */
export function entitySegs(e: Entity): Seg[] {
  switch (e.type) {
    case 'line':
      return [{ kind: 'line', a: e.p1, b: e.p2 }];
    case 'circle':
      return [{ kind: 'arc', c: e.c, r: e.r, start: 0, sweep: Math.PI * 2 }];
    case 'arc': {
      const s0 = normDeg(e.a0);
      let sw = normDeg(e.a1 - e.a0);
      if (sw === 0) sw = 360;
      return [{ kind: 'arc', c: e.c, r: e.r, start: s0 * DEG, sweep: sw * DEG }];
    }
    case 'polyline':
      return polySegs(e.pts, e.closed);
    case 'text':
      return [];
    case 'dimension':
      return [];
  }
}

/** 선택(클릭) 판정용 세그먼트: 문자와 치수 포함 */
export function pickSegs(e: Entity): Seg[] {
  if (e.type === 'text') {
    const a = textAnchor(e);
    return boxSegs(textCorners(a.p, e.h, e.rot, e.text, a.anchor));
  }
  if (e.type === 'dimension') {
    const g = dimGeometry(e, dimFmt);
    const segs: Seg[] = [...g.lines];
    segs.push(...boxSegs(textCorners(g.text.p, g.text.h, g.text.rot, g.text.str, g.text.anchor)));
    return segs;
  }
  return entitySegs(e);
}

export function entityBBox(e: Entity): BBox {
  if (e.type === 'text') {
    const a = textAnchor(e);
    return bboxOfPts(textCorners(a.p, e.h, e.rot, e.text, a.anchor));
  }
  if (e.type === 'dimension') {
    const g = dimGeometry(e, dimFmt);
    let bb: BBox | null = null;
    for (const l of g.lines) bb = unionBBox(bb, segBBox(l));
    for (const t of g.arrows) bb = unionBBox(bb, bboxOfPts(t));
    bb = unionBBox(bb, bboxOfPts(textCorners(g.text.p, g.text.h, g.text.rot, g.text.str, g.text.anchor)));
    return bb!;
  }
  let bb: BBox | null = null;
  for (const s of entitySegs(e)) bb = unionBBox(bb, segBBox(s));
  if (!bb) {
    const p = e.type === 'polyline' && e.pts.length ? e.pts[0] : v(0, 0);
    bb = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
  }
  return bb;
}

/** 점에서 객체까지 최단거리 */
export function distToEntity(e: Entity, p: Vec2): number {
  if (e.type === 'text') {
    // 문자 상자 내부면 0
    const a = textAnchor(e);
    const c = textCorners(a.p, e.h, e.rot, e.text, a.anchor);
    if (pointInPoly(p, c)) return 0;
  }
  let best = Infinity;
  for (const s of pickSegs(e)) {
    const d = closestOnSeg(s, p).d;
    if (d < best) best = d;
  }
  return best;
}

export function pointInPoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ───────── 변환 ─────────
const mv = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

export function moveEntity<T extends Entity>(e: T, d: Vec2): T {
  switch (e.type) {
    case 'line':
      return { ...e, p1: mv(e.p1, d), p2: mv(e.p2, d) };
    case 'circle':
    case 'arc':
      return { ...e, c: mv(e.c, d) };
    case 'polyline':
      return { ...e, pts: e.pts.map((q) => ({ x: q.x + d.x, y: q.y + d.y, b: q.b })) };
    case 'text':
      return { ...e, p: mv(e.p, d), p2: e.p2 ? mv(e.p2, d) : undefined };
    case 'dimension':
      return { ...e, p1: mv(e.p1, d), p2: mv(e.p2, d), loc: mv(e.loc, d) };
  }
}

/** 회전: angDeg(도) 반시계 */
export function rotateEntity<T extends Entity>(e: T, base: Vec2, angDeg: number): T {
  const a = angDeg * DEG;
  const r = (p: Vec2) => rotatePt(p, base, a);
  switch (e.type) {
    case 'line':
      return { ...e, p1: r(e.p1), p2: r(e.p2) };
    case 'circle':
      return { ...e, c: r(e.c) };
    case 'arc':
      return { ...e, c: r(e.c), a0: normDeg(e.a0 + angDeg), a1: normDeg(e.a1 + angDeg) };
    case 'polyline':
      return { ...e, pts: e.pts.map((q) => ({ ...r(q), b: q.b })) };
    case 'text':
      return { ...e, p: r(e.p), p2: e.p2 ? r(e.p2) : undefined, rot: normDeg(e.rot + angDeg) };
    case 'dimension':
      return {
        ...e,
        p1: r(e.p1),
        p2: r(e.p2),
        loc: r(e.loc),
        rot: e.kind === 'linear' ? normDeg((e.rot ?? 0) + angDeg) : e.rot,
      };
  }
}

/** 길이(둘레). 문자/치수는 0 */
export function entityLength(e: Entity): number {
  let L = 0;
  for (const s of entitySegs(e)) L += s.kind === 'line' ? dist(s.a, s.b) : Math.abs(s.sweep) * s.r;
  return L;
}

export const typeNameKo: Record<Entity['type'], string> = {
  line: '선(LINE)',
  circle: '원(CIRCLE)',
  arc: '호(ARC)',
  polyline: '폴리선(PLINE)',
  text: '문자(TEXT)',
  dimension: '치수(DIMENSION)',
};

/** 새 객체에 물려줄 공통 속성(레이어·색상·선종류) */
export function baseProps(e: { layer: string; color?: number; ltype?: string }): { layer: string; color?: number; ltype?: string } {
  const b: { layer: string; color?: number; ltype?: string } = { layer: e.layer };
  if (e.color !== undefined) b.color = e.color;
  if (e.ltype !== undefined) b.ltype = e.ltype;
  return b;
}
