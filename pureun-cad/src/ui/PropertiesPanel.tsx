// 우측 속성 창: 선택 객체의 속성 확인·수정
import { useState } from 'react';
import type { Engine } from '../commands/engine';
import { dimValue } from '../core/dimension';
import { entityLength, typeNameKo } from '../core/entity';
import { fmtNum } from '../core/format';
import { angleOf, DEG, dist, normDeg, polyArea } from '../core/geom';
import type { Entity } from '../core/types';
import { ACI_PICK, aciColor } from '../render/aci';

function NumField({ value, dec, onCommit }: { value: number; dec: number; onCommit: (n: number) => void }) {
  const shown = fmtNum(value, dec);
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const t = text.trim();
    setText(null);
    if (t === shown) return; // 바꾸지 않았으면 원래 64비트 값 유지
    const n = Number(t);
    if (t !== '' && Number.isFinite(n)) onCommit(n);
  };
  return (
    <input
      value={text ?? shown}
      title={String(value)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setText(null);
      }}
    />
  );
}

function TextField({ value, onCommit }: { value: string; onCommit: (s: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      value={text ?? value}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== null && text !== value) onCommit(text);
        setText(null);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function PropertiesPanel({ eng }: { eng: Engine }) {
  const { doc, settings } = eng;
  const dec = settings.decimals;
  const ids = [...eng.sel];
  const ents = ids.map((id) => doc.get(id)).filter((e): e is Entity => !!e);
  const f = (n: number) => fmtNum(n, dec);
  const fg7 = settings.theme === 'dark' ? '#ffffff' : '#111111';

  const update = (fn: (e: Entity) => Entity) => {
    const tx = doc.tx('속성 변경');
    for (const e of ents) tx.update(fn(e));
    tx.commit();
    if (tx.rejected) eng.log(`${tx.rejected}개 객체는 잠긴 레이어에 있어 변경하지 않았습니다.`);
  };

  if (!ents.length) {
    const usage = doc.layerUsage();
    return (
      <aside className="props" aria-label="속성">
        <h3>도면 정보</h3>
        <table>
          <tbody>
            <tr>
              <td>파일</td>
              <td className="ro">{doc.fileName}</td>
            </tr>
            <tr>
              <td>객체 수</td>
              <td>{doc.entities.size.toLocaleString()}</td>
            </tr>
            <tr>
              <td>보존(미지원) 객체</td>
              <td>{doc.preserved.length.toLocaleString()}</td>
            </tr>
            <tr>
              <td>현재 레이어</td>
              <td>
                <select value={doc.currentLayer} onChange={(e) => setCurrent(eng, e.target.value)}>
                  {[...doc.layers.values()].map((l) => (
                    <option key={l.name} value={l.name}>
                      {l.name} ({usage.get(l.name) ?? 0})
                    </option>
                  ))}
                </select>
              </td>
            </tr>
            <tr>
              <td>단위</td>
              <td>mm (내부 64비트)</td>
            </tr>
          </tbody>
        </table>
        <p className="hint">
          객체를 클릭하거나 창으로 선택하면 속성을 볼 수 있습니다.
          <br />왼→오른쪽 드래그: 완전히 포함된 객체(창)
          <br />오른→왼쪽 드래그: 걸친 객체 포함(걸치기)
          <br />Shift+클릭: 선택 해제, Esc: 선택 취소
        </p>
      </aside>
    );
  }

  const one = ents.length === 1 ? ents[0] : null;
  const types = new Map<string, number>();
  for (const e of ents) types.set(e.type, (types.get(e.type) ?? 0) + 1);
  const sameLayer = ents.every((e) => e.layer === ents[0].layer) ? ents[0].layer : '';
  const sameColor = ents.every((e) => (e.color ?? 256) === (ents[0].color ?? 256)) ? String(ents[0].color ?? 256) : '';
  const sameLt = ents.every((e) => (e.ltype ?? 'BYLAYER') === (ents[0].ltype ?? 'BYLAYER')) ? ents[0].ltype ?? 'BYLAYER' : '';

  const geo = () => {
    if (!one) return null;
    const row = (k: string, v: React.ReactNode) => (
      <tr key={k}>
        <td>{k}</td>
        <td className="ro">{v}</td>
      </tr>
    );
    const num = (k: string, v: number, fn: (n: number) => Entity) => row(k, <NumField key={one.id + k + v} value={v} dec={dec} onCommit={(n) => update(() => fn(n))} />);
    switch (one.type) {
      case 'line':
        return [
          num('시작 X', one.p1.x, (n) => ({ ...one, p1: { ...one.p1, x: n } })),
          num('시작 Y', one.p1.y, (n) => ({ ...one, p1: { ...one.p1, y: n } })),
          num('끝 X', one.p2.x, (n) => ({ ...one, p2: { ...one.p2, x: n } })),
          num('끝 Y', one.p2.y, (n) => ({ ...one, p2: { ...one.p2, y: n } })),
          row('길이', f(dist(one.p1, one.p2))),
          row('각도', f(normDeg(angleOf(one.p1, one.p2) / DEG)) + '°'),
        ];
      case 'circle':
        return [
          num('중심 X', one.c.x, (n) => ({ ...one, c: { ...one.c, x: n } })),
          num('중심 Y', one.c.y, (n) => ({ ...one, c: { ...one.c, y: n } })),
          num('반지름', one.r, (n) => (n > 0 ? { ...one, r: n } : one)),
          num('지름', one.r * 2, (n) => (n > 0 ? { ...one, r: n / 2 } : one)),
          row('둘레', f(2 * Math.PI * one.r)),
          row('면적', f(Math.PI * one.r * one.r)),
        ];
      case 'arc':
        return [
          num('중심 X', one.c.x, (n) => ({ ...one, c: { ...one.c, x: n } })),
          num('중심 Y', one.c.y, (n) => ({ ...one, c: { ...one.c, y: n } })),
          num('반지름', one.r, (n) => (n > 0 ? { ...one, r: n } : one)),
          num('시작각(°)', one.a0, (n) => ({ ...one, a0: n })),
          num('끝각(°)', one.a1, (n) => ({ ...one, a1: n })),
          row('호 길이', f(entityLength(one))),
        ];
      case 'polyline':
        return [
          row('정점 수', one.pts.length),
          row(
            '닫힘',
            <input type="checkbox" style={{ width: 'auto' }} checked={one.closed} onChange={(e) => update(() => ({ ...one, closed: e.target.checked }))} />,
          ),
          row('길이', f(entityLength(one))),
          ...(one.closed ? [row('면적', f(Math.abs(polyArea(one.pts))))] : []),
          row('호 세그먼트', one.pts.filter((p, i) => p.b !== 0 && (one.closed || i < one.pts.length - 1)).length),
        ];
      case 'text':
        return [
          num('X', one.p.x, (n) => ({ ...one, p: { ...one.p, x: n } })),
          num('Y', one.p.y, (n) => ({ ...one, p: { ...one.p, y: n } })),
          num('높이', one.h, (n) => (n > 0 ? { ...one, h: n } : one)),
          num('회전(°)', one.rot, (n) => ({ ...one, rot: n })),
          row('내용', <TextField key={one.id} value={one.text} onCommit={(s) => update(() => ({ ...one, text: s }))} />),
        ];
      case 'dimension':
        return [
          row('종류', { linear: '선형', aligned: '정렬', diameter: '지름', radius: '반지름' }[one.kind]),
          row('측정값', f(dimValue(one))),
          row('문자 재지정', <TextField key={one.id} value={one.textOverride ?? ''} onCommit={(s) => update(() => ({ ...one, textOverride: s || undefined }))} />),
          num('문자 높이', one.h, (n) => (n > 0 ? { ...one, h: n } : one)),
          num('화살표 크기', one.arrow, (n) => (n > 0 ? { ...one, arrow: n } : one)),
        ];
    }
  };

  return (
    <aside className="props" aria-label="속성">
      <h3>{one ? typeNameKo[one.type] : `${ents.length}개 선택`}</h3>
      {!one && (
        <p className="hint">
          {[...types.entries()].map(([t, n]) => `${typeNameKo[t as Entity['type']]} ${n}`).join(', ')}
        </p>
      )}
      <table>
        <tbody>
          <tr>
            <td>레이어</td>
            <td>
              <select value={sameLayer} onChange={(e) => update((x) => ({ ...x, layer: e.target.value }))}>
                {!sameLayer && <option value="">*여러 값*</option>}
                {[...doc.layers.values()].map((l) => (
                  <option key={l.name} value={l.name} disabled={l.locked}>
                    {l.name}
                    {l.locked ? ' (잠김)' : ''}
                  </option>
                ))}
              </select>
            </td>
          </tr>
          <tr>
            <td>색상</td>
            <td style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span className="swatch" style={{ background: sameColor && sameColor !== '256' ? aciColor(Number(sameColor), fg7) : 'transparent' }} />
              <select
                value={sameColor}
                onChange={(e) =>
                  update((x) => {
                    const c = Number(e.target.value);
                    const n = { ...x };
                    if (c === 256) delete n.color;
                    else n.color = c;
                    return n;
                  })
                }
              >
                {!sameColor && <option value="">*여러 값*</option>}
                <option value="256">BYLAYER</option>
                {ACI_PICK.map((c) => (
                  <option key={c} value={c}>
                    ACI {c}
                  </option>
                ))}
                {sameColor && !ACI_PICK.includes(Number(sameColor)) && sameColor !== '256' && <option value={sameColor}>ACI {sameColor}</option>}
              </select>
            </td>
          </tr>
          <tr>
            <td>선종류</td>
            <td>
              <select
                value={sameLt}
                onChange={(e) =>
                  update((x) => {
                    const n = { ...x };
                    if (e.target.value === 'BYLAYER') delete n.ltype;
                    else n.ltype = e.target.value;
                    return n;
                  })
                }
              >
                {!sameLt && <option value="">*여러 값*</option>}
                <option value="BYLAYER">BYLAYER</option>
                {[...doc.ltypes.values()].map((l) => (
                  <option key={l.name} value={l.name}>
                    {l.name}
                  </option>
                ))}
                {sameLt && sameLt !== 'BYLAYER' && !doc.ltypes.has(sameLt.toUpperCase()) && <option value={sameLt}>{sameLt}</option>}
              </select>
            </td>
          </tr>
          {geo()}
        </tbody>
      </table>
      <p className="hint">값을 바꾸고 Enter를 누르면 적용됩니다(실행취소 가능). 표시는 소수 {dec}자리이며 내부 값은 반올림하지 않습니다.</p>
    </aside>
  );
}

export function setCurrent(eng: Engine, name: string) {
  const doc = eng.doc;
  const tx = doc.tx('현재 레이어');
  tx.setLayers([...doc.layers.values()], name);
  tx.commit();
}
