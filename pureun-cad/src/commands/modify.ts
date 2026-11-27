// 수정 명령: ERASE, MOVE, COPY, ROTATE, TRIM, OFFSET
import { entityBBox, entitySegs, moveEntity, rotateEntity } from '../core/entity';
import { angleOf, DEG, sub, type Seg } from '../core/geom';
import { distanceToCurve, offsetEntity, offsetSide } from '../core/offset';
import { trimEntity } from '../core/trim';
import type { Entity, NewEntity, Vec2 } from '../core/types';
import type { CommandFn, Ctx, Req, Resp } from './types';

const strip = (e: Entity): NewEntity => {
  const { id: _id, ...rest } = e;
  void _id;
  return rest as NewEntity;
};

/** 선택 받기 (선택 후 실행 지원) */
export function* selectObjects(ctx: Ctx, prompt = '객체 선택'): Generator<Req, number[], Resp> {
  const pre = ctx.takePreselection();
  if (pre.length) return pre;
  const r = yield { kind: 'select', prompt };
  return r.t === 'ids' ? ctx.editable(r.ids) : [];
}

const entsOf = (ctx: Ctx, ids: number[]) => ids.map((id) => ctx.doc.get(id)).filter((e): e is Entity => !!e);

export const ERASE: CommandFn = function* (ctx) {
  const ids = yield* selectObjects(ctx);
  if (!ids.length) return;
  const tx = ctx.doc.tx('ERASE');
  for (const id of ids) tx.remove(id);
  tx.commit();
  ctx.log(`${ids.length - tx.rejected}개 객체를 지웠습니다.`);
  ctx.setSelection([]);
};

export const MOVE: CommandFn = function* (ctx) {
  const ids = yield* selectObjects(ctx);
  if (!ids.length) return;
  const ents = entsOf(ctx, ids);
  const b = yield { kind: 'point', prompt: '기준점 지정' };
  if (b.t !== 'point') return;
  const p = yield { kind: 'point', prompt: '두 번째 점 지정', base: b.p, preview: (q) => ents.map((e) => strip(moveEntity(e, sub(q, b.p)))) };
  if (p.t !== 'point') return;
  const d = sub(p.p, b.p);
  const tx = ctx.doc.tx('MOVE');
  for (const e of ents) tx.update(moveEntity(e, d));
  tx.commit();
  ctx.setSelection([]);
};

export const COPY: CommandFn = function* (ctx) {
  const ids = yield* selectObjects(ctx);
  if (!ids.length) return;
  const ents = entsOf(ctx, ids);
  const b = yield { kind: 'point', prompt: '기준점 지정' };
  if (b.t !== 'point') return;
  ctx.setSelection([]);
  for (;;) {
    const p = yield {
      kind: 'point',
      prompt: '두 번째 점 지정 (Enter: 종료)',
      base: b.p,
      allowNone: true,
      preview: (q) => ents.map((e) => strip(moveEntity(e, sub(q, b.p)))),
    };
    if (p.t !== 'point') return;
    const d = sub(p.p, b.p);
    const tx = ctx.doc.tx('COPY');
    for (const e of ents) tx.add(strip(moveEntity(e, d)));
    tx.commit();
  }
};

export const ROTATE: CommandFn = function* (ctx) {
  const ids = yield* selectObjects(ctx);
  if (!ids.length) return;
  const ents = entsOf(ctx, ids);
  const b = yield { kind: 'point', prompt: '기준점 지정' };
  if (b.t !== 'point') return;
  let copy = false;
  for (;;) {
    const a = yield {
      kind: 'angle',
      prompt: copy ? '회전 각도 지정 (복사 모드)' : '회전 각도 지정',
      base: b.p,
      keywords: [{ key: 'C', label: '복사(C)' }],
      preview: (q) => ents.map((e) => strip(rotateEntity(e, b.p, angleOf(b.p, q) / DEG))),
    };
    if (a.t === 'kw') {
      copy = !copy;
      continue;
    }
    if (a.t !== 'num') return;
    const tx = ctx.doc.tx('ROTATE');
    for (const e of ents) {
      const r = rotateEntity(e, b.p, a.n);
      if (copy) tx.add(strip(r));
      else tx.update(r);
    }
    tx.commit();
    ctx.setSelection([]);
    return;
  }
};

