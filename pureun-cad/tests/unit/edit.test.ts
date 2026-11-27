import { describe, expect, it } from 'vitest';
import { camCheck, chamferLines, explodeEntity, extendEntity, filletLines, findOverkill, joinEntities, mirrorEntity, polarArray, rectArray, scaleEntity } from '../../src/core/edit';
import { entityLength, entitySegs } from '../../src/core/entity';
import { breakEntity } from '../../src/core/trim';
import type { Entity } from '../../src/core/types';

type Line = Extract<Entity, { type: 'line' }>;
const L = (x1: number, y1: number, x2: number, y2: number, id = 1): Line => ({ id, type: 'line', layer: '0', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } });

describe('MIRROR / SCALE', () => {
  it('Y축 대칭: 호 각도와 폴리선 bulge 반전', () => {
    const a = mirrorEntity({ id: 1, type: 'arc', layer: '0', c: { x: 10, y: 0 }, r: 5, a0: 0, a1: 90 }, { x: 0, y: 0 }, { x: 0, y: 1 });
    expect(a.c.x).toBeCloseTo(-10, 12);
    expect([a.a0, a.a1]).toEqual([90, 180]);
    const p = mirrorEntity({ id: 1, type: 'polyline', layer: '0', closed: false, pts: [{ x: 0, y: 0, b: 1 }, { x: 10, y: 0, b: 0 }] }, { x: 0, y: 0 }, { x: 0, y: 1 });
    expect(p.pts[0].b).toBe(-1);
  });
  it('축척 2배: 원 반지름', () => {
    const c = scaleEntity({ id: 1, type: 'circle', layer: '0', c: { x: 10, y: 10 }, r: 5 }, { x: 0, y: 0 }, 2);
    expect([c.c, c.r]).toEqual([{ x: 20, y: 20 }, 10]);
  });
});

describe('EXTEND', () => {
  it('선을 수직선 경계까지 연장', () => {
    const r = extendEntity(L(0, 0, 5, 0), { x: 4, y: 0 }, entitySegs(L(10, -5, 10, 5)));
    expect((r.entity as Line).p2).toEqual({ x: 10, y: 0 });
  });
  it('선을 원 경계까지 연장', () => {
    const r = extendEntity(L(0, 0, 5, 0), { x: 4, y: 0 }, entitySegs({ id: 2, type: 'circle', layer: '0', c: { x: 20, y: 0 }, r: 5 }));
    expect((r.entity as Line).p2.x).toBeCloseTo(15, 12);
  });
  it('호를 선 경계까지 연장', () => {
    const r = extendEntity({ id: 1, type: 'arc', layer: '0', c: { x: 0, y: 0 }, r: 10, a0: 0, a1: 45 }, { x: 7, y: 7 }, entitySegs(L(0, 0, 0, 20)));
    expect((r.entity as Extract<Entity, { type: 'arc' }>).a1).toBeCloseTo(90, 9);
  });
  it('경계 없음 → 오류', () => {
    expect(extendEntity(L(0, 0, 5, 0), { x: 4, y: 0 }, entitySegs(L(10, 5, 20, 5))).ok).toBe(false);
  });
});

describe('FILLET / CHAMFER', () => {
  const inp = { l1: L(0, 0, 20, 0, 1), pick1: { x: 15, y: 0 }, l2: L(0, 0, 0, 20, 2), pick2: { x: 0, y: 15 } };
  it('직각 모서리 R5', () => {
    const r = filletLines(inp, 5);
    expect(r.ok).toBe(true);
    const [a, b, arc] = r.entities as [Line, Line, Extract<Entity, { type: 'arc' }>];
    expect(a.p1.x).toBeCloseTo(5, 12);
    expect(b.p1.y).toBeCloseTo(5, 12);
    expect(arc.c.x).toBeCloseTo(5, 12);
    expect(arc.c.y).toBeCloseTo(5, 12);
    expect([arc.a0, arc.a1].map((x) => Math.round(x))).toEqual([180, 270]);
  });
  it('반지름 0 → 모서리 맞춤 / 반지름 과다 → 오류', () => {
    const r = filletLines({ ...inp, l1: L(2, 0, 20, 0, 1), l2: L(0, 3, 0, 20, 2) }, 0);
    expect((r.entities![0] as Line).p1).toEqual({ x: 0, y: 0 });
    expect(filletLines(inp, 50).ok).toBe(false);
  });
  it('모따기 C3', () => {
    const r = chamferLines(inp, 3, 3);
    const c = r.entities![2] as Line;
    expect([c.p1, c.p2]).toEqual([{ x: 3, y: 0 }, { x: 0, y: 3 }]);
  });
});

