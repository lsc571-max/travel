// 기계가공용: 동일 지름 원 검색 및 일괄 변경 (중심 좌표 유지)
import type { Drawing } from './document';
import type { CircleEnt } from './types';

export interface HoleGroup {
  /** 대표 지름(그룹 최소값) */
  dia: number;
  maxDia: number;
  /** 수정 가능한 원 */
  ids: number[];
  locked: number;
  hidden: number;
}

/** 지름 허용오차(tol, 지름 기준) 안의 원을 묶음 */
export function groupHoles(doc: Drawing, tol: number): HoleGroup[] {
  const circles: CircleEnt[] = [];
  for (const e of doc.entities.values()) if (e.type === 'circle') circles.push(e);
  circles.sort((a, b) => a.r - b.r);
  const groups: HoleGroup[] = [];
  let g: HoleGroup | null = null;
  for (const c of circles) {
    const d = c.r * 2;
    if (!g || d - g.dia > tol) {
      g = { dia: d, maxDia: d, ids: [], locked: 0, hidden: 0 };
      groups.push(g);
    }
    g.maxDia = d;
    const l = doc.layerOf(c);
    if (!l.on) g.hidden++;
    else if (l.locked) g.locked++;
    else g.ids.push(c.id);
  }
  return groups;
}

/** 일괄 지름 변경. 반환: 변경 개수 */
export function changeHoleDiameter(doc: Drawing, ids: number[], newDia: number): number {
  if (!(newDia > 0) || !Number.isFinite(newDia)) throw new Error('지름은 0보다 큰 숫자여야 합니다.');
  const tx = doc.tx('동일 지름 원 일괄 변경');
  let n = 0;
  for (const id of ids) {
    const e = doc.get(id);
    if (e?.type !== 'circle') continue;
    if (tx.update({ ...e, r: newDia / 2 })) n++;
  }
  tx.commit();
  return n;
}
