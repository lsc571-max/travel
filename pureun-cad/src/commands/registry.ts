// 명령어 목록과 별칭 (AutoCAD 기본 별칭과 같게 유지)
import { DIMALIGNED, DIMDIAMETER, DIMLINEAR, DIMRADIUS, DIST, ID, LIST } from './dim';
import { ARC, CIRCLE, LINE, PLINE, RECTANG, TEXT } from './draw';
import { COPY, ERASE, MOVE, OFFSET, ROTATE, TRIM } from './modify';
import type { CommandDef, CommandFn, UiAction } from './types';

// 대화상자를 여는 명령 (입력 요청 없이 바로 끝남)
const uiCmd = (a: UiAction): CommandFn =>
  // eslint-disable-next-line require-yield
  function* (ctx) {
    ctx.ui(a);
  };

const ZOOM: CommandFn = function* (ctx) {
  const r = yield {
    kind: 'point',
    prompt: '윈도우 구석 지정',
    keywords: [
      { key: 'E', label: '범위(E)', alias: ['A'] },
      { key: 'W', label: '윈도우(W)' },
    ],
  };
  if (r.t === 'kw' && r.k === 'E') {
    ctx.ui('zoomExtents');
    return;
  }
  let a: { x: number; y: number } | null = r.t === 'point' ? r.p : null;
  if (!a) {
    const q = yield { kind: 'point', prompt: '첫 번째 구석 지정' };
    if (q.t !== 'point') return;
    a = q.p;
  }
  const p0 = a;
  const b = yield {
    kind: 'point',
    prompt: '반대 구석 지정',
    noRubber: true,
    preview: (p) => [
      { type: 'polyline', layer: '0', closed: true, pts: [ { x: p0.x, y: p0.y, b: 0 }, { x: p.x, y: p0.y, b: 0 }, { x: p.x, y: p.y, b: 0 }, { x: p0.x, y: p.y, b: 0 } ] },
    ],
  };
  if (b.t !== 'point') return;
  ctx.ui('zoomWindow', { minX: Math.min(p0.x, b.p.x), minY: Math.min(p0.y, b.p.y), maxX: Math.max(p0.x, b.p.x), maxY: Math.max(p0.y, b.p.y) });
};

export const COMMANDS: CommandDef[] = [
  { name: 'LINE', aliases: ['L'], label: '선', fn: LINE },
  { name: 'CIRCLE', aliases: ['C'], label: '원', fn: CIRCLE },
  { name: 'ARC', aliases: ['A'], label: '호', fn: ARC },
  { name: 'PLINE', aliases: ['PL'], label: '폴리선', fn: PLINE },
  { name: 'RECTANG', aliases: ['REC', 'RECTANGLE'], label: '직사각형', fn: RECTANG },
  { name: 'TEXT', aliases: ['DT', 'DTEXT'], label: '문자', fn: TEXT },
  { name: 'MOVE', aliases: ['M'], label: '이동', fn: MOVE, usesSelection: true },
  { name: 'COPY', aliases: ['CO', 'CP'], label: '복사', fn: COPY, usesSelection: true },
  { name: 'ROTATE', aliases: ['RO'], label: '회전', fn: ROTATE, usesSelection: true },
  { name: 'TRIM', aliases: ['TR'], label: '자르기', fn: TRIM },
  { name: 'OFFSET', aliases: ['O'], label: '간격띄우기', fn: OFFSET },
  { name: 'ERASE', aliases: ['E'], label: '지우기', fn: ERASE, usesSelection: true },
  { name: 'DIMLINEAR', aliases: ['DLI'], label: '선형 치수', fn: DIMLINEAR },
  { name: 'DIMALIGNED', aliases: ['DAL'], label: '정렬 치수', fn: DIMALIGNED },
  { name: 'DIMDIAMETER', aliases: ['DDI'], label: '지름 치수', fn: DIMDIAMETER },
  { name: 'DIMRADIUS', aliases: ['DRA'], label: '반지름 치수', fn: DIMRADIUS },
  { name: 'DIST', aliases: ['DI'], label: '거리 측정', fn: DIST },
  { name: 'ID', aliases: [], label: '좌표 확인', fn: ID },
  { name: 'LIST', aliases: ['LI', 'LS'], label: '객체 정보', fn: LIST, usesSelection: true },
  { name: 'ZOOM', aliases: ['Z'], label: '줌', fn: ZOOM },
  { name: 'LAYER', aliases: ['LA'], label: '레이어', fn: uiCmd('layer') },
  { name: 'HOLEDIA', aliases: ['HD'], label: '동일 지름 원 일괄 변경', fn: uiCmd('hole') },
  { name: 'OPTIONS', aliases: ['OP', 'SETTINGS'], label: '설정', fn: uiCmd('settings') },
  { name: 'OPEN', aliases: [], label: '열기', fn: uiCmd('open') },
  { name: 'QSAVE', aliases: ['SAVE'], label: '저장', fn: uiCmd('save') },
  { name: 'SAVEAS', aliases: [], label: '다른 이름으로 저장', fn: uiCmd('saveas') },
  { name: 'NEW', aliases: [], label: '새 도면', fn: uiCmd('new') },
  { name: 'HELP', aliases: ['?'], label: '명령어 도움말', fn: uiCmd('help') },
];

/** 실행취소 등 엔진이 직접 처리하는 명령 */
export const BUILTIN: Record<string, string[]> = {
  UNDO: ['U'],
  REDO: [],
};

const byName = new Map<string, CommandDef>();
for (const c of COMMANDS) {
  byName.set(c.name, c);
  for (const a of c.aliases) byName.set(a, c);
}
export const findCommand = (s: string) => byName.get(s.trim().toUpperCase());
