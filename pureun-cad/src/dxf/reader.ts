// DXF 읽기 (ASCII DXF, R12 ~ 최신). DWG/이진 DXF는 미지원.
// 지원 객체: LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE(2D), TEXT, DIMENSION(선형/정렬/지름/반지름)
// 미지원 객체는 원본 그룹코드를 그대로 보존하고(표시 가능한 것은 화면 표시용 형상 생성) 사용자에게 알린다.
import { buildDisplay, type BlockDef } from './display';
import type { DxfPair, Layer, Linetype, NewEntity, PreservedBlock, PreservedEntity, PVertex, Vec2 } from '../core/types';

export interface DxfReadResult {
  entities: NewEntity[];
  layers: Layer[];
  ltypes: Linetype[];
  preserved: Omit<PreservedEntity, 'id'>[];
  preservedBlocks: PreservedBlock[];
  header: Record<string, string>;
  /** 사용자 알림용 */
  warnings: string[];
  /** 미지원 객체 종류별 개수 */
  unsupported: Record<string, number>;
  version: string;
  encoding: string;
}

const CODEPAGES: Record<string, string> = {
  ANSI_949: 'euc-kr',
  ANSI_1361: 'euc-kr',
  ANSI_932: 'shift_jis',
  ANSI_936: 'gbk',
  ANSI_950: 'big5',
  ANSI_1250: 'windows-1250',
  ANSI_1251: 'windows-1251',
  ANSI_1252: 'windows-1252',
  ANSI_1253: 'windows-1253',
  ANSI_1254: 'windows-1254',
  ANSI_1255: 'windows-1255',
  ANSI_1256: 'windows-1256',
  ANSI_1257: 'windows-1257',
  ANSI_874: 'windows-874',
};

/** 바이트 → 문자열 (버전·코드페이지에 따라 인코딩 결정) */
export function decodeDxf(bytes: Uint8Array): { text: string; encoding: string } {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 200000)));
  if (head.startsWith('AutoCAD Binary DXF')) throw new Error('이진(Binary) DXF는 지원하지 않습니다. ASCII DXF로 저장해 주십시오.');
  const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/.exec(head)?.[1];
  const cp = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*([A-Za-z0-9_]+)/.exec(head)?.[1]?.toUpperCase();
  const tryDecode = (enc: string, fatal = false) => new TextDecoder(enc, { fatal }).decode(bytes);
  // R2007(AC1021) 이상은 UTF-8
  if (ver && ver >= 'AC1021') return { text: tryDecode('utf-8'), encoding: 'utf-8' };
  try {
    // 순수 ASCII 또는 UTF-8로 저장된 파일 우선 확인
    const t = tryDecode('utf-8', true);
    if (![...t].some((ch) => ch.charCodeAt(0) > 127) || !cp) return { text: t, encoding: 'utf-8' };
  } catch {
    /* UTF-8 아님 */
  }
  const enc = (cp && CODEPAGES[cp]) || 'euc-kr';
  if (enc === 'windows-1252') {
    // 머리글은 서유럽(1252)인데 실제로는 한국어(CP949)로 저장된 파일 보정
    try {
      const k = tryDecode('euc-kr', true);
      if (/[\uAC00-\uD7A3]/.test(k)) return { text: k, encoding: 'euc-kr (코드페이지 표시 ANSI_1252와 다름)' };
    } catch {
      /* CP949 아님 */
    }
  }
  try {
    return { text: tryDecode(enc), encoding: enc };
  } catch {
    return { text: tryDecode('windows-1252'), encoding: 'windows-1252' };
  }
}

/** \U+XXXX 유니코드 이스케이프 해석 */
export const unescapeDxf = (s: string) => s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

