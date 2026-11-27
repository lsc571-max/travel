// 명령어 엔진 공통 형식
// 각 명령은 제너레이터 함수로 작성한다. yield 로 입력을 요청하고, 엔진이 사용자 입력으로 재개한다.
import type { Drawing } from '../core/document';
import type { NewEntity, Vec2 } from '../core/types';

export interface Keyword {
  /** 반환 값 (예: 'C') */
  key: string;
  /** 표시 이름 (예: '닫기(C)') */
  label: string;
  /** 추가로 인식할 입력 (예: ['CLOSE']) */
  alias?: string[];
}

interface ReqBase {
  prompt: string;
  keywords?: Keyword[];
  /** 커서 위치에 따른 미리보기 형상 */
  preview?: (p: Vec2) => NewEntity[];
  /** Enter(빈 입력) 허용 */
  allowNone?: boolean;
}

export interface PointReq extends ReqBase {
  kind: 'point';
  /** 고무줄 선·직교·직접거리 입력의 기준점 */
  base?: Vec2;
  /** 숫자만 입력하면 {t:'num'} 으로 반환 (예: 원 반지름) */
  acceptNumber?: boolean;
  noRubber?: boolean;
}
export interface DistReq extends ReqBase {
  kind: 'dist';
  base?: Vec2;
  def?: number;
}
export interface AngleReq extends ReqBase {
  kind: 'angle';
  base: Vec2;
  def?: number;
}
export interface SelectReq extends ReqBase {
  kind: 'select';
}
export interface EntityReq extends ReqBase {
  kind: 'entity';
  filter?: (id: number) => boolean;
}
export interface StringReq extends ReqBase {
  kind: 'string';
  def?: string;
}

export type Req = PointReq | DistReq | AngleReq | SelectReq | EntityReq | StringReq;

export type Resp =
  | { t: 'point'; p: Vec2 }
  | { t: 'num'; n: number }
  | { t: 'kw'; k: string }
  | { t: 'none' }
  | { t: 'ids'; ids: number[] }
  | { t: 'ent'; id: number; p: Vec2 }
  | { t: 'str'; s: string };

export interface Settings {
  osnap: boolean;
  ortho: boolean;
  grid: boolean;
  snapModes: { end: boolean; mid: boolean; cen: boolean; int: boolean; qua: boolean };
  /** 좌표·거리 표시 소수 자릿수 */
  decimals: number;
  /** 치수 문자 소수 자릿수 */
  dimDecimals: number;
  dimTextH: number;
  dimArrow: number;
  textH: number;
  /** 선택 상자 크기(px) */
  pickbox: number;
  /** 스냅 감지 범위(px) */
  aperture: number;
  theme: 'dark' | 'light';
  /** 동일 지름 판정 허용오차(mm) */
  holeTol: number;
  autosave: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  osnap: true,
  ortho: false,
  grid: false,
  snapModes: { end: true, mid: true, cen: true, int: true, qua: false },
  decimals: 4,
  dimDecimals: 2,
  dimTextH: 3.5,
  dimArrow: 3,
  textH: 3.5,
  pickbox: 7,
  aperture: 12,
  theme: 'dark',
  holeTol: 0.0001,
  autosave: true,
};

export interface Ctx {
  doc: Drawing;
  settings: Settings;
  log(msg: string): void;
  /** 화면 표시 형식 */
  fmt(n: number): string;
  fmtPt(p: Vec2): string;
  lastPoint: Vec2 | null;
  /** 명령 시작 시 이미 선택되어 있던(편집 가능한) 객체 */
  takePreselection(): number[];
  setSelection(ids: number[]): void;
  /** 잠긴/숨겨진 레이어 객체를 걸러냄 */
  editable(ids: number[]): number[];
  ui(action: UiAction, arg?: unknown): void;
}

export type UiAction = 'layer' | 'settings' | 'hole' | 'open' | 'save' | 'saveas' | 'new' | 'help' | 'zoomExtents' | 'zoomWindow' | 'share' | 'version';

export type CommandFn = (ctx: Ctx) => Generator<Req, void, Resp>;

export interface CommandDef {
  name: string;
  aliases: string[];
  label: string;
  fn: CommandFn;
  /** 선택 후 실행(pickfirst) 지원 */
  usesSelection?: boolean;
}
