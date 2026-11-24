// 숨겨진 관리자 설정: 설정창 톱니바퀴 3초 안 5회 → 비밀번호 확인 → 연결 설정.
import { CREDENTIALS_PAGE, DAILY_QUOTA, SCOPES } from '../config';
import { AdminPassword, MIN_PW_LEN, TapCounter } from '../lib/adminCore';
import * as auth from '../lib/auth';
import { testConnection } from '../lib/calendarApi';
import { isValidClientId, safeStorage, getStoredClientId, setStoredClientId, todayApiCalls } from '../lib/settings';
import { checkOwner, clearOwner } from '../lib/owner';
import * as store from '../lib/store';
import { $, choose, el, openDialog, toast } from './dom';

const pw = new AdminPassword(safeStorage);
const taps = new TapCounter(5, 3000);
const IDLE_MS = 10 * 60 * 1000;
let idleTimer = 0;
let lockTimer = 0;
type AuthMode = 'verify' | 'register' | 'change';
let authMode: AuthMode = 'verify';
let onStatusChange: () => void = () => {};

export function initAdmin(opts: { onStatusChange: () => void }) {
  onStatusChange = opts.onStatusChange;
  $('settingsGear').addEventListener('click', () => {
    if (taps.tap()) startAuth();
  });
  $('adminLink').addEventListener('click', () => startAuth()); // 접근성용 대체 경로 (같은 비밀번호 필요)
  $<HTMLFormElement>('adminAuthForm').addEventListener('submit', (e) => { e.preventDefault(); void submitAuth(); });
  $('aaForgot').addEventListener('click', () => void forgot());
  const admin = $<HTMLDialogElement>('admin');
  admin.addEventListener('close', () => { clearTimeout(idleTimer); $('adminBody').replaceChildren(); }); // 닫으면 민감 화면 제거
  ['click', 'keydown', 'input'].forEach((t) => admin.addEventListener(t, bumpIdle));
}

export function startAuth(mode?: AuthMode) {
  authMode = mode ?? (pw.isSet() ? 'verify' : 'register');
  const reg = authMode !== 'verify';
  $('aaTitle').textContent = authMode === 'register' ? '관리자 비밀번호 등록' : authMode === 'change' ? '새 비밀번호 설정' : '관리자 확인';
  $('aaDesc').textContent = authMode === 'register'
    ? `이 기기에서 처음 사용하는 관리자 비밀번호를 정해 주세요 (${MIN_PW_LEN}자 이상). 다른 기기와 공유되지 않습니다.`
    : authMode === 'change' ? `새 비밀번호를 두 번 입력해 주세요 (${MIN_PW_LEN}자 이상).` : '관리자 비밀번호를 입력해 주세요.';
  $('aaPw2Box').hidden = !reg;
  $('aaForgot').parentElement!.hidden = reg;
  $<HTMLInputElement>('aaPw').value = '';
  $<HTMLInputElement>('aaPw2').value = '';
  $<HTMLInputElement>('aaPw').autocomplete = reg ? 'new-password' : 'current-password';
  $('aaError').hidden = true;
  showLock();
  openDialog($<HTMLDialogElement>('adminAuth'));
  setTimeout(() => $<HTMLInputElement>('aaPw').focus(), 50);
}

function authError(msg: string) { const e = $('aaError'); e.textContent = msg; e.hidden = false; }

function showLock(): boolean {
  const until = authMode === 'verify' ? pw.lockedUntil() : 0;
  $<HTMLButtonElement>('aaOk').disabled = !!until;
  clearTimeout(lockTimer);
  if (until) lockTimer = window.setTimeout(() => { if (!showLock()) $('aaError').hidden = true; }, until - Date.now() + 200);
  if (until) authError(`비밀번호를 여러 번 틀려 잠겼습니다. ${new Date(until).toLocaleTimeString('ko-KR')} 이후 다시 시도해 주세요.`);
  return !!until;
}