export function tokenize(text: string): DxfPair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: DxfPair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const cs = lines[i].trim();
    if (cs === '') {
      // 파일 끝 빈 줄 허용
      if (lines.slice(i).every((l) => l.trim() === '')) break;
    }
    const code = parseInt(cs, 10);
    if (!Number.isFinite(code)) throw new Error(`DXF 형식 오류: ${i + 1}번째 줄의 그룹코드가 숫자가 아닙니다 ("${cs.slice(0, 20)}")`);
    let value = lines[i + 1];
    // 문자열 코드는 앞 공백 보존, 그 외는 양쪽 공백 제거
    value = (code >= 1 && code <= 9) || code === 1000 ? value.replace(/\s+$/, '') : value.trim();
    pairs.push({ code, value });
  }
  return pairs;
}

const num = (s: string | undefined, d = 0) => {
  if (s === undefined) return d;
  const n = Number(s);
  return Number.isFinite(n) ? n : d;
};

export interface RawEntity {
  type: string;
  pairs: DxfPair[];
  /** POLYLINE의 VERTEX, INSERT의 ATTRIB 등 하위 객체 */
  children: RawEntity[];
}

/** 객체 열 분리 (POLYLINE/INSERT의 하위 객체 묶기) */
function groupEntities(pairs: DxfPair[], start: number, endMarker: (p: DxfPair) => boolean): { list: RawEntity[]; next: number } {
  const list: RawEntity[] = [];
  let i = start;
  let cur: RawEntity | null = null;
  let parent: RawEntity | null = null;
  while (i < pairs.length) {
    const p = pairs[i];
    if (p.code === 0) {
      if (endMarker(p)) break;
      const ent: RawEntity = { type: p.value.trim().toUpperCase(), pairs: [p], children: [] };
      if (parent && (ent.type === 'VERTEX' || ent.type === 'ATTRIB' || ent.type === 'SEQEND')) {
        parent.children.push(ent);
        if (ent.type === 'SEQEND') parent = null;
      } else {
        list.push(ent);
        parent = null;
        if (ent.type === 'POLYLINE') parent = ent;
      }
      cur = ent;
      i++;
      continue;
    }
    if (cur) {
      cur.pairs.push(p);
      // INSERT 66=1 이면 ATTRIB가 뒤따름
      if (cur.type === 'INSERT' && p.code === 66 && p.value.trim() === '1') parent = cur;
    }
    i++;
  }
  return { list, next: i };
}

const get = (e: RawEntity, code: number) => e.pairs.find((p) => p.code === code)?.value;
const allRaw = (e: RawEntity): DxfPair[] => [...e.pairs, ...e.children.flatMap(allRaw)];

export function readDxf(bytes: Uint8Array): DxfReadResult {
  const { text, encoding } = decodeDxf(bytes);
  return readDxfText(text, encoding);
}

