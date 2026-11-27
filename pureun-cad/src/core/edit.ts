// V1 편집 기하: 대칭(MIRROR), 축척(SCALE), 연장(EXTEND), 모깎기(FILLET), 모따기(CHAMFER),
// 결합(JOIN), 분해(EXPLODE), 배열(ARRAY), 중복 정리(OVERKILL), 가공 검사
import { dimGeometry } from './dimension';
import { baseProps, entitySegs, getDimFormatter, moveEntity, rotateEntity } from './entity';
import {
  add, angleOf, closestOnSeg, DEG, dist, dot, mul, norm, normAng, normDeg, samePt, segEnd, segStart, sub, TAU, v,
  type Seg,
} from './geom';
import { lineCircleParams, lineLineParams, segIntersect } from './intersect';
import type { BBox, Entity, NewEntity, PVertex, Vec2 } from './types';

export const stripId = (e: Entity): NewEntity => {
  const { id: _id, ...rest } = e;
  void _id;
  return rest as NewEntity;
};

// ───────── 대칭 ─────────
function reflect(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const d = norm(sub(b, a));
  const w = sub(p, a);
  const proj = add(a, mul(d, dot(w, d)));
  return { x: 2 * proj.x - p.x, y: 2 * proj.y - p.y };
}

/** 선 a-b 에 대해 대칭. 문자는 읽을 수 있게 위치만 대칭(AutoCAD MIRRTEXT=0과 같음) */
export function mirrorEntity<T extends Entity>(e: T, a: Vec2, b: Vec2): T {
  const r = (p: Vec2) => reflect(p, a, b);
  const th = angleOf(a, b) / DEG;
  switch (e.type) {
    case 'line':
      return { ...e, p1: r(e.p1), p2: r(e.p2) };
    case 'circle':
      return { ...e, c: r(e.c) };
    case 'arc':
      return { ...e, c: r(e.c), a0: normDeg(2 * th - e.a1), a1: normDeg(2 * th - e.a0) };
    case 'polyline':
      return { ...e, pts: e.pts.map((q) => ({ ...q, ...r(q), b: -q.b })) };
    case 'text':
      return { ...e, p: r(e.p), p2: e.p2 ? r(e.p2) : undefined };
    case 'dimension':
      return { ...e, p1: r(e.p1), p2: r(e.p2), loc: r(e.loc), rot: e.kind === 'linear' ? normDeg(2 * th - (e.rot ?? 0)) : e.rot };
  }
}

// ───────── 축척 ─────────
export function scaleEntity<T extends Entity>(e: T, base: Vec2, s: number): T {
  const f = (p: Vec2): Vec2 => ({ x: base.x + (p.x - base.x) * s, y: base.y + (p.y - base.y) * s });
  switch (e.type) {
    case 'line':
      return { ...e, p1: f(e.p1), p2: f(e.p2) };
    case 'circle':
      return { ...e, c: f(e.c), r: e.r * s };
    case 'arc':
      return { ...e, c: f(e.c), r: e.r * s };
    case 'polyline':
      return { ...e, pts: e.pts.map((q) => ({ ...q, ...f(q) })) };
    case 'text':
      return { ...e, p: f(e.p), p2: e.p2 ? f(e.p2) : undefined, h: e.h * s };
    case 'dimension':
      // 치수 문자·화살표 크기는 스타일 값이므로 유지, 위치와 측정값만 변경 (AutoCAD와 같음)
      return { ...e, p1: f(e.p1), p2: f(e.p2), loc: f(e.loc) };
  }
}

// ───────── 연장 ─────────
export interface EditResult {
  ok: boolean;
  entity?: NewEntity;
  entities?: NewEntity[];
  message?: string;
}

