// 그리기 명령: LINE, CIRCLE, ARC, PLINE, RECTANG, TEXT
import { angleOf, cross, dist, dot, DEG, norm, normDeg, samePt, sub, v, polar } from '../core/geom';
import { lineLineParams } from '../core/intersect';
import type { NewEntity, PVertex, Vec2 } from '../core/types';
import type { CommandFn, Ctx } from './types';

const base = (ctx: Ctx) => ({ layer: ctx.doc.currentLayer });
const lineEnt = (ctx: Ctx, a: Vec2, b: Vec2): NewEntity => ({ type: 'line', ...base(ctx), p1: a, p2: b });

export const LINE: CommandFn = function* (ctx) {
  const r = yield { kind: 'point', prompt: '첫 번째 점 지정' };
  if (r.t !== 'point') return;
  const pts: Vec2[] = [r.p];
  let segs = 0;
  for (;;) {
    const prev = pts[pts.length - 1];
    const kws = [];
    if (segs >= 2) kws.push({ key: 'C', label: '닫기(C)' });
    if (segs >= 1) kws.push({ key: 'U', label: '명령 취소(U)' });
    const q = yield { kind: 'point', prompt: '다음 점 지정', base: prev, keywords: kws, allowNone: true, preview: (p) => [lineEnt(ctx, prev, p)] };
    if (q.t === 'none') return;
    if (q.t === 'kw' && q.k === 'U') {
      if (segs > 0 && ctx.doc.groupDepth() > 0) {
        ctx.doc.undo();
        pts.pop();
        segs--;
        ctx.lastPoint = pts[pts.length - 1];
      }
      continue;
    }
    if (q.t === 'kw' && q.k === 'C') {
      const tx = ctx.doc.tx('LINE');
      tx.add(lineEnt(ctx, prev, pts[0]));
      tx.commit();
      ctx.lastPoint = pts[0];
      return;
    }
    if (q.t !== 'point') continue;
    if (samePt(q.p, prev, 0)) {
      ctx.log('길이가 0인 선은 만들 수 없습니다.');
      continue;
    }
    const tx = ctx.doc.tx('LINE');
    tx.add(lineEnt(ctx, prev, q.p));
    tx.commit();
    pts.push(q.p);
    segs++;
  }
};

/** 세 점을 지나는 원의 중심 */
function circumcenter(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const m1 = v((a.x + b.x) / 2, (a.y + b.y) / 2), m2 = v((b.x + c.x) / 2, (b.y + c.y) / 2);
  const d1 = sub(b, a), d2 = sub(c, b);
  const r = lineLineParams(m1, v(m1.x - d1.y, m1.y + d1.x), m2, v(m2.x - d2.y, m2.y + d2.x));
  if (!r) return null;
  return v(m1.x - d1.y * r.t1, m1.y + d1.x * r.t1);
}

export const CIRCLE: CommandFn = function* (ctx) {
  const circ = (c: Vec2, r: number): NewEntity => ({ type: 'circle', ...base(ctx), c, r });
  const add = (c: Vec2, r: number) => {
    if (!(r > 0)) {
      ctx.log('반지름은 0보다 커야 합니다.');
      return;
    }
    const tx = ctx.doc.tx('CIRCLE');
    tx.add(circ(c, r));
    tx.commit();
  };
  const r0 = yield { kind: 'point', prompt: '원의 중심점 지정', keywords: [{ key: '3P', label: '3점(3P)' }, { key: '2P', label: '2점(2P)' }] };
  if (r0.t === 'kw' && r0.k === '2P') {
    const a = yield { kind: 'point', prompt: '지름의 첫 번째 끝점 지정' };
    if (a.t !== 'point') return;
    const b = yield { kind: 'point', prompt: '지름의 두 번째 끝점 지정', base: a.p, preview: (p) => [circ(v((a.p.x + p.x) / 2, (a.p.y + p.y) / 2), dist(a.p, p) / 2)] };
    if (b.t !== 'point') return;
    add(v((a.p.x + b.p.x) / 2, (a.p.y + b.p.y) / 2), dist(a.p, b.p) / 2);
    return;
  }
  if (r0.t === 'kw' && r0.k === '3P') {
    const a = yield { kind: 'point', prompt: '원 위의 첫 번째 점 지정' };
    if (a.t !== 'point') return;
    const b = yield { kind: 'point', prompt: '원 위의 두 번째 점 지정', base: a.p };
    if (b.t !== 'point') return;
    const c = yield {
      kind: 'point',
      prompt: '원 위의 세 번째 점 지정',
      preview: (p) => {
        const cc = circumcenter(a.p, b.p, p);
        return cc ? [circ(cc, dist(cc, p))] : [];
      },
    };
    if (c.t !== 'point') return;
    const cc = circumcenter(a.p, b.p, c.p);
    if (!cc) {
      ctx.log('세 점이 한 직선 위에 있어 원을 만들 수 없습니다.');
      return;
    }
    add(cc, dist(cc, a.p));
    return;
  }
  if (r0.t !== 'point') return;
  const c = r0.p;
  const r1 = yield {
    kind: 'point',
    prompt: '원의 반지름 지정',
    base: c,
    acceptNumber: true,
    keywords: [{ key: 'D', label: '지름(D)' }],
    preview: (p) => [circ(c, dist(c, p))],
  };
  if (r1.t === 'kw' && r1.k === 'D') {
    const d = yield { kind: 'dist', prompt: '원의 지름 지정', base: c, preview: (p) => [circ(c, dist(c, p) / 2)] };
    if (d.t === 'num') add(c, d.n / 2);
    return;
  }
  if (r1.t === 'num') add(c, r1.n);
  else if (r1.t === 'point') add(c, dist(c, r1.p));
};

