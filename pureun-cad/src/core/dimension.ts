// 치수 형상 계산 (화면 표시와 DXF 블록 생성에 공통 사용)
import { add, angleOf, dist, dot, mul, norm, perpL, sub, v, DEG, type LineSeg } from './geom';
import { textWidth } from './format';
import type { DimensionEnt, Vec2 } from './types';

export interface DimText {
  p: Vec2;
  h: number;
  /** 도 */
  rot: number;
  str: string;
  /** 문자 기준: 'center-bottom' 또는 'center-middle' */
  anchor: 'cb' | 'cm';
}

export interface DimGeom {
  lines: LineSeg[];
  arrows: Vec2[][];
  text: DimText;
  /** 측정값 */
  value: number;
  /** DXF용 문자 중간점 */
  textMid: Vec2;
}

/** 측정값 */
export function dimValue(d: DimensionEnt): number {
  switch (d.kind) {
    case 'linear': {
      const u = v(Math.cos((d.rot ?? 0) * DEG), Math.sin((d.rot ?? 0) * DEG));
      return Math.abs(dot(sub(d.p2, d.p1), u));
    }
    case 'aligned':
      return dist(d.p1, d.p2);
    case 'radius':
      return dist(d.p1, d.p2);
    case 'diameter':
      return 2 * dist(d.p1, d.p2);
  }
}

/** 측정값 문자 (재지정 문자의 "<>"는 측정값으로 치환) */
export function dimString(d: DimensionEnt, fmt: (n: number) => string): string {
  const val = fmt(dimValue(d));
  const pre = d.kind === 'radius' ? 'R' : d.kind === 'diameter' ? '%%c' : '';
  const measured = pre + val;
  if (d.textOverride && d.textOverride.length) return d.textOverride.replace('<>', measured);
  return measured;
}

function arrowTri(tip: Vec2, dirOut: Vec2, size: number): Vec2[] {
  // dirOut: 화살 끝이 향하는 방향(단위)
  const back = sub(tip, mul(dirOut, size));
  const w = mul(perpL(dirOut), size / 6);
  return [tip, add(back, w), sub(back, w)];
}

/** 읽기 쉬운 문자 각도(-90 < a <= 90) */
const readable = (deg: number) => {
  let a = ((deg % 360) + 360) % 360;
  if (a > 90 && a <= 270) a -= 180;
  if (a > 270) a -= 360;
  return a;
};

export function dimGeometry(d: DimensionEnt, fmt: (n: number) => string): DimGeom {
  const str = dimString(d, fmt);
  const value = dimValue(d);
  const A = d.arrow;
  const gap = d.h * 0.4;
  const lines: LineSeg[] = [];
  const arrows: Vec2[][] = [];

  if (d.kind === 'linear' || d.kind === 'aligned') {
    let u: Vec2;
    if (d.kind === 'linear') u = v(Math.cos((d.rot ?? 0) * DEG), Math.sin((d.rot ?? 0) * DEG));
    else {
      u = norm(sub(d.p2, d.p1));
      if (u.x === 0 && u.y === 0) u = v(1, 0);
    }
    const n = perpL(u);
    const d1 = add(d.p1, mul(n, dot(sub(d.loc, d.p1), n)));
    const d2 = add(d.p2, mul(n, dot(sub(d.loc, d.p2), n)));
    // 치수보조선
    const ext = (p: Vec2, q: Vec2) => {
      const L = dist(p, q);
      if (L < 1e-12) return;
      const dir = norm(sub(q, p));
      const exo = Math.min(A * 0.25, L);
      lines.push({ kind: 'line', a: add(p, mul(dir, exo)), b: add(q, mul(dir, A * 0.5)) });
    };
    ext(d.p1, d1);
    ext(d.p2, d2);
    lines.push({ kind: 'line', a: d1, b: d2 });
    const L = dist(d1, d2);
    if (L > 1e-12) {
      const dir = norm(sub(d2, d1));
      if (L >= A * 2.5) {
        arrows.push(arrowTri(d1, mul(dir, -1), A), arrowTri(d2, dir, A));
      } else {
        arrows.push(arrowTri(d1, dir, A), arrowTri(d2, mul(dir, -1), A));
        lines.push({ kind: 'line', a: d1, b: sub(d1, mul(dir, A * 2)) }, { kind: 'line', a: d2, b: add(d2, mul(dir, A * 2)) });
      }
    }
    const ang = Math.atan2(u.y, u.x) / DEG;
    const rot = readable(ang);
    const up = perpL(v(Math.cos(rot * DEG), Math.sin(rot * DEG)));
    const m = { x: (d1.x + d2.x) / 2, y: (d1.y + d2.y) / 2 };
    const tp = add(m, mul(up, gap));
    return { lines, arrows, text: { p: tp, h: d.h, rot, str, anchor: 'cb' }, value, textMid: add(m, mul(up, gap + d.h / 2)) };
  }

  // 반지름·지름: loc = 문자 중심
  const c = d.p1;
  const r = dist(d.p1, d.p2);
  const angP = angleOf(c, d.p2);
  const dir = v(Math.cos(angP), Math.sin(angP));
  const locDist = dist(c, d.loc);
  const w = textWidth(str, d.h);
  // 지시선은 문자 상자의 좌/우 가장자리 중간에서 끝남
  const edge = v(d.loc.x + (d.loc.x >= d.p2.x ? -1 : 1) * (w / 2 + gap), d.loc.y);
  if (d.kind === 'radius') {
    if (locDist > r) {
      lines.push({ kind: 'line', a: d.p2, b: edge });
      arrows.push(arrowTri(d.p2, mul(dir, -1), A));
    } else {
      lines.push({ kind: 'line', a: c, b: d.p2 });
      arrows.push(arrowTri(d.p2, dir, A));
    }
  } else {
    const q = sub(mul(c, 2), d.p2);
    lines.push({ kind: 'line', a: q, b: d.p2 });
    if (locDist > r) {
      lines.push({ kind: 'line', a: d.p2, b: edge });
      arrows.push(arrowTri(d.p2, mul(dir, -1), A), arrowTri(q, dir, A));
    } else {
      arrows.push(arrowTri(d.p2, dir, A), arrowTri(q, mul(dir, -1), A));
    }
  }
  return { lines, arrows, text: { p: d.loc, h: d.h, rot: 0, str, anchor: 'cm' }, value, textMid: d.loc };
}
