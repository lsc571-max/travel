// AutoCAD 색상 색인(ACI) → 화면 색상
// 1~9는 표준 색상, 10~249는 색상환 규칙에 따른 근사값, 250~255는 회색조 근사값(화면 표시용).
// 저장되는 값은 ACI 번호 그대로이며 이 표는 표시에만 사용한다.
const BASE: Record<number, string> = {
  1: '#ff0000',
  2: '#ffff00',
  3: '#00ff00',
  4: '#00ffff',
  5: '#0000ff',
  6: '#ff00ff',
  8: '#808080',
  9: '#c0c0c0',
};

function hsv(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`;
}

const cache = new Map<string, string>();

/** @param fg7 ACI 7(흰/검정)에 사용할 색 (배경에 따라 반전) */
export function aciColor(aci: number, fg7: string): string {
  if (aci === 7 || aci === 0 || aci === 256) return fg7;
  const key = String(aci);
  const hit = cache.get(key);
  if (hit) return hit;
  let c: string;
  if (BASE[aci]) c = BASE[aci];
  else if (aci >= 10 && aci <= 249) {
    const h = Math.floor((aci - 10) / 10) * 15;
    const sub = (aci - 10) % 10;
    const val = [1, 0.8, 0.65, 0.5, 0.3][Math.floor(sub / 2)];
    const sat = sub % 2 === 0 ? 1 : 0.5;
    c = hsv(h, sat, val);
  } else if (aci >= 250 && aci <= 255) {
    const g = [0.2, 0.31, 0.41, 0.51, 0.75, 1][aci - 250];
    c = hsv(0, 0, g);
  } else c = fg7;
  cache.set(key, c);
  return c;
}

/** 색상 선택 대화상자용 대표 색상 */
export const ACI_PICK = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 30, 40, 50, 90, 130, 150, 170, 210, 250, 253];
