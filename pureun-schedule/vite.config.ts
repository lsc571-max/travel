import { defineConfig } from 'vite';

// 테스트는 한국 시간 기준으로 실행
process.env.TZ = 'Asia/Seoul';

export default defineConfig({
  base: './',
  build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 600 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