async function submitAuth() {
  const p1 = $<HTMLInputElement>('aaPw').value;
  const ok = $<HTMLButtonElement>('aaOk');
  if (ok.disabled) return;
  ok.disabled = true;
  try {
    if (authMode !== 'verify') {
      if (p1.length < MIN_PW_LEN) return authError(`비밀번호는 ${MIN_PW_LEN}자 이상이어야 합니다.`);
      if (p1 !== $<HTMLInputElement>('aaPw2').value) return authError('두 비밀번호가 다릅니다.');
      await pw.set(p1);
      toast(authMode === 'change' ? '관리자 비밀번호를 바꿨습니다.' : '관리자 비밀번호를 등록했습니다.');
      $<HTMLDialogElement>('adminAuth').close();
      openAdmin();
      return;
    }
    const r = await pw.verify(p1);
    if (r.ok) {
      $<HTMLDialogElement>('adminAuth').close();
      openAdmin();
    } else if (r.locked) {
      showLock();
    } else {
      authError(`비밀번호가 맞지 않습니다. (남은 시도 ${r.remaining}회)`);
      $<HTMLInputElement>('aaPw').select();
    }
  } finally {
    if (!showLock()) ok.disabled = false;
  }
}

async function forgot() {
  if (!auth.hasClientId()) {
    const c = await choose('아직 Google 연결 설정이 없어 보호할 정보가 없습니다. 이 기기의 관리자 비밀번호를 초기화할까요?', [{ label: '초기화', value: 'yes', kind: 'danger' }]);
    if (c) { pw.clear(); startAuth('register'); }
    return;
  }
  const c = await choose('비밀번호 재설정을 위해 Google 계정을 다시 확인합니다. 진행할까요?', [{ label: 'Google로 확인', value: 'yes', kind: 'primary' }]);
  if (!c) return;
  try {
    await auth.connect('select_account');
    const who = await checkOwner();
    if (who === 'different') {
      await auth.disconnect();
      await store.clearAll();
      authError('처음 이 기기에 연결한 Google 계정과 다릅니다. 본인 계정으로 다시 시도해 주세요.');
      return;
    }
    if (who === 'unknown') return authError('Google 계정을 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
    pw.clear();
    startAuth('register');
  } catch (e) {
    authError(e instanceof Error ? e.message : 'Google 확인에 실패했습니다.');
  }
}

function bumpIdle() {
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    const d = $<HTMLDialogElement>('admin');
    if (d.open) { d.close(); toast('관리자 설정이 10분 동안 사용되지 않아 닫혔습니다.'); }
  }, IDLE_MS);
}

function row(label: string, value: string | Node) {
  return el('div', { className: 'kv' }, el('span', { className: 'k', textContent: label }), typeof value === 'string' ? el('span', { className: 'v', textContent: value }) : value);
}

function openAdmin() {
  render();
  openDialog($<HTMLDialogElement>('admin'));
  bumpIdle();
}