/** 선택점에 가까운 끝을 경계까지 연장 (선, 호, 열린 폴리선의 끝 세그먼트) */
export function extendEntity(e: Entity, pick: Vec2, bounds: Seg[]): EditResult {
  const T = 1e-9;
  if (e.type === 'line') {
    const atEnd = dist(pick, e.p2) <= dist(pick, e.p1);
    const from = atEnd ? e.p1 : e.p2, to = atEnd ? e.p2 : e.p1;
    // 매개변수 t: from(0) → to(1). t > 1 인 가장 가까운 교점
    let best = Infinity;
    for (const b of bounds) {
      if (b.kind === 'line') {
        const r = lineLineParams(from, to, b.a, b.b);
        if (r && r.t1 > 1 + T && r.t2 >= -T && r.t2 <= 1 + T) best = Math.min(best, r.t1);
      } else {
        for (const t of lineCircleParams(from, to, b.c, b.r)) {
          if (t <= 1 + T) continue;
          const p = add(from, mul(sub(to, from), t));
          // 교점이 경계 호의 범위 안에 있는지
          if (closestOnSeg(b, p).d < 1e-7 * Math.max(1, b.r)) best = Math.min(best, t);
        }
      }
    }
    if (!Number.isFinite(best)) return { ok: false, message: '연장 방향에 만나는 경계가 없습니다.' };
    const np = add(from, mul(sub(to, from), best));
    return { ok: true, entity: stripId(atEnd ? { ...e, p2: np } : { ...e, p1: np }) };
  }
  if (e.type === 'arc') {
    const a0 = e.a0 * DEG, a1 = e.a1 * DEG;
    const atEnd = dist(pick, { x: e.c.x + e.r * Math.cos(a1), y: e.c.y + e.r * Math.sin(a1) }) <= dist(pick, { x: e.c.x + e.r * Math.cos(a0), y: e.c.y + e.r * Math.sin(a0) });
    const sweep = normAng(a1 - a0) || TAU;
    let bestExtra = Infinity;
    for (const b of bounds) {
      const full: Seg = { kind: 'arc', c: e.c, r: e.r, start: 0, sweep: TAU };
      for (const h of segIntersect(full, b)) {
        const ang = angleOf(e.c, h.p);
        // 끝 쪽: 끝각에서 반시계로 얼마나 더 가야 하는지 / 시작 쪽: 시작각에서 시계로
        const extra = atEnd ? normAng(ang - a1) : normAng(a0 - ang);
        if (extra > 1e-9 && extra < TAU - sweep - 1e-9) bestExtra = Math.min(bestExtra, extra);
      }
    }
    if (!Number.isFinite(bestExtra)) return { ok: false, message: '연장 방향에 만나는 경계가 없습니다.' };
    const d = bestExtra / DEG;
    return { ok: true, entity: stripId(atEnd ? { ...e, a1: normDeg(e.a1 + d) } : { ...e, a0: normDeg(e.a0 - d) }) };
  }
  if (e.type === 'polyline' && !e.closed && e.pts.length >= 2) {
    const n = e.pts.length;
    const atEnd = dist(pick, e.pts[n - 1]) <= dist(pick, e.pts[0]);
    const i0 = atEnd ? n - 2 : 0;
    const p = e.pts[i0], q = e.pts[i0 + 1];
    if (Math.abs(p.b) > 1e-12) return { ok: false, message: '호로 끝나는 폴리선의 연장은 아직 지원하지 않습니다. (분해 후 연장하십시오)' };
    const ln: Entity = { id: 0, type: 'line', layer: e.layer, p1: { x: p.x, y: p.y }, p2: { x: q.x, y: q.y } };
    const r = extendEntity(ln, atEnd ? q : p, bounds);
    if (!r.ok || r.entity?.type !== 'line') return r;
    const pts = e.pts.map((x) => ({ ...x }));
    if (atEnd) Object.assign(pts[n - 1], r.entity.p2);
    else Object.assign(pts[0], r.entity.p1);
    return { ok: true, entity: stripId({ ...e, pts }) };
  }
  return { ok: false, message: '선·호·열린 폴리선만 연장할 수 있습니다.' };
}

// ───────── 모깎기·모따기 (선-선) ─────────
interface CornerInput {
  l1: Extract<Entity, { type: 'line' }>;
  pick1: Vec2;
  l2: Extract<Entity, { type: 'line' }>;
  pick2: Vec2;
}

