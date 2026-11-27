// 푸른캐드 핵심 데이터 형식
// 모든 좌표·길이는 64비트 부동소수(JS number) 그대로 저장한다. 내부 반올림 금지.
// 원호 각도는 DXF와 동일하게 "도(degree), 반시계 방향"으로 저장하여 왕복 시 오차를 만들지 않는다.

export interface Vec2 {
  x: number;
  y: number;
}

/** ACI 색상 번호. 256 = BYLAYER, 0 = BYBLOCK */
export type Aci = number;

interface EntityBase {
  id: number;
  layer: string;
  /** 객체 색상(ACI). 생략/256이면 레이어 색상 */
  color?: Aci;
  /** 선종류 이름. 생략 = BYLAYER */
  ltype?: string;
}

export interface LineEnt extends EntityBase {
  type: 'line';
  p1: Vec2;
  p2: Vec2;
}

export interface CircleEnt extends EntityBase {
  type: 'circle';
  c: Vec2;
  r: number;
}

export interface ArcEnt extends EntityBase {
  type: 'arc';
  c: Vec2;
  r: number;
  /** 시작각(도), 반시계 */
  a0: number;
  /** 끝각(도), 반시계 */
  a1: number;
}

/** 폴리선 정점. b = bulge(볼록률) = tan(사이각/4), 양수=반시계 호 */
export interface PVertex {
  x: number;
  y: number;
  b: number;
  /** 시작/끝 폭 (DXF 40/41, 보존용) */
  sw?: number;
  ew?: number;
}

export interface PolylineEnt extends EntityBase {
  type: 'polyline';
  pts: PVertex[];
  closed: boolean;
  /** 고정 폭 (DXF 43, 보존용) */
  width?: number;
}

export interface TextEnt extends EntityBase {
  type: 'text';
  p: Vec2;
  h: number;
  text: string;
  /** 회전각(도) */
  rot: number;
  /** DXF 72(수평 정렬), 73(수직 정렬), 11(정렬점) 보존 */
  hAlign?: number;
  vAlign?: number;
  p2?: Vec2;
  /** 문자 스타일 이름(DXF 7), 폭 비율(41), 기울기(51) 보존 */
  style?: string;
  wf?: number;
  oblique?: number;
}

export type DimKind = 'linear' | 'aligned' | 'diameter' | 'radius';

export interface DimensionEnt extends EntityBase {
  type: 'dimension';
  kind: DimKind;
  /** linear/aligned: 첫 번째 치수보조선 원점(DXF 13). radius/diameter: 원 중심 */
  p1: Vec2;
  /** linear/aligned: 두 번째 원점(DXF 14). radius/diameter: 원 위의 점(DXF 15) */
  p2: Vec2;
  /** 치수선 위치(linear/aligned) 또는 문자 위치(radius/diameter) */
  loc: Vec2;
  /** linear 전용: 치수선 방향(도). 0=수평, 90=수직 */
  rot?: number;
  /** 문자 재지정. 비어 있으면 측정값 */
  textOverride?: string;
  /** 문자 높이 */
  h: number;
  /** 화살표 크기 */
  arrow: number;
  /** 치수 스타일 이름(DXF 3) 보존 */
  dimstyle?: string;
}

export type Entity = LineEnt | CircleEnt | ArcEnt | PolylineEnt | TextEnt | DimensionEnt;

/** 미지원 DXF 객체: 원본 그룹코드를 그대로 보존 */
export interface DxfPair {
  code: number;
  value: string;
}

export interface PreservedEntity {
  id: number;
  dxfType: string;
  layer: string;
  pairs: DxfPair[];
  /** 화면 표시 전용 형상(블록 참조 등). 편집 불가 */
  display?: Entity[];
}

export interface PreservedBlock {
  name: string;
  /** BLOCK ~ ENDBLK 전체 그룹코드(원본 그대로) */
  pairs: DxfPair[];
}

export interface Layer {
  name: string;
  color: Aci;
  on: boolean;
  locked: boolean;
  /** 선종류 이름 (기본 CONTINUOUS) */
  ltype?: string;
  /** DXF에서 동결(frozen) 상태였는지 (저장 시 보존) */
  frozen?: boolean;
}

/** 선종류 정의. pattern: 양수=선, 음수=공백, 0=점 (도면 단위) */
export interface Linetype {
  name: string;
  desc: string;
  pattern: number[];
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 엔티티를 id 없이 만들 때 사용 */
export type NewEntity = DistributiveOmit<Entity, 'id'>;
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
