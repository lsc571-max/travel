import { describe, expect, it } from 'vitest';
import { parseCoord } from '../../src/core/coords';
import { Drawing } from '../../src/core/document';
import { entityBBox, entityLength, rotateEntity } from '../../src/core/entity';
import { bulgeToArc, polyArea } from '../../src/core/geom';
import { segIntersect } from '../../src/core/intersect';
import { offsetEntity, offsetSide } from '../../src/core/offset';
import { trimEntity } from '../../src/core/trim';
import { entitySegs } from '../../src/core/entity';
import { dxfNum, fmtNum } from '../../src/core/format';
import { findSnap } from '../../src/core/snap';
import type { Entity } from '../../src/core/types';

const L = (x1: number, y1: number, x2: number, y2: number, id = 1): Entity => ({ id, type: 'line', layer: '0', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } });

describe('좌표 입력', () => {
  it('절대/상대/극좌표', () => {
    expect(parseCoord('100,50', null)).toEqual({ kind: 'point', p: { x: 100, y: 50 } });
    expect(parseCoord('@10,-5', { x: 1, y: 1 })).toEqual({ kind: 'point', p: { x: 11, y: -4 } });
    expect(parseCoord('@50<90', { x: 0, y: 0 })).toEqual({ kind: 'point', p: { x: 0, y: 50 } });
    expect(parseCoord('#3,4', { x: 9, y: 9 })).toEqual({ kind: 'point', p: { x: 3, y: 4 } });
    expect(parseCoord('25', { x: 0, y: 0 })).toEqual({ kind: 'distance', d: 25 });
    expect(parseCoord('abc', null).kind).toBe('invalid');
    const p = parseCoord('@10<30', { x: 0, y: 0 });
    expect(p.kind === 'point' && Math.abs(p.p.x - 8.660254037844387) < 1e-12).toBe(true);
  });
});

describe('정밀도', () => {
  it('내부 값은 반올림하지 않고 표시만 반올림', () => {
    expect(fmtNum(1 / 3, 4)).toBe('0.3333');
    expect(dxfNum(1 / 3)).toBe(String(1 / 3));
    expect(Number(dxfNum(0.1 + 0.2))).toBe(0.1 + 0.2);
    expect(dxfNum(1e-7).includes('e')).toBe(false);
    expect(Number(dxfNum(1e-7))).toBe(1e-7);
    expect(dxfNum(5)).toBe('5.0');
  });
});

describe('기하', () => {
  it('bulge=1 은 반원', () => {
    const a = bulgeToArc({ x: 0, y: 0 }, { x: 10, y: 0 }, 1)!;
    expect(a.r).toBeCloseTo(5, 12);
    expect(a.c.x).toBeCloseTo(5, 12);
    expect(a.c.y).toBeCloseTo(0, 12);
    expect(a.sweep).toBeCloseTo(Math.PI, 12);
  });
  it('원 면적 (bulge 폴리선)', () => {
    const area = polyArea([{ x: -5, y: 0, b: 1 }, { x: 5, y: 0, b: 1 }]);
    expect(area).toBeCloseTo(Math.PI * 25, 10);
  });
  it('선-선 교차', () => {
    const h = segIntersect(entitySegs(L(0, 0, 10, 10))[0], entitySegs(L(0, 10, 10, 0))[0]);
    expect(h.length).toBe(1);
    expect(h[0].p.x).toBeCloseTo(5, 12);
  });
  it('호 경계상자 (사분점 포함)', () => {
    const bb = entityBBox({ id: 1, type: 'arc', layer: '0', c: { x: 0, y: 0 }, r: 10, a0: 0, a1: 180 });
    expect(bb.maxY).toBeCloseTo(10, 12);
    expect(bb.minY).toBeCloseTo(0, 12);
  });
  it('회전 시 각도는 도 단위로 정확히 더해짐', () => {
    const a = rotateEntity({ id: 1, type: 'arc', layer: '0', c: { x: 10, y: 0 }, r: 5, a0: 30, a1: 60 }, { x: 0, y: 0 }, 90);
    expect(a.a0).toBe(120);
    expect(a.a1).toBe(150);
    expect(a.c.x).toBeCloseTo(0, 12);
    expect(a.c.y).toBeCloseTo(10, 12);
  });
});