function corner({ l1, pick1, l2, pick2 }: CornerInput) {
  const r = lineLineParams(l1.p1, l1.p2, l2.p1, l2.p2);
  if (!r) return null;
  const I = add(l1.p1, mul(sub(l1.p2, l1.p1), r.t1));
  // 각 선에서 선택점 쪽(남길 쪽) 방향
  const side = (l: typeof l1, pk: Vec2) => {
    const d = norm(sub(l.p2, l.p1));
    const s = dot(sub(pk, I), d) >= 0 ? 1 : -1;
    const u = mul(d, s);
    // 남길 쪽 먼 끝
    const far = dot(sub(l.p2, I), u) >= dot(sub(l.p1, I), u) ? l.p2 : l.p1;
    return { u, far, farD: dot(sub(far, I), u) };
  };
  return { I, a: side(l1, pick1), b: side(l2, pick2) };
}

const withEnds = (l: Extract<Entity, { type: 'line' }>, far: Vec2, near: Vec2): NewEntity => {
  // 원래 선 방향을 유지: far가 p1이었으면 p1=far
  const farIsP1 = samePt(far, l.p1, 0);
  return stripId(farIsP1 ? { ...l, p2: near } : { ...l, p1: near });
};

export function filletLines(inp: CornerInput, radius: number): EditResult {
  const c = corner(inp);
  if (!c) return { ok: false, message: '두 선이 평행하여 모깎기할 수 없습니다.' };
  const { I, a, b } = c;
  if (radius <= 0) {
    return { ok: true, entities: [withEnds(inp.l1, a.far, I), withEnds(inp.l2, b.far, I)] };
  }
  const cosPhi = Math.max(-1, Math.min(1, dot(a.u, b.u)));
  const phi = Math.acos(cosPhi);
  if (phi < 1e-9 || Math.PI - phi < 1e-9) return { ok: false, message: '두 선이 한 직선 위에 있어 모깎기할 수 없습니다.' };
  const d = radius / Math.tan(phi / 2);
  if (d > a.farD + 1e-9 || d > b.farD + 1e-9) return { ok: false, message: '반지름이 너무 커서 모깎기할 수 없습니다.' };
  const T1 = add(I, mul(a.u, d)), T2 = add(I, mul(b.u, d));
  const bis = norm(add(a.u, b.u));
  const C = add(I, mul(bis, radius / Math.sin(phi / 2)));
  let a0 = normDeg(angleOf(C, T1) / DEG), a1 = normDeg(angleOf(C, T2) / DEG);
  if (normDeg(a1 - a0) > 180) [a0, a1] = [a1, a0];
  const arc: NewEntity = { type: 'arc', ...baseProps(inp.l1), c: C, r: radius, a0, a1 };
  return { ok: true, entities: [withEnds(inp.l1, a.far, T1), withEnds(inp.l2, b.far, T2), arc] };
}

export function chamferLines(inp: CornerInput, d1: number, d2: number): EditResult {
  const c = corner(inp);
  if (!c) return { ok: false, message: '두 선이 평행하여 모따기할 수 없습니다.' };
  const { I, a, b } = c;
  if (d1 > a.farD + 1e-9 || d2 > b.farD + 1e-9) return { ok: false, message: '모따기 거리가 선 길이보다 깁니다.' };
  if (d1 <= 0 && d2 <= 0) return { ok: true, entities: [withEnds(inp.l1, a.far, I), withEnds(inp.l2, b.far, I)] };
  const T1 = add(I, mul(a.u, d1)), T2 = add(I, mul(b.u, d2));
  return { ok: true, entities: [withEnds(inp.l1, a.far, T1), withEnds(inp.l2, b.far, T2), { type: 'line', ...baseProps(inp.l1), p1: T1, p2: T2 }] };
}

