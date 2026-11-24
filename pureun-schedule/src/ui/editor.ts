// 일정 등록·수정·삭제 화면.
import { isConnected } from '../lib/auth';
import * as api from '../lib/calendarApi';
import { CATEGORIES, GOOGLE_COLORS, DEFAULT_EVENT_COLOR } from '../lib/colors';
import { localTimeZone, toDateStr, WEEKDAY_CODES, WEEKDAY_KO } from '../lib/dates';
import {
  applyForm, blankForm, eventToForm, fromGoogle, reminderLabel, validateForm,
  type CalEvent, type EventForm, type GEvent, type Importance, type ReminderChoice, type RepeatFreq,
} from '../lib/eventModel';
import { getSettings } from '../lib/settings';
import * as store from '../lib/store';
import { $, choose, el, openDialog, toast } from './dom';

type Mode = { kind: 'new' } | { kind: 'edit'; ev: CalEvent; master?: GEvent };

let mode: Mode = { kind: 'new' };
let initial: EventForm;
let category = '';
let colorId = '';
let colorPicked = false;
let importance: Importance = 0;
let byDay: string[] = [];
let customRule: string | undefined;
let busy = false;
let afterChange: () => void = () => {};
let requireConnect: () => void = () => {};

const REMINDER_MINUTES = [0, 10, 30, 60, 1440];

export function reminderOptions(sel: HTMLSelectElement, current: ReminderChoice, withKeep: boolean) {
  const opts: [string, string][] = [['default', '캘린더 기본 알림'], ['none', '알림 없음']];
  const mins = [...REMINDER_MINUTES];
  if (typeof current === 'number' && !mins.includes(current)) mins.push(current);
  mins.sort((a, b) => a - b).forEach((m) => opts.push([String(m), reminderLabel(m)]));
  if (withKeep) opts.push(['keep', '기존 알림 유지 (구글 캘린더에서 설정한 여러 알림)']);
  sel.replaceChildren(...opts.map(([v, l]) => el('option', { value: v, textContent: l })));
  sel.value = String(current);
}

export function parseReminder(v: string): ReminderChoice {
  return v === 'default' || v === 'none' || v === 'keep' ? v : Number(v);
}

export function initEditor(opts: { onChange: () => void; requireConnect: () => void }) {
  afterChange = opts.onChange;
  requireConnect = opts.requireConnect;

  // 요일 버튼
  const bd = $('fByDay');
  WEEKDAY_CODES.forEach((code, i) => {
    const b = el('button', { type: 'button', textContent: WEEKDAY_KO[i] });
    b.dataset.v = code;
    b.onclick = () => {
      byDay = byDay.includes(code) ? byDay.filter((c) => c !== code) : [...byDay, code];
      renderByDay();
    };
    bd.append(b);
  });

  $('fImportance').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.onclick = () => { importance = Number(b.dataset.v) as Importance; renderImportance(); };
  });

  $<HTMLInputElement>('fAllDay').onchange = renderTimeInputs;
  $<HTMLSelectElement>('fRepeat').onchange = () => {
    if ($<HTMLSelectElement>('fRepeat').value !== 'custom') customRule = undefined;
    renderRepeat();
  };
  $<HTMLSelectElement>('fRepeatEnd').onchange = renderRepeat;
  $<HTMLInputElement>('fStartDate').onchange = () => {
    const s = $<HTMLInputElement>('fStartDate'), e = $<HTMLInputElement>('fEndDate');
    if (e.value < s.value) e.value = s.value;
  };
  $<HTMLInputElement>('fStartTime').onchange = () => {
    const sd = $<HTMLInputElement>('fStartDate').value, ed = $<HTMLInputElement>('fEndDate').value;
    const st = $<HTMLInputElement>('fStartTime'), et = $<HTMLInputElement>('fEndTime');
    if (sd === ed && et.value <= st.value) {
      const [h, m] = st.value.split(':').map(Number);
      et.value = h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  };

  $<HTMLFormElement>('evForm').addEventListener('submit', (ev) => { ev.preventDefault(); void save(); });
  $('edDelete').onclick = () => void remove();
}

