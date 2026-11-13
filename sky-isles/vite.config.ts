import { defineConfig } from 'vitest/config';

const serverPort = Number(process.env.PORT ?? 8787);

export default defineConfig({
  // Relative base so the build also works from a sub-folder on a static host.
  base: './',
  server: {
    proxy: {
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 900 },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 20000 },
});
