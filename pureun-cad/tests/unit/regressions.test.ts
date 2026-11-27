// 독립 코드 검토(V0)에서 지적된 문제의 재발 방지 시험
import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/commands/engine';
import { Drawing } from '../../src/core/document';
import { entityLength, entitySegs } from '../../src/core/entity';
import { offsetEntity, offsetSide } from '../../src/core/offset';
import { trimEntity } from '../../src/core/trim';
import type { Entity } from '../../src/core/types';
import { readDxfText } from '../../src/dxf/reader';
import { writeDxf } from '../../src/dxf/writer';

const L = (x1: number, y1: number, x2: number, y2: number): Entity => ({ id: 99, type: 'line', layer: '0', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } });
const sq = (dupClose = false): Entity => ({
  id: 1,
  type: 'polyline',
  layer: '0',
  closed: true,
  pts: [
    { x: 0, y: 0, b: 0 },
    { x: 10, y: 0, b: 0 },
    { x: 10, y: 10, b: 0 },
    { x: 0, y: 10, b: 0 },
    ...(dupClose ? [{ x: 0, y: 0, b: 0 }] : []),
  ],
});

const dxf = (body: string, tables = '') =>
  `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n${tables}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${body}0\nENDSEC\n0\nEOF\n`;

describe('검토 1·10: 닫힌 폴리선 시작 정점·중복 정점', () => {
  it('시작 정점만 닿는 경계 → 삭제하지 않고 오류', () => {
    const r = trimEntity(sq(), { x: 5, y: 10 }, entitySegs(L(0, 0, -5, -5)));
    expect(r.ok).toBe(false);
  });
  it('마지막 정점=첫 정점(중복), 경계 없음 → 오류(원본 유지)', () => {
    expect(trimEntity(sq(true), { x: 5, y: 0 }, []).ok).toBe(false);
  });
  it('중복 정점 + 실제 교차 2개 → 올바른 조각', () => {
    const r = trimEntity(sq(true), { x: 5, y: 0 }, [...entitySegs(L(3, -5, 3, 5)), ...entitySegs(L(7, -5, 7, 5))]);
    expect(r.ok).toBe(true);
    expect(entityLength(r.pieces[0] as Entity)).toBeCloseTo(36, 9);
  });
  it('중복 정점 사각형 OFFSET 가능', () => {
    const e = sq(true);
    const r = offsetEntity(e, 1, offsetSide(e, { x: 5, y: -1 }));
    expect(r.ok).toBe(true);
    expect(entityLength(r.entity as Entity)).toBeCloseTo(48, 9);
  });
});

describe('검토 5: 자기교차 간격띄우기는 오류', () => {
  it('홈이 있는 다각형 안쪽 1.2 → 오류, 0.4 → 정상', () => {
    const notch: Entity = {
      id: 1,
      type: 'polyline',
      layer: '0',
      closed: true,
      pts: [
        [0, 0],
        [10, 0],
        [10, 5],
        [6, 5],
        [6, 1],
        [4, 1],
        [4, 5],
        [0, 5],
      ].map(([x, y]) => ({ x, y, b: 0 })),
    };
    const inside = offsetSide(notch, { x: 2, y: 2 });
    expect(offsetEntity(notch, 1.2, inside).ok).toBe(false);
    expect(offsetEntity(notch, 0.4, inside).ok).toBe(true);
  });
});