export function readDxfText(text: string, encoding = 'utf-8'): DxfReadResult {
  const pairs = tokenize(text);
  const res: DxfReadResult = {
    entities: [],
    layers: [],
    ltypes: [],
    preserved: [],
    preservedBlocks: [],
    header: {},
    warnings: [],
    unsupported: {},
    version: 'AC1009',
    encoding,
  };
  const dimStyles = new Map<string, { txt: number; asz: number; scale: number }>();
  const blocks = new Map<string, BlockDef>();
  const rawBlocks: { name: string; pairs: DxfPair[] }[] = [];
  let entityRaw: RawEntity[] = [];
  const skippedSections = new Set<string>();

  let i = 0;
  while (i < pairs.length) {
    const p = pairs[i];
    if (p.code === 0 && p.value === 'SECTION') {
      const name = pairs[i + 1]?.value.toUpperCase();
      i += 2;
      const endIdx = (() => {
        let k = i;
        while (k < pairs.length && !(pairs[k].code === 0 && pairs[k].value === 'ENDSEC')) k++;
        return k;
      })();
      const body = pairs.slice(i, endIdx);
      if (name === 'HEADER') readHeader(body, res.header);
      else if (name === 'TABLES') readTables(body, res, dimStyles);
      else if (name === 'BLOCKS') readBlocks(body, blocks, rawBlocks);
      else if (name === 'ENTITIES') entityRaw = groupEntities(body, 0, () => false).list;
      else if (name) skippedSections.add(name);
      i = endIdx + 1;
      continue;
    }
    if (p.code === 0 && p.value === 'EOF') break;
    i++;
  }
  res.version = res.header['$ACADVER'] ?? 'AC1009';
  const ltscale = num(res.header['$LTSCALE'], 1);
  res.header['$LTSCALE'] = String(ltscale);

  let zWarn = 0;
  const nativeDimBlocks = new Set<string>();
  for (const re of entityRaw) {
    const r = convertEntity(re, dimStyles);
    if (r.z) zWarn++;
    if (r.entity) {
      res.entities.push(r.entity);
      if (r.dimBlock) nativeDimBlocks.add(r.dimBlock);
      continue;
    }
    const layer = unescapeDxf(get(re, 8) ?? '0');
    const reason = r.reason ?? re.type;
    res.unsupported[reason] = (res.unsupported[reason] ?? 0) + 1;
    res.preserved.push({ dxfType: re.type, layer, pairs: allRaw(re), display: buildDisplay(re, blocks) });
  }

  for (const b of rawBlocks) {
    const up = b.name.toUpperCase();
    if (up === '*MODEL_SPACE' || up === '*PAPER_SPACE' || up.startsWith('*PAPER_SPACE')) continue;
    if (nativeDimBlocks.has(b.name)) continue; // 치수 블록은 저장 시 재생성
    res.preservedBlocks.push({ name: b.name, pairs: b.pairs });
  }

  const unsupportedCount = Object.values(res.unsupported).reduce((a, b) => a + b, 0);
  if (unsupportedCount) {
    const list = Object.entries(res.unsupported)
      .map(([k, n]) => `${k} ${n}개`)
      .join(', ');
    res.warnings.push(`미지원 객체 ${unsupportedCount}개는 원본 데이터 그대로 보존합니다(편집 불가): ${list}`);
  }
  if (zWarn) res.warnings.push(`Z 좌표(높이)가 0이 아닌 객체 ${zWarn}개는 XY 평면으로 투영하여 표시합니다.`);
  if (skippedSections.size)
    res.warnings.push(`다음 섹션은 2D 편집에 사용하지 않으며 R12 형식 저장 시 포함되지 않습니다: ${[...skippedSections].join(', ')}`);
  return res;
}

function readHeader(body: DxfPair[], header: Record<string, string>) {
  let key = '';
  for (const p of body) {
    if (p.code === 9) key = p.value.trim();
    else if (key && !(key in header)) header[key] = p.value;
  }
}

function readTables(body: DxfPair[], res: DxfReadResult, dimStyles: Map<string, { txt: number; asz: number; scale: number }>) {
  let table = '';
  let cur: DxfPair[] | null = null;
  const flush = () => {
    if (!cur) return;
    const g = (c: number) => cur!.find((p) => p.code === c)?.value;
    if (table === 'LAYER' && cur[0].value === 'LAYER') {
      const name = unescapeDxf(g(2) ?? '0');
      const color = num(g(62), 7);
      const flags = num(g(70), 0);
      res.layers.push({
        name,
        color: Math.abs(color) || 7,
        on: color >= 0 && !(flags & 1),
        locked: !!(flags & 4),
        ltype: g(6) ? unescapeDxf(g(6)!) : undefined,
        frozen: !!(flags & 1),
      });
    } else if (table === 'LTYPE' && cur[0].value === 'LTYPE') {
      const name = unescapeDxf(g(2) ?? '');
      const pattern = cur.filter((p) => p.code === 49).map((p) => num(p.value));
      if (name) res.ltypes.push({ name, desc: unescapeDxf(g(3) ?? ''), pattern });
    } else if (table === 'DIMSTYLE' && cur[0].value === 'DIMSTYLE') {
      const name = (g(2) ?? 'STANDARD').toUpperCase();
      dimStyles.set(name, { txt: num(g(140), 2.5), asz: num(g(41), 2.5), scale: num(g(40), 1) || 1 });
    }
    cur = null;
  };
  for (const p of body) {
    if (p.code === 0) {
      flush();
      if (p.value === 'TABLE') {
        table = '';
        continue;
      }
      if (p.value === 'ENDTAB') {
        table = '';
        continue;
      }
      cur = [p];
      continue;
    }
    if (!table && p.code === 2 && !cur) {
      table = p.value.toUpperCase();
      continue;
    }
    if (cur) cur.push(p);
  }
  flush();
}