// ───────── 결합 ─────────
/** 끝점이 이어지는 선·호·열린 폴리선을 폴리선으로 결합. 반환: 새 객체와 사용된 id */
export function joinEntities(ents: Entity[], tol = 1e-6): { created: NewEntity[]; used: number[]; message?: string } {
  type Piece = { id: number; segs: Seg[]; e: Entity };
  const pieces: Piece[] = [];
  for (const e of ents) {
    if (e.type === 'line' || e.type === 'arc' || (e.type === 'polyline' && !e.closed)) pieces.push({ id: e.id, segs: entitySegs(e), e });
  }
  const reverse = (segs: Seg[]): Seg[] =>
    segs
      .slice()
      .reverse()
      .map((s) => (s.kind === 'line' ? { kind: 'line', a: s.b, b: s.a } : { kind: 'arc', c: s.c, r: s.r, start: s.start + s.sweep, sweep: -s.sweep }));
  const left = new Set(pieces.map((_, i) => i));
  const created: NewEntity[] = [];
  const used: number[] = [];
  while (left.size) {
    const first = [...left][0];
    left.delete(first);
    let chain = pieces[first].segs.slice();
    const ids = [pieces[first].id];
    let grown = true;
    while (grown) {
      grown = false;
      for (const i of left) {
        const s = pieces[i].segs;
        const cs = segStart(chain[0]), ce = segEnd(chain[chain.length - 1]);
        const ps = segStart(s[0]), pe = segEnd(s[s.length - 1]);
        if (samePt(ce, ps, tol)) chain = [...chain, ...s];
        else if (samePt(ce, pe, tol)) chain = [...chain, ...reverse(s)];
        else if (samePt(cs, pe, tol)) chain = [...s, ...chain];
        else if (samePt(cs, ps, tol)) chain = [...reverse(s), ...chain];
        else continue;
        ids.push(pieces[i].id);
        left.delete(i);
        grown = true;
      }
    }
    if (ids.length < 2) continue;
    const closed = samePt(segStart(chain[0]), segEnd(chain[chain.length - 1]), tol);
    const pts: PVertex[] = chain.map((s) => ({ ...segStart(s), b: s.kind === 'arc' ? Math.tan(s.sweep / 4) : 0 }));
    if (!closed) pts.push({ ...segEnd(chain[chain.length - 1]), b: 0 });
    created.push({ type: 'polyline', ...baseProps(pieces[first].e), pts, closed });
    used.push(...ids);
  }
  return { created, used, message: created.length ? undefined : '끝점이 서로 이어지는 선·호·폴리선이 없습니다.' };
}

// ───────── 분해 ─────────
export function explodeEntity(e: Entity): NewEntity[] | null {
  const bp = baseProps(e);
  if (e.type === 'polyline') {
    return entitySegs(e).map((s) => {
      if (s.kind === 'line') return { type: 'line', ...bp, p1: s.a, p2: s.b } as NewEntity;
      let a0 = s.start, a1 = s.start + s.sweep;
      if (s.sweep < 0) [a0, a1] = [a1, a0];
      return { type: 'arc', ...bp, c: s.c, r: s.r, a0: normDeg(a0 / DEG), a1: normDeg(a1 / DEG) } as NewEntity;
    });
  }
  if (e.type === 'dimension') {
    const g = dimGeometry(e, getDimFormatter());
    const out: NewEntity[] = g.lines.map((l) => ({ type: 'line', ...bp, p1: l.a, p2: l.b }));
    for (const t of g.arrows) out.push({ type: 'polyline', ...bp, closed: true, pts: t.map((p) => ({ ...p, b: 0 })) });
    const anchor = g.text.anchor;
    out.push({ type: 'text', ...bp, p: g.text.p, h: g.text.h, text: g.text.str, rot: g.text.rot, hAlign: anchor === 'cm' ? 4 : 1, vAlign: 0, p2: g.text.p });
    return out;
  }
  return null;
}

// ───────── 배열 ─────────
export function rectArray(ents: Entity[], rows: number, cols: number, dy: number, dx: number): NewEntity[] {
  const out: NewEntity[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!r && !c) continue;
      for (const e of ents) out.push(stripId(moveEntity(e, v(c * dx, r * dy))));
    }
  return out;
}

