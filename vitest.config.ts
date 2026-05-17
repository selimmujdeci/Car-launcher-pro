/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals:     true,
    include:     ['src/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.tsx'],
    exclude:     ['src/__tests__/**/*.integration.test.ts', 'src/__tests__/fixtures/**'],
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      provider:  'v8',
      include:   ['src/platform/**/*.ts'],
      exclude:   ['src/platform/bridge.ts', 'src/platform/nativePlugin.ts'],
      thresholds: {
        lines:   60,
        functions: 60,
      },
    },
  },
});
