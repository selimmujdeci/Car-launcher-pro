/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals:     true,
    include:     ['src/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.tsx'],
    exclude:     ['src/__tests__/**/*.integration.test.ts', 'src/__tests__/fixtures/**'],
    setupFiles: ['src/__tests__/setup.ts'],

    /**
     * Varsayılan 5 sn YETMİYOR — ve bu bir ÜRÜN kusuru DEĞİL.
     *
     * ÖLÇÜM (2026-08-22): yerel Supabase yığını (10 Docker konteyneri) ayaktayken
     * tam paket koşulduğunda her seferinde 2-3 test düşüyordu ve **düşen küme
     * DEĞİŞİYORDU** (maviMemoryEngine · maviMechanicHistory · carosLabKwpMonitor
     * · guardianTickBudget dönüşümlü). Hepsi izole koşulduğunda GEÇİYOR;
     * `--testTimeout=60000` ile tam paket de geçiyor. Yani sebep ürün değil,
     * paralel işçilerin CPU için yarışması: ağır `await import(...)` grafiklerinin
     * Vite dönüşümü tek başına ~9 sn sürebiliyor.
     *
     * Bu değeri yükseltmek HİÇBİR İDDİAYI ZAYIFLATMAZ — yalnız "ne kadar
     * bekleriz"i değiştirir. Testler tam olarak aynı şeyleri doğrulamaya devam
     * eder. CI runner'ları geliştirici makinesinden genellikle YAVAŞTIR; 5 sn
     * orada da yalancı kırmızı üretirdi.
     *
     * NOT: `guardianTickBudget` gibi DUVAR SAATİ BÜTÇESİ ölçen testler bundan
     * etkilenmez ve etkilenmemelidir — onlar yük altında düşmeye devam eder,
     * çünkü ölçtükleri şey tam olarak budur. Onları gevşetmek KİLİDİ ZAYIFLATMAK
     * olurdu (bkz. CLAUDE.md · Regresyon Kasası).
     */
    testTimeout: 20_000,
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
