// 치수·조회 명령: DIMLINEAR, DIMALIGNED, DIMDIAMETER, DIMRADIUS, DIST, ID, LIST
import { entityLength, typeNameKo } from '../core/entity';
import { add, angleOf, DEG, dist, mul, norm, normDeg, polyArea, sub, v } from '../core/geom';
import type { DimensionEnt, NewEntity, Vec2 } from '../core/types';
import { dimValue } from '../core/dimension';
import type { CommandFn, Ctx } from './types';

const dimBase = (ctx: Ctx) => ({ type: 'dimension' as const, layer: ctx.doc.currentLayer, h: ctx.settings.dimTextH, arrow: ctx.settings.dimArrow });

function addDim(ctx: Ctx, d: NewEntity) {
  const tx = ctx.doc.tx('DIM');
  tx.add(d);
  tx.commit();
  ctx.log(`치수 = ${ctx.fmt(dimValue(d as DimensionEnt))}`);
}

/** 두 원점 받기 (Enter → 선 객체 선택) */
function* twoPoints(ctx: Ctx): Generator<import('./types').Req, [Vec2, Vec2] | null, import('./types').Resp> {
  const a = yield { kind: 'point', prompt: '첫 번째 치수보조선 원점 지정 (Enter: 객체 선택)', allowNone: true };
  if (a.t === 'none') {
    const r = yield {
      kind: 'entity',
      prompt: '치수 기입할 선 선택',
      filter: (id) => ctx.doc.get(id)?.type === 'line',
    };
    if (r.t !== 'ent') return null;
    const e = ctx.doc.get(r.id);
    if (e?.type !== 'line') return null;
    return [e.p1, e.p2];
  }
  if (a.t !== 'point') return null;
  const b = yield { kind: 'point', prompt: '두 번째 치수보조선 원점 지정', base: a.p };
  if (b.t !== 'point') return null;
  return [a.p, b.p];
}

export const DIMLINEAR: CommandFn = function* (ctx) {
  const pts = yield* twoPoints(ctx);
  if (!pts) return;
  const [p1, p2] = pts;
  let forced: number | null = null;
  let override: string | undefined;
  const autoRot = (p: Vec2) => {
    if (forced !== null) return forced;
    const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x), minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y);
    if (p.y > maxY || p.y < minY) return 0;
    if (p.x > maxX || p.x < minX) return 90;
    return 0;
  };
  const make = (p: Vec2): NewEntity => ({ ...dimBase(ctx), kind: 'linear', p1, p2, loc: p, rot: autoRot(p), ...(override ? { textOverride: override } : {}) });
  for (;;) {
    const r = yield {
      kind: 'point',
      prompt: '치수선 위치 지정',
      noRubber: true,
      keywords: [
        { key: 'H', label: '수평(H)' },
        { key: 'V', label: '수직(V)' },
        { key: 'T', label: '문자(T)' },
      ],
      preview: (p) => [make(p)],
    };
    if (r.t === 'kw') {
      if (r.k === 'H') forced = 0;
      else if (r.k === 'V') forced = 90;
      else {
        const s = yield { kind: 'string', prompt: '치수 문자 입력 (<> = 측정값)' };
        if (s.t === 'str') override = s.s || undefined;
      }
      continue;
    }
    if (r.t !== 'point') return;
    addDim(ctx, make(r.p));
    return;
  }
};

export const DIMALIGNED: CommandFn = function* (ctx) {
  const pts = yield* twoPoints(ctx);
  if (!pts) return;
  const [p1, p2] = pts;
  if (dist(p1, p2) === 0) {
    ctx.log('두 점이 같습니다.');
    return;
  }
  const make = (p: Vec2): NewEntity => ({ ...dimBase(ctx), kind: 'aligned', p1, p2, loc: p });
  const r = yield { kind: 'point', prompt: '치수선 위치 지정', noRubber: true, preview: (p) => [make(p)] };
  if (r.t !== 'point') return;
  addDim(ctx, make(r.p));
};