function renderCategory() {
  const box = $('fCategory');
  const cats = [{ key: '', label: '없음' }, ...CATEGORIES];
  const colors = getSettings().categoryColors;
  box.replaceChildren(...cats.map((c) => {
    const hex = c.key ? GOOGLE_COLORS[colors[c.key]]?.hex ?? DEFAULT_EVENT_COLOR : '';
    const b = el('button', { type: 'button', className: c.key === category ? 'chip on' : 'chip' });
    b.setAttribute('aria-pressed', String(c.key === category));
    if (hex) b.append(el('i', { className: 'dot' }));
    if (hex) (b.firstChild as HTMLElement).style.background = hex;
    b.append(c.label);
    b.onclick = () => {
      category = c.key;
      if (!colorPicked) colorId = c.key ? colors[c.key] ?? '' : '';
      renderCategory(); renderColors();
    };
    return b;
  }));
}

function renderColors() {
  const box = $('fColor');
  const items: [string, string, string][] = [['', DEFAULT_EVENT_COLOR, '기본'], ...Object.entries(GOOGLE_COLORS).map(([k, v]) => [k, v.hex, v.name] as [string, string, string])];
  box.replaceChildren(...items.map(([id, hex, name]) => {
    const b = el('button', { type: 'button', className: id === colorId ? 'sw on' : 'sw', title: name });
    b.setAttribute('aria-label', `${name}${id === colorId ? ' (선택됨)' : ''}`);
    b.style.background = hex;
    b.onclick = () => { colorId = id; colorPicked = true; renderColors(); };
    return b;
  }));
}

