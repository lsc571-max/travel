// 푸른캐드 주 화면: 메뉴 · 도구 모음 · 작업 영역 · 속성 창 · 명령창 · 상태 표시줄
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Engine } from '../commands/engine';
import { DEFAULT_SETTINGS } from '../commands/types';
import { fmtNum } from '../core/format';
import { snapNameKo } from '../core/snap';
import type { Layer, Linetype, NewEntity, PreservedBlock, PreservedEntity } from '../core/types';
import { readDxf } from '../dxf/reader';
import { writeDxf } from '../dxf/writer';
import { runBenchmark } from '../perf';
import { aciColor } from '../render/aci';
import { idbGet, idbSet } from '../storage/idb';
import { APP_NAME, APP_VERSION } from '../version';
import { CanvasView } from './CanvasView';
import { HelpDialog, HoleDialog, LayerDialog, MessageDialog, SaveDialog, type SaveChoice } from './dialogs';
import { clearSaveHandle, pickOpenFile, saveText } from './files';
import { Icon } from './icons';
import { Modal } from './Modal';
import { PropertiesPanel, setCurrent } from './PropertiesPanel';
import { SettingsDialog, ShareDialog, VersionDialog } from './settings';

type DialogState =
  | null
  | { k: 'layer' | 'hole' | 'settings' | 'help' | 'share' | 'version' }
  | { k: 'save'; reuse: boolean }
  | { k: 'msg'; title: string; lines: string[] }
  | { k: 'restore'; data: AutoSave };

interface AutoSave {
  fileName: string;
  savedAt: number;
  entities: NewEntity[];
  layers: Layer[];
  ltypes: Linetype[];
  preserved: Omit<PreservedEntity, 'id'>[];
  preservedBlocks: PreservedBlock[];
  header: Record<string, string>;
  currentLayer: string;
}

function createEngine() {
  const eng = new Engine();
  try {
    const s = localStorage.getItem('pureun-cad.settings');
    if (s) eng.settings = { ...structuredClone(DEFAULT_SETTINGS), ...JSON.parse(s) };
  } catch {
    /* 기본 설정 사용 */
  }
  eng.applySettings();
  // 자동 테스트·성능 측정용 핸들 (비밀정보 없음)
  Object.assign(window, { __pureunCad: { eng, runBenchmark } });
  return eng;
}

function snapshot(eng: Engine): AutoSave {
  const d = eng.doc;
  return {
    fileName: d.fileName,
    savedAt: Date.now(),
    entities: [...d.entities.values()].map(({ id: _i, ...r }) => (void _i, r as NewEntity)),
    layers: [...d.layers.values()],
    ltypes: [...d.ltypes.values()],
    preserved: d.preserved.map(({ id: _i, ...r }) => (void _i, r)),
    preservedBlocks: d.preservedBlocks,
    header: d.header,
    currentLayer: d.currentLayer,
  };
}

const TOOLS: (string | [string, string, string])[] = [
  ['new', 'NEW', '새 도면'],
  ['open', 'OPEN', '열기 (Ctrl+O)'],
  ['save', 'QSAVE', '저장 (Ctrl+S)'],
  '|',
  ['undo', 'U', '실행취소 (Ctrl+Z)'],
  ['redo', 'REDO', '다시실행 (Ctrl+Y)'],
  '|',
  ['line', 'LINE', '선 (L)'],
  ['pline', 'PLINE', '폴리선 (PL)'],
  ['circle', 'CIRCLE', '원 (C)'],
  ['arc', 'ARC', '호 (A)'],
  ['rect', 'RECTANG', '직사각형 (REC)'],
  ['text', 'TEXT', '문자 (DT)'],
  '|',
  ['move', 'MOVE', '이동 (M)'],
  ['copy', 'COPY', '복사 (CO)'],
  ['rotate', 'ROTATE', '회전 (RO)'],
  ['trim', 'TRIM', '자르기 (TR)'],
  ['offset', 'OFFSET', '간격띄우기 (O)'],
  ['erase', 'ERASE', '지우기 (E)'],
  '|',
  ['dimlinear', 'DIMLINEAR', '선형 치수 (DLI)'],
  ['dimaligned', 'DIMALIGNED', '정렬 치수 (DAL)'],
  ['dimdia', 'DIMDIAMETER', '지름 치수 (DDI)'],
  ['dimrad', 'DIMRADIUS', '반지름 치수 (DRA)'],
  ['dist', 'DIST', '거리 측정 (DI)'],
  '|',
  ['hole', 'HOLEDIA', '동일 지름 원 일괄 변경 (HD)'],
  ['layer', 'LAYER', '레이어 (LA)'],
  ['zoomext', 'ZOOMEXT', '전체 보기 (Z → E)'],
];

