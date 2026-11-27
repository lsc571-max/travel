// 도면 문서: 객체 저장소, 레이어, 공간 인덱스, 실행취소/다시실행
import RBush from 'rbush';
import { entityBBox } from './entity';
import { unionBBox } from './geom';
import type { BBox, Entity, Layer, Linetype, NewEntity, PreservedBlock, PreservedEntity } from './types';

/** 기본 제공 선종류 (자체 정의 패턴, 도면 단위 mm 기준) */
export const DEFAULT_LTYPES: Linetype[] = [
  { name: 'CONTINUOUS', desc: 'Solid line', pattern: [] },
  { name: 'CENTER', desc: 'Center ____ _ ____ _', pattern: [12, -3, 2, -3] },
  { name: 'HIDDEN', desc: 'Hidden __ __ __', pattern: [4, -2] },
  { name: 'PHANTOM', desc: 'Phantom ____ _ _ ____', pattern: [12, -3, 2, -3, 2, -3] },
];

interface IndexItem extends BBox {
  id: number;
}

interface LayerState {
  layers: Layer[];
  current: string;
}

interface Transaction {
  label: string;
  /** id → [이전, 이후] (null = 없음) */
  ents: Map<number, [Entity | null, Entity | null]>;
  layersBefore?: LayerState;
  layersAfter?: LayerState;
  /** 보존 객체의 레이어명 변경(이름 바꾸기) 기록 */
  preservedBefore?: PreservedEntity[];
  preservedAfter?: PreservedEntity[];
}

export class Drawing {
  entities = new Map<number, Entity>();
  preserved: PreservedEntity[] = [];
  preservedBlocks: PreservedBlock[] = [];
  /** DXF 헤더 중 보존할 값(단위 등) */
  header: Record<string, string> = {};
  layers = new Map<string, Layer>();
  ltypes = new Map<string, Linetype>(DEFAULT_LTYPES.map((l) => [l.name.toUpperCase(), l]));
  ltscale = 1;
  currentLayer = '0';
  /** 변경될 때마다 증가 (화면 갱신 판단용) */
  version = 0;
  modified = false;
  fileName = '새 도면.dxf';

  private nextId = 1;
  private tree = new RBush<IndexItem>();
  private items = new Map<number, IndexItem>();
  private ptree = new RBush<IndexItem>();
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  private listeners = new Set<() => void>();
  readonly maxUndo = 200;

  constructor() {
    this.layers.set('0', { name: '0', color: 7, on: true, locked: false });
  }

