// 좌표 입력 해석 (AutoCAD 방식)
//  x,y      절대 좌표          #x,y  절대 좌표(명시)
//  @x,y     상대 좌표          @     마지막 점과 같은 점
//  @d<a     상대 극좌표(도)     d<a   절대 극좌표
//  숫자 하나: 직접 거리 입력(기준점과 커서 방향 필요)
import { DEG } from './geom';
import type { Vec2 } from './types';

export type CoordInput =
  | { kind: 'point'; p: Vec2 }
  | { kind: 'distance'; d: number }
  | { kind: 'invalid'; reason: string };

const NUM = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`;
const reXY = new RegExp(String.raw`^(${NUM})\s*,\s*(${NUM})(?:\s*,\s*(${NUM}))?$`);
const rePolar = new RegExp(String.raw`^(${NUM})\s*<\s*(${NUM})$`);
const reNum = new RegExp(String.raw`^${NUM}$`);

export function isNumber(s: string) {
  return reNum.test(s.trim());
}

/**
 * @param text 입력 문자열
 * @param last 마지막 점(상대 좌표 기준). 없으면 상대 좌표는 원점 기준
 */
export function parseCoord(text: string, last: Vec2 | null): CoordInput {
  let s = text.trim().replace(/\s+/g, '');
  if (!s) return { kind: 'invalid', reason: '빈 입력' };
  let rel = false;
  if (s.startsWith('@')) {
    rel = true;
    s = s.slice(1);
    if (s === '') return { kind: 'point', p: last ? { ...last } : { x: 0, y: 0 } };
  } else if (s.startsWith('#')) {
    s = s.slice(1);
  }
  const base = rel && last ? last : { x: 0, y: 0 };
  let m = reXY.exec(s);
  if (m) {
    const x = Number(m[1]), y = Number(m[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { kind: 'invalid', reason: '숫자 범위 초과' };
    return { kind: 'point', p: { x: base.x + x, y: base.y + y } };
  }
  m = rePolar.exec(s);
  if (m) {
    const d = Number(m[1]), a = Number(m[2]);
    if (!Number.isFinite(d) || !Number.isFinite(a)) return { kind: 'invalid', reason: '숫자 범위 초과' };
    const r = polarExact(d, a);
    return { kind: 'point', p: { x: base.x + r.x, y: base.y + r.y } };
  }
  if (!rel && reNum.test(s)) return { kind: 'distance', d: Number(s) };
  return { kind: 'invalid', reason: '좌표 형식 오류 (예: 100,50  @20,0  @50<30)' };
}

/** 0/90/180/270도 등은 cos/sin 오차 없이 정확한 값 사용 */
export function polarExact(d: number, angDeg: number): Vec2 {
  const a = ((angDeg % 360) + 360) % 360;
  if (a === 0) return { x: d, y: 0 };
  if (a === 90) return { x: 0, y: d };
  if (a === 180) return { x: -d, y: 0 };
  if (a === 270) return { x: 0, y: -d };
  return { x: d * Math.cos(a * DEG), y: d * Math.sin(a * DEG) };
}