const MENUS: { label: string; items: ([string, string, string?] | '-')[] }[] = [
  {
    label: '파일',
    items: [
      ['새 도면', 'NEW'],
      ['열기…', 'OPEN', 'Ctrl+O'],
      ['저장', 'QSAVE', 'Ctrl+S'],
      ['다른 이름으로 저장…', 'SAVEAS'],
      '-',
      ['앱 공유 (링크·QR)', '#share'],
    ],
  },
  {
    label: '편집',
    items: [
      ['실행취소', 'U', 'Ctrl+Z'],
      ['다시실행', 'REDO', 'Ctrl+Y'],
      '-',
      ['전체 선택', '#selectall', 'Ctrl+A'],
      ['지우기', 'ERASE', 'Del'],
    ],
  },
  {
    label: '그리기',
    items: [
      ['선', 'LINE', 'L'],
      ['폴리선', 'PLINE', 'PL'],
      ['원', 'CIRCLE', 'C'],
      ['호', 'ARC', 'A'],
      ['직사각형', 'RECTANG', 'REC'],
      ['문자', 'TEXT', 'DT'],
    ],
  },
  {
    label: '수정',
    items: [
      ['이동', 'MOVE', 'M'],
      ['복사', 'COPY', 'CO'],
      ['회전', 'ROTATE', 'RO'],
      ['자르기', 'TRIM', 'TR'],
      ['간격띄우기', 'OFFSET', 'O'],
      ['지우기', 'ERASE', 'E'],
    ],
  },
  {
    label: '치수',
    items: [
      ['선형', 'DIMLINEAR', 'DLI'],
      ['정렬', 'DIMALIGNED', 'DAL'],
      ['지름', 'DIMDIAMETER', 'DDI'],
      ['반지름', 'DIMRADIUS', 'DRA'],
    ],
  },
  {
    label: '도구',
    items: [
      ['거리 측정', 'DIST', 'DI'],
      ['좌표 확인', 'ID', 'ID'],
      ['객체 정보(길이·면적)', 'LIST', 'LI'],
      '-',
      ['동일 지름 원 일괄 변경', 'HOLEDIA', 'HD'],
      ['레이어 관리', 'LAYER', 'LA'],
      '-',
      ['설정', 'OPTIONS', 'OP'],
    ],
  },
  {
    label: '보기',
    items: [
      ['전체 보기', 'ZOOMEXT', 'Z E'],
      ['확대 창', 'ZOOM', 'Z'],
      ['그리드 켜기/끄기', '#grid', 'F7'],
    ],
  },
  {
    label: '도움말',
    items: [
      ['명령어 · 단축키', 'HELP'],
      ['버전 정보 · 업그레이드', '#version'],
    ],
  },
];

