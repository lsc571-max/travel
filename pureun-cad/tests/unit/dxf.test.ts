import { describe, expect, it } from 'vitest';
import { Drawing } from '../../src/core/document';
import { readDxfText, readDxf } from '../../src/dxf/reader';
import { writeDxf } from '../../src/dxf/writer';
import type { DimensionEnt, Entity } from '../../src/core/types';
import { dimGeometry } from '../../src/core/dimension';

function sample(): Drawing {
  const d = new Drawing();
  const tx = d.tx('t');
  tx.setLayers(
    [
      { name: '0', color: 7, on: true, locked: false },
      { name: '외형선', color: 1, on: true, locked: true },
      { name: 'HIDE', color: 3, on: false, locked: false, ltype: 'HIDDEN' },
    ],
    '0',
  );
  tx.add({ type: 'line', layer: '0', p1: { x: 0.1 + 0.2, y: 1 / 3 }, p2: { x: 100, y: -2.5e-8 } });
  tx.add({ type: 'circle', layer: '외형선', c: { x: 12.345678901234567, y: 5 }, r: 4.25, color: 2 });
  tx.add({ type: 'arc', layer: '0', c: { x: 0, y: 0 }, r: 10, a0: 330, a1: 30 });
  tx.add({ type: 'polyline', layer: 'HIDE', closed: true, pts: [ { x: 0, y: 0, b: 0 }, { x: 20, y: 0, b: 1 }, { x: 20, y: 10, b: 0 }, { x: 0, y: 10, b: -0.4142135623730951 } ] });
  tx.add({ type: 'text', layer: '0', p: { x: 1, y: 2 }, h: 3.5, text: '구멍 4-%%c10 가공', rot: 15 });
  tx.add({ type: 'dimension', kind: 'linear', layer: '0', p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, loc: { x: 50, y: -15 }, rot: 0, h: 2.5, arrow: 2.5 });
  tx.add({ type: 'dimension', kind: 'diameter', layer: '0', p1: { x: 12.345678901234567, y: 5 }, p2: { x: 16.595678901234567, y: 5 }, loc: { x: 30, y: 20 }, h: 2.5, arrow: 2.5 });
  tx.add({ type: 'dimension', kind: 'radius', layer: '0', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, loc: { x: 5, y: 1 }, h: 2.5, arrow: 2.5 });
  tx.add({ type: 'dimension', kind: 'aligned', layer: '0', p1: { x: 0, y: 0 }, p2: { x: 30, y: 40 }, loc: { x: 0, y: 50 }, h: 2.5, arrow: 2.5, textOverride: '<> 참고' });
  tx.commit();
  return d;
}

const strip = (e: Entity) => {
  const { id: _id, ...rest } = e;
  void _id;
  return rest;
};