  // ───── 구독 ─────
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }
  /** 외부 설정 변경(치수 형식 등) 후 인덱스 재구성 */
  reindex() {
    this.tree.clear();
    this.items.clear();
    const all: IndexItem[] = [];
    for (const e of this.entities.values()) {
      const it = { ...entityBBox(e), id: e.id };
      this.items.set(e.id, it);
      all.push(it);
    }
    this.tree.load(all);
    this.ptree.clear();
    const pall: IndexItem[] = [];
    for (const p of this.preserved) {
      if (!p.display?.length) continue;
      let bb: BBox | null = null;
      for (const d of p.display) bb = unionBBox(bb, entityBBox(d));
      if (bb) pall.push({ ...bb, id: p.id });
    }
    this.ptree.load(pall);
    this.emit();
  }

  newId() {
    return this.nextId++;
  }

  // ───── 조회 ─────
  get(id: number) {
    return this.entities.get(id);
  }
  layerOf(e: { layer: string }): Layer {
    return this.layers.get(e.layer) ?? { name: e.layer, color: 7, on: true, locked: false };
  }
  isVisible(e: { layer: string }) {
    return this.layerOf(e).on;
  }
  isEditable(e: { layer: string }) {
    const l = this.layerOf(e);
    return l.on && !l.locked;
  }
  /** 경계상자와 겹치는 객체 id */
  query(bb: BBox): number[] {
    return this.tree.search(bb).map((i) => i.id);
  }
  queryPreserved(bb: BBox): PreservedEntity[] {
    const found = this.ptree.search(bb);
    if (!found.length) return [];
    const ids = new Set(found.map((i) => i.id));
    return this.preserved.filter((p) => ids.has(p.id));
  }
  extents(): BBox | null {
    let bb: BBox | null = null;
    if (this.entities.size) {
      const all = this.tree.all();
      // tree.all()은 모든 항목 → 경계 합집합
      for (const it of all) {
        if (!this.isVisible(this.entities.get(it.id)!)) continue;
        bb = unionBBox(bb, it);
      }
    }
    const pmap = new Map(this.preserved.map((q) => [q.id, q]));
    for (const it of this.ptree.all()) {
      const p = pmap.get(it.id);
      if (p && this.isVisible(p)) bb = unionBBox(bb, it);
    }
    return bb;
  }
  bboxOf(id: number): BBox | undefined {
    return this.items.get(id);
  }

  // ───── 내부 적용 ─────
  private put(e: Entity) {
    const old = this.items.get(e.id);
    if (old) this.tree.remove(old);
    this.entities.set(e.id, e);
    const it = { ...entityBBox(e), id: e.id };
    this.items.set(e.id, it);
    this.tree.insert(it);
  }
  private del(id: number) {
    const old = this.items.get(id);
    if (old) this.tree.remove(old);
    this.items.delete(id);
    this.entities.delete(id);
  }
  private layerState(): LayerState {
    return { layers: [...this.layers.values()].map((l) => ({ ...l })), current: this.currentLayer };
  }
  private applyLayerState(s: LayerState) {
    this.layers = new Map(s.layers.map((l) => [l.name, { ...l }]));
    this.currentLayer = s.current;
  }

  // ───── 트랜잭션 ─────
  tx(label: string) {
    return new TxBuilder(this, label);
  }

  /** @internal TxBuilder가 호출 */
  _commit(t: Transaction) {
    if (!t.ents.size && !t.layersAfter && !t.preservedAfter) return false;
    for (const [id, [, after]] of t.ents) {
      if (after) this.put(after);
      else this.del(id);
    }
    if (t.layersAfter) this.applyLayerState(t.layersAfter);
    if (t.preservedAfter) {
      this.preserved = t.preservedAfter;
      this.reindexPreserved();
    }
    this.undoStack.push(t);
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
    this.redoStack = [];
    this.modified = true;
    this.emit();
    return true;
  }
  /** @internal */
  _layerState() {
    return this.layerState();
  }

  private reindexPreserved() {
    this.ptree.clear();
    const pall: IndexItem[] = [];
    for (const p of this.preserved) {
      if (!p.display?.length) continue;
      let bb: BBox | null = null;
      for (const d of p.display) bb = unionBBox(bb, entityBBox(d));
      if (bb) pall.push({ ...bb, id: p.id });
    }
    this.ptree.load(pall);
  }

  // ───── 명령 단위 묶음: 한 명령에서 생긴 여러 커밋을 실행취소 1회로 묶음 ─────
  private groupStart = -1;
  private groupLabel = '';
  beginGroup(label: string) {
    if (this.groupStart >= 0) this.endGroup();
    this.groupStart = this.undoStack.length;
    this.groupLabel = label;
  }
  /** 현재 묶음 안에서 되돌릴 수 있는 단계 수 */
  groupDepth() {
    return this.groupStart < 0 ? 0 : this.undoStack.length - this.groupStart;
  }
  endGroup() {
    const start = this.groupStart;
    this.groupStart = -1;
    if (start < 0 || this.undoStack.length - start <= 1) {
      if (start >= 0 && this.undoStack.length - start === 1) this.undoStack[start].label = this.groupLabel;
      return;
    }
    const parts = this.undoStack.splice(start);
    const merged: Transaction = { label: this.groupLabel, ents: new Map() };
    for (const t of parts) {
      for (const [id, [b, a]] of t.ents) {
        const prev = merged.ents.get(id);
        if (prev) prev[1] = a;
        else merged.ents.set(id, [b, a]);
      }
      if (t.layersAfter) {
        if (!merged.layersBefore) merged.layersBefore = t.layersBefore;
        merged.layersAfter = t.layersAfter;
      }
      if (t.preservedAfter) {
        if (!merged.preservedBefore) merged.preservedBefore = t.preservedBefore;
        merged.preservedAfter = t.preservedAfter;
      }
    }
    // 추가 후 삭제된 객체는 기록에서 제거
    for (const [id, [b, a]] of merged.ents) if (!b && !a) merged.ents.delete(id);
    this.undoStack.push(merged);
  }

  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }
  undoLabel() {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }
  redoLabel() {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }

  undo(): string | null {
    const t = this.undoStack.pop();
    if (!t) return null;
    for (const [id, [before]] of t.ents) {
      if (before) this.put(before);
      else this.del(id);
    }
    if (t.layersBefore) this.applyLayerState(t.layersBefore);
    if (t.preservedBefore) {
      this.preserved = t.preservedBefore;
      this.reindexPreserved();
    }
    this.redoStack.push(t);
    this.modified = true;
    this.emit();
    return t.label;
  }

  redo(): string | null {
    const t = this.redoStack.pop();
    if (!t) return null;
    for (const [id, [, after]] of t.ents) {
      if (after) this.put(after);
      else this.del(id);
    }
    if (t.layersAfter) this.applyLayerState(t.layersAfter);
    if (t.preservedAfter) {
      this.preserved = t.preservedAfter;
      this.reindexPreserved();
    }
    this.undoStack.push(t);
    this.modified = true;
    this.emit();
    return t.label;
  }

  /** 새 문서 내용으로 교체 (파일 열기). 실행취소 기록 초기화 */
  load(data: {
    entities: NewEntity[];
    layers: Layer[];
    preserved?: Omit<PreservedEntity, 'id'>[];
    preservedBlocks?: PreservedBlock[];
    header?: Record<string, string>;
    fileName?: string;
    ltypes?: Linetype[];
  }) {
    this.ltypes = new Map(DEFAULT_LTYPES.map((l) => [l.name.toUpperCase(), l]));
    for (const l of data.ltypes ?? []) this.ltypes.set(l.name.toUpperCase(), l);
    this.ltscale = Number(data.header?.['$LTSCALE'] ?? 1) || 1;
    this.entities.clear();
    this.items.clear();
    this.tree.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.nextId = 1;
    this.layers = new Map();
    this.layers.set('0', { name: '0', color: 7, on: true, locked: false });
    for (const l of data.layers) this.layers.set(l.name, { ...l });
    for (const e of data.entities) {
      if (!this.layers.has(e.layer)) this.layers.set(e.layer, { name: e.layer, color: 7, on: true, locked: false });
      const ent = { ...e, id: this.nextId++ } as Entity;
      this.entities.set(ent.id, ent);
    }
    this.preserved = (data.preserved ?? []).map((p) => {
      if (!this.layers.has(p.layer)) this.layers.set(p.layer, { name: p.layer, color: 7, on: true, locked: false });
      return { ...p, id: this.nextId++ };
    });
    this.preservedBlocks = data.preservedBlocks ?? [];
    this.header = data.header ?? {};
    this.currentLayer = this.layers.has(this.currentLayer) ? this.currentLayer : '0';
    if (!this.layers.get(this.currentLayer)) this.currentLayer = '0';
    this.fileName = data.fileName ?? '새 도면.dxf';
    this.modified = false;
    this.reindex();
  }

  clear() {
    this.load({ entities: [], layers: [] });
  }

  /** 레이어별 객체 수 (보존 객체 포함) */
  layerUsage(): Map<string, number> {
    const m = new Map<string, number>();
    for (const e of this.entities.values()) m.set(e.layer, (m.get(e.layer) ?? 0) + 1);
    for (const p of this.preserved) m.set(p.layer, (m.get(p.layer) ?? 0) + 1);
    return m;
  }
}