export function App() {
  const [eng] = useState(createEngine);
  useSyncExternalStore(
    (f) => eng.subscribe(f),
    () => eng.ver,
  );
  const [dialog, setDialog] = useState<DialogState>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [cmdText, setCmdText] = useState('');
  const [toast, setToast] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const histRef = useRef<HTMLDivElement>(null);
  const recall = useRef<{ list: string[]; i: number }>({ list: [], i: -1 });

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 2500);
  };

  // ── 파일
  const loadBytes = useCallback(
    (name: string, bytes: Uint8Array) => {
      try {
        const r = readDxf(bytes);
        eng.cancel(true);
        eng.doc.load({ ...r, fileName: name });
        eng.setSelection([]);
        clearSaveHandle();
        eng.zoomExtents();
        eng.log(`열기: ${name} (DXF ${r.version}, ${r.encoding}) — 객체 ${r.entities.length}개, 보존 ${r.preserved.length}개`);
        if (r.warnings.length) setDialog({ k: 'msg', title: 'DXF 열기 결과', lines: r.warnings });
      } catch (e) {
        setDialog({ k: 'msg', title: 'DXF 열기 실패', lines: [(e as Error).message, '현재 도면은 변경되지 않았습니다.'] });
      }
    },
    [eng],
  );

  const doSave = useCallback(
    async (choice: SaveChoice, reuse: boolean) => {
      try {
        const { text, report } = writeDxf(eng.doc, choice);
        const base = eng.doc.fileName.replace(/\.dxf$/i, '');
        const name = await saveText(text, `${base}.dxf`, reuse);
        if (!name) return;
        eng.doc.fileName = name;
        eng.doc.modified = false;
        const notes: string[] = [];
        const ex = Object.entries(report.excluded);
        const ap = Object.entries(report.approximated);
        if (ex.length) notes.push('저장 파일에서 제외: ' + ex.map(([k, n]) => `${k} ${n}`).join(', '));
        if (ap.length) notes.push('근사 변환하여 저장: ' + ap.map(([k, n]) => `${k} ${n}`).join(', '));
        eng.log(`저장: ${name} (R12 DXF, 객체 ${report.entities}개, 보존 객체 ${report.preservedWritten}개)${notes.length ? ' — ' + notes.join(' / ') : ''}`);
        flash(`저장했습니다: ${name}`);
        eng.notify();
      } catch (e) {
        setDialog({ k: 'msg', title: '저장 실패', lines: [(e as Error).message, '도면 데이터는 그대로 유지됩니다.'] });
      }
    },
    [eng],
  );

  const confirmDiscard = () => !eng.doc.modified || confirm('저장하지 않은 변경 내용이 있습니다. 계속하면 사라집니다. 계속할까요?');

  const needsSaveDialog = () => eng.doc.preserved.length > 0 || [...eng.doc.entities.values()].some((e) => e.type === 'dimension');

  useEffect(() => {
    eng.uiHandler = (a) => {
      switch (a) {
        case 'layer':
        case 'hole':
        case 'settings':
        case 'help':
        case 'share':
        case 'version':
          setDialog({ k: a });
          break;
        case 'open':
          if (!confirmDiscard()) return;
          void pickOpenFile().then((f) => f && loadBytes(f.name, f.bytes));
          break;
        case 'save':
        case 'saveas':
          if (needsSaveDialog()) setDialog({ k: 'save', reuse: a === 'save' });
          else void doSave({ explodeDims: false, approximateUnsupported: false }, a === 'save');
          break;
        case 'new':
          if (!confirmDiscard()) return;
          eng.cancel(true);
          eng.doc.clear();
          clearSaveHandle();
          eng.view.fit({ minX: 0, minY: 0, maxX: 297, maxY: 210 });
          eng.redrawAll();
          eng.log('새 도면');
          break;
      }
    };
  });

  // ── 자동 저장 (IndexedDB, 이 PC 브라우저 안에만)
  useEffect(() => {
    let timer = 0;
    let lastVer = eng.doc.version;
    const un = eng.doc.subscribe(() => {
      if (!eng.settings.autosave) return;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (eng.doc.version === lastVer) return;
        lastVer = eng.doc.version;
        idbSet('autosave', snapshot(eng)).catch(() => eng.log('자동 저장 실패 (브라우저 저장 공간 확인)'));
      }, 1500);
    });
    idbGet<AutoSave>('autosave')
      .then((d) => {
        if (d && (d.entities.length || d.preserved.length)) setDialog({ k: 'restore', data: d });
      })
      .catch(() => {});
    const before = (e: BeforeUnloadEvent) => {
      if (eng.doc.modified) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', before);
    return () => {
      un();
      clearTimeout(timer);
      window.removeEventListener('beforeunload', before);
    };
  }, [eng]);

  // ── 전역 키보드: 작업 영역에서 입력하면 명령창으로
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog) return;
      const t = e.target as HTMLElement;
      const inField = t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA';
      if (inField && t !== inputRef.current) return;
      if (t === inputRef.current) return; // 명령창 자체 처리
      if (eng.key(e)) {
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        eng.submit('');
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [eng, dialog]);

  useEffect(() => {
    histRef.current?.scrollTo(0, histRef.current.scrollHeight);
  }, [eng.history.length]);

  useEffect(() => {
    document.documentElement.dataset.theme = eng.settings.theme;
  }, [eng.settings.theme, eng.ver]);

  const run = (c: string) => {
    setMenu(null);
    if (c === 'ZOOMEXT') return eng.zoomExtents();
    if (c === '#share') return setDialog({ k: 'share' });
    if (c === '#version') return setDialog({ k: 'version' });
    if (c === '#grid') return eng.key({ key: 'F7', ctrlKey: false, metaKey: false, shiftKey: false });
    if (c === '#selectall') return eng.key({ key: 'a', ctrlKey: true, metaKey: false, shiftKey: false });
    eng.run(c);
    inputRef.current?.focus();
  };

  const onCmdKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const req = eng.req;
    if (e.key === 'Enter' || (e.key === ' ' && req?.kind !== 'string')) {
      e.preventDefault();
      const t = cmdText;
      if (t.trim()) recall.current = { list: [...recall.current.list.slice(-30), t], i: -1 };
      setCmdText('');
      eng.submit(t);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setCmdText('');
      eng.cancel();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const r = recall.current;
      if (!r.list.length) return;
      e.preventDefault();
      r.i = e.key === 'ArrowUp' ? (r.i < 0 ? r.list.length - 1 : Math.max(0, r.i - 1)) : r.i < 0 ? -1 : r.i + 1;
      if (r.i >= r.list.length) r.i = -1;
      setCmdText(r.i < 0 ? '' : r.list[r.i]);
      return;
    }
    if (e.key.startsWith('F') && e.key.length <= 3) {
      if (eng.key(e)) e.preventDefault();
      return;
    }
    if (!cmdText && (e.ctrlKey || e.metaKey || e.key === 'Delete')) {
      if (eng.key(e)) e.preventDefault();
    }
  };

  const req = eng.req;
  const p = eng.cursorS ? eng.effectivePoint() : null;
  const dec = eng.settings.decimals;
  const fg7 = eng.settings.theme === 'dark' ? '#ffffff' : '#111111';
  const cur = eng.doc.layers.get(eng.doc.currentLayer);
  const promptHead = req ? `${req.prompt}` : '명령';

  return (
    <div className="app" onPointerDown={() => menu && setMenu(null)}>
      <nav className="menubar" aria-label="메뉴">
        <span className="brand">{APP_NAME}</span>
        {MENUS.map((m) => (
          <div key={m.label} className={'menu' + (menu === m.label ? ' open' : '')}>
            <button
              onPointerDown={(e) => {
                e.stopPropagation();
                setMenu(menu === m.label ? null : m.label);
              }}
              onPointerEnter={() => menu && setMenu(m.label)}
            >
              {m.label}
            </button>
            {menu === m.label && (
              <div className="menu-list" onPointerDown={(e) => e.stopPropagation()}>
                {m.items.map((it, i) =>
                  it === '-' ? (
                    <hr key={i} />
                  ) : (
                    <button key={i} onClick={() => run(it[1])}>
                      <span>{it[0]}</span>
                      <span className="sc">{it[2] ?? ''}</span>
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
        <span className="spacer" />
        <span className="small" style={{ marginRight: 8, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {eng.doc.fileName}
          {eng.doc.modified ? ' *' : ''}
        </span>
        <button className="icon-btn" title="공유" aria-label="공유" onClick={() => setDialog({ k: 'share' })}>
          <Icon name="share" />
        </button>
        <button className="icon-btn" title="설정" aria-label="설정" data-testid="open-settings" onClick={() => setDialog({ k: 'settings' })}>
          <Icon name="settings" />
        </button>
      </nav>

      <div className="toolbar" role="toolbar" aria-label="도구 모음">
        {TOOLS.map((t, i) =>
          t === '|' ? (
            <span key={i} className="tb-sep" />
          ) : (
            <button key={t[1]} className={'icon-btn' + (eng.cmd?.name === t[1] ? ' active' : '')} title={t[2]} aria-label={t[2]} onClick={() => run(t[1])}>
              <Icon name={t[0]} />
            </button>
          ),
        )}
        <span className="layer-pick">
          <span className="swatch" style={{ background: aciColor(cur?.color ?? 7, fg7) }} />
          <select value={eng.doc.currentLayer} onChange={(e) => setCurrent(eng, e.target.value)} aria-label="현재 레이어" title="현재 레이어">
            {[...eng.doc.layers.values()].map((l) => (
              <option key={l.name} value={l.name}>
                {l.name}
                {!l.on ? ' (꺼짐)' : ''}
                {l.locked ? ' (잠김)' : ''}
              </option>
            ))}
          </select>
        </span>
      </div>

      <div className="main">
        <CanvasView eng={eng} />
        <PropertiesPanel key={[...eng.sel].join(',') + ':' + eng.doc.version} eng={eng} />
      </div>

      <div className="cmdline">
        <div className="cmd-history" ref={histRef} aria-live="polite" data-testid="cmd-history">
          {eng.history.slice(-60).join('\n')}
        </div>
        <div className="cmd-input">
          <span className="cmd-prompt" data-testid="cmd-prompt">
            {promptHead}
            {req?.keywords?.length ? (
              <>
                {' ['}
                {req.keywords.map((k, i) => (
                  <span key={k.key}>
                    {i > 0 && ' / '}
                    <span className="kw" onClick={() => eng.submit(k.key)}>
                      {k.label}
                    </span>
                  </span>
                ))}
                {']'}
              </>
            ) : null}
            :
          </span>
          <input
            ref={inputRef}
            value={cmdText}
            onChange={(e) => setCmdText(e.target.value)}
            onKeyDown={onCmdKey}
            placeholder={req ? '' : '명령 입력 (예: L, C, PL, TR, O, DLI, HD)'}
            aria-label="명령 입력"
            data-testid="cmd-input"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>

      <footer className="status">
        <span className="coord" data-testid="coords">
          {p ? `${fmtNum(p.x, dec)}, ${fmtNum(p.y, dec)}` : '—'}
          {eng.snap ? `  [${snapNameKo[eng.snap.kind]}]` : ''}
        </span>
        <button className={'tog' + (eng.settings.osnap ? ' on' : '')} onClick={() => eng.key({ key: 'F3', ctrlKey: false, metaKey: false, shiftKey: false })} title="객체 스냅 (F3)">
          스냅 F3
        </button>
        <button className={'tog' + (eng.settings.ortho ? ' on' : '')} onClick={() => eng.key({ key: 'F8', ctrlKey: false, metaKey: false, shiftKey: false })} title="직교 (F8)">
          직교 F8
        </button>
        <button className={'tog' + (eng.settings.grid ? ' on' : '')} onClick={() => eng.key({ key: 'F7', ctrlKey: false, metaKey: false, shiftKey: false })} title="그리드 (F7)">
          그리드 F7
        </button>
        <span className="spacer" />
        <span className="small">{eng.sel.size ? `${eng.sel.size}개 선택` : ''}</span>
        <span className="small" style={{ marginLeft: 8 }}>
          mm
        </span>
        <button className="ver" onClick={() => setDialog({ k: 'version' })} title="버전 정보">
          {APP_VERSION}
        </button>
      </footer>

      {dialog?.k === 'layer' && <LayerDialog eng={eng} onClose={() => setDialog(null)} />}
      {dialog?.k === 'hole' && <HoleDialog eng={eng} onClose={() => setDialog(null)} />}
      {dialog?.k === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {dialog?.k === 'share' && <ShareDialog onClose={() => setDialog(null)} />}
      {dialog?.k === 'version' && <VersionDialog onClose={() => setDialog(null)} />}
      {dialog?.k === 'settings' && <SettingsDialog eng={eng} onClose={() => setDialog(null)} onShare={() => setDialog({ k: 'share' })} onVersion={() => setDialog({ k: 'version' })} />}
      {dialog?.k === 'save' && (
        <SaveDialog
          eng={eng}
          onClose={() => setDialog(null)}
          onSave={(c) => {
            const reuse = dialog.reuse;
            setDialog(null);
            void doSave(c, reuse);
          }}
        />
      )}
      {dialog?.k === 'msg' && <MessageDialog title={dialog.title} lines={dialog.lines} onClose={() => setDialog(null)} />}
      {dialog?.k === 'restore' && (
        <Modal
          title="자동 저장 도면 복구"
          onClose={() => setDialog(null)}
          foot={
            <>
              <button className="btn" onClick={() => setDialog(null)}>
                복구 안 함
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  const d = dialog.data;
                  eng.doc.load({ ...d });
                  if (d.currentLayer && eng.doc.layers.has(d.currentLayer)) eng.doc.currentLayer = d.currentLayer;
                  eng.doc.modified = true;
                  eng.zoomExtents();
                  eng.log(`자동 저장 도면을 복구했습니다: ${d.fileName}`);
                  setDialog(null);
                }}
              >
                복구
              </button>
            </>
          }
        >
          <p className="msg">
            {new Date(dialog.data.savedAt).toLocaleString()}에 이 PC 브라우저에 자동 저장된 도면 "{dialog.data.fileName}" (객체 {dialog.data.entities.length.toLocaleString()}개)이 있습니다.
          </p>
        </Modal>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