function radialDim(kind: 'diameter' | 'radius'): CommandFn {
  return function* (ctx) {
    const r = yield {
      kind: 'entity',
      prompt: kind === 'diameter' ? '원 또는 호 선택' : '호 또는 원 선택',
      filter: (id) => {
        const t = ctx.doc.get(id)?.type;
        return t === 'circle' || t === 'arc';
      },
    };
    if (r.t !== 'ent') return;
    const e = ctx.doc.get(r.id);
    if (!e || (e.type !== 'circle' && e.type !== 'arc')) return;
    const make = (p: Vec2): NewEntity => {
      let dir = norm(sub(p, e.c));
      if (dir.x === 0 && dir.y === 0) dir = v(1, 0);
      return { ...dimBase(ctx), kind, p1: e.c, p2: add(e.c, mul(dir, e.r)), loc: p };
    };
    const q = yield { kind: 'point', prompt: '치수선 위치 지정', noRubber: true, preview: (p) => [make(p)] };
    if (q.t !== 'point') return;
    addDim(ctx, make(q.p));
  };
}
export const DIMDIAMETER = radialDim('diameter');
export const DIMRADIUS = radialDim('radius');

export const DIST: CommandFn = function* (ctx) {
  const a = yield { kind: 'point', prompt: '첫 번째 점 지정' };
  if (a.t !== 'point') return;
  const b = yield { kind: 'point', prompt: '두 번째 점 지정', base: a.p };
  if (b.t !== 'point') return;
  const d = dist(a.p, b.p);
  ctx.log(
    `거리 = ${ctx.fmt(d)},  X증분 = ${ctx.fmt(b.p.x - a.p.x)},  Y증분 = ${ctx.fmt(b.p.y - a.p.y)},  XY평면 각도 = ${ctx.fmt(normDeg(angleOf(a.p, b.p) / DEG))}°`,
  );
};

export const ID: CommandFn = function* (ctx) {
  const a = yield { kind: 'point', prompt: '점 지정' };
  if (a.t !== 'point') return;
  ctx.log(`X = ${ctx.fmt(a.p.x)}   Y = ${ctx.fmt(a.p.y)}`);
};

export const LIST: CommandFn = function* (ctx) {
  const pre = ctx.takePreselection();
  let ids = pre;
  if (!ids.length) {
    const r = yield { kind: 'select', prompt: '객체 선택' };
    if (r.t !== 'ids') return;
    ids = r.ids;
  }
  const f = ctx.fmt, fp = ctx.fmtPt;
  for (const id of ids.slice(0, 50)) {
    const e = ctx.doc.get(id);
    if (!e) continue;
    const head = `■ ${typeNameKo[e.type]}  레이어: ${e.layer}`;
    switch (e.type) {
      case 'line':
        ctx.log(`${head}  시작 ${fp(e.p1)}  끝 ${fp(e.p2)}  길이 ${f(dist(e.p1, e.p2))}  각도 ${f(normDeg(angleOf(e.p1, e.p2) / DEG))}°`);
        break;
      case 'circle':
        ctx.log(`${head}  중심 ${fp(e.c)}  반지름 ${f(e.r)}  지름 ${f(e.r * 2)}  둘레 ${f(2 * Math.PI * e.r)}  면적 ${f(Math.PI * e.r * e.r)}`);
        break;
      case 'arc':
        ctx.log(`${head}  중심 ${fp(e.c)}  반지름 ${f(e.r)}  시작각 ${f(e.a0)}°  끝각 ${f(e.a1)}°  길이 ${f(entityLength(e))}`);
        break;
      case 'polyline':
        ctx.log(
          `${head}  정점 ${e.pts.length}개  ${e.closed ? '닫힘' : '열림'}  길이 ${f(entityLength(e))}${e.closed ? `  면적 ${f(Math.abs(polyArea(e.pts)))}` : ''}`,
        );
        break;
      case 'text':
        ctx.log(`${head}  위치 ${fp(e.p)}  높이 ${f(e.h)}  "${e.text}"`);
        break;
      case 'dimension':
        ctx.log(`${head}  종류 ${e.kind}  측정값 ${f(dimValue(e))}`);
        break;
    }
  }
  if (ids.length > 50) ctx.log(`… 외 ${ids.length - 50}개`);
};
