// V1 편집 명령: MIRROR, SCALE, EXTEND, FILLET, CHAMFER, JOIN, EXPLODE, BREAK, ARRAY, OVERKILL, CAMCHECK
import {
  camCheck, chamferLines, explodeEntity, extendEntity, filletLines, findOverkill, joinEntities, mirrorEntity, polarArray, rectArray,
  scaleEntity, stripId,
} from '../core/edit';
import { entityBBox, entitySegs } from '../core/entity';
import { dist, type Seg } from '../core/geom';
import { breakEntity } from '../core/trim';
import type { Entity } from '../core/types';
import { selectObjects } from './modify';
import type { CommandFn, Ctx, Req, Resp } from './types';

const entsOf = (ctx: Ctx, ids: number[]) => ids.map((id) => ctx.doc.get(id)).filter((e): e is Entity => !!e);

export const MIRROR: CommandFn = function* (ctx) {
  const ids = yield* selectObjects(ctx);
  if (!ids.length) return;
  const ents = entsOf(ctx, ids);
  const a = yield { kind: 'point', prompt: '대칭선의 첫 번째 점 지정' };
  if (a.t !== 'point') return;
  const b = yield { kind: 'point', prompt: '대칭선의 두 번째 점 지정', base: a.p, preview: (p) => (dist(p, a.p) > 0 ? ents.map((e) => stripId(mirrorEntity(e, a.p, p))) : []) };
  if (b.t !== 'point' || dist(a.p, b.p) === 0) return;
  const k = yield { kind: 'point', prompt: '원본 객체를 지우시겠습니까? [예(Y) / 아니오(N)] <N>', keywords: [{ key: 'Y', label: '예(Y)' }, { key: 'N', label: '아니오(N)' }], allowNone: true, noRubber: true };
  const erase = k.t === 'kw' && k.k === 'Y';
  const tx = ctx.doc.tx('MIRROR');
  for (const e of ents) {
    const m = mirrorEntity(e, a.p, b.p);
    if (erase) tx.update(m);
    else tx.add(stripId(m));
  }
  tx.commit();
  ctx.setSelection([]);
};

export const SCALE: CommandFn = function* (ctx) {
  const ids = yield* selectObjects(ctx);
  if (!ids.length) return;
  const ents = entsOf(ctx, ids);
  const b = yield { kind: 'point', prompt: '기준점 지정' };
  if (b.t !== 'point') return;
  const s = yield {
    kind: 'dist',
    prompt: '축척 비율 지정 (예: 2, 0.5) 또는 점 지정',
    base: b.p,
    preview: (p) => {
      const f = dist(b.p, p) / 10;
      return f > 0 ? ents.map((e) => stripId(scaleEntity(e, b.p, f))) : [];
    },
  };
  if (s.t !== 'num') return;
  if (!(s.n > 0)) {
    ctx.log('축척 비율은 0보다 커야 합니다.');
    return;
  }
  const tx = ctx.doc.tx('SCALE');
  for (const e of ents) tx.update(scaleEntity(e, b.p, s.n));
  tx.commit();
  ctx.setSelection([]);
};

/** 보이는 모든 객체의 세그먼트(경계용) */
function boundsNear(ctx: Ctx, exclude: number): Seg[] {
  const out: Seg[] = [];
  for (const e of ctx.doc.entities.values()) {
    if (e.id === exclude || !ctx.doc.isVisible(e)) continue;
    out.push(...entitySegs(e));
  }
  for (const p of ctx.doc.preserved) if (ctx.doc.isVisible(p)) for (const d of p.display ?? []) out.push(...entitySegs(d));
  return out;
}

export const EXTEND: CommandFn = function* (ctx) {
  ctx.setSelection([]);
  ctx.log('빠른 모드: 모든 객체가 연장 경계로 사용됩니다. 연장할 끝 가까이를 클릭하십시오.');
  for (;;) {
    const r = yield { kind: 'entity', prompt: '연장할 객체의 끝 쪽 선택 (Enter: 종료)', allowNone: true, filter: (id) => ctx.doc.isEditable(ctx.doc.get(id)!) };
    if (r.t !== 'ent') return;
    const e = ctx.doc.get(r.id)!;
    const res = extendEntity(e, r.p, boundsNear(ctx, e.id));
    if (!res.ok || !res.entity) {
      ctx.log(res.message ?? '연장할 수 없습니다.');
      continue;
    }
    const tx = ctx.doc.tx('EXTEND');
    tx.update({ ...res.entity, id: e.id } as Entity);
    tx.commit();
  }
};