/** 자르기 경계로 쓸 세그먼트 (보이는 객체, 문자·치수 제외) */
function cuttersNear(ctx: Ctx, target: Entity, only?: Set<number>): Seg[] {
  const segs: Seg[] = [];
  const bb = entityBBox(target);
  for (const id of ctx.doc.query(bb)) {
    if (id === target.id) continue;
    if (only && !only.has(id)) continue;
    const e = ctx.doc.get(id)!;
    if (!ctx.doc.isVisible(e)) continue;
    segs.push(...entitySegs(e));
  }
  for (const p of ctx.doc.queryPreserved(bb)) {
    if (only || !ctx.doc.isVisible(p)) continue;
    for (const d of p.display ?? []) segs.push(...entitySegs(d));
  }
  return segs;
}

export const TRIM: CommandFn = function* (ctx) {
  let boundary: Set<number> | undefined;
  const txIds: number[] = [];
  ctx.setSelection([]);
  ctx.log('빠른 모드: 모든 객체가 자르기 경계로 사용됩니다. (교차하지 않는 객체는 지우지 않고 그대로 둡니다)');
  for (;;) {
    const kws = [{ key: 'B', label: boundary ? '빠른 모드(B)' : '경계 선택(B)' }];
    if (txIds.length) kws.push({ key: 'U', label: '명령 취소(U)' });
    const r = yield { kind: 'entity', prompt: '자를 부분 선택 (Enter: 종료)', keywords: kws, allowNone: true, filter: (id) => ctx.doc.isEditable(ctx.doc.get(id)!) };
    if (r.t === 'none') return;
    if (r.t === 'kw') {
      if (r.k === 'U') {
        const last = txIds.pop();
        if (last !== undefined && !ctx.doc.revertInGroup(last)) ctx.log('직전 자르기 이후 다른 변경이 있어 취소할 수 없습니다.');
        continue;
      }
      if (boundary) {
        boundary = undefined;
        ctx.log('빠른 모드로 전환했습니다.');
        continue;
      }
      const s = yield { kind: 'select', prompt: '자르기 경계 객체 선택' };
      if (s.t === 'ids' && s.ids.length) {
        boundary = new Set(s.ids);
        ctx.log(`경계 ${s.ids.length}개 선택됨.`);
      }
      ctx.setSelection([]);
      continue;
    }
    if (r.t !== 'ent') continue;
    const target = ctx.doc.get(r.id);
    if (!target) continue;
    const res = trimEntity(target, r.p, cuttersNear(ctx, target, boundary));
    if (!res.ok) {
      ctx.log(res.message ?? '자를 수 없습니다.');
      continue;
    }
    const tx = ctx.doc.tx('TRIM');
    if (!tx.remove(target.id)) {
      ctx.log('잠긴 레이어 또는 꺼진 레이어의 객체는 자를 수 없습니다.');
      continue;
    }
    for (const p of res.pieces) tx.add(p);
    tx.commit();
    txIds.push(tx.committedId);
  }
};

let lastOffset = 10;
export const OFFSET: CommandFn = function* (ctx) {
  ctx.setSelection([]);
  const d = yield {
    kind: 'dist',
    prompt: `간격띄우기 거리 지정 <${ctx.fmt(lastOffset)}>`,
    def: lastOffset,
    keywords: [{ key: 'T', label: '통과점(T)' }],
  };
  let through = false;
  if (d.t === 'kw') through = true;
  else if (d.t === 'num') {
    if (!(d.n > 0)) {
      ctx.log('간격은 0보다 커야 합니다.');
      return;
    }
    lastOffset = d.n;
  } else return;
  for (;;) {
    const r = yield { kind: 'entity', prompt: '간격띄우기할 객체 선택 (Enter: 종료)', allowNone: true };
    if (r.t !== 'ent') return;
    const e = ctx.doc.get(r.id);
    if (!e) continue;
    if (e.type === 'text' || e.type === 'dimension') {
      ctx.log('문자·치수는 간격띄우기를 할 수 없습니다.');
      continue;
    }
    ctx.setSelection([e.id]);
    const calc = (p: Vec2) => offsetEntity(e, through ? distanceToCurve(e, p) : lastOffset, offsetSide(e, p));
    const s = yield {
      kind: 'point',
      prompt: through ? '통과점 지정' : '간격띄우기할 쪽의 점 지정',
      preview: (p) => {
        const o = calc(p);
        return o.ok && o.entity ? [o.entity] : [];
      },
    };
    ctx.setSelection([]);
    if (s.t !== 'point') return;
    const o = calc(s.p);
    if (!o.ok || !o.entity) {
      ctx.log(o.message ?? '간격띄우기를 할 수 없습니다.');
      continue;
    }
    const tx = ctx.doc.tx('OFFSET');
    tx.add({ ...o.entity, layer: e.layer });
    tx.commit();
  }
};
