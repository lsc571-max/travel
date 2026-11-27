// DXF 쓰기: AutoCAD R12(AC1009) ASCII 형식
// - R12는 CAM·CNC 프로그램과의 호환성이 가장 넓은 형식이다.
// - 원·호는 원래 기하 그대로(CIRCLE/ARC), 폴리선 호는 bulge(42)로 저장하여 선분으로 쪼개지 않는다.
// - 치수(DIMENSION)는 AutoCAD 요구사항에 맞춰 형상 블록(*D)을 함께 쓴다.
// - 보존된 미지원 객체는 R12에서 유효한 객체면 원본 그룹코드를 그대로(R12에 없는 코드만 제외) 쓴다.
import { dimGeometry, type DimGeom } from '../core/dimension';
import { add, DEG, dot, mul, perpL, v, norm, sub } from '../core/geom';
import { dxfNum } from '../core/format';
import type { Drawing } from '../core/document';
import { getDimFormatter } from '../core/entity';
import { buildDisplay } from './display';
import { convertEntity, unescapeDxf, type RawEntity } from './reader';
import type { DimensionEnt, DxfPair, Entity, Vec2 } from '../core/types';

export interface DxfWriteOptions {
  /** 치수를 선·문자로 분해하여 저장 (CAM 전달용) */
  explodeDims?: boolean;
  /** R12에 없는 보존 객체(MTEXT, SPLINE, ELLIPSE 등)를 근사 형상으로 변환하여 포함 */
  approximateUnsupported?: boolean;
}

export interface DxfWriteReport {
  entities: number;
  preservedWritten: number;
  approximated: Record<string, number>;
  excluded: Record<string, number>;
}

/** R12에서 유효한 객체 종류 */
const R12_TYPES = new Set(['POINT', 'LINE', 'CIRCLE', 'ARC', 'TRACE', 'SOLID', 'TEXT', 'SHAPE', 'INSERT', 'ATTDEF', 'ATTRIB', 'POLYLINE', 'VERTEX', 'SEQEND', '3DFACE', 'DIMENSION']);

/** R12에 존재하는 그룹코드만 유지 (0~79, 210~239). 102 그룹({...})·핸들·서브클래스·확장데이터 제외 */
export function filterR12Pairs(pairs: DxfPair[]): DxfPair[] {
  const out: DxfPair[] = [];
  let in102 = false;
  for (const p of pairs) {
    if (p.code === 102) {
      in102 = p.value.trim().startsWith('{');
      continue;
    }
    if (in102) continue;
    if ((p.code >= 0 && p.code <= 79) || (p.code >= 210 && p.code <= 239)) {
      if (p.code === 5) continue;
      out.push(p);
    }
  }
  return out;
}

/** 비ASCII 문자는 \U+XXXX로 이스케이프 (R12는 코드페이지 기반이므로) */
export function escapeDxf(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 128) out += ch === '\n' || ch === '\r' ? ' ' : ch;
    else if (c <= 0xffff) out += '\\U+' + c.toString(16).toUpperCase().padStart(4, '0');
    else out += '?';
  }
  return out;
}

class Out {
  lines: string[] = [];
  g(code: number, value: string | number) {
    this.lines.push(String(code).padStart(3, ' '));
    this.lines.push(typeof value === 'number' ? dxfNum(value) : value);
  }
  i(code: number, value: number) {
    this.lines.push(String(code).padStart(3, ' '));
    this.lines.push(String(Math.trunc(value)));
  }
  s(code: number, value: string) {
    this.g(code, escapeDxf(value));
  }
  pt(code: number, p: Vec2) {
    this.g(code, p.x);
    this.g(code + 10, p.y);
    this.g(code + 20, 0);
  }
  raw(pairs: DxfPair[]) {
    for (const p of pairs) {
      this.lines.push(String(p.code).padStart(3, ' '));
      this.lines.push(p.value);
    }
  }
}

function common(o: Out, e: { layer: string; color?: number; ltype?: string }) {
  o.s(8, e.layer);
  if (e.ltype) o.s(6, e.ltype);
  if (e.color !== undefined && e.color !== 256) o.i(62, e.color);
}

