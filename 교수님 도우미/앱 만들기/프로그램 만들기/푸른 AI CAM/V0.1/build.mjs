// 푸른 AI CAM 빌드: src/ 의 파일을 하나의 무설치 HTML 로 합친다 (외부 의존성 없음)
// 사용: node build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const rd = f => readFileSync(join(here, 'src', f), 'utf8');
const qrLicense = '/*\n' + rd('vendor/LICENSE-qrcode-generator.txt').replace(/\*\//g, '* /') + '*/\n';
const parts = { '/*__CSS__*/': rd('style.css'), '/*__QR__*/': qrLicense + rd('vendor/qrcode-generator-1.4.4.js'), '/*__CORE__*/': rd('core.js'), '/*__UI__*/': rd('ui.js') };
let html = rd('template.html');
for (const [k, v] of Object.entries(parts)) {
  if (/<\/script/i.test(v)) throw new Error(k + ' 에 </script 문자열이 있어 인라인할 수 없습니다.');
  if (!html.includes(k)) throw new Error('템플릿에 ' + k + ' 가 없습니다.');
  html = html.split(k).join(v);
}
const ver = /VERSION = '([^']+)'/.exec(parts['/*__CORE__*/'])[1];
const date = /BUILD_DATE = '([^']+)'/.exec(parts['/*__CORE__*/'])[1];
writeFileSync(join(here, 'pureun-ai-cam.html'), html);
writeFileSync(join(here, 'version.json'), JSON.stringify({ app: '푸른 AI CAM', version: ver, date }, null, 2) + '\n');
console.log('빌드 완료: pureun-ai-cam.html (' + (html.length / 1024).toFixed(1) + ' KB), 버전 ' + ver);
