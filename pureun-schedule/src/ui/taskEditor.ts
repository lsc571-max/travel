// 할 일 등록·수정·완료·삭제 화면.
import { hasTasksAccess, isConnected } from '../lib/auth';
import * as api from '../lib/tasksApi';
import * as tasksStore from '../lib/tasksStore';
import {
  completionPatch, fromGoogleTask, newTaskBody, taskPatch, validateTaskForm,
  type GTask, type TaskForm, type TaskItem,
} from '../lib/taskModel';
import { $, choose, el, openDialog, toast } from './dom';

let editing: TaskItem | null = null;
let busy = false;
let requireConnect: () => void = () => {};

export function initTaskEditor(opts: { requireConnect: () => void }) {
  requireConnect = opts.requireConnect;
  $<HTMLFormElement>('taskForm').addEventListener('submit', (e) => { e.preventDefault(); void save(); });
  $('tkDelete').onclick = () => void remove();
}

function showError(msg: string) { const e = $('tkError'); e.textContent = msg; e.hidden = false; }

/** 쓰기 전에 연결·권한 확인. 문제가 있으면 안내하고 false */
function canWrite(report: (m: string) => void): boolean {
  if (!navigator.onLine) { report('오프라인 상태입니다. 인터넷 연결 후 다시 해 주세요.'); return false; }
  if (!isConnected()) { report('Google 연결이 필요합니다.'); requireConnect(); return false; }
  if (!hasTasksAccess()) { report('할 일 권한이 없습니다. 설정에서 연결을 끊고 다시 연결해 "할 일" 권한에 체크해 주세요.'); return false; }
  return true;
}

function fillLists(selected: string) {
  const sel = $<HTMLSelectElement>('tList');
  const lists = tasksStore.getLists();
  sel.replaceChildren(...lists.map((l) => el('option', { value: l.id, textContent: l.title || '(이름 없음)' })));
  if (selected && lists.some((l) => l.id === selected)) sel.value = selected;
  $('tListBox').hidden = lists.length <= 1;
}

function fill(f: TaskForm) {
  $<HTMLInputElement>('tTitle').value = f.title;
  $<HTMLInputElement>('tDue').value = f.due;
  $<HTMLInputElement>('tDone').checked = f.done;
  $<HTMLTextAreaElement>('tNotes').value = f.notes;
  fillLists(f.listId);
  $('tkError').hidden = true;
}

export function openNewTask(due = '') {
  if (!canWrite(toast)) return;
  if (!tasksStore.getLists().length) { toast('할 일 목록을 아직 불러오지 못했습니다. 새로고침 후 다시 해 주세요.'); return; }
  editing = null;
  $('tkTitle').textContent = '새 할 일';
  $('tkDelete').hidden = true;
  $<HTMLSelectElement>('tList').disabled = false;
  fill({ title: '', notes: '', due, done: false, listId: tasksStore.getLists()[0].id });
  openDialog($<HTMLDialogElement>('taskEditor'));
  setTimeout(() => $<HTMLInputElement>('tTitle').focus(), 50);
}

export function openEditTask(t: TaskItem) {
  editing = t;
  $('tkTitle').textContent = '할 일 수정';
  $('tkDelete').hidden = false;
  fill({ title: t.title, notes: t.notes, due: t.due, done: t.done, listId: t.listId });
  $<HTMLSelectElement>('tList').disabled = true; // 목록 옮기기는 구글 할 일에서 (이 앱은 지원 안 함)
  openDialog($<HTMLDialogElement>('taskEditor'));
}

function readForm(): TaskForm {
  return {
    title: $<HTMLInputElement>('tTitle').value,
    due: $<HTMLInputElement>('tDue').value,
    done: $<HTMLInputElement>('tDone').checked,
    notes: $<HTMLTextAreaElement>('tNotes').value,
    listId: editing ? editing.listId : $<HTMLSelectElement>('tList').value,
  };
}

function setBusy(b: boolean) {
  busy = b;
  $<HTMLButtonElement>('tkSave').disabled = b;
  $<HTMLButtonElement>('tkDelete').disabled = b;
  $('tkSave').textContent = b ? '저장 중…' : '저장';
}

const listOf = (id: string) => tasksStore.getLists().find((l) => l.id === id) ?? { id, title: '' };

function applySaved(saved: GTask, listId: string) {
  const item = fromGoogleTask(saved, listOf(listId));
  if (item) tasksStore.upsertLocal(item);
}

async function save() {
  if (busy) return;
  const f = readForm();
  const err = validateTaskForm(f);
  if (err) return showError(err);
  if (!canWrite(showError)) return;
  setBusy(true);
  try {
    if (!editing) {
      applySaved(await api.insertTask(f.listId, newTaskBody(f)), f.listId);
      toast('할 일을 저장했습니다.');
    } else {
      const patch = taskPatch(editing, f);
      if (Object.keys(patch).length) applySaved(await api.patchTask(editing.listId, editing.id, patch), editing.listId);
      toast('할 일을 수정했습니다.');
    }
    $<HTMLDialogElement>('taskEditor').close();
  } catch (e) {
    showError(e instanceof Error ? e.message : '저장하지 못했습니다.');
  } finally {
    setBusy(false);
  }
}

async function remove() {
  if (busy || !editing) return;
  const t = editing;
  if (!canWrite(showError)) return;
  const c = await choose(`"${t.title || '(제목 없음)'}" 할 일을 삭제할까요?`, [{ label: '삭제', value: 'yes', kind: 'danger' }]);
  if (!c) return;
  setBusy(true);
  try {
    await api.deleteTask(t.listId, t.id);
    tasksStore.removeLocal(t.key);
    toast('할 일을 삭제했습니다.');
    $<HTMLDialogElement>('taskEditor').close();
  } catch (e) {
    showError(e instanceof Error ? e.message : '삭제하지 못했습니다.');
  } finally {
    setBusy(false);
  }
}

/** 목록의 체크칸: 완료 ↔ 안 함 전환 */
export async function toggleDone(t: TaskItem): Promise<void> {
  if (!canWrite(toast)) return;
  const done = !t.done;
  tasksStore.upsertLocal({ ...t, done }); // 바로 반영하고, 실패하면 되돌린다
  try {
    applySaved(await api.patchTask(t.listId, t.id, completionPatch(done)), t.listId);
    toast(done ? '완료로 표시했습니다.' : '다시 할 일로 돌렸습니다.', 1800);
  } catch (e) {
    tasksStore.upsertLocal(t);
    toast(e instanceof Error ? e.message : '바꾸지 못했습니다.');
  }
}
