// 독립 도구(ezdxf)로 만든 실무형 시험 도면 읽기·저장 호환성
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Drawing } from '../../src/core/document';
import { groupHoles } from '../../src/core/holes';
import { readDxf } from '../../src/dxf/reader';
import { writeDxf } from '../../src/dxf/writer';
import type { Entity } from '../../src/core/types';

const FIX = join(__dirname, '../fixtures');
const OUT = join(__dirname, '../e2e/out');
const hasPy = (() => {
  try {
    execFileSync('python3', ['-c', 'import ezdxf']);
    return true;
  } catch {
    return false;
  }
})();

describe.each(['R12', 'R2000', 'R2010', 'R2018'])('시험 도면 flange_%s.dxf', (ver) => {
  const file = join(FIX, `flange_${ver}.dxf`);
  it.skipIf(!existsSync(file))('읽기: 구멍·레이어·한글·슬롯', () => {
    const r = readDxf(new Uint8Array(readFileSync(file)));
    const circles = r.entities.filter((e) => e.type === 'circle') as Extract<Entity, { type: 'circle' }>[];
    expect(circles.length).toBe(11);
    const d = new Drawing();
    d.load({ ...r });
    const holes = groupHoles(d, 1e-6);
    expect(holes.find((g) => Math.abs(g.dia - 14) < 1e-9)!.ids.length).toBe(8);
    const lay = Object.fromEntries(r.layers.map((l) => [l.name, l]));
    expect(lay['잠금'].locked).toBe(true);
    expect(lay['숨김'].on).toBe(false);
    expect(lay['중심선'].ltype?.toUpperCase()).toBe('CENTER');
    const t = r.entities.find((e) => e.type === 'text') as Extract<Entity, { type: 'text' }>;
    expect(t.text).toBe('플랜지 8-%%c14 PCD150');
    const slot = r.entities.find((e) => e.type === 'polyline') as Extract<Entity, { type: 'polyline' }>;
    expect(slot.closed).toBe(true);
    expect(slot.pts.map((p) => p.b)).toEqual([0, 1, 0, 1]);
    const dims = r.entities.filter((e) => e.type === 'dimension');
    expect(dims.map((x) => (x as Extract<Entity, { type: 'dimension' }>).kind).sort()).toEqual(['diameter', 'linear', 'radius']);
    if (ver !== 'R12') {
      for (const k of ['SPLINE', 'ELLIPSE', 'MTEXT', 'INSERT']) expect(r.unsupported[k], k).toBeGreaterThan(0);
      expect(r.unsupported['DIMENSION(각도/좌표 치수)']).toBe(1);
      const arc = r.entities.find((e) => e.type === 'arc' && (e as Extract<Entity, { type: 'arc' }>).c.x === 150) as Extract<Entity, { type: 'arc' }>;
      // OCS -Z 호 (-150,0) 중심, 0~90° → WCS 중심 (150,0)?  ezdxf는 OCS 좌표 그대로 저장하므로 x 반전
      expect(arc).toBeTruthy();
      expect([arc.a0, arc.a1]).toEqual([90, 180]);
      for (const p of r.preserved) if (p.dxfType !== 'DIMENSION') expect(p.display?.length, p.dxfType).toBeGreaterThan(0);
    }
  });

  it.skipIf(!existsSync(file) || !hasPy)('R12로 저장 → ezdxf 감사 통과', () => {
    const r = readDxf(new Uint8Array(readFileSync(file)));
    const d = new Drawing();
    d.load({ ...r });
    mkdirSync(OUT, { recursive: true });
    for (const opt of [{}, { approximateUnsupported: true }, { explodeDims: true }]) {
      const { text } = writeDxf(d, opt);
      const f = join(OUT, `resave_${ver}_${Object.keys(opt).join('_') || 'default'}.dxf`);
      writeFileSync(f, text);
      const out = execFileSync('python3', [join(__dirname, '../e2e/audit_dxf.py'), f]).toString();
      expect(out).toContain('AUDIT OK');
      // 다시 읽어도 구멍 정보 동일
      const back = readDxf(new Uint8Array(readFileSync(f)));
      expect(back.entities.filter((e) => e.type === 'circle').length).toBe(11);
    }
  });
});