describe('검토 2·4·8·9: DXF 쓰기', () => {
  it('보존 객체의 한글 값도 \\U+ 로 저장 (전체 ASCII)', () => {
    const src = dxf(`0\nINSERT\n8\n도면층\n2\nBLK\n10\n0\n20\n0\n0\nMTEXT\n8\n도면층\n1\n한글값\n10\n0\n20\n0\n40\n2\n`);
    const d = new Drawing();
    d.load(readDxfText(src));
    const { text } = writeDxf(d);
    expect([...text].every((c) => c.charCodeAt(0) < 128)).toBe(true);
    expect(text).toContain('\\U+B3C4');
  });
  it('레이어 대소문자 불일치: 잠금 유지, LAYER 항목 1개', () => {
    const tables = `0\nTABLE\n2\nLAYER\n0\nLAYER\n2\nWALL\n70\n4\n62\n1\n0\nENDTAB\n`;
    const d = new Drawing();
    d.load(readDxfText(dxf(`0\nLINE\n8\nwall\n10\n0\n20\n0\n11\n1\n21\n1\n`, tables)));
    const e = [...d.entities.values()][0];
    expect(d.isEditable(e)).toBe(false);
    const { text } = writeDxf(d);
    expect((text.match(/\n\s*0\r\nLAYER\r\n/g) ?? []).length).toBe(2); // 0 + WALL
  });
  it('문자 스타일 보존·STYLE 항목 기록', () => {
    const tables = `0\nTABLE\n2\nSTYLE\n0\nSTYLE\n2\nHGTXT\n70\n0\n40\n0\n41\n0.8\n3\nwhgtxt.shx\n0\nENDTAB\n`;
    const d = new Drawing();
    d.load(readDxfText(dxf(`0\nTEXT\n8\n0\n10\n0\n20\n0\n40\n3\n1\nA\n7\nHGTXT\n41\n0.8\n`, tables)));
    const t = [...d.entities.values()][0] as Extract<Entity, { type: 'text' }>;
    expect([t.style, t.wf]).toEqual(['HGTXT', 0.8]);
    const back = readDxfText(writeDxf(d).text);
    expect((back.entities[0] as Extract<Entity, { type: 'text' }>).style).toBe('HGTXT');
    expect(back.tables.STYLE.some((s) => s.some((p) => p.code === 2 && p.value === 'HGTXT'))).toBe(true);
  });
  it('도면공간 LWPOLYLINE은 67=1로 유지, 폭 보존', () => {
    const d = new Drawing();
    d.load(readDxfText(dxf(`0\nLWPOLYLINE\n8\n0\n67\n1\n90\n2\n70\n0\n10\n0\n20\n0\n10\n5\n20\n0\n0\nLWPOLYLINE\n8\n0\n90\n2\n70\n0\n43\n0.5\n10\n0\n20\n1\n10\n5\n20\n1\n`)));
    const { text, report } = writeDxf(d);
    expect(report.excluded).toEqual({});
    expect(text).toMatch(/POLYLINE\r\n\s+8\r\n0\r\n\s+67\r\n1/);
    const back = readDxfText(text);
    const pl = back.entities.find((e) => e.type === 'polyline') as Extract<Entity, { type: 'polyline' }>;
    expect(pl.width).toBe(0.5);
  });
});

describe('검토 3·6·7: 실행취소 묶음', () => {
  const run = (eng: Engine, ...inputs: string[]) => {
    for (const s of inputs) {
      if (!eng.cmd && s && s !== '') eng.run(s);
      else eng.submit(s);
    }
  };
  it('실행취소 기록 200개 초과 후에도 PLINE 중복 생성 없음 · LINE U 동작', () => {
    const eng = new Engine();
    for (let i = 0; i < 205; i++) {
      eng.run('C');
      eng.submit(`${i},0`);
      eng.submit('1');
    }
    const n0 = eng.doc.entities.size;
    eng.run('PL');
    for (const s of ['0,100', '50,100', '50,150', '']) eng.submit(s);
    expect(eng.doc.entities.size).toBe(n0 + 1);
    eng.run('L');
    for (const s of ['0,0', '10,0', '10,10', 'U', '']) eng.submit(s);
    expect(eng.doc.entities.size).toBe(n0 + 2);
    void run;
  });
  it('LINE 중 레이어 변경 후 U → 선분만 취소, 레이어 변경 유지', () => {
    const eng = new Engine();
    const tx0 = eng.doc.tx('t');
    tx0.setLayers([...eng.doc.layers.values(), { name: 'A', color: 1, on: true, locked: false }], '0');
    tx0.commit();
    eng.run('L');
    eng.submit('0,0');
    eng.submit('10,0');
    eng.submit('10,10');
    const tx = eng.doc.tx('현재 레이어');
    tx.setLayers([...eng.doc.layers.values()], 'A');
    tx.commit();
    eng.submit('U');
    eng.submit('');
    expect(eng.doc.entities.size).toBe(1);
    expect(eng.doc.currentLayer).toBe('A');
    // 명령 종료 후 다시실행해도 취소한 선분이 되살아나지 않음
    eng.redo();
    expect(eng.doc.entities.size).toBe(1);
  });
});

describe('검토 11: 꺼진 레이어 객체 수정 차단', () => {
  it('tx.update/remove 거부', () => {
    const d = new Drawing();
    const t = d.tx('t');
    t.setLayers([{ name: '0', color: 7, on: true, locked: false }, { name: 'H', color: 7, on: false, locked: false }], '0');
    const id = t.add({ type: 'line', layer: 'H', p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 } });
    t.commit();
    const t2 = d.tx('x');
    expect(t2.remove(id)).toBe(false);
    expect(t2.update({ ...(d.get(id) as Entity) })).toBe(false);
  });
});
