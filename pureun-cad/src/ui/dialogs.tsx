// 대화상자: 레이어, 동일 지름 원 일괄 변경, DXF 저장 옵션, 메시지, 도움말
import { useMemo, useState } from 'react';
import type { Engine } from '../commands/engine';
import { COMMANDS } from '../commands/registry';
import { fmtNum } from '../core/format';
import { changeHoleDiameter, groupHoles } from '../core/holes';
import { addLayer, deleteLayer, renameLayer, setLayerProps } from '../core/layers';
import { ACI_PICK, aciColor } from '../render/aci';
import { Icon } from './icons';
import { Modal } from './Modal';
import { setCurrent } from './PropertiesPanel';

export function LayerDialog({ eng, onClose }: { eng: Engine; onClose: () => void }) {
  const { doc } = eng;
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<{ name: string; text: string } | null>(null);
  const usage = doc.layerUsage();
  const fg7 = eng.settings.theme === 'dark' ? '#ffffff' : '#111111';
  const run = (r: string | null) => setErr(r ?? '');
  const newLayer = () => {
    let k = 1;
    while (doc.layers.has(`레이어${k}`)) k++;
    run(addLayer(doc, `레이어${k}`));
  };
  return (
    <Modal
      title="레이어 관리"
      wide
      onClose={onClose}
      foot={
        <>
          <span className="small" style={{ flex: 1 }}>
            이름 칸을 더블클릭하면 이름을 바꿀 수 있습니다. 모든 변경은 실행취소(Ctrl+Z)할 수 있습니다.
          </span>
          <button className="btn" onClick={newLayer}>
            새 레이어
          </button>
          <button className="btn primary" onClick={onClose}>
            닫기
          </button>
        </>
      }
    >
      {err && <p className="err">{err}</p>}
      <div style={{ maxHeight: '55vh', overflow: 'auto' }}>
        <table className="grid-table">
          <thead>
            <tr>
              <th>현재</th>
              <th>이름</th>
              <th>켜기</th>
              <th>잠금</th>
              <th>색상</th>
              <th>선종류</th>
              <th>객체</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...doc.layers.values()].map((l) => (
              <tr key={l.name} className={l.name === doc.currentLayer ? 'cur' : ''}>
                <td>
                  <input type="radio" name="curlayer" checked={l.name === doc.currentLayer} onChange={() => setCurrent(eng, l.name)} aria-label={`${l.name} 현재 레이어로`} />
                </td>
                <td onDoubleClick={() => l.name !== '0' && setEditing({ name: l.name, text: l.name })}>
                  {editing?.name === l.name ? (
                    <input
                      autoFocus
                      value={editing.text}
                      onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                      onBlur={() => {
                        run(renameLayer(doc, l.name, editing.text));
                        setEditing(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                  ) : (
                    l.name
                  )}
                </td>
                <td>
                  <button className="icon-btn" title={l.on ? '끄기' : '켜기'} onClick={() => run(setLayerProps(doc, l.name, { on: !l.on }))}>
                    <Icon name={l.on ? 'eye' : 'eyeOff'} />
                  </button>
                </td>
                <td>
                  <button className="icon-btn" title={l.locked ? '잠금 해제' : '잠금'} onClick={() => run(setLayerProps(doc, l.name, { locked: !l.locked }))}>
                    <Icon name={l.locked ? 'lock' : 'unlock'} />
                  </button>
                </td>
                <td>
                  <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span className="swatch" style={{ background: aciColor(l.color, fg7) }} />
                    <select value={l.color} onChange={(e) => run(setLayerProps(doc, l.name, { color: Number(e.target.value) }))}>
                      {[...new Set([...ACI_PICK, l.color])].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </span>
                </td>
                <td>
                  <select value={(l.ltype ?? 'CONTINUOUS').toUpperCase()} onChange={(e) => run(setLayerProps(doc, l.name, { ltype: e.target.value }))}>
                    {[...doc.ltypes.values()].map((t) => (
                      <option key={t.name} value={t.name.toUpperCase()}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{usage.get(l.name) ?? 0}</td>
                <td>
                  <button className="btn danger" disabled={l.name === '0'} onClick={() => run(deleteLayer(doc, l.name))}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export function HoleDialog({ eng, onClose }: { eng: Engine; onClose: () => void }) {
  const { doc } = eng;
  const tol = eng.settings.holeTol;
  const groups = useMemo(() => groupHoles(doc, tol), [doc, tol, doc.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const preDia = (() => {
    const one = eng.sel.size === 1 ? doc.get([...eng.sel][0]) : undefined;
    return one?.type === 'circle' ? one.r * 2 : null;
  })();
  const [pick, setPick] = useState<number>(() => {
    if (preDia === null) return 0;
    const k = groups.findIndex((g) => preDia >= g.dia - 1e-12 && preDia <= g.maxDia + 1e-12);
    return Math.max(0, k);
  });
  const [val, setVal] = useState('');
  const [msg, setMsg] = useState('');
  const g = groups[pick];
  const f = (n: number) => fmtNum(n, eng.settings.decimals);
  const apply = () => {
    const n = Number(val);
    if (!g || !(n > 0)) {
      setMsg('새 지름을 0보다 큰 숫자로 입력하십시오.');
      return;
    }
    try {
      const c = changeHoleDiameter(doc, g.ids, n);
      setMsg(`${c}개 원의 지름을 ${f(n)}(으)로 변경했습니다. 중심 좌표는 그대로입니다. (Ctrl+Z로 되돌리기)`);
      eng.log(`동일 지름 원 일괄 변경: Ø${f(g.dia)} → Ø${f(n)}, ${c}개`);
      eng.setSelection(g.ids);
      setVal('');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <Modal
      title="동일 지름 원 검색 · 일괄 변경"
      wide
      onClose={onClose}
      foot={
        <button className="btn primary" onClick={onClose}>
          닫기
        </button>
      }
    >
      <p className="small">
        도면의 모든 원(CIRCLE)을 지름별로 묶었습니다(허용오차 {tol} mm, 설정에서 변경). 잠긴 레이어·꺼진 레이어의 원은 변경하지 않습니다.
      </p>
      {!groups.length ? (
        <p>도면에 원이 없습니다.</p>
      ) : (
        <div style={{ maxHeight: '40vh', overflow: 'auto' }}>
          <table className="grid-table">
            <thead>
              <tr>
                <th>지름</th>
                <th>반지름</th>
                <th>변경 가능</th>
                <th>잠김</th>
                <th>숨김</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((x, i) => (
                <tr key={i} className={i === pick ? 'cur' : ''} onClick={() => setPick(i)} style={{ cursor: 'pointer' }}>
                  <td>
                    Ø{f(x.dia)}
                    {x.maxDia !== x.dia ? ` ~ ${f(x.maxDia)}` : ''}
                  </td>
                  <td>R{f(x.dia / 2)}</td>
                  <td>{x.ids.length}</td>
                  <td>{x.locked || ''}</td>
                  <td>{x.hidden || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {g && (
        <div className="section" style={{ marginTop: 10 }}>
          <div className="row">
            <label>선택한 지름</label>
            <b>Ø{f(g.dia)}</b> ({g.ids.length}개 변경 가능)
            <button className="btn" onClick={() => eng.setSelection(g.ids)}>
              도면에서 선택 표시
            </button>
          </div>
          <div className="row">
            <label htmlFor="newdia">새 지름 (mm)</label>
            <input id="newdia" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} inputMode="decimal" style={{ width: 120 }} />
            <button className="btn primary" disabled={!g.ids.length} onClick={apply}>
              일괄 변경
            </button>
          </div>
        </div>
      )}
      {msg && <p className="msg">{msg}</p>}
    </Modal>
  );
}

export interface SaveChoice {
  explodeDims: boolean;
  approximateUnsupported: boolean;
}

export function SaveDialog({
  eng,
  onSave,
  onClose,
}: {
  eng: Engine;
  onSave: (c: SaveChoice) => void;
  onClose: () => void;
}) {
  const { doc } = eng;
  const dims = [...doc.entities.values()].filter((e) => e.type === 'dimension').length;
  const counts = new Map<string, number>();
  for (const p of doc.preserved) counts.set(p.dxfType, (counts.get(p.dxfType) ?? 0) + 1);
  const r12 = new Set(['POINT', 'LINE', 'CIRCLE', 'ARC', 'TRACE', 'SOLID', 'TEXT', 'SHAPE', 'INSERT', 'ATTDEF', 'POLYLINE', '3DFACE', 'DIMENSION', 'LWPOLYLINE']);
  const nonR12 = [...counts.entries()].filter(([t]) => !r12.has(t));
  const [c, setC] = useState<SaveChoice>({ explodeDims: false, approximateUnsupported: false });
  return (
    <Modal
      title="DXF 저장 옵션"
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" onClick={() => onSave(c)}>
            저장
          </button>
        </>
      }
    >
      <p className="small">저장 형식: AutoCAD R12 DXF (AC1009, CAM 호환성 우선). 원·호는 원래 기하 그대로, 폴리선 호는 bulge 값으로 저장합니다.</p>
      {dims > 0 && (
        <div className="section">
          <h4>치수 {dims}개</h4>
          <label className="row">
            <input type="checkbox" checked={c.explodeDims} onChange={(e) => setC({ ...c, explodeDims: e.target.checked })} />
            치수를 선·문자로 분해하여 저장 (CAM 프로그램 전달용, 치수 정보는 사라짐)
          </label>
        </div>
      )}
      {doc.preserved.length > 0 && (
        <div className="section">
          <h4>보존된 미지원 객체 {doc.preserved.length}개</h4>
          <p className="small">{[...counts.entries()].map(([t, n]) => `${t} ${n}`).join(', ')}</p>
          <p className="small">R12에서 유효한 객체(INSERT, SOLID, POINT 등)는 원본 그룹코드를 그대로 저장합니다(R12에 없는 핸들·서브클래스·확장데이터 코드는 제외).</p>
          {nonR12.length > 0 && (
            <>
              <p className="warn">
                다음 객체는 R12 형식에 존재하지 않아 그대로 저장할 수 없습니다: {nonR12.map(([t, n]) => `${t} ${n}개`).join(', ')}
              </p>
              <label className="row">
                <input type="checkbox" checked={c.approximateUnsupported} onChange={(e) => setC({ ...c, approximateUnsupported: e.target.checked })} />
                근사 형상(선·폴리선·문자)으로 변환하여 포함 — 선택하지 않으면 저장 파일에서 제외됩니다(현재 도면에는 계속 보존).
              </label>
            </>
          )}
        </div>
      )}
      <p className="small">원본 파일은 덮어쓰지 않으며, 새 파일로 내려받거나 지정한 위치에 저장합니다.</p>
    </Modal>
  );
}

export function MessageDialog({ title, lines, onClose }: { title: string; lines: string[]; onClose: () => void }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      foot={
        <button className="btn primary" onClick={onClose}>
          확인
        </button>
      }
    >
      {lines.map((l, i) => (
        <p key={i} className="msg">
          {l}
        </p>
      ))}
    </Modal>
  );
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="명령어 · 단축키" wide onClose={onClose} foot={<button className="btn primary" onClick={onClose}>닫기</button>}>
      <table className="grid-table">
        <thead>
          <tr>
            <th>명령</th>
            <th>별칭</th>
            <th>기능</th>
          </tr>
        </thead>
        <tbody>
          {COMMANDS.map((c) => (
            <tr key={c.name}>
              <td className="kbd">{c.name}</td>
              <td>{c.aliases.join(', ')}</td>
              <td>{c.label}</td>
            </tr>
          ))}
          <tr>
            <td className="kbd">UNDO</td>
            <td>U, Ctrl+Z</td>
            <td>실행취소</td>
          </tr>
          <tr>
            <td className="kbd">REDO</td>
            <td>Ctrl+Y</td>
            <td>다시실행</td>
          </tr>
        </tbody>
      </table>
      <div className="section" style={{ marginTop: 10 }}>
        <h4>좌표 입력</h4>
        <p className="msg small">
          <span className="kbd">100,50</span> 절대 좌표 · <span className="kbd">#100,50</span> 절대 좌표 · <span className="kbd">@20,0</span> 상대 좌표 ·{' '}
          <span className="kbd">@50&lt;30</span> 상대 극좌표(거리&lt;각도, 반시계 +) · 숫자만 입력: 커서 방향으로 그 거리(직접 거리 입력)
        </p>
        <h4>키 · 마우스</h4>
        <p className="msg small">
          Enter/Space: 입력 확정·직전 명령 반복 · Esc: 취소 · F3: 객체 스냅 · F8: 직교 · F7: 그리드 · Delete: 선택 지우기 · Ctrl+A: 전체 선택{'\n'}
          휠: 확대/축소 · 가운데 버튼 드래그: 화면 이동 · 가운데 버튼 두 번: 전체 보기 · 오른쪽 클릭: Enter
        </p>
      </div>
    </Modal>
  );
}

/** 빠른 선택: 종류·레이어·색상 조건으로 객체 선택 */
export function QuickSelectDialog({ eng, onClose }: { eng: Engine; onClose: () => void }) {
  const { doc } = eng;
  const [type, setType] = useState('');
  const [layer, setLayer] = useState('');
  const [color, setColor] = useState('');
  const [mode, setMode] = useState<'new' | 'add'>('new');
  const match = [...doc.entities.values()].filter(
    (e) =>
      (!type || e.type === type) &&
      (!layer || e.layer === layer) &&
      (!color || String(e.color ?? 256) === color) &&
      doc.isEditable(e),
  );
  const colors = [...new Set([...doc.entities.values()].map((e) => String(e.color ?? 256)))];
  return (
    <Modal
      title="빠른 선택 (QSELECT)"
      onClose={onClose}
      foot={
        <>
          <span className="small" style={{ flex: 1 }}>
            조건에 맞는 객체 {match.length.toLocaleString()}개 (잠김·꺼짐 레이어 제외)
          </span>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button
            className="btn primary"
            disabled={!match.length}
            onClick={() => {
              const ids = match.map((e) => e.id);
              eng.setSelection(mode === 'add' ? [...new Set([...eng.sel, ...ids])] : ids);
              eng.log(`빠른 선택: ${ids.length}개 선택`);
              onClose();
            }}
          >
            선택
          </button>
        </>
      }
    >
      <div className="row">
        <label htmlFor="qs-type">객체 종류</label>
        <select id="qs-type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">전체</option>
          <option value="line">선</option>
          <option value="circle">원</option>
          <option value="arc">호</option>
          <option value="polyline">폴리선</option>
          <option value="text">문자</option>
          <option value="dimension">치수</option>
        </select>
      </div>
      <div className="row">
        <label htmlFor="qs-layer">레이어</label>
        <select id="qs-layer" value={layer} onChange={(e) => setLayer(e.target.value)}>
          <option value="">전체</option>
          {[...doc.layers.values()].map((l) => (
            <option key={l.name} value={l.name}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <label htmlFor="qs-color">색상</label>
        <select id="qs-color" value={color} onChange={(e) => setColor(e.target.value)}>
          <option value="">전체</option>
          {colors.map((c) => (
            <option key={c} value={c}>
              {c === '256' ? 'BYLAYER' : `ACI ${c}`}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <label>선택 방식</label>
        <label style={{ minWidth: 0, color: 'inherit' }}>
          <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> 새로 선택
        </label>
        <label style={{ minWidth: 0, color: 'inherit' }}>
          <input type="radio" checked={mode === 'add'} onChange={() => setMode('add')} /> 현재 선택에 추가
        </label>
      </div>
      <p className="small">같은 지름의 원을 고르려면 "동일 지름 원 일괄 변경(HD)"의 "도면에서 선택 표시"를 사용하십시오.</p>
    </Modal>
  );
}
