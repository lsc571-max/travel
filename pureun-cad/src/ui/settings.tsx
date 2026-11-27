// 일반 설정 (1회 클릭) + 숨겨진 관리자 설정 (설정창 아이콘 3초 안에 5회 → 비밀번호 인증)
import qrcode from 'qrcode-generator';
import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../commands/engine';
import { fmtNum } from '../core/format';
import { runBenchmark, type BenchResult } from '../perf';
import { failCount, hasPassword, lockRemaining, MAX_FAIL, resetPassword, setPassword, validatePassword, verifyPassword } from '../storage/admin';
import { idbDel } from '../storage/idb';
import { APP_NAME, APP_VERSION, BUILD_DATE, CHANGES } from '../version';
import { Icon } from './icons';
import { Modal } from './Modal';

export function saveSettings(eng: Engine) {
  try {
    localStorage.setItem('pureun-cad.settings', JSON.stringify(eng.settings));
  } catch {
    /* 저장 불가 환경 */
  }
}

/** 5회 연속 클릭 감지 (첫 클릭부터 3초 이내, 시간 초과 시 초기화) */
function useSecretTap(onUnlock: () => void) {
  const st = useRef({ n: 0, t0: 0 });
  return () => {
    const now = performance.now();
    if (!st.current.n || now - st.current.t0 > 3000) st.current = { n: 0, t0: now };
    st.current.n++;
    if (st.current.n >= 5) {
      st.current = { n: 0, t0: 0 };
      onUnlock();
    }
  };
}

export function SettingsDialog({ eng, onClose, onShare, onVersion }: { eng: Engine; onClose: () => void; onShare: () => void; onVersion: () => void }) {
  const [, force] = useState(0);
  const [admin, setAdmin] = useState(false);
  const s = eng.settings;
  const set = (patch: Partial<typeof s>) => {
    Object.assign(eng.settings, patch);
    saveSettings(eng);
    eng.applySettings();
    force((x) => x + 1);
  };
  const tap = useSecretTap(() => setAdmin(true));
  const num = (v: string, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  };
  if (admin) return <AdminDialog eng={eng} onClose={() => setAdmin(false)} />;
  return (
    <Modal
      title="설정"
      onClose={onClose}
      headExtra={
        <button className="icon-btn" onClick={tap} aria-label="설정" title="설정" data-testid="settings-gear">
          <Icon name="settings" />
        </button>
      }
      foot={
        <button className="btn primary" onClick={onClose}>
          닫기
        </button>
      }
    >
      <div className="section">
        <h4>화면</h4>
        <div className="row">
          <label>테마</label>
          <select value={s.theme} onChange={(e) => set({ theme: e.target.value as 'dark' | 'light' })}>
            <option value="dark">어두운 배경</option>
            <option value="light">밝은 배경</option>
          </select>
        </div>
        <div className="row">
          <label>그리드 표시 (F7)</label>
          <input type="checkbox" checked={s.grid} onChange={(e) => set({ grid: e.target.checked })} />
        </div>
        <div className="row">
          <label>좌표·길이 표시 소수 자리</label>
          <input type="number" min={0} max={10} value={s.decimals} onChange={(e) => set({ decimals: num(e.target.value, 0, 10) })} style={{ width: 70 }} />
          <span className="small">표시만 반올림, 내부 값은 64비트 그대로</span>
        </div>
      </div>
      <div className="section">
        <h4>작도 보조</h4>
        <div className="row">
          <label>객체 스냅 (F3)</label>
          <input type="checkbox" checked={s.osnap} onChange={(e) => set({ osnap: e.target.checked })} />
        </div>
        <div className="row">
          <label>스냅 종류</label>
          {(
            [
              ['end', '끝점'],
              ['mid', '중간점'],
              ['cen', '중심점'],
              ['int', '교차점'],
              ['qua', '사분점'],
            ] as const
          ).map(([k, l]) => (
            <label key={k} style={{ minWidth: 0, color: 'inherit' }}>
              <input type="checkbox" checked={s.snapModes[k]} onChange={(e) => set({ snapModes: { ...s.snapModes, [k]: e.target.checked } })} /> {l}
            </label>
          ))}
        </div>
        <div className="row">
          <label>선택 상자 / 스냅 범위(px)</label>
          <input type="number" min={2} max={30} value={s.pickbox} onChange={(e) => set({ pickbox: num(e.target.value, 2, 30) })} style={{ width: 70 }} />
          <input type="number" min={4} max={40} value={s.aperture} onChange={(e) => set({ aperture: num(e.target.value, 4, 40) })} style={{ width: 70 }} />
        </div>
      </div>
      <div className="section">
        <h4>치수 · 문자</h4>
        <div className="row">
          <label>치수 소수 자리</label>
          <input type="number" min={0} max={8} value={s.dimDecimals} onChange={(e) => set({ dimDecimals: num(e.target.value, 0, 8) })} style={{ width: 70 }} />
        </div>
        <div className="row">
          <label>새 치수 문자 높이 / 화살표</label>
          <input type="number" step="0.5" min={0.1} value={s.dimTextH} onChange={(e) => set({ dimTextH: num(e.target.value, 0.1, 1000) })} style={{ width: 70 }} />
          <input type="number" step="0.5" min={0.1} value={s.dimArrow} onChange={(e) => set({ dimArrow: num(e.target.value, 0.1, 1000) })} style={{ width: 70 }} />
        </div>
        <div className="row">
          <label>기본 문자 높이</label>
          <input type="number" step="0.5" min={0.1} value={s.textH} onChange={(e) => set({ textH: num(e.target.value, 0.1, 1000) })} style={{ width: 70 }} />
        </div>
      </div>
      <div className="section">
        <h4>가공 · 저장</h4>
        <div className="row">
          <label>동일 지름 허용오차(mm)</label>
          <input type="number" step="0.0001" min={0} value={s.holeTol} onChange={(e) => set({ holeTol: num(e.target.value, 0, 10) })} style={{ width: 100 }} />
        </div>
        <div className="row">
          <label>자동 저장(이 PC 브라우저)</label>
          <input type="checkbox" checked={s.autosave} onChange={(e) => set({ autosave: e.target.checked })} />
          <span className="small">도면은 외부 서버로 전송되지 않습니다</span>
        </div>
      </div>
      <div className="section">
        <h4>공유 · 버전</h4>
        <div className="row">
          <button className="btn" onClick={onShare}>
            <span style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
              <Icon name="share" />
            </span>{' '}
            앱 공유 (링크 · QR코드)
          </button>
          <button className="btn" onClick={onVersion}>
            버전 정보 · 업그레이드
          </button>
        </div>
        <p className="small">
          {APP_NAME} {APP_VERSION} ({BUILD_DATE})
        </p>
      </div>
    </Modal>
  );
}

