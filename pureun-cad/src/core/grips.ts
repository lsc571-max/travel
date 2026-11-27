// 그립(선택한 객체의 조절점) 위치와 그립 편집
import { angleOf, DEG, dist, mid, normDeg, polar } from './geom';
import { moveEntity } from './entity';
import type { Entity, Vec2 } from './types';

export interface Grip {
  id: number;
  idx: number;
  p: Vec2;
}

export function gripPoints(e: Entity): Vec2[] {
  switch (e.type) {
    case 'line':
      return [e.p1, mid(e.p1, e.p2), e.p2];
    case 'circle':
      return [e.c, ...[0, 90, 180, 270].map((a) => polar(e.c, e.r, a * DEG))];
    case 'arc': {
      const sw = normDeg(e.a1 - e.a0) || 360;
      return [e.c, polar(e.c, e.r, e.a0 * DEG), polar(e.c, e.r, (e.a0 + sw / 2) * DEG), polar(e.c, e.r, e.a1 * DEG)];
    }
    case 'polyline':
      return e.pts.map((p) => ({ x: p.x, y: p.y }));
    case 'text':
      return [e.p];
    case 'dimension':
      return [e.p1, e.p2, e.loc];
  }
}

/** 그립 idx를 점 p로 옮긴 결과 */
export function gripEdit<T extends Entity>(e: T, idx: number, p: Vec2): T {
  const from = gripPoints(e)[idx];
  const d = { x: p.x - from.x, y: p.y - from.y };
  switch (e.type) {
    case 'line':
      if (idx === 0) return { ...e, p1: p };
      if (idx === 2) return { ...e, p2: p };
      return moveEntity(e, d);
    case 'circle':
      if (idx === 0) return moveEntity(e, d);
      return dist(e.c, p) > 0 ? { ...e, r: dist(e.c, p) } : e;
    case 'arc':
      if (idx === 0) return moveEntity(e, d);
      if (idx === 1) return { ...e, a0: normDeg(angleOf(e.c, p) / DEG) };
      if (idx === 3) return { ...e, a1: normDeg(angleOf(e.c, p) / DEG) };
      return dist(e.c, p) > 0 ? { ...e, r: dist(e.c, p) } : e;
    case 'polyline':
      return { ...e, pts: e.pts.map((q, i) => (i === idx ? { ...q, x: p.x, y: p.y } : q)) };
    case 'text':
      return moveEntity(e, d);
    case 'dimension':
      if (idx === 0) return { ...e, p1: p };
      if (idx === 1) return { ...e, p2: p };
      return { ...e, loc: p };
  }
}