let filletR = 0;
let chamD1 = 1;
let chamD2 = 1;

type Line = Extract<Entity, { type: 'line' }>;
type Pick2 = { l1: Line; pick1: { x: number; y: number }; l2: Line; pick2: { x: number; y: number } };
function* pickTwoLines(ctx: Ctx, what: string, kws: { key: string; label: string }[], onKw: (k: string) => Generator<Req, void, Resp>): Generator<Req, Pick2 | null, Resp> {
  for (;;) {
    const a = yield { kind: 'entity' as const, prompt: `${what}: 첫 번째 선 선택`, keywords: kws, filter: (id: number) => ctx.doc.get(id)?.type === 'line' && ctx.doc.isEditable(ctx.doc.get(id)!) };
    if (a.t === 'kw') {
      yield* onKw(a.k);
      continue;
    }
    if (a.t !== 'ent') return null;
    ctx.setSelection([a.id]);
    const b = yield {
      kind: 'entity' as const,
      prompt: `${what}: 두 번째 선 선택`,
      filter: (id: number) => id !== a.id && ctx.doc.get(id)?.type === 'line' && ctx.doc.isEditable(ctx.doc.get(id)!),
    };
    ctx.setSelection([]);
    if (b.t !== 'ent') return null;
    return { l1: ctx.doc.get(a.id) as Extract<Entity, { type: 'line' }>, pick1: a.p, l2: ctx.doc.get(b.id) as Extract<Entity, { type: 'line' }>, pick2: b.p };
  }
}

export const FILLET: CommandFn = function* (ctx) {
  ctx.log(`현재 모깎기 반지름 = ${ctx.fmt(filletR)}  (선-선 지원. 폴리선은 분해(X) 후 사용)`);
  const inp = yield* pickTwoLines(ctx, '모깎기', [{ key: 'R', label: '반지름(R)' }], function* () {
    const d = yield { kind: 'dist', prompt: `모깎기 반지름 지정 <${ctx.fmt(filletR)}>`, def: filletR };
    if (d.t === 'num' && d.n >= 0) filletR = d.n;
  });
  if (!inp) return;
  const r = filletLines(inp, filletR);
  if (!r.ok) {
    ctx.log(r.message ?? '모깎기할 수 없습니다.');
    return;
  }
  const [n1, n2, ...rest] = r.entities!;
  const tx = ctx.doc.tx('FILLET');
  tx.update({ ...n1, id: inp.l1.id } as Entity);
  tx.update({ ...n2, id: inp.l2.id } as Entity);
  for (const x of rest) tx.add(x);
  tx.commit();
};

export const CHAMFER: CommandFn = function* (ctx) {
  ctx.log(`현재 모따기 거리 1 = ${ctx.fmt(chamD1)}, 거리 2 = ${ctx.fmt(chamD2)}`);
  const inp = yield* pickTwoLines(ctx, '모따기', [{ key: 'D', label: '거리(D)' }], function* () {
    const a = yield { kind: 'dist', prompt: `첫 번째 모따기 거리 <${ctx.fmt(chamD1)}>`, def: chamD1 };
    if (a.t !== 'num' || a.n < 0) return;
    chamD1 = a.n;
    const b = yield { kind: 'dist', prompt: `두 번째 모따기 거리 <${ctx.fmt(chamD1)}>`, def: chamD1 };
    if (b.t === 'num' && b.n >= 0) chamD2 = b.n;
  });
  if (!inp) return;
  const r = chamferLines(inp, chamD1, chamD2);
  if (!r.ok) {
    ctx.log(r.message ?? '모따기할 수 없습니다.');
    return;
  }
  const [n1, n2, ...rest] = r.entities!;
  const tx = ctx.doc.tx('CHAMFER');
  tx.update({ ...n1, id: inp.l1.id } as Entity);
  tx.update({ ...n2, id: inp.l2.id } as Entity);
  for (const x of rest) tx.add(x);
  tx.commit();
};

export const JOIN: CommandFn = function* (ctx) {
  const ids = yield* selectObjects(ctx, '결합할 객체 선택 (선·호·열린 폴리선)');
  if (!ids.length) return;
  const r = joinEntities(entsOf(ctx, ids));
  if (!r.created.length) {
    ctx.log(r.message ?? '결합할 수 없습니다.');
    return;
  }
  const tx = ctx.doc.tx('JOIN');
  for (const id of r.used) tx.remove(id);
  for (const e of r.created) tx.add(e);
  tx.commit();
  const closed = r.created.filter((e) => e.type === 'polyline' && e.closed).length;
  ctx.log(`${r.used.length}개 객체를 폴리선 ${r.created.length}개로 결합했습니다 (닫힌 윤곽 ${closed}개).`);
  ctx.setSelection([]);
};