/** 세 점 원호 (도 단위 각도) */
function arc3(a: Vec2, b: Vec2, c: Vec2): { c: Vec2; r: number; a0: number; a1: number } | null {
  const cc = circumcenter(a, b, c);
  if (!cc) return null;
  const r = dist(cc, a);
  const ccw = cross(sub(b, a), sub(c, a)) > 0;
  const aa = normDeg(angleOf(cc, a) / DEG), ac = normDeg(angleOf(cc, c) / DEG);
  return ccw ? { c: cc, r, a0: aa, a1: ac } : { c: cc, r, a0: ac, a1: aa };
}

export const ARC: CommandFn = function* (ctx) {
  const arcEnt = (x: { c: Vec2; r: number; a0: number; a1: number }): NewEntity => ({ type: 'arc', ...base(ctx), ...x });
  const add = (x: { c: Vec2; r: number; a0: number; a1: number } | null) => {
    if (!x || !(x.r > 0)) {
      ctx.log('원호를 만들 수 없습니다(세 점이 한 직선 위).');
      return;
    }
    const tx = ctx.doc.tx('ARC');
    tx.add(arcEnt(x));
    tx.commit();
  };
  const r0 = yield { kind: 'point', prompt: '호의 시작점 지정', keywords: [{ key: 'C', label: '중심(C)' }] };
  if (r0.t === 'kw') {
    const c = yield { kind: 'point', prompt: '호의 중심점 지정' };
    if (c.t !== 'point') return;
    const s = yield { kind: 'point', prompt: '호의 시작점 지정', base: c.p };
    if (s.t !== 'point') return;
    const r = dist(c.p, s.p);
    const a0 = normDeg(angleOf(c.p, s.p) / DEG);
    const e = yield {
      kind: 'point',
      prompt: '호의 끝점 지정 (반시계 방향)',
      base: c.p,
      preview: (p) => [arcEnt({ c: c.p, r, a0, a1: normDeg(angleOf(c.p, p) / DEG) })],
    };
    if (e.t !== 'point') return;
    add({ c: c.p, r, a0, a1: normDeg(angleOf(c.p, e.p) / DEG) });
    return;
  }
  if (r0.t !== 'point') return;
  const b = yield { kind: 'point', prompt: '호의 두 번째 점 지정', base: r0.p };
  if (b.t !== 'point') return;
  const c = yield {
    kind: 'point',
    prompt: '호의 끝점 지정',
    base: b.p,
    preview: (p) => {
      const x = arc3(r0.p, b.p, p);
      return x ? [arcEnt(x)] : [lineEnt(ctx, r0.p, p)];
    },
  };
  if (c.t !== 'point') return;
  add(arc3(r0.p, b.p, c.p));
};

/** 접선 방향 t로 P에서 출발해 Q에서 끝나는 원호의 bulge */
function tangentBulge(P: Vec2, t: Vec2, Q: Vec2): number {
  const c = sub(Q, P);
  const th = Math.atan2(cross(t, c), dot(t, c));
  return Math.tan(th / 2);
}

/** 폴리선 마지막 정점에서의 진행 방향 */
function endTangent(pts: PVertex[]): Vec2 {
  if (pts.length < 2) return v(1, 0);
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  const chord = norm(sub(b, a));
  if (Math.abs(a.b) < 1e-12) return chord;
  // 호 끝 접선 = 현 방향을 sweep/2 만큼 회전
  const half = 2 * Math.atan(a.b);
  const c = Math.cos(half), s = Math.sin(half);
  return v(chord.x * c - chord.y * s, chord.x * s + chord.y * c);
}

