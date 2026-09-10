import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // `server-only` throws under any client condition, and jsdom looks like
      // one. The guard still does its job in the real build.
      'server-only': fileURLToPath(new URL('./src/test/empty.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@typing-game/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    // Mirrors the web block of `.env.example`. `lib/env.ts` refuses to boot on a
    // missing value, so the suite has to supply the same contract production does.
    env: {
      API_BASE_URL: 'http://localhost:3001/api/v1',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      WEB_COOKIE_DOMAIN: 'localhost',
    },
  },
});