export const EXPLODE: CommandFn = function* (ctx) {
  const pre = ctx.takePreselection();
  let ids = pre;
  if (!ids.length) {
    const r = yield { kind: 'select', prompt: '분해할 객체 선택 (폴리선·치수)', keywords: [{ key: 'B', label: '모든 블록 참조 분해(B)' }] };
    if (r.t === 'kw') {
      explodeBlocks(ctx);
      return;
    }
    if (r.t !== 'ids') return;
    ids = ctx.editable(r.ids);
  }
  const tx = ctx.doc.tx('EXPLODE');
  let n = 0;
  for (const e of entsOf(ctx, ids)) {
    const parts = explodeEntity(e);
    if (!parts) continue;
    if (!tx.remove(e.id)) continue;
    for (const p of parts) tx.add(p);
    n++;
  }
  tx.commit();
  ctx.log(n ? `${n}개 객체를 분해했습니다.` : '분해할 수 있는 객체(폴리선·치수)가 없습니다.');
  ctx.setSelection([]);
};

/** 보존된 블록 참조(INSERT)를 표시 형상 그대로 편집 가능한 객체로 바꿈 */
function explodeBlocks(ctx: Ctx) {
  const doc = ctx.doc;
  const targets = doc.preserved.filter((p) => p.dxfType === 'INSERT' && p.display?.length && doc.isEditable(p));
  if (!targets.length) {
    ctx.log('분해할 블록 참조가 없습니다(잠기거나 꺼진 레이어 제외).');
    return;
  }
  const tx = doc.tx('EXPLODE 블록');
  let n = 0;
  for (const p of targets) for (const d of p.display!) {
    tx.add(stripId(d));
    n++;
  }
  const ids = new Set(targets.map((p) => p.id));
  tx.setPreserved(doc.preserved.filter((p) => !ids.has(p.id)));
  tx.commit();
  ctx.log(`블록 참조 ${targets.length}개를 객체 ${n}개로 분해했습니다. (비균일 축척 블록의 원·호는 폴리선 근사)`);
}

export const BREAK: CommandFn = function* (ctx) {
  const r = yield { kind: 'entity', prompt: '끊을 객체 선택 (선택한 점 = 첫 번째 끊는 점)', filter: (id) => ctx.doc.isEditable(ctx.doc.get(id)!) };
  if (r.t !== 'ent') return;
  const e = ctx.doc.get(r.id)!;
  ctx.setSelection([e.id]);
  let first = r.p;
  const q = yield { kind: 'point', prompt: '두 번째 끊는 점 지정 (@: 같은 점에서 나눔)', keywords: [{ key: 'F', label: '첫 번째 점 다시(F)' }], noRubber: true };
  let second = q.t === 'point' ? q.p : null;
  if (q.t === 'kw') {
    const a = yield { kind: 'point', prompt: '첫 번째 끊는 점 지정' };
    if (a.t !== 'point') return;
    first = a.p;
    const b = yield { kind: 'point', prompt: '두 번째 끊는 점 지정' };
    if (b.t !== 'point') return;
    second = b.p;
  }
  ctx.setSelection([]);
  if (!second) return;
  const res = breakEntity(e, first, second);
  if (!res.ok) {
    ctx.log(res.message ?? '끊을 수 없습니다.');
    return;
  }
  const tx = ctx.doc.tx('BREAK');
  tx.remove(e.id);
  for (const p of res.pieces) tx.add(p);
  tx.commit();
};