function writeEntity(o: Out, e: Entity, dimBlock?: string) {
  switch (e.type) {
    case 'line':
      o.g(0, 'LINE');
      common(o, e);
      o.pt(10, e.p1);
      o.pt(11, e.p2);
      return;
    case 'circle':
      o.g(0, 'CIRCLE');
      common(o, e);
      o.pt(10, e.c);
      o.g(40, e.r);
      return;
    case 'arc':
      o.g(0, 'ARC');
      common(o, e);
      o.pt(10, e.c);
      o.g(40, e.r);
      o.g(50, e.a0);
      o.g(51, e.a1);
      return;
    case 'polyline':
      o.g(0, 'POLYLINE');
      common(o, e);
      o.i(66, 1);
      o.pt(10, v(0, 0));
      o.i(70, e.closed ? 1 : 0);
      for (const p of e.pts) {
        o.g(0, 'VERTEX');
        o.s(8, e.layer);
        o.pt(10, p);
        if (p.b !== 0) o.g(42, p.b);
        o.i(70, 0);
      }
      o.g(0, 'SEQEND');
      o.s(8, e.layer);
      return;
    case 'text':
      o.g(0, 'TEXT');
      common(o, e);
      o.pt(10, e.p);
      o.g(40, e.h);
      o.s(1, e.text);
      if (e.rot) o.g(50, e.rot);
      o.g(7, 'STANDARD');
      if (e.hAlign || e.vAlign) {
        if (e.hAlign) o.i(72, e.hAlign);
        o.pt(11, e.p2 ?? e.p);
        if (e.vAlign) o.i(73, e.vAlign);
      }
      return;
    case 'dimension':
      writeDimension(o, e, dimBlock!);
      return;
  }
}

/** 치수의 형상 요소(선, 화살표 SOLID, 문자) 쓰기 */
function writeDimGeometry(o: Out, g: DimGeom, props: { layer: string; color?: number }) {
  for (const l of g.lines) {
    o.g(0, 'LINE');
    common(o, props);
    o.pt(10, l.a);
    o.pt(11, l.b);
  }
  for (const t of g.arrows) {
    o.g(0, 'SOLID');
    common(o, props);
    o.pt(10, t[0]);
    o.pt(11, t[1]);
    o.pt(12, t[2]);
    o.pt(13, t[2]);
  }
  o.g(0, 'TEXT');
  common(o, props);
  o.pt(10, g.text.p);
  o.g(40, g.text.h);
  o.s(1, g.text.str);
  if (g.text.rot) o.g(50, g.text.rot);
  o.g(7, 'STANDARD');
  o.i(72, 1); // 가운데
  o.pt(11, g.text.p);
}

function dimLinePoint(d: DimensionEnt): Vec2 {
  // 치수선과 두 번째 치수보조선의 만나는 점 (DXF 10)
  let u: Vec2;
  if (d.kind === 'linear') u = v(Math.cos((d.rot ?? 0) * DEG), Math.sin((d.rot ?? 0) * DEG));
  else u = norm(sub(d.p2, d.p1));
  const n = perpL(u);
  return add(d.p2, mul(n, dot(sub(d.loc, d.p2), n)));
}

function writeDimension(o: Out, d: DimensionEnt, block: string) {
  const g = dimGeometry(d, getDimFormatter());
  o.g(0, 'DIMENSION');
  common(o, d);
  o.s(2, block);
  o.g(3, 'STANDARD');
  const type = { linear: 0, aligned: 1, diameter: 3, radius: 4 }[d.kind];
  if (d.kind === 'linear' || d.kind === 'aligned') o.pt(10, dimLinePoint(d));
  else if (d.kind === 'diameter') o.pt(10, sub(mul(d.p1, 2), d.p2));
  else o.pt(10, d.p1);
  o.pt(11, g.textMid);
  o.i(70, type);
  o.s(1, d.textOverride ?? '');
  if (d.kind === 'linear' || d.kind === 'aligned') {
    o.pt(13, d.p1);
    o.pt(14, d.p2);
    if (d.kind === 'linear') o.g(50, d.rot ?? 0);
  } else {
    o.pt(15, d.p2);
    o.g(40, 0);
  }
}