function AdminDialog({ eng, onClose }: { eng: Engine; onClose: () => void }) {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [bench, setBench] = useState<BenchResult[]>([]);
  const registering = !hasPassword();

  // 5분간 조작이 없으면 재인증
  useEffect(() => {
    if (!authed) return;
    let t = window.setTimeout(() => setAuthed(false), 5 * 60 * 1000);
    const reset = () => {
      clearTimeout(t);
      t = window.setTimeout(() => setAuthed(false), 5 * 60 * 1000);
    };
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
    };
  }, [authed]);

  const submit = async () => {
    setMsg('');
    if (registering) {
      const e = validatePassword(pw);
      if (e) return setMsg(e);
      if (pw !== pw2) return setMsg('비밀번호 확인이 일치하지 않습니다.');
      setBusy(true);
      await setPassword(pw);
      setBusy(false);
      setPw('');
      setPw2('');
      setAuthed(true);
      return;
    }
    setBusy(true);
    const r = await verifyPassword(pw);
    setBusy(false);
    setPw('');
    if (r === 'ok') setAuthed(true);
    else if (r === 'locked') setMsg(`인증 실패가 ${MAX_FAIL}회 누적되어 잠겼습니다. ${Math.ceil(lockRemaining() / 60000)}분 후 다시 시도하십시오.`);
    else setMsg(`비밀번호가 올바르지 않습니다. (${failCount()}/${MAX_FAIL})`);
  };

  const close = () => {
    setAuthed(false);
    setPw('');
    onClose();
  };

  if (!authed) {
    const locked = lockRemaining() > 0;
    return (
      <Modal
        title={registering ? '관리자 비밀번호 등록 (이 기기 전용)' : '관리자 인증'}
        onClose={close}
        foot={
          <>
            <button className="btn" onClick={close}>
              취소
            </button>
            <button className="btn primary" disabled={busy || locked} onClick={submit}>
              {registering ? '등록' : '확인'}
            </button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input type="text" name="username" autoComplete="username" value="pureun-cad-admin" readOnly hidden />
          <div className="row">
            <label htmlFor="apw">비밀번호</label>
            <input id="apw" type="password" autoFocus autoComplete={registering ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} disabled={locked} />
          </div>
          {registering && (
            <div className="row">
              <label htmlFor="apw2">비밀번호 확인</label>
              <input id="apw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </div>
          )}
          <button type="submit" hidden />
        </form>
        {locked && <p className="err">인증 실패 누적으로 잠겨 있습니다. {Math.ceil(lockRemaining() / 60000)}분 후 다시 시도하십시오.</p>}
        {msg && <p className="err">{msg}</p>}
        <p className="small">
          비밀번호는 원문이 아닌 PBKDF2-SHA256 해시로 이 기기의 브라우저에만 저장되며 다른 기기와 동기화되지 않습니다. 브라우저 저장소는 운영체제 보안 저장소보다 보호 수준이
          낮으므로, 관리자 설정에는 비밀키를 보관하지 않습니다.
        </p>
      </Modal>
    );
  }

  const doBench = async (n: number) => {
    if (eng.doc.modified && !confirm('현재 도면을 닫고 시험 도면을 만듭니다. 저장하지 않은 변경은 사라집니다. 계속할까요?')) return;
    setBusy(true);
    setMsg(`${n.toLocaleString()}개 객체 시험 중…`);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const r = runBenchmark(eng, n);
      setBench((b) => [...b.filter((x) => x.n !== n), r].sort((a, c) => a.n - c.n));
      setMsg('측정 완료 (이 PC·브라우저 기준 실제 측정값)');
    } catch (e) {
      setMsg('측정 실패: ' + (e as Error).message);
    }
    setBusy(false);
  };
  const ms = (x: number) => fmtNum(x, 1);

  return (
    <Modal
      title="관리자 설정"
      wide
      onClose={close}
      foot={
        <button className="btn primary" onClick={close}>
          관리자 설정 종료
        </button>
      }
    >
      <div className="section">
        <h4>성능 측정 (시험 도면 생성)</h4>
        <div className="row">
          {[1000, 10000, 50000].map((n) => (
            <button key={n} className="btn" disabled={busy} onClick={() => doBench(n)}>
              {n.toLocaleString()}개
            </button>
          ))}
        </div>
        {bench.length > 0 && (
          <table className="grid-table">
            <thead>
              <tr>
                <th>객체 수</th>
                <th>불러오기+인덱스</th>
                <th>전체 그리기</th>
                <th>확대 그리기</th>
                <th>이동 1프레임</th>
                <th>선택 1회</th>
                <th>스냅 1회</th>
                <th>DXF 쓰기</th>
                <th>DXF 읽기</th>
              </tr>
            </thead>
            <tbody>
              {bench.map((b) => (
                <tr key={b.n}>
                  <td>{b.n.toLocaleString()}</td>
                  <td>{ms(b.loadMs)} ms</td>
                  <td>{ms(b.renderFullMs)} ms</td>
                  <td>{ms(b.renderZoomMs)} ms</td>
                  <td>{ms(b.pan10Ms / 10)} ms</td>
                  <td>{fmtNum(b.hit100Ms / 100, 3)} ms</td>
                  <td>{fmtNum(b.snap100Ms / 100, 3)} ms</td>
                  <td>{ms(b.dxfWriteMs)} ms</td>
                  <td>{ms(b.dxfReadMs)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="section">
        <h4>비밀번호</h4>
        <div className="row">
          <input type="password" placeholder="새 비밀번호(6자 이상)" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <input type="password" placeholder="새 비밀번호 확인" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          <button
            className="btn"
            onClick={async () => {
              const e = validatePassword(pw);
              if (e) return setMsg(e);
              if (pw !== pw2) return setMsg('비밀번호 확인이 일치하지 않습니다.');
              await setPassword(pw);
              setPw('');
              setPw2('');
              setMsg('비밀번호를 변경했습니다.');
            }}
          >
            변경
          </button>
          <button
            className="btn danger"
            onClick={() => {
              if (!confirm('이 기기의 관리자 비밀번호를 삭제합니다. 다음 진입 시 새로 등록합니다. 계속할까요?')) return;
              resetPassword();
              close();
            }}
          >
            비밀번호 재설정
          </button>
        </div>
      </div>
      <div className="section">
        <h4>저장 데이터</h4>
        <div className="row">
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm('브라우저에 자동 저장된 도면을 삭제합니다. (열려 있는 도면과 PC의 DXF 파일은 영향 없음) 계속할까요?')) return;
              await idbDel('autosave');
              setMsg('자동 저장 데이터를 삭제했습니다.');
            }}
          >
            자동 저장 도면 삭제
          </button>
          <button
            className="btn"
            onClick={() => {
              localStorage.removeItem('pureun-cad.settings');
              setMsg('설정 저장값을 삭제했습니다. 다시 시작하면 기본 설정이 적용됩니다.');
            }}
          >
            설정 초기화
          </button>
        </div>
        <p className="small">이 앱은 AI·외부 API를 사용하지 않으므로 API 키 연결 설정이 없습니다. (향후 기능 추가 시 서버 측 인증 구조로 별도 구현)</p>
      </div>
      {msg && <p className="msg">{msg}</p>}
    </Modal>
  );
}

/** 공유 주소: 쿼리·해시 제거 */
export function shareUrl(): string {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  return u.toString();
}

function qrCanvas(text: string, cell = 10, margin = 4): HTMLCanvasElement {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const size = (n + margin * 2) * cell;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect((k + margin) * cell, (r + margin) * cell, cell, cell);
  return c;
}

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const url = shareUrl();
  const local = location.protocol === 'file:' || /^(localhost|127\.|\[::1\])/.test(location.hostname);
  const [img] = useState(() => qrCanvas(url).toDataURL('image/png'));
  const [msg, setMsg] = useState('');
  return (
    <Modal
      title="앱 공유"
      onClose={onClose}
      foot={
        <>
          {'share' in navigator && (
            <button className="btn" onClick={() => navigator.share({ title: APP_NAME, url }).catch(() => {})}>
              공유하기
            </button>
          )}
          <a className="btn" href={img} download="pureun-cad-qr.png">
            QR 이미지 저장
          </a>
          <button
            className="btn primary"
            onClick={() =>
              navigator.clipboard.writeText(url).then(
                () => setMsg('링크를 복사했습니다.'),
                () => setMsg('복사할 수 없습니다. 주소를 직접 선택해 복사하십시오.'),
              )
            }
          >
            링크 복사
          </button>
        </>
      }
    >
      <div className="qr">
        <img src={img} alt="앱 주소 QR코드" />
      </div>
      <p className="small" style={{ wordBreak: 'break-all', userSelect: 'text' }}>
        {url}
      </p>
      {local && <p className="warn">현재 주소는 이 컴퓨터에서만 열리는 로컬 주소입니다. 다른 기기와 공유하려면 배포된 주소(예: GitHub Pages)에서 공유하십시오.</p>}
      <p className="small">공유 링크에는 앱 주소만 포함되며 도면·비밀번호·설정 정보는 포함되지 않습니다.</p>
      {msg && <p className="msg">{msg}</p>}
    </Modal>
  );
}

export function VersionDialog({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<string>('');
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const check = async () => {
    setState('확인 중…');
    try {
      const r = await fetch('version.json', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { version: string; date: string };
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
      await reg?.update();
      if (reg?.waiting) setWaiting(reg.waiting);
      if (j.version === APP_VERSION) setState(`최신 버전입니다. (배포 버전 ${j.version}, ${j.date})`);
      else setState(`새 버전 ${j.version} (${j.date})이 있습니다. 아래 "새 버전 적용" 또는 새로고침으로 업데이트하십시오. 도면은 자동 저장 데이터로 보존됩니다.`);
    } catch {
      setState('새 버전을 확인할 수 없습니다. (오프라인이거나 배포 주소가 아님) 현재 버전은 그대로 사용할 수 있습니다.');
    }
  };
  return (
    <Modal
      title="버전 정보 · 업그레이드"
      onClose={onClose}
      foot={
        <>
          {waiting && (
            <button
              className="btn"
              onClick={() => {
                waiting.postMessage('skipWaiting');
                setTimeout(() => location.reload(), 300);
              }}
            >
              새 버전 적용
            </button>
          )}
          <button className="btn primary" onClick={check}>
            업그레이드 확인
          </button>
        </>
      }
    >
      <p>
        <b>
          {APP_NAME} {APP_VERSION}
        </b>{' '}
        <span className="small">빌드 {BUILD_DATE}</span>
      </p>
      {CHANGES.map((c) => (
        <div key={c.v} className="section">
          <h4>
            {c.v} · {c.date}
          </h4>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {c.items.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      ))}
      <p className="small">업데이트 방식: 웹앱(PWA) — 배포 주소에 새 버전이 올라가면 이 화면에서 확인 후 적용합니다. 자동 설치형 업데이트는 지원하지 않습니다.</p>
      {state && <p className="msg">{state}</p>}
    </Modal>
  );
}