export const PLINE: CommandFn = function* (ctx) {
  const r0 = yield { kind: 'point', prompt: '시작점 지정' };
  if (r0.t !== 'point') return;
  const pts: PVertex[] = [{ ...r0.p, b: 0 }];
  let arcMode = false;
  const poly = (list: PVertex[], closed = false): NewEntity => ({ type: 'polyline', ...base(ctx), pts: list.map((p) => ({ ...p })), closed });
  const finish = (closed: boolean) => {
    if (pts.length < 2) return;
    const tx = ctx.doc.tx('PLINE');
    tx.add(poly(pts, closed));
    tx.commit();
  };
  try {
    for (;;) {
      const last = pts[pts.length - 1];
      const kws = arcMode
        ? [{ key: 'L', label: '선(L)' }]
        : [{ key: 'A', label: '호(A)' }];
      if (pts.length >= 3) kws.push({ key: 'C', label: '닫기(C)' });
      if (pts.length >= 2) kws.push({ key: 'U', label: '명령 취소(U)' });
      const preview = (p: Vec2) => {
        const tmp = pts.map((q) => ({ ...q }));
        if (arcMode) tmp[tmp.length - 1].b = tangentBulge(last, endTangent(pts), p);
        tmp.push({ ...p, b: 0 });
        return [poly(tmp)];
      };
      const q = yield {
        kind: 'point',
        prompt: arcMode ? '호의 끝점 지정' : '다음 점 지정',
        base: last,
        keywords: kws,
        allowNone: true,
        noRubber: arcMode,
        preview,
      };
      if (q.t === 'none') {
        finish(false);
        return;
      }
      if (q.t === 'kw') {
        if (q.k === 'A') arcMode = true;
        else if (q.k === 'L') arcMode = false;
        else if (q.k === 'U') {
          pts.pop();
          pts[pts.length - 1].b = 0;
          ctx.lastPoint = pts[pts.length - 1];
        } else if (q.k === 'C') {
          if (arcMode) pts[pts.length - 1].b = tangentBulge(last, endTangent(pts), pts[0]);
          finish(true);
          return;
        }
        continue;
      }
      if (q.t !== 'point') continue;
      if (samePt(q.p, last, 0)) continue;
      if (arcMode) pts[pts.length - 1].b = tangentBulge(last, endTangent(pts), q.p);
      pts.push({ ...q.p, b: 0 });
    }
  } finally {
    // ESC로 끝낸 경우에도 지금까지 그린 폴리선 유지 (AutoCAD와 동일)
    if (pts.length >= 2 && ctx.doc.groupDepth() === 0) finish(false);
  }
};

export const RECTANG: CommandFn = function* (ctx) {
  const rect = (a: Vec2, b: Vec2): NewEntity => ({
    type: 'polyline',
    ...base(ctx),
    closed: true,
    pts: [
      { x: a.x, y: a.y, b: 0 },
      { x: b.x, y: a.y, b: 0 },
      { x: b.x, y: b.y, b: 0 },
      { x: a.x, y: b.y, b: 0 },
    ],
  });
  const a = yield { kind: 'point', prompt: '첫 번째 구석점 지정' };
  if (a.t !== 'point') return;
  const b = yield { kind: 'point', prompt: '다른 구석점 지정 (예: @100,50)', base: a.p, noRubber: true, preview: (p) => [rect(a.p, p)] };
  if (b.t !== 'point') return;
  if (a.p.x === b.p.x || a.p.y === b.p.y) {
    ctx.log('가로 또는 세로 길이가 0입니다.');
    return;
  }
  const tx = ctx.doc.tx('RECTANG');
  tx.add(rect(a.p, b.p));
  tx.commit();
};

let lastTextH = 0;
export const TEXT: CommandFn = function* (ctx) {
  const a = yield { kind: 'point', prompt: '문자의 시작점 지정' };
  if (a.t !== 'point') return;
  const def = lastTextH || ctx.settings.textH;
  const h = yield { kind: 'dist', prompt: `높이 지정 <${ctx.fmt(def)}>`, base: a.p, def };
  if (h.t !== 'num' || !(h.n > 0)) return;
  lastTextH = h.n;
  const r = yield { kind: 'angle', prompt: '문자의 회전 각도 지정 <0>', base: a.p, def: 0 };
  if (r.t !== 'num') return;
  let p = a.p;
  for (;;) {
    const s = yield { kind: 'string', prompt: '문자 입력 (빈 줄 Enter: 종료)' };
    if (s.t !== 'str' || !s.s) return;
    const tx = ctx.doc.tx('TEXT');
    tx.add({ type: 'text', ...base(ctx), p, h: h.n, text: s.s, rot: r.n });
    tx.commit();
    p = polar(p, h.n * 1.6, (r.n - 90) * DEG);
  }
};
