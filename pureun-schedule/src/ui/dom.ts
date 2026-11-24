// 화면 공통 도우미: 요소 찾기, 알림 메시지, 선택 확인창, 대화상자 열고 닫기.

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 없음`);
  return el as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  children.forEach((c) => e.append(c));
  return e;
}

let toastTimer = 0;
export function toast(msg: string, ms = 3500) {
  const t = $('toast');
  t.textContent = msg; // 항상 글자 그대로 표시 (HTML 해석 안 함)
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { t.hidden = true; }, ms);
}

export function openDialog(d: HTMLDialogElement) {
  if (!d.open) d.showModal();
}

/** data-close 버튼과 바깥 클릭으로 닫기 */
export function wireDialogs() {
  document.querySelectorAll<HTMLDialogElement>('dialog').forEach((d) => {
    d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close('cancel')));
    d.addEventListener('click', (ev) => {
      if (ev.target === d && d.id !== 'confirm') d.close('cancel');
    });
  });
}

/** 버튼 여러 개 중 하나를 고르는 확인창. 취소하면 null */
export function choose<T extends string>(text: string, buttons: { label: string; value: T; kind?: 'primary' | 'danger' }[]): Promise<T | null> {
  const d = $<HTMLDialogElement>('confirm');
  $('cfText').textContent = text;
  const box = $('cfBtns');
  box.replaceChildren(el('span', { className: 'grow' }));
  return new Promise((resolve) => {
    let result: T | null = null;
    const cancel = el('button', { type: 'button', className: 'btn', textContent: '취소' });
    cancel.onclick = () => d.close();
    box.append(cancel);
    buttons.forEach((b) => {
      const btn = el('button', { type: 'button', className: `btn ${b.kind ?? ''}`, textContent: b.label });
      btn.onclick = () => { result = b.value; d.close(); };
      box.append(btn);
    });
    d.addEventListener('close', () => resolve(result), { once: true });
    openDialog(d);
  });
}
