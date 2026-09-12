/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * website/vitest.config.ts — website test koşucusu.
 *
 * NEDEN VAR: `website/src/__tests__/commandService.test.ts` depoda ZATEN vardı ama
 * hiçbir koşucu tarafından TOPLANMIYORDU (kök `vitest.config.ts` yalnız
 * `src/__tests__/**`i tarar, website onun DIŞINDA). Yani website testleri
 * fiilen ÖLÜYDÜ. Bu dosya yalnız toplayıcıdır: yeni bağımlılık KURULMAZ
 * (vitest/jsdom kökten, react/react-dom website'in KENDİ 18.x sürümünden gelir —
 * kökteki React 19 ile karıştırılırsa hook testi patlar).
 *
 * Çalıştırma:  npx vitest run --config website/vitest.config.ts
 */
export default defineConfig({
  /**
   * JSX dönüşümü BURADA açılır. NEDEN: `website/tsconfig.json` Next.js için
   * `"jsx": "preserve"` kullanır (dönüşümü Next yapar) — bu ayar test
   * koşucusuna da sızarsa `.tsx` test dosyaları "Unexpected JSX expression"
   * ile PARSE EDİLEMEZ. Yalnız test koşucusunu etkiler; Next derlemesi
   * `tsconfig.json`u okumaya devam eder, DEĞİŞMEZ.
   */
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // React'in TEK kopyası website'inki olsun (kök 19 ≠ website 18).
      react:       fileURLToPath(new URL('./node_modules/react', import.meta.url)),
      'react-dom': fileURLToPath(new URL('./node_modules/react-dom', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals:     true,
    root:        fileURLToPath(new URL('.', import.meta.url)),
    include:     ['src/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.tsx'],
  },
});
