// Google Calendar 일정 색상 11가지 (colorId) — 구글 캘린더 앱과 같은 색으로 보이도록 일치.
export const GOOGLE_COLORS: Record<string, { name: string; hex: string }> = {
  '1': { name: '라벤더', hex: '#7986cb' },
  '2': { name: '세이지', hex: '#33b679' },
  '3': { name: '포도', hex: '#8e24aa' },
  '4': { name: '플라밍고', hex: '#e67c73' },
  '5': { name: '바나나', hex: '#f6bf26' },
  '6': { name: '귤', hex: '#f4511e' },
  '7': { name: '공작', hex: '#039be5' },
  '8': { name: '흑연', hex: '#616161' },
  '9': { name: '블루베리', hex: '#3f51b5' },
  '10': { name: '바질', hex: '#0b8043' },
  '11': { name: '토마토', hex: '#d50000' },
};

export const DEFAULT_EVENT_COLOR = '#5b7bd5';
export const HOLIDAY_COLOR = '#d93025';

type CategoryKey = 'personal' | 'school' | 'meeting' | 'trip';

export const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: 'personal', label: '개인' },
  { key: 'school', label: '학교' },
  { key: 'meeting', label: '회의' },
  { key: 'trip', label: '출장' },
];

// 서로 확실히 구분되는 기본 색: 개인=파랑, 학교=초록, 회의=노랑, 출장=빨강
export const DEFAULT_CATEGORY_COLORS: Record<CategoryKey, string> = {
  personal: '7',
  school: '10',
  meeting: '5',
  trip: '11',
};

export function categoryLabel(key: string | undefined): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? '';
}

export function resolveColor(colorId: string | undefined, category: string | undefined, catColors: Record<string, string>): string {
  if (colorId && GOOGLE_COLORS[colorId]) return GOOGLE_COLORS[colorId].hex;
  const c = category ? catColors[category] : undefined;
  if (c && GOOGLE_COLORS[c]) return GOOGLE_COLORS[c].hex;
  return DEFAULT_EVENT_COLOR;
}

/** 배경색 위 글자색 (밝은 노랑 등에는 검정 글자) */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#1f1f1f' : '#ffffff';
}
