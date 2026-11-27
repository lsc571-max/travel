// 숫자 표시 형식. 화면 표시용 반올림만 수행하며 내부 값은 바꾸지 않는다.

/** 지정 자릿수로 표시하고 끝의 0 제거 */
export function fmtNum(n: number, decimals: number, stripZeros = true): string {
  if (!Number.isFinite(n)) return String(n);
  let s = n.toFixed(Math.max(0, Math.min(12, decimals)));
  if (stripZeros && s.includes('.')) s = s.replace(/\.?0+$/, '');
  if (s === '-0') s = '0';
  return s;
}

/** DXF 저장용: 64비트 값을 손실 없이(왕복 가능한 최단 표현) 지수 표기 없이 출력 */
export function dxfNum(n: number): string {
  if (!Number.isFinite(n)) return '0.0';
  if (Object.is(n, -0)) n = 0;
  let s = String(n);
  if (s.includes('e') || s.includes('E')) {
    // 지수 표기 회피: 충분한 자릿수로 고정소수 변환 후 끝 0 제거
    s = n.toFixed(20);
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '.0');
    // toFixed(20)가 원래 값과 다르게 되돌아오는지 확인
    if (Number(s) !== n) s = String(n);
  }
  if (!s.includes('.') && !s.includes('e')) s += '.0';
  return s;
}

/** %%c, %%d, %%p 등 AutoCAD 특수문자 코드를 화면 표시용 문자로 변환 */
export function displayText(s: string): string {
  return s
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%%/g, '%')
    .replace(/%%[uUoO]/g, '');
}

/** 문자 폭 추정(전각 1.0h, 반각 0.62h) */
export function textWidth(s: string, h: number): number {
  let w = 0;
  for (const ch of displayText(s)) w += ch.charCodeAt(0) > 0x2e80 ? 1.0 : 0.62;
  return w * h;
}
