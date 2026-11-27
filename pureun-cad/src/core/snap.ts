// 객체 스냅: 끝점(END), 중간점(MID), 중심점(CEN), 교차점(INT), 사분점(QUA)
import type { Drawing } from './document';
import { entitySegs } from './entity';
import { bboxOverlap, closestOnSeg, dist, segBBox, segEnd, segPoint, segStart, type Seg } from './geom';
import { segIntersect } from './intersect';
import type { BBox, Entity, Vec2 } from './types';

export type SnapKind = 'end' | 'mid' | 'cen' | 'int' | 'qua';
export interface SnapModes {
  end: boolean;
  mid: boolean;
  cen: boolean;
  int: boolean;
  qua: boolean;
}
export interface SnapResult {
  p: Vec2;
  kind: SnapKind;
}

export const snapNameKo: Record<SnapKind, string> = {
  end: '끝점',
  mid: '중간점',
  cen: '중심점',
  int: '교차점',
  qua: '사분점',
};

export function findSnap(
  doc: Drawing,
  cursor: Vec2,
  aperture: number,
  modes: SnapModes,
  extra: Seg[] = [],
  exclude?: Set<number>,
): SnapResult | null {
  const box: BBox = { minX: cursor.x - aperture, minY: cursor.y - aperture, maxX: cursor.x + aperture, maxY: cursor.y + aperture };
  const segs: Seg[] = [];
  const ents: Entity[] = [];
  for (const id of doc.query(box)) {
    if (exclude?.has(id)) continue;
    const e = doc.get(id)!;
    if (!doc.isVisible(e)) continue;
    ents.push(e);
  }
  for (const p of doc.queryPreserved(box)) {
    if (!doc.isVisible(p)) continue;
    for (const d of p.display ?? []) ents.push(d);
  }
  for (const e of ents) for (const s of entitySegs(e)) if (bboxOverlap(segBBox(s), box)) segs.push(s);
  for (const s of extra) if (bboxOverlap(segBBox(s), box)) segs.push(s);
  if (segs.length > 400) segs.length = 400; // 과밀 영역 계산량 제한

  let best: SnapResult | null = null;
  let bestD = Infinity;
  const prio: Record<SnapKind, number> = { end: 0, int: 1, mid: 2, cen: 3, qua: 4 };
  const consider = (p: Vec2, kind: SnapKind, rankD?: number) => {
    const d = rankD ?? dist(p, cursor);
    const tie = best !== null && Math.abs(d - bestD) <= 1e-9 * Math.max(1, aperture);
    if (d <= aperture && (tie ? prio[kind] < prio[(best as SnapResult).kind] : d < bestD)) {
      bestD = d;
      best = { p, kind };
    }
  };

  for (const s of segs) {
    const full = s.kind === 'arc' && Math.abs(s.sweep) >= Math.PI * 2 - 1e-12;
    if (modes.end && !full) {
      consider(segStart(s), 'end');
      consider(segEnd(s), 'end');
    }
    if (modes.mid && !full) consider(segPoint(s, 0.5), 'mid');
    if (s.kind === 'arc') {
      if (modes.cen) {
        // 곡선 근처에 커서가 있으면 멀리 있는 중심도 제안 (가까운 점 우선)
        const onCurve = closestOnSeg(s, cursor).d <= aperture;
        if (onCurve) consider(s.c, 'cen', aperture * 0.95);
        else consider(s.c, 'cen');
      }
      if (modes.qua) {
        for (let k = 0; k < 4; k++) {
          const ang = (k * Math.PI) / 2;
          const q = { x: s.c.x + s.r * Math.cos(ang), y: s.c.y + s.r * Math.sin(ang) };
          if (full || closestOnSeg(s, q).d < 1e-9 * Math.max(1, s.r)) consider(q, 'qua');
        }
      }
    }
  }
  if (modes.int) {
    // 교차점은 커서에 가까운 세그먼트 60개까지만 계산 (밀집 영역 응답속도 유지)
    if (segs.length > 60) {
      const d = new Map(segs.map((s) => [s, closestOnSeg(s, cursor).d]));
      segs.sort((a, b) => d.get(a)! - d.get(b)!);
    }
    const n = Math.min(segs.length, 60);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        for (const h of segIntersect(segs[i], segs[j])) {
          // 이웃 세그먼트의 공유 끝점은 교차점 후보로 의미가 적지만 AutoCAD도 표시하므로 허용
          consider(h.p, 'int');
        }
      }
    }
  }
  return best;
}