describe('DXF 왕복 (R12)', () => {
  it('모든 지원 객체가 정확히(64비트 그대로) 왕복됨', () => {
    const d = sample();
    const { text } = writeDxf(d);
    expect(text).toContain('AC1009');
    const r = readDxfText(text);
    const orig = [...d.entities.values()].map(strip);
    const noDim = (a: unknown[]) => (a as Entity[]).filter((e) => e.type !== 'dimension');
    expect(noDim(r.entities)).toEqual(noDim(orig));
    // 치수: 정의점은 정확히, 치수선 위치는 같은 선 위(형상 동일)
    const dimsA = orig.filter((e) => e.type === 'dimension') as DimensionEnt[];
    const dimsB = r.entities.filter((e) => e.type === 'dimension') as DimensionEnt[];
    expect(dimsB.length).toBe(dimsA.length);
    dimsA.forEach((a, k) => {
      const b = dimsB[k];
      expect([b.kind, b.p1, b.p2, b.rot, b.textOverride]).toEqual([a.kind, a.p1, a.p2, a.rot, a.textOverride]);
      const ga = dimGeometry(a, String), gb = dimGeometry(b, String);
      ga.lines.forEach((l, i) => {
        expect(gb.lines[i].a.x).toBeCloseTo(l.a.x, 9);
        expect(gb.lines[i].b.y).toBeCloseTo(l.b.y, 9);
      });
    });
    const lay = Object.fromEntries(r.layers.map((l) => [l.name, l]));
    expect(lay['외형선'].locked).toBe(true);
    expect(lay['HIDE'].on).toBe(false);
    expect(lay['HIDE'].ltype).toBe('HIDDEN');
    expect(Object.keys(r.unsupported).length).toBe(0);
  });

  it('비ASCII 문자는 \\U+ 로 저장되고 다시 한글로 복원', () => {
    const { text } = writeDxf(sample());
    expect([...text].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
    expect(text).toContain('\\U+AD6C');
  });

  it('치수는 *D 블록과 함께 저장 / 분해 옵션', () => {
    const { text } = writeDxf(sample());
    expect(text).toMatch(/BLOCK\r\n\s+8\r\n0\r\n\s+2\r\n\*D1/);
    const ex = writeDxf(sample(), { explodeDims: true }).text;
    expect(ex).not.toContain('DIMENSION\r\n  8');
    const r = readDxfText(ex);
    expect(r.entities.some((e) => e.type === 'dimension')).toBe(false);
  });
});

const R2000 = `  0
SECTION
  2
HEADER
  9
$ACADVER
  1
AC1015
  9
$DWGCODEPAGE
  3
ANSI_949
  0
ENDSEC
  0
SECTION
  2
BLOCKS
  0
BLOCK
  5
20
330
1F
100
AcDbEntity
  8
0
100
AcDbBlockBegin
  2
BOLT
 70
0
 10
0.0
 20
0.0
 30
0.0
  3
BOLT
  0
CIRCLE
  8
0
 10
0.0
 20
0.0
 40
3.0
  0
ENDBLK
  5
21
100
AcDbEntity
  8
0
100
AcDbBlockEnd
  0
ENDSEC
  0
SECTION
  2
ENTITIES
  0
LWPOLYLINE
  5
30
100
AcDbEntity
  8
PART
100
AcDbPolyline
 90
3
 70
1
 10
0.0
 20
0.0
 10
10.0
 20
0.0
 42
0.5
 10
10.0
 20
10.0
  0
SPLINE
  8
CURVE
 71
3
 72
8
 73
4
 40
0.0
 40
0.0
 40
0.0
 40
0.0
 40
1.0
 40
1.0
 40
1.0
 40
1.0
 10
0.0
 20
0.0
 10
10.0
 20
20.0
 10
20.0
 20
-20.0
 10
30.0
 20
0.0
  0
INSERT
  8
PART
  2
BOLT
 10
50.0
 20
50.0
 41
2.0
 42
2.0
  0
ARC
  8
0
 10
5.0
 20
0.0
 40
5.0
 50
0.0
 51
90.0
210
0.0
220
0.0
230
-1.0
  0
ENDSEC
  0
EOF
`;

describe('DXF 읽기 (R2000, 미지원 객체 보존)', () => {
  it('LWPOLYLINE bulge, 반전 OCS 호, SPLINE/INSERT 보존 + 표시', () => {
    const r = readDxfText(R2000);
    const pl = r.entities.find((e) => e.type === 'polyline') as Extract<Entity, { type: 'polyline' }>;
    expect(pl.closed).toBe(true);
    expect(pl.pts[1].b).toBe(0.5);
    const arc = r.entities.find((e) => e.type === 'arc') as Extract<Entity, { type: 'arc' }>;
    expect(arc.c.x).toBe(-5);
    expect(arc.a0).toBe(90);
    expect(arc.a1).toBe(180);
    expect(r.unsupported['SPLINE']).toBe(1);
    expect(r.unsupported['INSERT']).toBe(1);
    const ins = r.preserved.find((p) => p.dxfType === 'INSERT')!;
    const c = ins.display![0] as Extract<Entity, { type: 'circle' }>;
    expect(c.type).toBe('circle');
    expect(c.r).toBe(6);
    expect(c.c).toEqual({ x: 50, y: 50 });
    expect(r.preserved.find((p) => p.dxfType === 'SPLINE')!.display!.length).toBe(1);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('R12로 저장 시 INSERT·블록은 유지, SPLINE은 옵션에 따라 제외/근사', () => {
    const r = readDxfText(R2000);
    const d = new Drawing();
    d.load({ ...r });
    const a = writeDxf(d);
    expect(a.report.excluded['SPLINE']).toBe(1);
    expect(a.text).toContain('BOLT');
    expect(a.text).not.toContain('AcDb');
    const back = readDxfText(a.text);
    expect(back.unsupported['INSERT']).toBe(1);
    const b = writeDxf(d, { approximateUnsupported: true });
    expect(b.report.approximated['SPLINE']).toBe(1);
  });

  it('CP949(ANSI_949) 인코딩 한글 레이어 읽기', () => {
    const src = `  0\nSECTION\n  2\nHEADER\n  9\n$ACADVER\n  1\nAC1015\n  9\n$DWGCODEPAGE\n  3\nANSI_949\n  0\nENDSEC\n  0\nSECTION\n  2\nENTITIES\n  0\nLINE\n  8\nLAYERNAME\n 10\n0\n 20\n0\n 11\n1\n 21\n1\n  0\nENDSEC\n  0\nEOF\n`;
    // "외형" 의 CP949 바이트: BF DC C7 FC
    const head = new TextEncoder().encode(src.split('LAYERNAME')[0]);
    const tail = new TextEncoder().encode(src.split('LAYERNAME')[1]);
    const bytes = new Uint8Array([...head, 0xbf, 0xdc, 0xc7, 0xfc, ...tail]);
    const r = readDxf(bytes);
    expect(r.entities[0].layer).toBe('외형');
    expect(r.encoding).toBe('euc-kr');
  });
});