/** 원형 배열: 전체 각도 fill(도), 개수 n(원본 포함), 객체 회전 여부 */
export function polarArray(ents: Entity[], center: Vec2, n: number, fill: number, rotateItems: boolean): NewEntity[] {
  const out: NewEntity[] = [];
  const full = Math.abs(Math.abs(fill) - 360) < 1e-9;
  const step = full ? fill / n : fill / Math.max(1, n - 1);
  for (let k = 1; k < n; k++) {
    const ang = step * k;
    for (const e of ents) {
      if (rotateItems) out.push(stripId(rotateEntity(e, center, ang)));
      else {
        // 객체 기준점(중심/시작점)만 회전 이동
        const ref = e.type === 'circle' || e.type === 'arc' ? e.c : e.type === 'line' ? e.p1 : e.type === 'polyline' ? e.pts[0] : e.type === 'text' ? e.p : e.p1;
        const a = ang * DEG;
        const rp = { x: center.x + (ref.x - center.x) * Math.cos(a) - (ref.y - center.y) * Math.sin(a), y: center.y + (ref.x - center.x) * Math.sin(a) + (ref.y - center.y) * Math.cos(a) };
        out.push(stripId(moveEntity(e, sub(rp, ref))));
      }
    }
  }
  return out;
}

// ───────── 중복 정리 (OVERKILL) ─────────
function geomKey(e: Entity, q: (n: number) => string): string | null {
  const P = (p: Vec2) => `${q(p.x)},${q(p.y)}`;
  switch (e.type) {
    case 'line': {
      const a = P(e.p1), b = P(e.p2);
      return 'L' + (a < b ? a + ';' + b : b + ';' + a);
    }
    case 'circle':
      return 'C' + P(e.c) + ';' + q(e.r);
    case 'arc':
      return 'A' + P(e.c) + ';' + q(e.r) + ';' + q(normDeg(e.a0)) + ';' + q(normDeg(e.a1));
    case 'polyline': {
      const f = e.pts.map((p) => P(p) + ':' + q(p.b)).join('|');
      const r = e.pts
        .slice()
        .reverse()
        .map((p, i, arr) => P(p) + ':' + q(-(arr[i + 1]?.b ?? 0)))
        .join('|');
      return 'P' + (e.closed ? 'c' : 'o') + (f < r || e.closed ? f : r);
    }
    case 'text':
      return 'T' + P(e.p) + ';' + q(e.h) + ';' + e.text + ';' + q(e.rot);
    case 'dimension':
      return null;
  }
}

/** 중복 객체와 다른 선에 완전히 포함되는 겹친 선을 찾음 (지울 id 목록) */
export function findOverkill(ents: Entity[], tol = 1e-6): { duplicates: number[]; overlapped: number[] } {
  const q = (n: number) => String(Math.round(n / tol));
  const seen = new Map<string, number>();
  const duplicates: number[] = [];
  for (const e of ents) {
    const k = geomKey(e, q);
    if (k === null) continue;
    const key = e.layer.toUpperCase() + '#' + k;
    if (seen.has(key)) duplicates.push(e.id);
    else seen.set(key, e.id);
  }
  const dup = new Set(duplicates);
  const lines = ents.filter((e): e is Extract<Entity, { type: 'line' }> => e.type === 'line' && !dup.has(e.id));
  const overlapped: number[] = [];
  // 같은 직선 위에서 다른 선에 완전히 포함되는 선
  for (const a of lines) {
    const da = sub(a.p2, a.p1);
    const La = Math.hypot(da.x, da.y);
    if (La < tol) continue;
    for (const b of lines) {
      if (a === b || overlapped.includes(b.id)) continue;
      const db = sub(b.p2, b.p1);
      const Lb = Math.hypot(db.x, db.y);
      if (Lb > La + tol || Lb < tol) continue;
      const u = mul(da, 1 / La);
      const off = (p: Vec2) => Math.abs((p.x - a.p1.x) * u.y - (p.y - a.p1.y) * u.x);
      if (off(b.p1) > tol || off(b.p2) > tol) continue;
      const t1 = dot(sub(b.p1, a.p1), u), t2 = dot(sub(b.p2, a.p1), u);
      if (Math.min(t1, t2) >= -tol && Math.max(t1, t2) <= La + tol && !(Lb > La - tol && b.id < a.id)) overlapped.push(b.id);
    }
  }
  return { duplicates, overlapped: overlapped.filter((id) => !dup.has(id)) };
}

