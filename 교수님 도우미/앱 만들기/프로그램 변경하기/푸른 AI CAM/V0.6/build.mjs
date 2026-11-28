// 푸른 AI CAM 빌드: 기능별 소스 파일(src/)을 하나의 무설치 HTML 로 자동 통합한다 (외부 의존성 없음)
// 로드 순서는 src/modules.json 하나로 관리 (Node 테스트 로더와 공용)
// 사용: node build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const rd = f => readFileSync(join(here, 'src', f), 'utf8');
const mods = JSON.parse(rd('modules.json'));
const bundle = list => list.map(f => '/* ==== ' + f + ' ==== */\n' + rd(f)).join('\n');
const qrLicense = '/*\n' + rd('vendor/LICENSE-qrcode-generator.txt').replace(/\*\//g, '* /') + '*/\n';
const threeLicense = '/*\n' + rd('vendor/LICENSE-three.txt').replace(/\*\//g, '* /') + '*/\n';
const clipLicense = '/*\n' + rd('vendor/LICENSE-clipper.txt').replace(/\*\//g, '* /') + '*/\n';
const parts = {
  '/*__CSS__*/': rd('style.css'),
  '/*__QR__*/': qrLicense + rd('vendor/qrcode-generator-1.4.4.js'),
  '/*__THREE__*/': threeLicense + rd('vendor/three-0.149.0.min.js'),
  '/*__CLIPPER__*/': clipLicense + rd('vendor/clipper-6.4.2.js'),
  '/*__CORE__*/': bundle(mods.core),
  '/*__UI__*/': bundle(mods.ui)
};
let html = rd('template.html');
for (const [k, v] of Object.entries(parts)) {
  if (/<\/script/i.test(v)) throw new Error(k + ' 에 </script 문자열이 있어 인라인할 수 없습니다.');
  if (!html.includes(k)) throw new Error('템플릿에 ' + k + ' 가 없습니다.');
  html = html.split(k).join(v);
}
const common = rd('engine/common.js');
const ver = /VERSION = '([^']+)'/.exec(common)[1];
const date = /BUILD_DATE = '([^']+)'/.exec(common)[1];
writeFileSync(join(here, 'pureun-ai-cam.html'), html);
writeFileSync(join(here, 'version.json'), JSON.stringify({ app: '푸른 AI CAM', version: ver, date }, null, 2) + '\n');
console.log('빌드 완료: pureun-ai-cam.html (' + (html.length / 1024).toFixed(1) + ' KB), 버전 ' + ver + ', 모듈 ' + (mods.core.length + mods.ui.length) + '개');
