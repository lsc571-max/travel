import { Calendar, type EventInput } from '@fullcalendar/core';
import koLocale from '@fullcalendar/core/locales/ko';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import timeGridPlugin from '@fullcalendar/timegrid';
import './styles.css';

import { APP_VERSION, HOLIDAY_CALENDAR_ID } from './config';
import * as auth from './lib/auth';
import { CATEGORIES, GOOGLE_COLORS, HOLIDAY_COLOR, categoryLabel, resolveColor, textOn } from './lib/colors';
import { addDays, formatKoDate, parseDateStr, toDateStr, toTimeStr } from './lib/dates';
import { importanceMark, type CalEvent } from './lib/eventModel';
import { getSettings, onSettings, updateSettings, type Settings, type ViewName } from './lib/settings';
import { checkOwner } from './lib/owner';
import * as store from './lib/store';
import { dueLabel, type TaskItem } from './lib/taskModel';
import * as tasksStore from './lib/tasksStore';
import { initAdmin, startAuth } from './ui/admin';
import { $, el, openDialog, toast, wireDialogs } from './ui/dom';
import { initEditor, openEdit, openNew, parseReminder, reminderOptions } from './ui/editor';
import { initTaskEditor, openEditTask, openNewTask, toggleDone } from './ui/taskEditor';
import { initServiceWorker, initShare, openShare, openVersion } from './ui/shareVersion';

let selectedDate = toDateStr(new Date());
let calendar: Calendar;
let viewRange: [Date, Date] | null = null;

// ───────── 테마 · 글자 크기 ─────────
function applyLook(s: Settings) {
  const root = document.documentElement;
  if (s.theme === 'system') delete root.dataset.theme; else root.dataset.theme = s.theme;
  root.dataset.font = s.fontSize;
}

// ───────── 달력 ─────────
function toFc(e: CalEvent): EventInput {
  const holiday = e.calendarId === HOLIDAY_CALENDAR_ID;
  const bg = holiday ? HOLIDAY_COLOR : resolveColor(e.colorId, e.category, getSettings().categoryColors);
  return {
    id: e.key,
    title: (holiday ? '' : importanceMark(e.importance)) + (e.title || '(제목 없음)'),
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    backgroundColor: bg,
    borderColor: bg,
    textColor: textOn(bg),
    classNames: holiday ? ['ev-holiday'] : e.importance === 2 ? ['ev-very-important'] : [],
  };
}

const TASK_PREFIX = 'task:';
function taskToFc(t: TaskItem): EventInput {
  return {
    id: TASK_PREFIX + t.key,
    title: (t.done ? '✓ ' : '☐ ') + (t.title || '(제목 없음)'),
    start: t.due,
    allDay: true,
    classNames: t.done ? ['ev-task', 'ev-task-done'] : ['ev-task'],
  };
}

function renderCalendar() {
  if (!calendar || !viewRange) return;
  const evs = store.inRange(viewRange[0], viewRange[1]).map(toFc);
  if (getSettings().showTasks) {
    evs.push(...tasksStore.dueBetween(toDateStr(viewRange[0]), toDateStr(viewRange[1])).map(taskToFc));
  }
  calendar.batchRendering(() => {
    calendar.removeAllEventSources();
    calendar.addEventSource(evs);
  });
}

