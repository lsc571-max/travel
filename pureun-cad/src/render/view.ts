// 화면 좌표 변환 (월드: Y 위쪽 / 화면: Y 아래쪽). 64비트로 계산 후 그리기
import type { BBox, Vec2 } from '../core/types';

export class View {
  /** 화면 1px 당 월드 단위의 역수 (px / 단위) */
  scale = 4;
  /** 화면 중심의 월드 좌표 */
  cx = 50;
  cy = 50;
  w = 800;
  h = 600;

  toScreen(p: Vec2): Vec2 {
    return { x: this.w / 2 + (p.x - this.cx) * this.scale, y: this.h / 2 - (p.y - this.cy) * this.scale };
  }
  sx(x: number) {
    return this.w / 2 + (x - this.cx) * this.scale;
  }
  sy(y: number) {
    return this.h / 2 - (y - this.cy) * this.scale;
  }
  toWorld(s: Vec2): Vec2 {
    return { x: this.cx + (s.x - this.w / 2) / this.scale, y: this.cy - (s.y - this.h / 2) / this.scale };
  }
  /** 현재 화면에 보이는 월드 영역 */
  bbox(margin = 0): BBox {
    const a = this.toWorld({ x: -margin, y: this.h + margin });
    const b = this.toWorld({ x: this.w + margin, y: -margin });
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }
  /** 화면 점 s를 고정한 채 배율 변경 */
  zoomAt(s: Vec2, factor: number) {
    const before = this.toWorld(s);
    this.scale = Math.min(1e9, Math.max(1e-9, this.scale * factor));
    const after = this.toWorld(s);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }
  panPx(dx: number, dy: number) {
    this.cx -= dx / this.scale;
    this.cy += dy / this.scale;
  }
  fit(bb: BBox, marginRatio = 0.06) {
    const bw = Math.max(bb.maxX - bb.minX, 1e-9), bh = Math.max(bb.maxY - bb.minY, 1e-9);
    const s = Math.min(this.w / bw, this.h / bh) * (1 - 2 * marginRatio);
    this.scale = Number.isFinite(s) && s > 0 ? s : 1;
    this.cx = (bb.minX + bb.maxX) / 2;
    this.cy = (bb.minY + bb.maxY) / 2;
  }
}
