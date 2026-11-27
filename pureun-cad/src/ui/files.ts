// 파일 열기/저장 (브라우저 안에서만 처리, 외부 서버 전송 없음)
// File System Access API를 지원하면 사용하고, 아니면 파일 선택·내려받기로 처리한다.

interface FsHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(d: Blob | string): Promise<void>; close(): Promise<void> }>;
}
type W = Window & {
  showOpenFilePicker?: (o: unknown) => Promise<FsHandle[]>;
  showSaveFilePicker?: (o: unknown) => Promise<FsHandle>;
};

const types = [{ description: 'DXF 도면', accept: { 'application/dxf': ['.dxf'] } }];

export async function pickOpenFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  const w = window as W;
  if (w.showOpenFilePicker) {
    try {
      const [h] = await w.showOpenFilePicker({ types, multiple: false });
      const f = await h.getFile();
      return { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      // 지원하지 않는 환경이면 아래 방식으로
    }
  }
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.dxf,.DXF';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return res(null);
      res({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    };
    inp.addEventListener('cancel', () => res(null));
    inp.click();
  });
}

let lastHandle: FsHandle | null = null;
export const clearSaveHandle = () => {
  lastHandle = null;
};

/**
 * 저장. reuse=true이고 이번 세션에서 이 앱이 저장한 파일이 있으면 그 파일에 다시 쓴다.
 * 열기로 불러온 원본 파일에는 묻지 않고 덮어쓰지 않는다.
 * @returns 저장된 파일 이름 또는 null(취소)
 */
export async function saveText(text: string, suggested: string, reuse: boolean): Promise<string | null> {
  const blob = new Blob([text], { type: 'application/dxf' });
  const w = window as W;
  if (reuse && lastHandle) {
    const wr = await lastHandle.createWritable();
    await wr.write(blob);
    await wr.close();
    return lastHandle.name;
  }
  if (w.showSaveFilePicker) {
    try {
      const h = await w.showSaveFilePicker({ suggestedName: suggested, types });
      const wr = await h.createWritable();
      await wr.write(blob);
      await wr.close();
      lastHandle = h;
      return h.name;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = suggested;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return suggested;
}