// ───────── 가공 검사 ─────────
export interface CamReport {
  openEnds: Vec2[];
  zeroLength: number[];
  openPolylines: number[];
}

/** 열린 끝점(다른 객체와 이어지지 않는 끝점)과 길이 0 객체 검출 */
export function camCheck(ents: Entity[], tol = 1e-6): CamReport {
  const ends: { p: Vec2; id: number }[] = [];
  const zeroLength: number[] = [];
  const openPolylines: number[] = [];
  for (const e of ents) {
    if (e.type === 'circle' || e.type === 'text' || e.type === 'dimension') continue;
    if (e.type === 'polyline' && e.closed) continue;
    const segs = entitySegs(e);
    if (!segs.length) continue;
    const a = segStart(segs[0]), b = segEnd(segs[segs.length - 1]);
    let L = 0;
    for (const s of segs) L += s.kind === 'line' ? dist(s.a, s.b) : Math.abs(s.sweep) * s.r;
    if (L < tol) {
      zeroLength.push(e.id);
      continue;
    }
    if (e.type === 'polyline') openPolylines.push(e.id);
    ends.push({ p: a, id: e.id }, { p: b, id: e.id });
  }
  // 격자 해시로 같은 위치 끝점 묶기
  const key = (p: Vec2) => `${Math.round(p.x / tol)},${Math.round(p.y / tol)}`;
  const count = new Map<string, number>();
  for (const x of ends) count.set(key(x.p), (count.get(key(x.p)) ?? 0) + 1);
  const openEnds = ends.filter((x) => count.get(key(x.p)) === 1).map((x) => x.p);
  return { openEnds, zeroLength, openPolylines };
}

// ───────── 신축 (STRETCH) ─────────
const inRect = (p: Vec2, r: BBox) => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

/** 걸치기 창 안에 있는 정의점만 d만큼 옮김. 창 안 점이 없으면 null */
export function stretchEntity(e: Entity, r: BBox, d: Vec2): Entity | null {
  const mv = (p: Vec2) => (inRect(p, r) ? { x: p.x + d.x, y: p.y + d.y } : p);
  switch (e.type) {
    case 'line':
      if (!inRect(e.p1, r) && !inRect(e.p2, r)) return null;
      return { ...e, p1: mv(e.p1), p2: mv(e.p2) };
    case 'circle':
      return inRect(e.c, r) ? moveEntity(e, d) : null;
    case 'arc': {
      const s = { x: e.c.x + e.r * Math.cos(e.a0 * DEG), y: e.c.y + e.r * Math.sin(e.a0 * DEG) };
      const t = { x: e.c.x + e.r * Math.cos(e.a1 * DEG), y: e.c.y + e.r * Math.sin(e.a1 * DEG) };
      // 중심 또는 양 끝이 모두 창 안일 때만 이동 (한쪽 끝만 들어오면 형상 보존을 위해 그대로)
      return inRect(e.c, r) || (inRect(s, r) && inRect(t, r)) ? moveEntity(e, d) : null;
    }
    case 'polyline':
      if (!e.pts.some((p) => inRect(p, r))) return null;
      return { ...e, pts: e.pts.map((p) => (inRect(p, r) ? { ...p, x: p.x + d.x, y: p.y + d.y } : p)) };
    case 'text':
      return inRect(e.p, r) ? moveEntity(e, d) : null;
    case 'dimension':
      if (![e.p1, e.p2, e.loc].some((p) => inRect(p, r))) return null;
      return { ...e, p1: mv(e.p1), p2: mv(e.p2), loc: mv(e.loc) };
  }
}
