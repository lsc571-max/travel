// 명령어 엔진: 마우스·키보드·명령창 입력을 해석하여 명령 제너레이터에 전달
import { parseCoord, isNumber } from '../core/coords';
import { Drawing } from '../core/document';
import { distToEntity, entityBBox, pickSegs, pointInPoly, setDimFormatter, textAnchor, textCorners } from '../core/entity';
import { fmtNum } from '../core/format';
import { angleOf, bboxInside, bboxOverlap, DEG, dist, normDeg, segStart, v } from '../core/geom';
import { segIntersect } from '../core/intersect';
import { findSnap, type SnapResult } from '../core/snap';
import type { BBox, Entity, Vec2 } from '../core/types';
import { View } from '../render/view';
import { BUILTIN, findCommand } from './registry';
import { DEFAULT_SETTINGS, type Ctx, type Req, type Resp, type Settings, type UiAction } from './types';

interface ActiveCmd {
  name: string;
  gen: Generator<Req, void, Resp>;
  req: Req | null;
}

export interface WindowSel {
  s: Vec2;
  w: Vec2;
  dragged: boolean;
}

export class Engine {
  doc = new Drawing();
  view = new View();
  settings: Settings = structuredClone(DEFAULT_SETTINGS);
  sel = new Set<number>();
  history: string[] = ['푸른캐드에 오신 것을 환영합니다. 명령어(예: L, C, PL, TR, O) 또는 도구 버튼을 사용하십시오. 도움말: HELP'];
  cmd: ActiveCmd | null = null;
  lastCmdName: string | null = null;
  lastPoint: Vec2 | null = null;
  cursorS: Vec2 | null = null;
  cursorW: Vec2 = { x: 0, y: 0 };
  snap: SnapResult | null = null;
  hover: number | null = null;
  win: WindowSel | null = null;
  /** dist 요청에서 첫 번째 점 */
  distFirst: Vec2 | null = null;
  dirty = { base: true, sel: true, over: true };
  uiHandler: (a: UiAction, arg?: unknown) => void = () => {};
  /** 다른 화면 요소(React) 갱신용 */
  ver = 0;
  /** 마지막 화면 이동/확대 시각 (대형 도면에서 이동 중 비트맵 재사용 판단) */
  interactAt = 0;

  private listeners = new Set<() => void>();
  private preselection: number[] = [];
  private panLast: Vec2 | null = null;
  readonly ctx: Ctx;

  constructor() {
    this.applySettings();
    this.doc.subscribe(() => {
      // 지워진 객체는 선택에서 제거
      for (const id of [...this.sel]) if (!this.doc.get(id)) this.sel.delete(id);
      this.dirty.base = this.dirty.sel = this.dirty.over = true;
      this.notify();
    });
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.ctx = {
      doc: this.doc,
      get settings() {
        return self.settings;
      },
      log: (m) => this.log(m),
      fmt: (n) => fmtNum(n, this.settings.decimals),
      fmtPt: (p) => `(${fmtNum(p.x, this.settings.decimals)}, ${fmtNum(p.y, this.settings.decimals)})`,
      get lastPoint() {
        return self.lastPoint;
      },
      set lastPoint(p) {
        self.lastPoint = p;
      },
      takePreselection: () => {
        const p = this.preselection;
        this.preselection = [];
        return p;
      },
      setSelection: (ids) => this.setSelection(ids),
      editable: (ids) => this.editable(ids),
      ui: (a, arg) => this.ui(a, arg),
    };
  }

  // ───────── 상태 알림 ─────────
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  notify() {
    this.ver++;
    for (const f of this.listeners) f();
  }
  log(m: string) {
    this.history.push(m);
    if (this.history.length > 300) this.history.splice(0, this.history.length - 300);
    this.notify();
  }
  applySettings() {
    setDimFormatter((n) => fmtNum(n, this.settings.dimDecimals));
    this.doc.reindex();
    this.dirty.base = this.dirty.sel = this.dirty.over = true;
    this.notify();
  }
  ui(a: UiAction, arg?: unknown) {
    if (a === 'zoomExtents') this.zoomExtents();
    else if (a === 'zoomWindow') {
      this.view.fit(arg as BBox, 0.02);
      this.redrawAll();
    } else {
      // 대화상자·파일 동작은 현재 명령이 끝난 뒤 실행 (실행 중인 명령 제너레이터 재진입 방지)
      setTimeout(() => this.uiHandler(a, arg), 0);
    }
  }
  redrawAll() {
    this.dirty.base = this.dirty.sel = this.dirty.over = true;
    this.notify();
  }
  zoomExtents() {
    const bb = this.doc.extents();
    if (bb) this.view.fit(bb);
    else {
      this.view.scale = 4;
      this.view.cx = this.view.w / 8;
      this.view.cy = this.view.h / 8;
    }
    this.redrawAll();
  }

