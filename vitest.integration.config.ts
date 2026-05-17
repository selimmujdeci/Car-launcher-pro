/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals:     true,
    include:     ['src/__tests__/**/*.integration.test.ts'],
    setupFiles:  ['src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      include:  ['src/platform/**/*.ts'],
      exclude:  ['src/platform/bridge.ts', 'src/platform/nativePlugin.ts'],
    },
  },
});