function readBlocks(body: DxfPair[], blocks: Map<string, BlockDef>, rawBlocks: { name: string; pairs: DxfPair[] }[]) {
  let i = 0;
  while (i < body.length) {
    if (body[i].code === 0 && body[i].value === 'BLOCK') {
      const start = i;
      let j = i + 1;
      while (j < body.length && body[j].code !== 0) j++;
      const head = body.slice(i, j);
      const name = unescapeDxf(head.find((p) => p.code === 2)?.value ?? '');
      const base = { x: num(head.find((p) => p.code === 10)?.value), y: num(head.find((p) => p.code === 20)?.value) };
      const { list, next } = groupEntities(body, j, (p) => p.value === 'ENDBLK');
      let k = next;
      // ENDBLK 포함
      k++;
      while (k < body.length && body[k].code !== 0) k++;
      rawBlocks.push({ name, pairs: body.slice(start, k) });
      blocks.set(name, { name, base, ents: list });
      i = k;
      continue;
    }
    i++;
  }
}

interface ConvertResult {
  entity?: NewEntity;
  reason?: string;
  z?: boolean;
  dimBlock?: string;
}

/** 지원 객체 변환. 변환 불가 시 reason 반환 */
export function convertEntity(re: RawEntity, dimStyles: Map<string, { txt: number; asz: number; scale: number }>): ConvertResult {
  const g = (c: number) => get(re, c);
  const n = (c: number, d = 0) => num(g(c), d);
  if (n(67) === 1) return { reason: `${re.type}(배치/도면공간)` };
  const layer = unescapeDxf(g(8) ?? '0');
  const base: { layer: string; color?: number; ltype?: string } = { layer };
  if (g(62) !== undefined && n(62) !== 256) base.color = n(62);
  const lt = g(6);
  if (lt && lt.toUpperCase() !== 'BYLAYER') base.ltype = unescapeDxf(lt);
  // 돌출 방향(OCS): (0,0,1) 기본, (0,0,-1)은 좌우 반전으로 처리, 그 외는 3D → 미지원
  const ez = n(230, 1), ex = n(210, 0), ey = n(220, 0);
  const flipped = Math.abs(ex) < 1e-12 && Math.abs(ey) < 1e-12 && ez < 0;
  const ocsOk = (Math.abs(ex) < 1e-12 && Math.abs(ey) < 1e-12) || g(210) === undefined;
  const fx = (x: number) => (flipped ? -x : x);
  const hasZ = [30, 31, 38].some((c) => g(c) !== undefined && Math.abs(n(c)) > 1e-12);

  switch (re.type) {
    case 'LINE':
      return {
        entity: { type: 'line', ...base, p1: { x: n(10), y: n(20) }, p2: { x: n(11), y: n(21) } },
        z: hasZ,
      };
    case 'CIRCLE': {
      if (!ocsOk) return { reason: 'CIRCLE(3D 방향)' };
      const r = n(40);
      if (!(r > 0)) return { reason: 'CIRCLE(반지름 오류)' };
      return { entity: { type: 'circle', ...base, c: { x: fx(n(10)), y: n(20) }, r }, z: hasZ };
    }
    case 'ARC': {
      if (!ocsOk) return { reason: 'ARC(3D 방향)' };
      const r = n(40);
      if (!(r > 0)) return { reason: 'ARC(반지름 오류)' };
      let a0 = n(50), a1 = n(51);
      if (flipped) [a0, a1] = [180 - a1, 180 - a0];
      const norm = (a: number) => ((a % 360) + 360) % 360;
      return { entity: { type: 'arc', ...base, c: { x: fx(n(10)), y: n(20) }, r, a0: flipped ? norm(a0) : a0, a1: flipped ? norm(a1) : a1 }, z: hasZ };
    }
    case 'LWPOLYLINE': {
      if (!ocsOk) return { reason: 'LWPOLYLINE(3D 방향)' };
      const pts: PVertex[] = [];
      for (const p of re.pairs) {
        if (p.code === 10) pts.push({ x: fx(num(p.value)), y: 0, b: 0 });
        else if (p.code === 20 && pts.length) pts[pts.length - 1].y = num(p.value);
        else if (p.code === 42 && pts.length) pts[pts.length - 1].b = flipped ? -num(p.value) : num(p.value);
      }
      if (pts.length < 2) return { reason: 'LWPOLYLINE(정점 부족)' };
      return { entity: { type: 'polyline', ...base, pts, closed: (n(70) & 1) === 1 }, z: hasZ };
    }
    case 'POLYLINE': {
      const flags = n(70);
      if (flags & (8 | 16 | 64)) return { reason: 'POLYLINE(3D/메시)' };
      if (!ocsOk) return { reason: 'POLYLINE(3D 방향)' };
      const pts: PVertex[] = [];
      for (const v of re.children) {
        if (v.type !== 'VERTEX') continue;
        const vf = num(get(v, 70));
        if (vf & 16) continue; // 스플라인 프레임 제어점
        pts.push({ x: fx(num(get(v, 10))), y: num(get(v, 20)), b: (flipped ? -1 : 1) * num(get(v, 42)) });
      }
      if (pts.length < 2) return { reason: 'POLYLINE(정점 부족)' };
      return { entity: { type: 'polyline', ...base, pts, closed: (flags & 1) === 1 }, z: hasZ };
    }
    case 'TEXT': {
      if (!ocsOk) return { reason: 'TEXT(3D 방향)' };
      const h = n(40, 2.5);
      const ha = n(72), va = n(73);
      const ent: NewEntity = {
        type: 'text',
        ...base,
        p: { x: fx(n(10)), y: n(20) },
        h,
        text: unescapeDxf(g(1) ?? ''),
        rot: n(50),
      };
      if (ha || va) {
        ent.hAlign = ha;
        ent.vAlign = va;
        ent.p2 = { x: fx(n(11)), y: n(21) };
      }
      return { entity: ent, z: hasZ };
    }
    case 'DIMENSION': {
      const dt = n(70) & 7;
      if (dt !== 0 && dt !== 1 && dt !== 3 && dt !== 4) return { reason: 'DIMENSION(각도/좌표 치수)' };
      if (!ocsOk) return { reason: 'DIMENSION(3D 방향)' };
      const st = dimStyles.get((g(3) ?? 'STANDARD').toUpperCase()) ?? { txt: 2.5, asz: 2.5, scale: 1 };
      const P = (c: number): Vec2 => ({ x: n(c), y: n(c + 10) });
      let override = unescapeDxf(g(1) ?? '');
      if (override === '<>') override = '';
      const common = { ...base, h: st.txt * st.scale, arrow: st.asz * st.scale, ...(override ? { textOverride: override } : {}) };
      const blk = g(2);
      if (dt === 0)
        return { entity: { type: 'dimension', kind: 'linear', ...common, p1: P(13), p2: P(14), loc: P(10), rot: n(50) }, dimBlock: blk };
      if (dt === 1) return { entity: { type: 'dimension', kind: 'aligned', ...common, p1: P(13), p2: P(14), loc: P(10) }, dimBlock: blk };
      if (dt === 3) {
        const far = P(10), on = P(15);
        const c = { x: (far.x + on.x) / 2, y: (far.y + on.y) / 2 };
        return { entity: { type: 'dimension', kind: 'diameter', ...common, p1: c, p2: on, loc: P(11) }, dimBlock: blk };
      }
      return { entity: { type: 'dimension', kind: 'radius', ...common, p1: P(10), p2: P(15), loc: P(11) }, dimBlock: blk };
    }
    default:
      return { reason: re.type };
  }
}