describe('JOIN / EXPLODE / BREAK', () => {
  it('사각형 4선 → 닫힌 폴리선 (방향 섞여도)', () => {
    const r = joinEntities([L(0, 0, 10, 0, 1), L(10, 10, 10, 0, 2), L(10, 10, 0, 10, 3), L(0, 0, 0, 10, 4)]);
    expect(r.created.length).toBe(1);
    const p = r.created[0] as Extract<Entity, { type: 'polyline' }>;
    expect(p.closed).toBe(true);
    expect(entityLength({ ...p, id: 0 } as Entity)).toBeCloseTo(40, 12);
  });
  it('선+호 결합 후 분해 → 원래 길이', () => {
    const r = joinEntities([L(0, 0, 10, 0, 1), { id: 2, type: 'arc', layer: '0', c: { x: 10, y: 5 }, r: 5, a0: 270, a1: 90 }]);
    const p = { ...r.created[0], id: 9 } as Entity;
    expect(entityLength(p)).toBeCloseTo(10 + Math.PI * 5, 9);
    const ex = explodeEntity(p)!;
    expect(ex.map((e) => e.type)).toEqual(['line', 'arc']);
  });
  it('BREAK: 선 가운데 / 원 반시계 구간', () => {
    const r = breakEntity(L(0, 0, 10, 0), { x: 3, y: 0 }, { x: 6, y: 0 });
    expect(r.pieces.length).toBe(2);
    const c = breakEntity({ id: 1, type: 'circle', layer: '0', c: { x: 0, y: 0 }, r: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 });
    const a = c.pieces[0] as Extract<Entity, { type: 'arc' }>;
    expect([Math.round(a.a0), Math.round(a.a1)]).toEqual([90, 0]);
  });
});

describe('ARRAY / OVERKILL / CAM 검사', () => {
  it('원형 배열 PCD150 8개 (원본 포함)', () => {
    const hole: Entity = { id: 1, type: 'circle', layer: '0', c: { x: 75, y: 0 }, r: 7 };
    const out = polarArray([hole], { x: 0, y: 0 }, 8, 360, true) as Extract<Entity, { type: 'circle' }>[];
    expect(out.length).toBe(7);
    expect(out[1].c.x).toBeCloseTo(0, 9);
    expect(out[1].c.y).toBeCloseTo(75, 9);
  });
  it('직사각형 배열 3x4', () => {
    expect(rectArray([L(0, 0, 1, 0)], 3, 4, 10, 20).length).toBe(11);
  });
  it('중복선(역방향 포함)·포함된 겹친 선 검출', () => {
    const r = findOverkill([L(0, 0, 10, 0, 1), L(10, 0, 0, 0, 2), L(2, 0, 5, 0, 3), L(0, 5, 10, 5, 4)]);
    expect(r.duplicates).toEqual([2]);
    expect(r.overlapped).toEqual([3]);
  });
  it('열린 끝점·길이 0 검출', () => {
    const r = camCheck([L(0, 0, 10, 0, 1), L(10, 0, 10, 10, 2), L(5, 5, 5, 5, 3)]);
    expect(r.openEnds.length).toBe(2);
    expect(r.zeroLength).toEqual([3]);
  });
});