/** 원시 그룹코드 → 객체 단위 분리 (POLYLINE/INSERT 하위 객체 포함) */
function splitRaw(pairs: DxfPair[]): RawEntity[] {
  const list: RawEntity[] = [];
  let parent: RawEntity | null = null;
  let cur: RawEntity | null = null;
  for (const p of pairs) {
    if (p.code === 0) {
      const t = p.value.trim().toUpperCase();
      const e: RawEntity = { type: t, pairs: [p], children: [] };
      if (parent && (t === 'VERTEX' || t === 'ATTRIB' || t === 'SEQEND')) {
        parent.children.push(e);
        if (t === 'SEQEND') parent = null;
      } else {
        list.push(e);
        parent = t === 'POLYLINE' ? e : null;
      }
      cur = e;
      continue;
    }
    if (cur) {
      cur.pairs.push(p);
      if (cur.type === 'INSERT' && p.code === 66 && p.value.trim() === '1') parent = cur;
    }
  }
  return list;
}
const flatRaw = (e: RawEntity): DxfPair[] => [...e.pairs, ...e.children.flatMap(flatRaw)];

export function writeDxf(doc: Drawing, opts: DxfWriteOptions = {}): { text: string; report: DxfWriteReport } {
  const report: DxfWriteReport = { entities: 0, preservedWritten: 0, approximated: {}, excluded: {} };
  const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);
  const ents = [...doc.entities.values()];

  // 블록 이름 충돌 방지용 *D 번호
  const usedNames = new Set(doc.preservedBlocks.map((b) => b.name.toUpperCase()));
  let dimNo = 1;
  const nextDimBlock = () => {
    while (usedNames.has(`*D${dimNo}`)) dimNo++;
    const n = `*D${dimNo++}`;
    usedNames.add(n);
    return n;
  };

  // ── ENTITIES와 BLOCKS 본문을 먼저 만든 뒤, 사용된 레이어·선종류를 수집해 TABLES를 쓴다
  const blocksOut = new Out();
  const entsOut = new Out();
  const fmt = getDimFormatter();

  /** 보존 객체 하나를 R12로 쓰기 (필요 시 근사 변환) */
  const writeRaw = (o: Out, re: RawEntity, inBlock: boolean) => {
    if (R12_TYPES.has(re.type)) {
      o.raw(filterR12Pairs(flatRaw(re)));
      return true;
    }
    if (re.type === 'LWPOLYLINE') {
      // 정확한 변환 (POLYLINE + bulge)
      const r = convertEntity(re, new Map());
      if (r.entity) {
        writeEntity(o, { ...r.entity, id: 0 } as Entity);
        return true;
      }
    }
    if (opts.approximateUnsupported) {
      const disp = buildDisplay(re, new Map());
      if (disp?.length) {
        for (const d of disp) writeEntity(o, d);
        bump(report.approximated, re.type + (inBlock ? '(블록 내부)' : ''));
        return true;
      }
    }
    bump(report.excluded, re.type + (inBlock ? '(블록 내부)' : ''));
    return false;
  };

  for (const b of doc.preservedBlocks) {
    const parts = splitRaw(b.pairs);
    for (const re of parts) {
      if (re.type === 'BLOCK' || re.type === 'ENDBLK') {
        const f = filterR12Pairs(re.pairs);
        if (re.type === 'ENDBLK' && !f.some((p) => p.code === 8)) f.push({ code: 8, value: '0' });
        blocksOut.raw(f);
      } else writeRaw(blocksOut, re, true);
    }
  }

  for (const e of ents) {
    if (e.type === 'dimension') {
      const g = dimGeometry(e, fmt);
      if (opts.explodeDims) {
        writeDimGeometry(entsOut, g, { layer: e.layer, color: e.color });
      } else {
        const name = nextDimBlock();
        blocksOut.g(0, 'BLOCK');
        blocksOut.g(8, '0');
        blocksOut.s(2, name);
        blocksOut.i(70, 1);
        blocksOut.pt(10, v(0, 0));
        blocksOut.s(3, name);
        writeDimGeometry(blocksOut, g, { layer: '0', color: 0 });
        blocksOut.g(0, 'ENDBLK');
        blocksOut.g(8, '0');
        writeEntity(entsOut, e, name);
      }
    } else writeEntity(entsOut, e);
    report.entities++;
  }
  for (const p of doc.preserved) {
    const parts = splitRaw(p.pairs);
    let ok = true;
    for (const re of parts) ok = writeRaw(entsOut, re, false) && ok;
    if (ok) report.preservedWritten++;
  }

  // ── 사용된 레이어·선종류 수집
  const layerNames = new Map<string, true>();
  const ltNames = new Map<string, true>();
  for (const l of doc.layers.values()) layerNames.set(l.name, true);
  const scan = (lines: string[]) => {
    for (let k = 0; k + 1 < lines.length; k += 2) {
      const c = lines[k].trim();
      if (c === '8') layerNames.set(unescapeDxf(lines[k + 1]), true);
      else if (c === '6') ltNames.set(unescapeDxf(lines[k + 1]).toUpperCase(), true);
    }
  };
  scan(blocksOut.lines);
  scan(entsOut.lines);
  for (const l of doc.layers.values()) if (l.ltype) ltNames.set(l.ltype.toUpperCase(), true);
  ltNames.delete('BYLAYER');
  ltNames.delete('BYBLOCK');
  ltNames.set('CONTINUOUS', true);

  // ── 출력
  const o = new Out();
  const ext = doc.extents() ?? { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  o.g(0, 'SECTION');
  o.g(2, 'HEADER');
  o.g(9, '$ACADVER');
  o.g(1, 'AC1009');
  o.g(9, '$DWGCODEPAGE');
  o.g(3, 'ANSI_1252');
  o.g(9, '$INSBASE');
  o.pt(10, v(0, 0));
  o.g(9, '$EXTMIN');
  o.pt(10, v(ext.minX, ext.minY));
  o.g(9, '$EXTMAX');
  o.pt(10, v(ext.maxX, ext.maxY));
  o.g(9, '$LTSCALE');
  o.g(40, doc.ltscale);
  o.g(0, 'ENDSEC');

  o.g(0, 'SECTION');
  o.g(2, 'TABLES');
  // LTYPE
  o.g(0, 'TABLE');
  o.g(2, 'LTYPE');
  o.i(70, ltNames.size);
  for (const name of ltNames.keys()) {
    const def = doc.ltypes.get(name) ?? { name, desc: '', pattern: [] };
    o.g(0, 'LTYPE');
    o.s(2, def.name.toUpperCase() === 'CONTINUOUS' ? 'CONTINUOUS' : def.name);
    o.i(70, 0);
    o.s(3, def.desc);
    o.i(72, 65);
    o.i(73, def.pattern.length);
    o.g(40, def.pattern.reduce((a, b) => a + Math.abs(b), 0));
    for (const d of def.pattern) o.g(49, d);
  }
  o.g(0, 'ENDTAB');
  // LAYER
  o.g(0, 'TABLE');
  o.g(2, 'LAYER');
  o.i(70, layerNames.size);
  for (const name of layerNames.keys()) {
    const l = doc.layers.get(name) ?? { name, color: 7, on: true, locked: false };
    o.g(0, 'LAYER');
    o.s(2, l.name);
    o.i(70, (l.frozen ? 1 : 0) | (l.locked ? 4 : 0));
    o.i(62, l.on ? Math.abs(l.color) || 7 : -(Math.abs(l.color) || 7));
    o.s(6, l.ltype && doc.ltypes.has(l.ltype.toUpperCase()) ? l.ltype : 'CONTINUOUS');
  }
  o.g(0, 'ENDTAB');
  // STYLE
  o.g(0, 'TABLE');
  o.g(2, 'STYLE');
  o.i(70, 1);
  o.g(0, 'STYLE');
  o.g(2, 'STANDARD');
  o.i(70, 0);
  o.g(40, 0);
  o.g(41, 1);
  o.g(50, 0);
  o.i(71, 0);
  o.g(42, 2.5);
  o.g(3, 'txt');
  o.g(4, '');
  o.g(0, 'ENDTAB');
  // DIMSTYLE
  o.g(0, 'TABLE');
  o.g(2, 'DIMSTYLE');
  o.i(70, 1);
  o.g(0, 'DIMSTYLE');
  o.g(2, 'STANDARD');
  o.i(70, 0);
  o.g(0, 'ENDTAB');
  o.g(0, 'ENDSEC');

  o.g(0, 'SECTION');
  o.g(2, 'BLOCKS');
  for (const l of blocksOut.lines) o.lines.push(l);
  o.g(0, 'ENDSEC');

  o.g(0, 'SECTION');
  o.g(2, 'ENTITIES');
  for (const l of entsOut.lines) o.lines.push(l);
  o.g(0, 'ENDSEC');
  o.g(0, 'EOF');
  return { text: o.lines.join('\r\n') + '\r\n', report };
}
