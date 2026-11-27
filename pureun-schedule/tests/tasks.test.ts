import { describe, expect, it } from 'vitest';
import {
  completionPatch, dateToDue, dueLabel, dueToDate, fromGoogleTask, newTaskBody, sortTasks, taskPatch, validateTaskForm,
  type TaskItem,
} from '../src/lib/taskModel';

process.env.TZ = 'Asia/Seoul';
const L = { id: 'L1', title: '내 할 일' };

describe('할 일 마감일 변환', () => {
  it('Google due는 시간대 변환 없이 날짜만 사용', () => {
    expect(dueToDate('2026-11-27T00:00:00.000Z')).toBe('2026-11-27');
    expect(dueToDate(undefined)).toBe('');
    expect(dueToDate('엉터리')).toBe('');
  });
  it('날짜 → Google due, 빈 값은 null(마감일 지우기)', () => {
    expect(dateToDue('2026-12-31')).toBe('2026-12-31T00:00:00.000Z');
    expect(dateToDue('')).toBeNull();
  });
});

describe('할 일 변환', () => {
  it('완료·숨김·삭제 처리', () => {
    const t = fromGoogleTask({ id: 'a', title: ' 성적 입력 ', status: 'completed', due: '2026-11-25T00:00:00.000Z', completed: '2026-11-24T01:00:00.000Z' }, L)!;
    expect(t).toMatchObject({ key: 'L1|a', title: '성적 입력', done: true, due: '2026-11-25', listTitle: '내 할 일' });
    expect(fromGoogleTask({ id: 'b', status: 'completed', hidden: true }, L)).toBeNull(); // "완료 지우기"로 숨긴 항목
    expect(fromGoogleTask({ id: 'c', deleted: true }, L)).toBeNull();
  });
  it('새 할 일 본문: 마감일 없으면 due를 보내지 않음', () => {
    expect(newTaskBody({ title: ' 보고서 ', notes: '', due: '', done: false, listId: 'L1' })).toEqual({ title: '보고서', notes: '', status: 'needsAction' });
    expect(newTaskBody({ title: '보고서', notes: 'n', due: '2026-12-01', done: false, listId: 'L1' }).due).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('할 일 수정', () => {
  const before: TaskItem = { key: 'L1|a', id: 'a', listId: 'L1', listTitle: '', title: '제목', notes: '메모', due: '2026-11-27', done: false, completedAt: '', parent: '', position: '1' };
  it('바뀐 칸만 보낸다', () => {
    expect(taskPatch(before, { title: '제목', notes: '메모', due: '2026-11-27', done: false, listId: 'L1' })).toEqual({});
    expect(taskPatch(before, { title: '새 제목', notes: '메모', due: '', done: false, listId: 'L1' })).toEqual({ title: '새 제목', due: null });
  });
  it('완료 ↔ 되돌리기', () => {
    expect(taskPatch(before, { ...before, done: true })).toEqual({ status: 'completed' });
    expect(completionPatch(false)).toEqual({ status: 'needsAction', completed: null });
  });
  it('입력 검증', () => {
    expect(validateTaskForm({ title: '  ', notes: '', due: '', done: false, listId: 'L1' })).toMatch(/제목/);
    expect(validateTaskForm({ title: 'a', notes: '', due: '2026-1-1', done: false, listId: 'L1' })).toMatch(/형식/);
    expect(validateTaskForm({ title: 'a', notes: '', due: '', done: false, listId: 'L1' })).toBeNull();
  });
});

describe('할 일 정렬·마감 표시', () => {
  const mk = (id: string, due: string, done = false, position = '0'): TaskItem => ({ key: id, id, listId: 'L1', listTitle: '', title: id, notes: '', due, done, completedAt: '', parent: '', position });
  it('안 한 일 → 마감 빠른 순 → 마감 없음 → 완료', () => {
    const list = [mk('완료', '2026-11-01', true), mk('없음', ''), mk('나중', '2026-12-01'), mk('먼저', '2026-11-20')].sort(sortTasks);
    expect(list.map((t) => t.id)).toEqual(['먼저', '나중', '없음', '완료']);
  });
  it('지남·오늘·내일 표시 (월말 넘김 포함)', () => {
    expect(dueLabel('2026-11-26', '2026-11-27')).toEqual({ text: '11월 26일 (지남)', overdue: true });
    expect(dueLabel('2026-11-27', '2026-11-27').text).toBe('오늘까지');
    expect(dueLabel('2026-12-01', '2026-11-30').text).toBe('내일까지');
    expect(dueLabel('', '2026-11-27').text).toBe('마감일 없음');
  });
});
