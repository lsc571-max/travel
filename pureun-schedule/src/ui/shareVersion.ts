// 공유(링크·QR)와 버전·업그레이드 화면.
import QRCode from 'qrcode';
import { APP_BUILD_DATE, APP_NAME, APP_VERSION } from '../config';
import { $, el, openDialog, toast } from './dom';

function appUrl(): string {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

export async function openShare() {
  const url = appUrl();
  $('shareUrl').textContent = url;
  const local = /^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname) || location.protocol !== 'https:';
  const warn = $('shareWarn');
  warn.hidden = !local;
  warn.textContent = '아직 정식 배포 주소가 아닙니다. Firebase 배포 후 공유해 주세요.';
  try {
    await QRCode.toCanvas($<HTMLCanvasElement>('qr'), url, { width: 360, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
  } catch {
    toast('QR코드를 만들지 못했습니다.');
  }
  $('shNative').hidden = typeof navigator.share !== 'function';
  openDialog($<HTMLDialogElement>('share'));
}

export function initShare() {
  $('shCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(appUrl()); toast('링크를 복사했습니다.'); } catch { toast('복사하지 못했습니다. 주소를 길게 눌러 복사해 주세요.'); }
  };
  $('shNative').onclick = async () => {
    try { await navigator.share({ title: APP_NAME, url: appUrl() }); } catch { /* 사용자가 취소 */ }
  };
  $('shSave').onclick = () => {
    const a = el('a', { href: $<HTMLCanvasElement>('qr').toDataURL('image/png'), download: 'pureun-schedule-qr.png' });
    a.click();
  };
}

// ───── 버전 ─────
interface VersionInfo { version: string; date: string; changes: string[] }
let waitingWorker: ServiceWorker | null = null;

function setWaitingWorker(w: ServiceWorker | null) {
  waitingWorker = w;
  $('verBtn').classList.toggle('has-update', !!w);
}

export async function openVersion() {
  const body = $('versionBody');
  body.replaceChildren(el('p', { className: 'note', textContent: '확인 중…' }));
  openDialog($<HTMLDialogElement>('version'));
  let latest: VersionInfo | null = null;
  try {
    const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) latest = await r.json();
  } catch { /* 오프라인 */ }

  const rows = [
    el('div', { className: 'kv' }, el('span', { className: 'k', textContent: '현재 버전' }), el('span', { className: 'v', textContent: `${APP_VERSION} (${APP_BUILD_DATE})` })),
    el('div', { className: 'kv' }, el('span', { className: 'k', textContent: '최신 버전' }), el('span', { className: 'v', textContent: latest ? `${latest.version} (${latest.date})` : '확인할 수 없음 (오프라인)' })),
  ];
  const hasUpdate = !!waitingWorker || (!!latest && latest.version !== APP_VERSION);
  const btn = el('button', { className: 'btn primary', type: 'button', textContent: hasUpdate ? '업그레이드 (새로고침)' : '최신 버전입니다' });
  btn.disabled = !hasUpdate;
  btn.onclick = () => {
    if (waitingWorker) waitingWorker.postMessage('SKIP_WAITING');
    else location.reload();
  };
  const list = el('ul', { className: 'changes' }, ...(latest?.changes ?? []).map((c) => el('li', { textContent: c })));
  body.replaceChildren(
    ...rows,
    el('h3', { textContent: '변경 내역' }), list,
    el('div', { className: 'row-btns' }, btn),
    el('p', { className: 'note', textContent: '업그레이드해도 일정은 구글 캘린더에 있으므로 지워지지 않습니다.' }),
  );
}

export function initServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const check = () => { if (reg.waiting && navigator.serviceWorker.controller) { setWaitingWorker(reg.waiting); toast('새 버전이 있습니다. 하단 버전 표시를 눌러 업그레이드하세요.', 6000); } };
    check();
    reg.addEventListener('updatefound', () => {
      reg.installing?.addEventListener('statechange', check);
    });
    setInterval(() => { void reg.update(); }, 60 * 60 * 1000);
  }).catch(() => { /* 서비스워커 미지원 환경 */ });
}