describe('TRIM', () => {
  it('선 가운데 자르기 → 두 조각', () => {
    const t = L(0, 0, 100, 0);
    const cutters = [...entitySegs(L(30, -10, 30, 10)), ...entitySegs(L(60, -10, 60, 10))];
    const r = trimEntity(t, { x: 45, y: 0.1 }, cutters);
    expect(r.ok).toBe(true);
    expect(r.pieces.length).toBe(2);
    const [a, b] = r.pieces as Extract<Entity, { type: 'line' }>[];
    expect(a.p2.x).toBeCloseTo(30, 12);
    expect(b.p1.x).toBeCloseTo(60, 12);
    expect(b.p2.x).toBe(100);
  });
  it('원 자르기 → 호', () => {
    const c: Entity = { id: 1, type: 'circle', layer: '0', c: { x: 0, y: 0 }, r: 10 };
    const r = trimEntity(c, { x: 10, y: 0 }, entitySegs(L(0, -20, 0, 20)));
    expect(r.ok).toBe(true);
    const a = r.pieces[0] as Extract<Entity, { type: 'arc' }>;
    expect(a.type).toBe('arc');
    expect(a.a0).toBeCloseTo(90, 9);
    expect(a.a1).toBeCloseTo(270, 9);
    expect(a.r).toBe(10);
  });
  it('교차 경계 없으면 원본 유지', () => {
    const r = trimEntity(L(0, 0, 10, 0), { x: 5, y: 0 }, entitySegs(L(0, 5, 10, 5)));
    expect(r.ok).toBe(false);
  });
  it('닫힌 폴리선 자르기', () => {
    const sq: Entity = { id: 1, type: 'polyline', layer: '0', closed: true, pts: [ { x: 0, y: 0, b: 0 }, { x: 10, y: 0, b: 0 }, { x: 10, y: 10, b: 0 }, { x: 0, y: 10, b: 0 } ] };
    const r = trimEntity(sq, { x: 5, y: 0 }, entitySegs(L(3, -5, 3, 5)).concat(entitySegs(L(7, -5, 7, 5))));
    expect(r.ok).toBe(true);
    const p = r.pieces[0] as Extract<Entity, { type: 'polyline' }>;
    expect(p.closed).toBe(false);
    expect(entityLength(p)).toBeCloseTo(40 - 4, 9);
  });
});

describe('OFFSET', () => {
  it('선', () => {
    const r = offsetEntity(L(0, 0, 10, 0), 5, offsetSide(L(0, 0, 10, 0), { x: 5, y: 3 }));
    const e = r.entity as Extract<Entity, { type: 'line' }>;
    expect(e.p1.y).toBe(5);
  });
  it('원 안쪽 과다 → 오류', () => {
    const c: Entity = { id: 1, type: 'circle', layer: '0', c: { x: 0, y: 0 }, r: 3 };
    expect(offsetEntity(c, 5, -1).ok).toBe(false);
  });
  it('사각형 폴리선 바깥 간격 → 둘레 증가 (모서리 연장)', () => {
    const sq: Entity = { id: 1, type: 'polyline', layer: '0', closed: true, pts: [ { x: 0, y: 0, b: 0 }, { x: 10, y: 0, b: 0 }, { x: 10, y: 10, b: 0 }, { x: 0, y: 10, b: 0 } ] };
    const side = offsetSide(sq, { x: 5, y: -1 });
    const r = offsetEntity(sq, 2, side);
    expect(r.ok).toBe(true);
    expect(entityLength(r.entity as Entity)).toBeCloseTo(4 * 14, 9);
    const r2 = offsetEntity(sq, 2, -side);
    expect(entityLength(r2.entity as Entity)).toBeCloseTo(4 * 6, 9);
    expect(offsetEntity(sq, 6, -side).ok).toBe(false);
  });
  it('호가 있는 폴리선 (슬롯) 간격', () => {
    // 길이 20, 폭 10 슬롯 (반원 두 개)
    const slot: Entity = { id: 1, type: 'polyline', layer: '0', closed: true, pts: [ { x: 0, y: 0, b: 0 }, { x: 20, y: 0, b: 1 }, { x: 20, y: 10, b: 0 }, { x: 0, y: 10, b: 1 } ] };
    const out = offsetEntity(slot, 1, offsetSide(slot, { x: 10, y: -3 }));
    expect(out.ok).toBe(true);
    expect(entityLength(out.entity as Entity)).toBeCloseTo(40 + Math.PI * 12, 9);
  });
});

