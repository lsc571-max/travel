// V1 독립 검토 지적 사항 재발 방지
import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/commands/engine';
import { insertExplodeIssue } from '../../src/commands/edit';
import { findOverkill, joinEntities, scaleEntity, stretchEntity } from '../../src/core/edit';
import { moveEntity, rotateEntity } from '../../src/core/entity';
import type { DxfPair, Entity } from '../../src/core/types';
import { buildDisplay } from '../../src/dxf/display';

type Line = Extract<Entity, { type: 'line' }>;
const L = (x1: number, y1: number, x2: number, y2: number, id: number, extra: Partial<Line> = {}): Line => ({ id, type: 'line', layer: '0', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, ...extra });
const P = (code: number, value: string | number): DxfPair => ({ code, value: String(value) });

describe('V1 검토 지적 재발 방지', () => {
  it('1. BREAK @ → 같은 점에서 둘로 나눔 (길이 손실 없음)', () => {
    const eng = new Engine();
    eng.run('C');
    for (const s of ['100,0', '5']) eng.submit(s);
    eng.run('L');
    for (const s of ['0,0', '10,0', '']) eng.submit(s);
    const id = [...eng.doc.entities.values()].find((e) => e.type === 'line')!.id;
    eng.run('BR');
    // 엔티티 선택 요청에 직접 응답 (화면 클릭과 같음)
    (eng as unknown as { feed: (r: unknown) => void }).feed({ t: 'ent', id, p: { x: 3, y: 0 } });
    eng.submit('@');
    const lines = [...eng.doc.entities.values()].filter((e): e is Line => e.type === 'line');
    expect(lines.map((l) => [l.p1.x, l.p2.x]).sort((a, b) => a[0] - b[0])).toEqual([
      [0, 3],
      [3, 10],
    ]);
  });
  it('2. OVERKILL: 레이어·선종류·색상이 다르면 중복 아님', () => {
    const r = findOverkill([
      L(0, 0, 100, 0, 1, { layer: 'OUTLINE' }),
      L(20, 0, 40, 0, 2, { layer: 'CENTER' }),
      L(0, 5, 10, 5, 3),
      L(0, 5, 10, 5, 4, { ltype: 'HIDDEN' }),
      L(0, 9, 10, 9, 5),
      L(0, 9, 10, 9, 6, { color: 1 }),
      L(0, 20, 10, 20, 7),
      L(0, 20, 10, 20, 8),
    ]);
    expect(r).toEqual({ duplicates: [8], overlapped: [] });
  });
  it('3. 블록 분해 가능 여부: 비균일·배열·POINT 포함 → 거부, 대칭은 정확', () => {
    const blk = [{ name: 'B', pairs: [P(0, 'BLOCK'), P(2, 'B'), P(0, 'ARC'), P(10, 0), P(20, 0), P(40, 5), P(50, 0), P(51, 90), P(0, 'ENDBLK')] }];
    const ins = (extra: DxfPair[]) => [P(0, 'INSERT'), P(8, '0'), P(2, 'B'), P(10, 0), P(20, 0), ...extra];
    expect(insertExplodeIssue(ins([]), blk)).toBeNull();
    expect(insertExplodeIssue(ins([P(41, 2), P(42, 1)]), blk)).toBe('비균일 축척');
    expect(insertExplodeIssue(ins([P(70, 3)]), blk)).toBe('배열 삽입(MINSERT)');
    expect(insertExplodeIssue(ins([]), [{ name: 'B', pairs: [P(0, 'BLOCK'), P(0, 'POINT'), P(0, 'ENDBLK')] }])).toContain('POINT');
    expect(insertExplodeIssue(ins([P(41, -1)]), blk)).toBeNull();
    // 대칭 삽입의 호는 정확한 호로 표시 (근사 폴리선 아님)
    const disp = buildDisplay(
      { type: 'INSERT', pairs: ins([P(41, -1)]), children: [] },
      new Map([['B', { name: 'B', base: { x: 0, y: 0 }, ents: [{ type: 'ARC', pairs: [P(0, 'ARC'), P(10, 0), P(20, 0), P(40, 5), P(50, 0), P(51, 90)], children: [] }] }]]),
    )!;
    const a = disp[0] as Extract<Entity, { type: 'arc' }>;
    expect(a.type).toBe('arc');
    expect([Math.round(a.a0), Math.round(a.a1)]).toEqual([90, 180]);
  });
  it('4·6. SCALE 폭 비례, 이동·회전·결합 시 폭 유지', () => {
    const pl: Entity = { id: 1, type: 'polyline', layer: '0', closed: false, width: 0.5, pts: [{ x: 0, y: 0, b: 0, sw: 1, ew: 2 }, { x: 10, y: 0, b: 0 }] };
    const s = scaleEntity(pl, { x: 0, y: 0 }, 2) as Extract<Entity, { type: 'polyline' }>;
    expect([s.width, s.pts[0].sw, s.pts[0].ew]).toEqual([1, 2, 4]);
    expect((moveEntity(pl, { x: 1, y: 1 }) as typeof s).pts[0].sw).toBe(1);
    expect((rotateEntity(pl, { x: 0, y: 0 }, 90) as typeof s).pts[0].ew).toBe(2);
    const pl2: Entity = { ...pl, id: 2, pts: [{ x: 10, y: 0, b: 0 }, { x: 20, y: 0, b: 0 }] };
    expect((joinEntities([pl, pl2]).created[0] as typeof s).width).toBe(0.5);
  });
  it('5. 두 번 클릭 두 번째 클릭이 그립이어도 문자 편집', () => {
    const eng = new Engine();
    eng.view.w = 800;
    eng.view.h = 600;
    eng.view.scale = 2.64;
    eng.view.cx = 0;
    eng.view.cy = 0;
    const t = eng.doc.tx('t');
    const id = t.add({ type: 'text', layer: '0', p: { x: 1, y: 1 }, h: 2.5, text: 'A', rot: 0 });
    t.commit();
    const s = eng.view.toScreen({ x: 1, y: 1 });
    eng.pointerDown(s, 0, false); // 첫 클릭: 선택
    eng.pointerDown(s, 0, false); // 두 번째 클릭: 그립
    expect(eng.cmd?.name).toBe('그립 편집');
    eng.doubleClick(s);
    expect(eng.cmd?.name).toBe('문자 편집');
    eng.submit('B');
    expect((eng.doc.get(id) as Extract<Entity, { type: 'text' }>).text).toBe('B');
  });
  it('7. STRETCH: 한쪽 끝만 창 안인 호는 이웃과 이어지도록 다시 계산', () => {
    const arc: Entity = { id: 1, type: 'arc', layer: '0', c: { x: 10, y: 0 }, r: 5, a0: 270, a1: 90 }; // (10,-5)→(10,5) 오른쪽 반원
    const r = { minX: 9, minY: 4, maxX: 20, maxY: 6 }; // 끝점 (10,5)만 포함
    const n = stretchEntity(arc, r, { x: 0, y: 2 }) as Extract<Entity, { type: 'arc' }>;
    const end = { x: n.c.x + n.r * Math.cos((n.a1 * Math.PI) / 180), y: n.c.y + n.r * Math.sin((n.a1 * Math.PI) / 180) };
    const start = { x: n.c.x + n.r * Math.cos((n.a0 * Math.PI) / 180), y: n.c.y + n.r * Math.sin((n.a0 * Math.PI) / 180) };
    expect(end.x).toBeCloseTo(10, 9);
    expect(end.y).toBeCloseTo(7, 9);
    expect(start.y).toBeCloseTo(-5, 9);
    expect(stretchEntity(arc, { minX: 9, minY: -1, maxX: 11, maxY: 1 }, { x: 1, y: 0 })).toBeNull(); // 중심만 포함 → 그대로
  });
});