  // ───────── 선택 ─────────
  setSelection(ids: number[]) {
    this.sel = new Set(ids);
    this.dirty.sel = true;
    this.notify();
  }
  editable(ids: number[]): number[] {
    const out: number[] = [];
    let locked = 0;
    for (const id of ids) {
      const e = this.doc.get(id);
      if (!e || !this.doc.isVisible(e)) continue;
      if (this.doc.layerOf(e).locked) locked++;
      else out.push(id);
    }
    if (locked) this.log(`${locked}개 객체가 잠긴 레이어에 있어 제외되었습니다.`);
    return out;
  }
  /** 화면 점에서 가장 가까운 객체 */
  pickAt(s: Vec2, filter?: (e: Entity) => boolean): number | null {
    const w = this.view.toWorld(s);
    const tol = this.settings.pickbox / this.view.scale;
    const bb = { minX: w.x - tol, minY: w.y - tol, maxX: w.x + tol, maxY: w.y + tol };
    let best: number | null = null;
    let bd = Infinity;
    for (const id of this.doc.query(bb)) {
      const e = this.doc.get(id)!;
      if (!this.doc.isVisible(e)) continue;
      if (filter && !filter(e)) continue;
      const d = distToEntity(e, w);
      if (d <= tol && d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  }
  /** 창(윈도우)/걸치기(크로싱) 선택 */
  windowSelect(a: Vec2, b: Vec2, crossing: boolean): number[] {
    const r: BBox = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
    const out: number[] = [];
    const corners = [v(r.minX, r.minY), v(r.maxX, r.minY), v(r.maxX, r.maxY), v(r.minX, r.maxY)];
    const edges = corners.map((c, i) => ({ kind: 'line' as const, a: c, b: corners[(i + 1) % 4] }));
    for (const id of this.doc.query(r)) {
      const e = this.doc.get(id)!;
      if (!this.doc.isVisible(e)) continue;
      const bb = this.doc.bboxOf(id) ?? entityBBox(e);
      if (bboxInside(bb, r)) {
        out.push(id);
        continue;
      }
      if (!crossing || !bboxOverlap(bb, r)) continue;
      const segs = pickSegs(e);
      let hit = segs.some((s) => {
        const p = segStart(s);
        if (p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY) return true;
        return edges.some((ed) => segIntersect(s, ed).length > 0);
      });
      if (!hit && e.type === 'text') {
        const an = textAnchor(e);
        hit = pointInPoly(corners[0], textCorners(an.p, e.h, e.rot, e.text, an.anchor));
      }
      if (hit) out.push(id);
    }
    return out;
  }

  // ───────── 명령 실행 ─────────
  get req(): Req | null {
    return this.cmd?.req ?? null;
  }
  promptText(): string {
    const r = this.req;
    if (!r) return '명령:';
    const kw = r.keywords?.length ? ` [${r.keywords.map((k) => k.label).join(' / ')}]` : '';
    return `${r.prompt}${kw}:`;
  }

  run(input: string) {
    const name = input.trim().toUpperCase();
    if (!name) return;
    if (this.cmd) this.cancel(true);
    if (name === 'UNDO' || BUILTIN.UNDO.includes(name)) return this.undo();
    if (name === 'REDO') return this.redo();
    const def = findCommand(name);
    if (!def) {
      this.log(`알 수 없는 명령 "${input.trim()}". HELP 를 입력하면 명령 목록을 볼 수 있습니다.`);
      return;
    }
    this.lastCmdName = def.name;
    this.log(`명령: ${def.name}`);
    this.preselection = def.usesSelection ? this.editable([...this.sel]) : [];
    if (!def.usesSelection && this.sel.size) this.setSelection([]);
    this.doc.beginGroup(def.name);
    this.win = null;
    const gen = def.fn(this.ctx);
    this.cmd = { name: def.name, gen, req: null };
    this.step(() => gen.next(undefined as unknown as Resp));
  }

  private step(fn: () => IteratorResult<Req, void>) {
    if (!this.cmd) return;
    let r: IteratorResult<Req, void>;
    try {
      r = fn();
    } catch (err) {
      console.error(err);
      this.log(`오류: ${(err as Error).message ?? err}. 명령을 종료합니다. (도면 원본 데이터는 변경되지 않았습니다)`);
      this.finish();
      return;
    }
    if (r.done) this.finish();
    else {
      this.cmd.req = r.value;
      this.distFirst = null;
      this.refreshCursor();
      this.dirty.over = true;
      this.notify();
    }
  }
  private finish() {
    this.doc.endGroup();
    this.cmd = null;
    this.preselection = [];
    this.snap = null;
    this.distFirst = null;
    this.dirty.over = this.dirty.sel = true;
    this.notify();
  }
  private feed(resp: Resp) {
    if (!this.cmd) return;
    if (resp.t === 'point') this.lastPoint = resp.p;
    const gen = this.cmd.gen;
    this.step(() => gen.next(resp));
  }
  cancel(silent = false) {
    if (this.cmd) {
      const gen = this.cmd.gen;
      try {
        gen.return(undefined);
      } catch (err) {
        console.error(err);
      }
      this.finish();
      if (!silent) this.log('*취소*');
    } else {
      this.win = null;
      if (this.sel.size) this.setSelection([]);
    }
    this.dirty.over = true;
    this.notify();
  }
  undo() {
    if (this.cmd) this.cancel(true);
    const l = this.doc.undo();
    this.log(l ? `실행취소: ${l}` : '더 이상 실행취소할 작업이 없습니다.');
  }
  redo() {
    if (this.cmd) this.cancel(true);
    const l = this.doc.redo();
    this.log(l ? `다시실행: ${l}` : '다시실행할 작업이 없습니다.');
  }

  /** 명령창 입력(Enter/Space) */
  submit(text: string) {
    const t = text.trim();
    if (!this.cmd) {
      if (!t) {
        if (this.lastCmdName) this.run(this.lastCmdName);
        return;
      }
      this.run(t);
      return;
    }
    const req = this.cmd.req!;
    if (!t && req.kind !== 'string') return this.enterEmpty();
    this.log(`${this.promptText()} ${text}`);
    if (req.kind !== 'string' && req.keywords) {
      const up = t.toUpperCase();
      const k = req.keywords.find((kw) => kw.key.toUpperCase() === up || kw.alias?.some((a) => a.toUpperCase() === up));
      if (k) return this.feed({ t: 'kw', k: k.key });
    }
    switch (req.kind) {
      case 'string':
        return this.feed({ t: 'str', s: text });
      case 'point': {
        if (req.acceptNumber && isNumber(t)) return this.feed({ t: 'num', n: Number(t) });
        const c = parseCoord(t, this.lastPoint);
        if (c.kind === 'point') return this.feed({ t: 'point', p: c.p });
        if (c.kind === 'distance' && req.base) {
          const p = this.directDistance(req.base, c.d);
          if (p) return this.feed({ t: 'point', p });
          return this.log('방향을 알 수 없습니다. 커서를 원하는 방향으로 옮긴 뒤 거리를 입력하십시오.');
        }
        return this.log(c.kind === 'invalid' ? c.reason : '점을 지정하십시오 (예: 100,50 / @20,0 / @50<45).');
      }
      case 'dist': {
        if (isNumber(t)) return this.feed({ t: 'num', n: Number(t) });
        const c = parseCoord(t, this.lastPoint);
        if (c.kind === 'point') return this.distPoint(c.p);
        return this.log('거리(숫자)를 입력하거나 두 점을 지정하십시오.');
      }
      case 'angle': {
        if (isNumber(t)) return this.feed({ t: 'num', n: Number(t) });
        const c = parseCoord(t, this.lastPoint);
        if (c.kind === 'point') return this.feed({ t: 'num', n: normDeg(angleOf(req.base, c.p) / DEG) });
        return this.log('각도(도)를 입력하십시오.');
      }
      case 'select': {
        if (['ALL', '전체', 'A'].includes(t.toUpperCase())) {
          const ids = [...this.doc.entities.keys()];
          this.setSelection(this.editable(ids));
          return this.log(`${this.sel.size}개 선택됨`);
        }
        return this.log('객체를 클릭하거나 창으로 선택한 뒤 Enter를 누르십시오. (ALL: 전체)');
      }
      case 'entity':
        return this.log('객체를 클릭하여 선택하십시오.');
    }
  }
  private enterEmpty() {
    const req = this.cmd!.req!;
    switch (req.kind) {
      case 'select':
        return this.feed({ t: 'ids', ids: [...this.sel] });
      case 'dist':
      case 'angle':
        if (req.def !== undefined) return this.feed({ t: 'num', n: req.def });
        break;
      case 'string':
        return this.feed({ t: 'str', s: '' });
    }
    if (req.allowNone) return this.feed({ t: 'none' });
  }
  private directDistance(base: Vec2, d: number): Vec2 | null {
    const tgt = this.effectivePoint(false);
    const L = dist(base, tgt);
    if (L < 1e-12) return null;
    // 직교 모드면 축 방향 그대로, 아니면 커서 방향
    const ux = (tgt.x - base.x) / L, uy = (tgt.y - base.y) / L;
    return { x: base.x + ux * d, y: base.y + uy * d };
  }
  private distPoint(p: Vec2) {
    const req = this.cmd!.req as Extract<Req, { kind: 'dist' }>;
    const b = req.base ?? this.distFirst;
    if (b) return this.feed({ t: 'num', n: dist(b, p) });
    this.distFirst = p;
    this.log('두 번째 점 지정:');
    this.dirty.over = true;
    this.notify();
  }

  // ───────── 커서·스냅 ─────────
  /** 기준점(고무줄·직교 기준) */
  reqBase(): Vec2 | null {
    const r = this.req;
    if (!r) return null;
    if (r.kind === 'point' || r.kind === 'angle') return r.base ?? null;
    if (r.kind === 'dist') return r.base ?? this.distFirst;
    return null;
  }
  needsPoint() {
    const k = this.req?.kind;
    return k === 'point' || k === 'dist' || k === 'angle';
  }
  /** 스냅·직교가 반영된 현재 점 */
  effectivePoint(useSnap = true): Vec2 {
    if (useSnap && this.snap) return this.snap.p;
    const p = this.cursorW;
    const b = this.reqBase();
    if (this.settings.ortho && b) {
      return Math.abs(p.x - b.x) >= Math.abs(p.y - b.y) ? { x: p.x, y: b.y } : { x: b.x, y: p.y };
    }
    return p;
  }
  refreshCursor() {
    if (!this.cursorS) return;
    this.cursorW = this.view.toWorld(this.cursorS);
    this.snap = null;
    this.hover = null;
    if (this.needsPoint()) {
      if (this.settings.osnap) this.snap = findSnap(this.doc, this.cursorW, this.settings.aperture / this.view.scale, this.settings.snapModes);
    } else if (!this.win) {
      const r = this.req;
      const filter = r?.kind === 'entity' && r.filter ? (e: Entity) => r.filter!(e.id) : undefined;
      this.hover = this.pickAt(this.cursorS, filter);
    }
  }

  // ───────── 마우스 ─────────
  pointerMove(s: Vec2) {
    if (this.panLast) {
      this.view.panPx(s.x - this.panLast.x, s.y - this.panLast.y);
      this.panLast = s;
      this.interactAt = performance.now();
      this.dirty.base = this.dirty.sel = true;
    }
    this.cursorS = s;
    if (this.win && dist(this.win.s, s) > 4) this.win.dragged = true;
    this.refreshCursor();
    this.dirty.over = true;
    this.notify();
  }
  pointerLeave() {
    this.cursorS = null;
    this.snap = null;
    this.hover = null;
    this.dirty.over = true;
    this.notify();
  }
  pointerDown(s: Vec2, button: number, shift: boolean) {
    if (button === 1) {
      this.panLast = s;
      return;
    }
    if (button === 2) {
      // 오른쪽 클릭 = Enter
      if (this.cmd) this.submit('');
      else if (this.lastCmdName) this.run(this.lastCmdName);
      return;
    }
    this.cursorS = s;
    this.refreshCursor();
    const req = this.req;
    if (req && this.needsPoint()) {
      const p = this.effectivePoint();
      if (req.kind === 'point') this.feed({ t: 'point', p });
      else if (req.kind === 'angle') this.feed({ t: 'num', n: normDeg(angleOf(req.base, p) / DEG) });
      else this.distPoint(p);
      return;
    }
    if (req?.kind === 'entity') {
      const id = this.pickAt(s, req.filter ? (e) => req.filter!(e.id) : undefined);
      if (id === null) {
        const any = this.pickAt(s);
        this.log(any !== null ? '이 명령에 사용할 수 없는 객체입니다.' : '선택된 객체가 없습니다.');
        return;
      }
      this.feed({ t: 'ent', id, p: this.view.toWorld(s) });
      return;
    }
    if (req?.kind === 'string') return;
    // 선택 (명령 대기 상태 또는 객체 선택 요청)
    if (this.win) {
      this.finishWindow(s, shift);
      return;
    }
    const id = this.pickAt(s);
    if (id !== null) {
      const next = new Set(this.sel);
      if (shift) next.delete(id);
      else {
        const e = this.doc.get(id)!;
        if (this.doc.layerOf(e).locked) {
          this.log('잠긴 레이어의 객체는 선택할 수 없습니다.');
          return;
        }
        next.add(id);
      }
      this.sel = next;
      this.dirty.sel = true;
      this.notify();
      return;
    }
    this.win = { s, w: this.view.toWorld(s), dragged: false };
    this.dirty.over = true;
  }
  pointerUp(s: Vec2, button: number, shift: boolean) {
    if (button === 1) {
      this.panLast = null;
      return;
    }
    if (this.win?.dragged) this.finishWindow(s, shift);
  }
  private finishWindow(s: Vec2, shift: boolean) {
    const w = this.win!;
    this.win = null;
    const crossing = s.x < w.s.x;
    const found = this.windowSelect(w.w, this.view.toWorld(s), crossing);
    const next = new Set(this.sel);
    if (shift) for (const id of found) next.delete(id);
    else for (const id of this.editable(found)) next.add(id);
    this.sel = next;
    this.dirty.sel = this.dirty.over = true;
    this.notify();
  }
  wheel(s: Vec2, deltaY: number) {
    this.view.zoomAt(s, deltaY < 0 ? 1.2 : 1 / 1.2);
    this.interactAt = performance.now();
    this.refreshCursor();
    this.redrawAll();
  }

  // ───────── 키보드 ─────────
  /** 처리했으면 true */
  key(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
    const mod = e.ctrlKey || e.metaKey;
    switch (e.key) {
      case 'F3':
        this.settings.osnap = !this.settings.osnap;
        this.log(`객체 스냅 ${this.settings.osnap ? '켜기' : '끄기'}`);
        this.refreshCursor();
        this.notify();
        return true;
      case 'F8':
        this.settings.ortho = !this.settings.ortho;
        this.log(`직교 ${this.settings.ortho ? '켜기' : '끄기'}`);
        this.notify();
        return true;
      case 'F7':
        this.settings.grid = !this.settings.grid;
        this.redrawAll();
        return true;
      case 'Escape':
        this.cancel();
        return true;
      case 'Delete':
        if (!this.cmd && this.sel.size) {
          this.run('ERASE');
          return true;
        }
        return false;
    }
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === 'z') {
        this.undo();
        return true;
      }
      if (k === 'y') {
        this.redo();
        return true;
      }
      if (k === 'a') {
        if (this.cmd && this.req?.kind !== 'select') return false;
        this.setSelection(this.editable([...this.doc.entities.keys()]));
        this.log(`${this.sel.size}개 선택됨`);
        return true;
      }
      if (k === 's') {
        this.ui('save');
        return true;
      }
      if (k === 'o') {
        this.ui('open');
        return true;
      }
    }
    return false;
  }
}
