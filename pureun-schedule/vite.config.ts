import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// 테스트는 한국 시간 기준으로 실행
process.env.TZ = 'Asia/Seoul';

// 미리보기(preview) 서버에도 배포(firebase.json)와 같은 보안 헤더를 붙여, 브라우저 시험에서 CSP 위반을 잡는다
const firebase = JSON.parse(readFileSync(new URL('./firebase.json', import.meta.url), 'utf8'));
const deployHeaders: Record<string, string> = Object.fromEntries(
  (firebase.hosting.headers.find((h: { source?: string }) => h.source === '**')?.headers ?? [])
    .map((h: { key: string; value: string }) => [h.key, h.value]),
);

export default defineConfig({
  base: './',
  build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 600 },
  preview: { headers: deployHeaders },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