describe('문서/실행취소/잠금', () => {
  it('UNDO/REDO 및 잠긴 레이어 보호', () => {
    const d = new Drawing();
    const tx = d.tx('LINE');
    const id = tx.add({ type: 'line', layer: '0', p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 } });
    tx.commit();
    expect(d.entities.size).toBe(1);
    d.undo();
    expect(d.entities.size).toBe(0);
    d.redo();
    expect(d.get(id)).toBeTruthy();
    d.layers.get('0')!.locked = true;
    const t2 = d.tx('ERASE');
    expect(t2.remove(id)).toBe(false);
    t2.commit();
    expect(d.entities.size).toBe(1);
  });
  it('스냅: 끝점/중간점/중심/교차점', () => {
    const d = new Drawing();
    const tx = d.tx('t');
    tx.add({ type: 'line', layer: '0', p1: { x: 0, y: 0 }, p2: { x: 10, y: 10 } });
    tx.add({ type: 'line', layer: '0', p1: { x: 0, y: 10 }, p2: { x: 10, y: 0 } });
    tx.add({ type: 'circle', layer: '0', c: { x: 50, y: 50 }, r: 5 });
    tx.commit();
    const modes = { end: true, mid: true, cen: true, int: true, qua: false };
    expect(findSnap(d, { x: 0.2, y: 0.1 }, 1, modes)?.kind).toBe('end');
    expect(findSnap(d, { x: 5.1, y: 5.2 }, 1, modes)?.kind).toBe('int');
    const c = findSnap(d, { x: 55.2, y: 50 }, 1, modes);
    expect(c?.kind).toBe('cen');
    expect(c?.p).toEqual({ x: 50, y: 50 });
  });
});

import { changeHoleDiameter, groupHoles } from '../../src/core/holes';
import { deleteLayer, renameLayer } from '../../src/core/layers';
describe('동일 지름 원 일괄 변경 / 레이어', () => {
  it('중심 유지, 잠긴 레이어 제외, 실행취소 1회', () => {
    const d = new Drawing();
    const tx = d.tx('t');
    tx.setLayers([{ name: '0', color: 7, on: true, locked: false }, { name: 'L', color: 1, on: true, locked: true }], '0');
    tx.add({ type: 'circle', layer: '0', c: { x: 1, y: 2 }, r: 5 });
    tx.add({ type: 'circle', layer: '0', c: { x: 10, y: 20 }, r: 5.00000001 });
    tx.add({ type: 'circle', layer: 'L', c: { x: 3, y: 3 }, r: 5 });
    tx.add({ type: 'circle', layer: '0', c: { x: 0, y: 0 }, r: 3 });
    tx.commit();
    const g = groupHoles(d, 0.0001);
    expect(g.length).toBe(2);
    const g10 = g.find((x) => Math.abs(x.dia - 10) < 1e-6)!;
    expect(g10.ids.length).toBe(2);
    expect(g10.locked).toBe(1);
    expect(changeHoleDiameter(d, g10.ids, 12)).toBe(2);
    const cs = [...d.entities.values()].filter((e) => e.type === 'circle' && e.r === 6) as Extract<Entity, { type: 'circle' }>[];
    expect(cs.map((c) => c.c)).toEqual([{ x: 1, y: 2 }, { x: 10, y: 20 }]);
    d.undo();
    expect([...d.entities.values()].filter((e) => e.type === 'circle' && e.r === 6).length).toBe(0);
  });
  it('레이어 이름 변경·삭제 규칙', () => {
    const d = new Drawing();
    const tx = d.tx('t');
    tx.setLayers([{ name: '0', color: 7, on: true, locked: false }, { name: 'A', color: 1, on: true, locked: true }], '0');
    tx.add({ type: 'line', layer: 'A', p1: { x: 0, y: 0 }, p2: { x: 1, y: 1 } });
    tx.commit();
    expect(renameLayer(d, '0', 'X')).not.toBeNull();
    expect(renameLayer(d, 'A', 'B')).toBeNull();
    expect([...d.entities.values()][0].layer).toBe('B');
    expect(deleteLayer(d, 'B')).not.toBeNull();
    d.undo();
    expect([...d.entities.values()][0].layer).toBe('A');
  });
});