export class TxBuilder {
  private t: Transaction;
  /** 잠긴 레이어 때문에 거부된 개수 */
  rejected = 0;
  constructor(
    private doc: Drawing,
    label: string,
  ) {
    this.t = { label, ents: new Map() };
  }
  private record(id: number, before: Entity | null, after: Entity | null) {
    const prev = this.t.ents.get(id);
    if (prev) prev[1] = after;
    else this.t.ents.set(id, [before, after]);
  }
  private current(id: number): Entity | null {
    const p = this.t.ents.get(id);
    return p ? p[1] : (this.doc.get(id) ?? null);
  }
  add(e: NewEntity): number {
    const layer = this.doc.layers.get(e.layer);
    if (layer?.locked) {
      // AutoCAD와 같이 잠긴 레이어에도 새 객체 작성은 허용
    }
    const id = this.doc.newId();
    this.record(id, null, { ...e, id } as Entity);
    return id;
  }
  update(e: Entity, opts?: { allowLocked?: boolean }): boolean {
    const cur = this.current(e.id);
    if (!cur) return false;
    if (!opts?.allowLocked && this.doc.layerOf(cur).locked) {
      this.rejected++;
      return false;
    }
    this.record(e.id, this.doc.get(e.id) ?? null, e);
    return true;
  }
  remove(id: number): boolean {
    const cur = this.current(id);
    if (!cur) return false;
    if (this.doc.layerOf(cur).locked) {
      this.rejected++;
      return false;
    }
    this.record(id, this.doc.get(id) ?? null, null);
    return true;
  }
  setLayers(layers: Layer[], current: string) {
    if (!this.t.layersBefore) this.t.layersBefore = this.doc._layerState();
    this.t.layersAfter = { layers: layers.map((l) => ({ ...l })), current };
  }
  setPreserved(p: PreservedEntity[]) {
    if (!this.t.preservedBefore) this.t.preservedBefore = this.doc.preserved;
    this.t.preservedAfter = p;
  }
  /** 이번 트랜잭션에서 추가된 객체 id */
  addedIds(): number[] {
    return [...this.t.ents.entries()].filter(([, [b, a]]) => !b && a).map(([id]) => id);
  }
  get size() {
    return this.t.ents.size;
  }
  commit(): boolean {
    return this.doc._commit(this.t);
  }
}