function renderImportance() {
  $('fImportance').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    const on = Number(b.dataset.v) === importance;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function renderByDay() {
  $('fByDay').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    const on = byDay.includes(b.dataset.v!);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function renderTimeInputs() {
  const allDay = $<HTMLInputElement>('fAllDay').checked;
  document.querySelectorAll<HTMLElement>('#editor .field.time').forEach((x) => { x.hidden = allDay; });
}

function renderRepeat() {
  const r = $<HTMLSelectElement>('fRepeat').value as RepeatFreq;
  const end = $<HTMLSelectElement>('fRepeatEnd').value;
  const simple = r !== 'none' && r !== 'custom';
  $('fByDay').hidden = r !== 'WEEKLY';
  $('repeatEndBox').hidden = !simple;
  $('fUntil').hidden = end !== 'until';
  $('fCount').hidden = end !== 'count';
  ($('fRepeat').querySelector('option[value=custom]') as HTMLOptionElement).hidden = r !== 'custom';
  renderByDay();
}

function fill(f: EventForm, readOnly: boolean, isInstance: boolean) {
  initial = f;
  $<HTMLInputElement>('fTitle').value = f.title;
  $<HTMLInputElement>('fAllDay').checked = f.allDay;
  $<HTMLInputElement>('fStartDate').value = f.startDate;
  $<HTMLInputElement>('fStartTime').value = f.startTime;
  $<HTMLInputElement>('fEndDate').value = f.endDate;
  $<HTMLInputElement>('fEndTime').value = f.endTime;
  $<HTMLInputElement>('fLocation').value = f.location;
  $<HTMLTextAreaElement>('fDesc').value = f.description;
  $<HTMLSelectElement>('fRepeat').value = f.repeat;
  $<HTMLSelectElement>('fRepeatEnd').value = f.repeatEnd;
  $<HTMLInputElement>('fUntil').value = f.until;
  $<HTMLInputElement>('fCount').value = String(f.count);
  reminderOptions($<HTMLSelectElement>('fReminder'), f.reminder, f.reminder === 'keep');
  category = f.category; colorId = f.colorId; colorPicked = !!f.colorId && f.colorId !== (getSettings().categoryColors[f.category] ?? '');
  importance = f.importance; byDay = [...f.byDay]; customRule = f.customRule;
  renderCategory(); renderColors(); renderImportance(); renderTimeInputs(); renderRepeat();

  const note = $('repeatNote');
  note.hidden = !isInstance && f.repeat !== 'custom';
  note.textContent = isInstance
    ? '반복 일정입니다. 반복 설정 변경은 저장할 때 "전체 반복 일정"을 고르면 적용됩니다.'
    : '구글 캘린더에서 만든 복잡한 반복 규칙입니다. 바꾸지 않으면 그대로 유지됩니다.';

  const form = $<HTMLFormElement>('evForm');
  form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea,.sheet-body button')
    .forEach((x) => { x.disabled = readOnly; });
  $('edReadonly').hidden = !readOnly;
  $('edSave').hidden = readOnly;
  $('edError').hidden = true;
}

export function openNew(date: string, opts: { startTime?: string; endTime?: string; endDate?: string; allDay?: boolean } = {}) {
  mode = { kind: 'new' };
  const f = blankForm(date, getSettings().defaultReminder, opts.startTime);
  if (opts.endTime) f.endTime = opts.endTime;
  if (opts.endDate) f.endDate = opts.endDate;
  if (opts.allDay) f.allDay = true;
  $('edTitle').textContent = '새 일정';
  $('edDelete').hidden = true;
  fill(f, false, false);
  openDialog($<HTMLDialogElement>('editor'));
  setTimeout(() => $<HTMLInputElement>('fTitle').focus(), 50);
}

export async function openEdit(ev: CalEvent) {
  mode = { kind: 'edit', ev };
  $('edTitle').textContent = ev.readOnly ? '공휴일' : '일정 수정';
  $('edDelete').hidden = ev.readOnly;
  fill(eventToForm(ev), ev.readOnly, !!ev.recurringEventId);
  openDialog($<HTMLDialogElement>('editor'));
  if (ev.recurringEventId && !ev.readOnly && isConnected()) {
    try {
      const master = await api.getEvent(ev.calendarId, ev.recurringEventId);
      if (mode.kind === 'edit' && mode.ev.key === ev.key) {
        mode.master = master;
        fill(eventToForm(ev, master.recurrence), false, true);
      }
    } catch { /* 반복 정보 없이도 '이 일정만' 수정은 가능 */ }
  }
}

function readForm(): EventForm {
  return {
    title: $<HTMLInputElement>('fTitle').value,
    allDay: $<HTMLInputElement>('fAllDay').checked,
    startDate: $<HTMLInputElement>('fStartDate').value,
    startTime: $<HTMLInputElement>('fStartTime').value,
    endDate: $<HTMLInputElement>('fEndDate').value,
    endTime: $<HTMLInputElement>('fEndTime').value,
    location: $<HTMLInputElement>('fLocation').value,
    description: $<HTMLTextAreaElement>('fDesc').value,
    category, colorId, importance,
    reminder: parseReminder($<HTMLSelectElement>('fReminder').value),
    repeat: $<HTMLSelectElement>('fRepeat').value as RepeatFreq,
    byDay,
    repeatEnd: $<HTMLSelectElement>('fRepeatEnd').value as EventForm['repeatEnd'],
    until: $<HTMLInputElement>('fUntil').value,
    count: Number($<HTMLInputElement>('fCount').value),
    customRule,
  };
}

function showError(msg: string) {
  const e = $('edError');
  e.textContent = msg;
  e.hidden = false;
}

function canWrite(): boolean {
  if (!navigator.onLine) { showError('오프라인 상태입니다. 인터넷 연결 후 저장해 주세요.'); return false; }
  if (!isConnected()) { showError('Google 캘린더 연결이 필요합니다.'); requireConnect(); return false; }
  return true;
}

function setBusy(b: boolean) {
  busy = b;
  $<HTMLButtonElement>('edSave').disabled = b;
  $<HTMLButtonElement>('edDelete').disabled = b;
  $('edSave').textContent = b ? '저장 중…' : '저장';
}

const masterStart = (m: GEvent) => m.start.date ?? toDateStr(new Date(m.start.dateTime!));

/** 다른 기기에서 먼저 바뀐 경우 사용자에게 묻는다. 덮어쓰기면 true */
async function confirmOverwrite(): Promise<boolean> {
  const c = await choose('다른 기기(또는 구글 캘린더)에서 이 일정이 먼저 수정되었습니다.\n내 변경 내용으로 덮어쓸까요?', [
    { label: '최신 내용 보기', value: 'reload' },
    { label: '내 내용으로 덮어쓰기', value: 'overwrite', kind: 'danger' },
  ]);
  if (c === 'overwrite') return true;
  if (c === 'reload') { $<HTMLDialogElement>('editor').close(); store.invalidate(); afterChange(); }
  return false;
}

async function save() {
  if (busy || (mode.kind === 'edit' && mode.ev.readOnly)) return;
  const f = readForm();
  const err = validateForm(f);
  if (err) return showError(err);
  if (!canWrite()) return;
  const tz = localTimeZone();
  setBusy(true);
  try {
    if (mode.kind === 'new') {
      const created = await api.insertEvent('primary', applyForm({}, f, { tz, includeRecurrence: true }));
      if (f.repeat !== 'none') store.invalidate();
      const ce = fromGoogle(created, 'primary', false);
      if (ce && f.repeat === 'none') await store.upsertLocal(ce);
      toast('일정을 저장했습니다.');
    } else {
      const ev = mode.ev;
      let scope: 'this' | 'all' = 'this';
      if (ev.recurringEventId) {
        const c = await choose('반복 일정입니다. 어디까지 바꿀까요?', [
          { label: '이 일정만', value: 'this' }, { label: '전체 반복 일정', value: 'all', kind: 'primary' },
        ]);
        if (!c) return;
        scope = c;
      }
      if (scope === 'all') {
        if (f.repeat === 'none') return showError('반복을 없애려면 "전체 반복 일정"을 삭제한 뒤 새로 만들어 주세요.');
        const master = await api.getEvent(ev.calendarId, ev.recurringEventId!);
        const body = applyForm(master, f, { tz, includeRecurrence: true, series: { masterStartDate: masterStart(master), instanceOldStartDate: initial.startDate } });
        await api.updateEvent(ev.calendarId, master.id, body, master.etag);
        store.invalidate();
      } else {
        let latest = await api.getEvent(ev.calendarId, ev.id);
        if (ev.etag && latest.etag !== ev.etag && !(await confirmOverwrite())) return;
        const isSingle = !ev.recurringEventId;
        const send = async () => api.updateEvent(ev.calendarId, ev.id, applyForm(latest, f, { tz, includeRecurrence: isSingle }), latest.etag);
        let updated: GEvent;
        try {
          updated = await send();
        } catch (e) {
          if (!(e instanceof api.ApiError && e.status === 412) || !(await confirmOverwrite())) throw e;
          latest = await api.getEvent(ev.calendarId, ev.id);
          updated = await send();
        }
        const ce = fromGoogle(updated, ev.calendarId, false);
        if (isSingle && f.repeat !== 'none') store.invalidate();
        else if (ce) await store.upsertLocal(ce);
      }
      toast('일정을 수정했습니다.');
    }
    $<HTMLDialogElement>('editor').close();
    afterChange();
  } catch (e) {
    showError(e instanceof Error ? e.message : '저장하지 못했습니다.');
  } finally {
    setBusy(false);
  }
}

async function remove() {
  if (busy || mode.kind !== 'edit' || mode.ev.readOnly) return;
  const ev = mode.ev;
  if (!canWrite()) return;
  let target: 'this' | 'all' = 'this';
  if (ev.recurringEventId) {
    const c = await choose('반복 일정입니다. 어떻게 삭제할까요?', [
      { label: '이 일정만 삭제', value: 'this', kind: 'danger' }, { label: '전체 반복 일정 삭제', value: 'all', kind: 'danger' },
    ]);
    if (!c) return;
    target = c;
  } else {
    const c = await choose(`"${ev.title || '(제목 없음)'}" 일정을 삭제할까요?`, [{ label: '삭제', value: 'yes', kind: 'danger' }]);
    if (!c) return;
  }
  setBusy(true);
  try {
    if (target === 'all') {
      await api.deleteEvent(ev.calendarId, ev.recurringEventId!);
      await store.removeLocal((e) => e.recurringEventId === ev.recurringEventId && e.calendarId === ev.calendarId);
    } else {
      try {
        await api.deleteEvent(ev.calendarId, ev.id, ev.etag);
      } catch (e) {
        if (!(e instanceof api.ApiError && e.status === 412)) throw e;
        const c = await choose('다른 곳에서 먼저 수정된 일정입니다. 그래도 삭제할까요?', [{ label: '그래도 삭제', value: 'yes', kind: 'danger' }]);
        if (!c) return;
        await api.deleteEvent(ev.calendarId, ev.id);
      }
      await store.removeLocal((e) => e.key === ev.key);
    }
    toast('일정을 삭제했습니다.');
    $<HTMLDialogElement>('editor').close();
    afterChange();
  } catch (e) {
    showError(e instanceof Error ? e.message : '삭제하지 못했습니다.');
  } finally {
    setBusy(false);
  }
}