function render() {
  const body = $('adminBody');
  const stored = getStoredClientId();
  const effective = auth.clientId();

  const input = el('input', { id: 'adClientId', value: stored, placeholder: '123456789-xxxx.apps.googleusercontent.com', autocomplete: 'off', spellcheck: false });
  const status = el('p', { className: 'note', id: 'adStatus' });
  const setStatus = (msg: string, ok?: boolean) => { status.textContent = msg; status.className = `note ${ok === true ? 'ok' : ok === false ? 'warn' : ''}`; };
  setStatus(auth.isConnected() ? '연결됨' : effective ? '연결 안 됨 (설정 화면에서 "구글 연결"을 눌러 주세요)' : '클라이언트 ID가 없습니다', auth.isConnected() ? true : undefined);

  const saveBtn = el('button', { className: 'btn primary', textContent: '저장하기', type: 'button' });
  saveBtn.onclick = () => {
    const v = input.value.trim();
    if (!isValidClientId(v)) return setStatus('형식이 맞지 않습니다. "숫자-영문.apps.googleusercontent.com" 형태인지 확인해 주세요.', false);
    setStoredClientId(v);
    auth.resetClient();
    void auth.preload();
    setStatus('저장했습니다. "연결 테스트"로 확인해 주세요.', true);
    onStatusChange();
  };
  const testBtn = el('button', { className: 'btn', textContent: '연결 테스트', type: 'button' });
  testBtn.onclick = async () => {
    testBtn.disabled = true;
    setStatus('확인 중…');
    try {
      if (!auth.isConnected()) await auth.connect('');
      await testConnection();
      if ((await checkOwner()) === 'different') await store.clearAll();
      setStatus('연결 성공: Google 캘린더 일정을 읽을 수 있습니다.', true);
      onStatusChange();
    } catch (e) {
      setStatus(`연결 실패: ${e instanceof Error ? e.message : String(e)}`, false);
    } finally { testBtn.disabled = false; }
  };
  const delBtn = el('button', { className: 'btn danger', textContent: '삭제', type: 'button' });
  delBtn.onclick = async () => {
    const c = await choose('저장된 클라이언트 ID를 삭제하고 Google 연결을 끊을까요? (구글 캘린더의 일정은 지워지지 않습니다)', [{ label: '삭제', value: 'yes', kind: 'danger' }]);
    if (!c) return;
    await auth.disconnect();
    clearOwner();
    setStoredClientId('');
    auth.resetClient();
    await store.clearAll();
    input.value = '';
    render();
    onStatusChange();
  };
  const disconnectBtn = el('button', { className: 'btn', textContent: '연결 해제', type: 'button' });
  disconnectBtn.onclick = async () => {
    await auth.disconnect();
    await store.clearAll();
    setStatus('연결을 해제하고 이 기기의 일정 사본을 지웠습니다.');
    onStatusChange();
  };
  const getKey = el('a', { href: CREDENTIALS_PAGE, target: '_blank', rel: 'noopener noreferrer', className: 'btn', textContent: '키 받으러 가기 ↗' });
  const changePw = el('button', { className: 'btn', textContent: '관리자 비밀번호 변경', type: 'button' });
  changePw.onclick = () => { $<HTMLDialogElement>('admin').close(); startAuth('change'); };

  const calls = todayApiCalls();
  body.replaceChildren(
    el('section', { className: 'set-group' },
      el('h3', { textContent: 'Google Calendar 연결' }),
      el('p', { className: 'note', textContent: '사용 중 · 일정 보기·등록·수정·삭제에 사용합니다. 인증 방식: OAuth (API 키·비밀키 없음)' }),
      row('권한 범위', SCOPES.replace('https://www.googleapis.com/auth/', '')),
      row('현재 상태', status),
      el('label', { className: 'field' }, el('span', { textContent: 'OAuth 클라이언트 ID (공개 식별자, 비밀 아님)' }), input),
      el('div', { className: 'row-btns' }, saveBtn, testBtn, disconnectBtn, delBtn),
      el('div', { className: 'row-btns' }, getKey),
      el('p', { className: 'note', textContent: `승인된 JavaScript 원본에 이 주소를 등록해야 합니다: ${location.origin}` }),
      effective && !stored ? el('p', { className: 'note', textContent: '현재 앱에 기본 포함된 클라이언트 ID를 사용 중입니다.' }) : '',
    ),
    el('section', { className: 'set-group' },
      el('h3', { textContent: 'Google Drive 연결' }),
      el('p', { className: 'note', textContent: '2단계(사진·파일 첨부)에서 사용 예정 · 현재 권한을 요청하지 않습니다.' }),
    ),
    el('section', { className: 'set-group' },
      el('h3', { textContent: '사용량 · 비용' }),
      row('오늘 API 호출 (이 기기)', `${calls.toLocaleString('ko-KR')}회`),
      row('무료 한도', `하루 ${DAILY_QUOTA.toLocaleString('ko-KR')}회 (프로젝트 전체)`),
      row('예상 비용', '0원 (개인 사용 기준)'),
    ),
    el('section', { className: 'set-group' },
      el('h3', { textContent: '보안' }),
      el('div', { className: 'row-btns' }, changePw),
      el('p', { className: 'note', textContent: '관리자 비밀번호는 이 기기에만 해시로 저장되며 다른 기기와 동기화되지 않습니다. 10분 동안 사용하지 않으면 자동으로 닫힙니다.' }),
    ),
  );
}