export const ARRAY: CommandFn = function* (ctx) {
  const ids = yield* selectObjects(ctx);
  if (!ids.length) return;
  const ents = entsOf(ctx, ids);
  const k = yield {
    kind: 'point',
    prompt: '배열 종류 <원형>',
    keywords: [
      { key: 'P', label: '원형(P)' },
      { key: 'R', label: '직사각형(R)' },
    ],
    allowNone: true,
    noRubber: true,
  };
  const rect = k.t === 'kw' && k.k === 'R';
  const int = (n: number) => Math.round(n);
  let created: ReturnType<typeof rectArray>;
  if (rect) {
    const rows = yield { kind: 'dist', prompt: '행 수 <3>', def: 3 };
    if (rows.t !== 'num' || int(rows.n) < 1) return;
    const cols = yield { kind: 'dist', prompt: '열 수 <4>', def: 4 };
    if (cols.t !== 'num' || int(cols.n) < 1) return;
    const bb = entityBBox(ents[0]);
    const dy0 = (bb.maxY - bb.minY) * 1.5 || 10, dx0 = (bb.maxX - bb.minX) * 1.5 || 10;
    const dy = yield { kind: 'dist', prompt: `행 간격(위쪽 +) <${ctx.fmt(dy0)}>`, def: dy0 };
    if (dy.t !== 'num') return;
    const dx = yield { kind: 'dist', prompt: `열 간격(오른쪽 +) <${ctx.fmt(dx0)}>`, def: dx0 };
    if (dx.t !== 'num') return;
    created = rectArray(ents, int(rows.n), int(cols.n), dy.n, dx.n);
  } else {
    const c = yield { kind: 'point', prompt: '배열의 중심점 지정' };
    if (c.t !== 'point') return;
    const n = yield { kind: 'dist', prompt: '항목 수(원본 포함) <6>', def: 6 };
    if (n.t !== 'num' || int(n.n) < 2) {
      ctx.log('항목 수는 2 이상이어야 합니다.');
      return;
    }
    const f = yield { kind: 'dist', prompt: '채울 각도(반시계 +) <360>', def: 360 };
    if (f.t !== 'num' || f.n === 0) return;
    const rot = yield {
      kind: 'point',
      prompt: '항목을 회전하시겠습니까? <Y>',
      keywords: [
        { key: 'Y', label: '예(Y)' },
        { key: 'N', label: '아니오(N)' },
      ],
      allowNone: true,
      noRubber: true,
    };
    created = polarArray(ents, c.p, int(n.n), f.n, !(rot.t === 'kw' && rot.k === 'N'));
  }
  const tx = ctx.doc.tx('ARRAY');
  for (const e of created) tx.add(e);
  tx.commit();
  ctx.log(`배열: 객체 ${created.length}개를 만들었습니다.`);
  ctx.setSelection([]);
};

export const OVERKILL: CommandFn = function* (ctx) {
  const pre = ctx.takePreselection();
  let ids = pre;
  if (!ids.length) {
    const r = yield { kind: 'select', prompt: '중복을 정리할 객체 선택 (ALL: 전체)' };
    if (r.t !== 'ids') return;
    ids = ctx.editable(r.ids);
  }
  // 선택한 객체와 겹치는 상대가 선택 밖에 있어도 찾도록 보이는 전체와 비교하고, 지우는 것은 선택한 객체만
  const chosen = new Set(ids);
  const all = [...ctx.doc.entities.values()].filter((e) => ctx.doc.isVisible(e));
  const found = findOverkill(all);
  const duplicates = found.duplicates.filter((id) => chosen.has(id));
  const overlapped = found.overlapped.filter((id) => chosen.has(id));
  const tx = ctx.doc.tx('OVERKILL');
  for (const id of [...duplicates, ...overlapped]) tx.remove(id);
  tx.commit();
  ctx.log(`중복 정리: 완전히 같은 객체 ${duplicates.length}개, 다른 선에 포함된 겹친 선 ${overlapped.length}개를 지웠습니다. (Ctrl+Z로 되돌리기)`);
  ctx.setSelection([]);
};

// eslint-disable-next-line require-yield
export const CAMCHECK: CommandFn = function* (ctx) {
  const ents = [...ctx.doc.entities.values()].filter((e) => ctx.doc.isVisible(e));
  const r = camCheck(ents);
  const dup = findOverkill(ents);
  ctx.setMarks(r.openEnds);
  ctx.setSelection(ctx.editable([...r.zeroLength, ...dup.duplicates, ...dup.overlapped]));
  ctx.log(
    `가공 검사: 열린 끝점 ${r.openEnds.length}곳(빨간 원 표시), 열린 폴리선 ${r.openPolylines.length}개, 길이 0 객체 ${r.zeroLength.length}개, 중복 ${dup.duplicates.length}개, 겹친 선 ${dup.overlapped.length}개` +
      (r.zeroLength.length + dup.duplicates.length + dup.overlapped.length ? ' — 문제 객체를 선택해 두었습니다 (OVERKILL로 정리).' : ''),
  );
  if (!r.openEnds.length && !r.zeroLength.length && !dup.duplicates.length && !dup.overlapped.length) ctx.log('가공 검사: 문제가 없습니다. 모든 윤곽이 닫혀 있습니다.');
};