function updateHeader() {
  $('title').textContent = calendar.view.title;
  document.querySelectorAll<HTMLButtonElement>('.views button').forEach((b) => {
    const on = b.dataset.view === calendar.view.type;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
}

function initCalendar() {
  const s = getSettings();
  const mobile = window.matchMedia('(max-width: 720px)').matches;
  calendar = new Calendar($('calendar'), {
    plugins: [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin],
    locale: koLocale,
    initialView: s.defaultView,
    firstDay: s.weekStart,
    headerToolbar: false,
    height: '100%',
    dayMaxEvents: mobile ? 2 : 4,
    nowIndicator: true,
    fixedWeekCount: false,
    scrollTime: '08:00:00',
    eventTimeFormat: { hour: 'numeric', minute: '2-digit', meridiem: false, hour12: false },
    slotLabelFormat: { hour: 'numeric', minute: '2-digit', hour12: false },
    eventDisplay: 'block',
    dayCellContent: (arg) => arg.dayNumberText.replace('일', ''),
    views: { timeGrid: { selectable: true, selectMirror: true } },
    dayCellClassNames: (arg) => (toDateStr(arg.date) === selectedDate ? ['is-selected'] : []),
    datesSet: (info) => {
      viewRange = [info.start, info.end];
      updateHeader();
      renderCalendar();
      void sync(false);
    },
    dateClick: (info) => {
      selectDate(toDateStr(info.date));
      if (calendar.view.type === 'dayGridMonth' && window.matchMedia('(max-width: 720px)').matches) {
        document.querySelector('.day-pane')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    select: (info) => {
      calendar.unselect();
      if (info.allDay) openNew(toDateStr(info.start), { allDay: true, endDate: addDays(toDateStr(info.end), -1) });
      else openNew(toDateStr(info.start), { startTime: toTimeStr(info.start), endTime: toTimeStr(info.end), endDate: toDateStr(info.end) });
    },
    eventClick: (info) => {
      info.jsEvent.preventDefault();
      if (info.event.id.startsWith(TASK_PREFIX)) {
        const t = tasksStore.get(info.event.id.slice(TASK_PREFIX.length));
        if (t) openEditTask(t);
        return;
      }
      const ev = store.get(info.event.id);
      if (ev) void openEdit(ev);
    },
  });
  calendar.render();
}

function selectDate(d: string) {
  selectedDate = d;
  // 선택 표시 다시 그리기
  calendar.setOption('dayCellClassNames', (arg) => (toDateStr(arg.date) === selectedDate ? ['is-selected'] : []));
  renderSide();
  void sync(false);
}

// ───────── 오른쪽(모바일: 위쪽) 패널 ─────────
function evItem(e: CalEvent, showDate: boolean): HTMLLIElement {
  const holiday = e.calendarId === HOLIDAY_CALENDAR_ID;
  const color = holiday ? HOLIDAY_COLOR : resolveColor(e.colorId, e.category, getSettings().categoryColors);
  let when: string;
  if (e.allDay) when = '종일';
  else when = `${toTimeStr(new Date(e.start))}–${toTimeStr(new Date(e.end))}`;
  const datePart = showDate ? `${formatKoDate(e.allDay ? e.start : toDateStr(new Date(e.start)))} · ` : '';
  const dot = el('i', { className: 'dot' });
  dot.style.background = color;
  const btn = el('button', { type: 'button', className: holiday ? 'ev holiday' : 'ev' },
    dot,
    el('span', { className: 'when', textContent: datePart + when }),
    el('span', { className: 'what', textContent: (holiday ? '' : importanceMark(e.importance)) + (e.title || '(제목 없음)') }),
  );
  const meta = [categoryLabel(e.category), e.location ?? ''].filter(Boolean).join(' · ');
  if (meta) btn.append(el('span', { className: 'meta', textContent: meta }));
  btn.onclick = () => void openEdit(e);
  return el('li', {}, btn);
}

const sortEv = (a: CalEvent, b: CalEvent) => {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return (a.allDay ? parseDateStr(a.start).getTime() : new Date(a.start).getTime()) - (b.allDay ? parseDateStr(b.start).getTime() : new Date(b.start).getTime());
};

function renderSide() {
  const today = toDateStr(new Date());
  $('dayTitle').textContent = selectedDate === today ? `오늘 · ${formatKoDate(today)}` : formatKoDate(selectedDate);
  const dayStart = parseDateStr(selectedDate), dayEnd = parseDateStr(addDays(selectedDate, 1));
  const list = store.inRange(dayStart, dayEnd).sort(sortEv);
  const ul = $('dayList');
  ul.replaceChildren(...(list.length ? list.map((e) => evItem(e, false)) : [el('li', { className: 'empty', textContent: '일정이 없습니다.' })]));

  const upStart = parseDateStr(addDays(today, 1)), upEnd = parseDateStr(addDays(today, 8));
  const up = store.inRange(upStart, upEnd).sort(sortEv).slice(0, 30);
  $('upcoming').replaceChildren(...(up.length ? up.map((e) => evItem(e, true)) : [el('li', { className: 'empty', textContent: '다가오는 일정이 없습니다.' })]));
  renderTasks();
}

// ───────── 할 일 ─────────
let showDone = false;
function taskItem(t: TaskItem, today: string, multiList: boolean): HTMLLIElement {
  const check = el('button', { type: 'button', className: t.done ? 'tk-check on' : 'tk-check', textContent: t.done ? '✓' : '' });
  check.setAttribute('role', 'checkbox');
  check.setAttribute('aria-checked', String(t.done));
  check.setAttribute('aria-label', `${t.title || '(제목 없음)'} ${t.done ? '완료 취소' : '완료로 표시'}`);
  check.onclick = () => void toggleDone(t);
  const d = dueLabel(t.due, today);
  const meta = [d.text, multiList ? t.listTitle : ''].filter(Boolean).join(' · ');
  const body = el('button', { type: 'button', className: 'tk-body' },
    el('span', { className: 'what', textContent: t.title || '(제목 없음)' }),
    el('span', { className: d.overdue && !t.done ? 'when overdue' : 'when', textContent: meta }),
  );
  body.onclick = () => openEditTask(t);
  return el('li', { className: t.done ? 'task done' : 'task' }, check, body);
}

function renderTasks() {
  const on = getSettings().showTasks;
  ['taskHead', 'taskList'].forEach((id) => { $(id).hidden = !on; });
  const note = $('taskNote');
  if (!on) { note.hidden = true; $('btnDoneToggle').hidden = true; $('doneList').hidden = true; return; }
  let msg = '';
  if (!auth.isConnected()) msg = tasksStore.all().length ? '' : '구글 연결 후 할 일이 보입니다.';
  else if (!auth.hasTasksAccess()) msg = '할 일 권한이 없습니다. 설정 → 연결 끊기 → 구글 연결에서 "할 일" 권한에 체크해 주세요.';
  else if (tasksStore.lastError) msg = `할 일을 불러오지 못했습니다: ${tasksStore.lastError}`;
  note.textContent = msg;
  note.hidden = !msg;

  const today = toDateStr(new Date());
  const multi = tasksStore.getLists().length > 1;
  const all = tasksStore.all();
  const open = all.filter((t) => !t.done);
  const done = all.filter((t) => t.done).sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1)).slice(0, 30);
  $('taskCount').textContent = open.length ? `(${open.length})` : '';
  $('taskList').replaceChildren(...(open.length
    ? open.slice(0, 100).map((t) => taskItem(t, today, multi))
    : [el('li', { className: 'empty', textContent: auth.hasTasksAccess() ? '남은 할 일이 없습니다.' : '' })]));
  const tg = $<HTMLButtonElement>('btnDoneToggle');
  tg.hidden = !done.length;
  tg.textContent = showDone ? '완료한 할 일 숨기기' : `완료한 할 일 ${done.length}개 보기`;
  $('doneList').hidden = !showDone || !done.length;
  $('doneList').replaceChildren(...done.map((t) => taskItem(t, today, multi)));
}

async function syncTasks(force: boolean) {
  if (!getSettings().showTasks || !auth.hasTasksAccess() || !navigator.onLine) return;
  try { await tasksStore.ensure(force); } catch { /* 안내는 할 일 칸에 표시 */ }
}

// ───────── 동기화 ─────────
let syncing = false;
async function sync(force: boolean) {
  if (!auth.isConnected() || !navigator.onLine || !viewRange) { updateBanner(); return; }
  const today = toDateStr(new Date());
  const ranges: [Date, Date][] = [viewRange, [parseDateStr(selectedDate), parseDateStr(addDays(selectedDate, 1))], [parseDateStr(today), parseDateStr(addDays(today, 8))]];
  syncing = true;
  $('btnSync').classList.add('spin');
  try {
    await Promise.all([...ranges.map(([a, b]) => store.ensure(a, b, force)), syncTasks(force)]);
  } catch (e) {
    if (e instanceof Error) toast(e.message);
  } finally {
    syncing = false;
    $('btnSync').classList.remove('spin');
    updateBanner();
  }
}

function refreshAfterChange() {
  store.invalidate();
  renderCalendar();
  renderSide();
  void sync(false);
}

// ───────── 연결 안내 배너 ─────────
async function doConnect() {
  try {
    await auth.connect('');
    if ((await checkOwner()) === 'different') {
      await store.clearAll(); // 이전 계정의 일정 사본이 섞이지 않게
      toast('처음 연결한 계정과 다른 Google 계정입니다. 이 기기의 일정 사본을 새로 받습니다.', 5000);
    } else toast('Google 캘린더에 연결했습니다.');
    await sync(true);
  } catch (e) {
    toast(e instanceof Error ? e.message : '연결하지 못했습니다.', 5000);
  }
}

function updateBanner() {
  const b = $('banner'), t = $('bannerText'), btn = $<HTMLButtonElement>('bannerBtn');
  let text = '', label = '', action: (() => void) | null = null;
  if (!navigator.onLine) {
    text = '오프라인입니다. 저장된 일정만 볼 수 있고, 등록·수정은 연결 후 가능합니다.';
  } else if (!auth.hasClientId()) {
    text = '처음 설정이 필요합니다. Google 클라우드에서 받은 OAuth 클라이언트 ID를 관리자 설정에 입력해 주세요.';
    label = '관리자 설정 열기'; action = () => startAuth();
  } else if (!auth.isConnected()) {
    text = auth.wasConnected() ? 'Google 캘린더 연결이 필요합니다 (보안을 위해 앱을 열 때마다 한 번 눌러 주세요).' : 'Google 계정으로 캘린더를 연결해 주세요.';
    label = '구글 연결'; action = () => void doConnect();
  } else if (store.holidayError && getSettings().showHolidays) {
    text = '공휴일 캘린더를 불러오지 못했습니다. 내 일정은 정상입니다.';
  }
  b.hidden = !text;
  t.textContent = text;
  btn.hidden = !action;
  btn.textContent = label;
  btn.onclick = action;
  ($('fab') as HTMLButtonElement).disabled = !navigator.onLine;
}

// ───────── 일반 설정 ─────────
function renderSettings() {
  const s = getSettings();
  $<HTMLSelectElement>('sTheme').value = s.theme;
  $<HTMLSelectElement>('sFont').value = s.fontSize;
  $<HTMLSelectElement>('sView').value = s.defaultView;
  $<HTMLSelectElement>('sWeek').value = String(s.weekStart);
  $<HTMLInputElement>('sHoliday').checked = s.showHolidays;
  $<HTMLInputElement>('sTasks').checked = s.showTasks;
  reminderOptions($<HTMLSelectElement>('sReminder'), s.defaultReminder, false);
  $('sAccount').textContent = !auth.hasClientId() ? '아직 연결 설정이 없습니다 (관리자 설정 필요).' : auth.isConnected() ? 'Google 캘린더에 연결되어 있습니다.' : '연결되어 있지 않습니다.';
  $<HTMLButtonElement>('sConnect').hidden = auth.isConnected() || !auth.hasClientId();
  $<HTMLButtonElement>('sLogout').hidden = !auth.isConnected();

  const box = $('sCatColors');
  box.replaceChildren(...CATEGORIES.map((c) => {
    const sel = el('select');
    sel.setAttribute('aria-label', `${c.label} 색상`);
    sel.append(...Object.entries(GOOGLE_COLORS).map(([id, v]) => el('option', { value: id, textContent: v.name })));
    sel.value = s.categoryColors[c.key];
    const dot = el('i', { className: 'dot' });
    dot.style.background = GOOGLE_COLORS[sel.value]?.hex ?? '';
    sel.onchange = () => {
      updateSettings({ categoryColors: { ...getSettings().categoryColors, [c.key]: sel.value } });
      dot.style.background = GOOGLE_COLORS[sel.value].hex;
    };
    return el('label', { className: 'cat-row' }, dot, el('span', { textContent: c.label }), sel);
  }));
}

function initSettings() {
  const d = $<HTMLDialogElement>('settings');
  $('btnSettings').onclick = () => { renderSettings(); openDialog(d); };
  $<HTMLSelectElement>('sTheme').onchange = (e) => updateSettings({ theme: (e.target as HTMLSelectElement).value as Settings['theme'] });
  $<HTMLSelectElement>('sFont').onchange = (e) => updateSettings({ fontSize: (e.target as HTMLSelectElement).value as Settings['fontSize'] });
  $<HTMLSelectElement>('sView').onchange = (e) => {
    const v = (e.target as HTMLSelectElement).value as ViewName;
    updateSettings({ defaultView: v });
    calendar.changeView(v);
  };
  $<HTMLSelectElement>('sWeek').onchange = (e) => {
    const v = Number((e.target as HTMLSelectElement).value) as 0 | 1;
    updateSettings({ weekStart: v });
    calendar.setOption('firstDay', v);
  };
  $<HTMLInputElement>('sHoliday').onchange = (e) => {
    updateSettings({ showHolidays: (e.target as HTMLInputElement).checked });
    renderCalendar(); renderSide(); void sync(false);
  };
  $<HTMLInputElement>('sTasks').onchange = (e) => {
    updateSettings({ showTasks: (e.target as HTMLInputElement).checked });
    void sync(false);
  };
  $<HTMLSelectElement>('sReminder').onchange = (e) => updateSettings({ defaultReminder: parseReminder((e.target as HTMLSelectElement).value) });
  $('sConnect').onclick = async () => { await doConnect(); renderSettings(); };
  $('sLogout').onclick = async () => {
    await auth.disconnect();
    await store.clearAll();
    toast('연결을 끊고 이 기기에 저장된 일정 사본을 지웠습니다.');
    renderSettings();
  };
  $('sShare').onclick = () => { d.close(); void openShare(); };
  $('sVersion').onclick = () => { d.close(); void openVersion(); };
}

// ───────── 시작 ─────────
function init() {
  applyLook(getSettings());
  onSettings((s) => { applyLook(s); renderCalendar(); renderSide(); });
  $('verBtn').textContent = APP_VERSION;
  wireDialogs();
  initCalendar();
  initEditor({ onChange: refreshAfterChange, requireConnect: updateBanner });
  initTaskEditor({ requireConnect: updateBanner });
  $('btnAddTask').onclick = () => openNewTask(selectedDate);
  $('btnDoneToggle').onclick = () => { showDone = !showDone; renderTasks(); };
  initSettings();
  initAdmin({ onStatusChange: () => { updateBanner(); renderSettings(); void sync(true); } });
  initShare();

  $('btnToday').onclick = () => { calendar.today(); selectDate(toDateStr(new Date())); };
  $('btnPrev').onclick = () => calendar.prev();
  $('btnNext').onclick = () => calendar.next();
  const picker = $<HTMLInputElement>('datePicker');
  $('title').onclick = () => {
    picker.value = selectedDate;
    try { picker.showPicker(); } catch { picker.click(); }
  };
  picker.onchange = () => { if (picker.value) { calendar.gotoDate(picker.value); selectDate(picker.value); } };
  document.querySelectorAll<HTMLButtonElement>('.views button').forEach((b) => {
    b.onclick = () => { calendar.changeView(b.dataset.view!, selectedDate); };
  });
  $('btnSync').onclick = async () => {
    if (syncing) return;
    if (!auth.isConnected()) { updateBanner(); toast('먼저 구글 캘린더를 연결해 주세요.'); return; }
    store.invalidate();
    await sync(true);
    if (!store.lastError) toast('최신 일정으로 새로고침했습니다.', 1800);
  };
  $('btnShare').onclick = () => void openShare();
  $('verBtn').onclick = () => void openVersion();
  $('fab').onclick = () => openNew(selectedDate);
  $('btnAddDay').onclick = () => openNew(selectedDate);

  auth.onAuthChange(() => { updateBanner(); renderTasks(); });
  store.onChange(() => { renderCalendar(); renderSide(); });
  tasksStore.onChange(() => { renderCalendar(); renderTasks(); });
  tasksStore.loadCache();
  window.addEventListener('online', () => { updateBanner(); void sync(false); });
  window.addEventListener('offline', updateBanner);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void sync(false); });
  setInterval(() => { if (document.visibilityState === 'visible') void sync(false); }, 5 * 60 * 1000);

  void store.loadCache().then(renderSide);
  void auth.preload();
  updateBanner();
  renderSide();
  initServiceWorker();
}

init();
