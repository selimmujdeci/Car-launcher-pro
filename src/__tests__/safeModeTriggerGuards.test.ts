/**
 * safeModeTriggerGuards.test.ts — SAFE_MODE'a giden yolun İKİ kökünü kilitler.
 *
 * ── SAHA BAĞLAMI (kütük #598-D → #604) ─────────────────────────────────────
 * Gerçek cihazda `data-runtime="SAFE_MODE"` görüldü, ama TETİKLEYİCİ
 * bulunamadı: `_detectInitialMode()` SAFE_MODE döndüremiyor (en kötü
 * BASIC_JS) ve `[Runtime] runtime_mode_changed` satırı log'larda YOKTU.
 * Kod taramasıyla iki ayrı kök ölçüldü:
 *
 *  KÖK 1 — native `onTrimMemory` severity testi yanlıştı. `TRIM_MEMORY_*`
 *  sabitleri monoton bir şiddet ölçeği DEĞİLDİR; 20/40/60/80 "arka plana
 *  düştün" bildirimidir ve bellek baskısı YOKKEN de gönderilir. `>= 15`
 *  testi bunları CRITICAL sayıyordu → uygulamayı arka plana almak
 *  SAFE_MODE'a sokuyor, `_commit` modu diske yazdığı için sonraki açılışta
 *  `crash-recovery` SAFE_MODE'a SABİTLİYORDU.
 *
 *  KÖK 2 — geçişi duyuran log satırı, duyurduğu geçiş tarafından
 *  susturuluyordu: `_commit()` önce `this._mode = mode` yazar, sonra
 *  `console.warn` çağırır; `logGate` o an ARTIK yeni modun seviyesini
 *  ('silent'/'error') okur ve satırı yutar. Bu yüzden tetikleyici hiçbir iz
 *  bırakmıyordu — kusur kendi kanıtını siliyordu.
 *
 * Bu testler ikisini de kalıcı olarak kilitler.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

/* Java kaynakları metin olarak okunur — SQL kilitlerinde (prodBaselineSecurityGuards)
   kullanılan desenin aynısı. Derleyici yok, ama SÖZLEŞME kilitlenebilir. */
import mainActivitySrc  from '../../android/app/src/main/java/com/cockpitos/pro/MainActivity.java?raw';
import pluginSrc        from '../../android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java?raw';

/* ══════════════════════════════════════════════════════════════════════════
   KÖK 1 — native onTrimMemory eşleştirmesi
   ══════════════════════════════════════════════════════════════════════════ */

describe('SAFE_MODE kökü #1 — native onTrimMemory arka plan seviyesini baskı sanmamalı', () => {
  /** Java yorumları çıkarılmış gövde (yorumlar sabit ADLARINI taşır). */
  const govde = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  const kaynaklar: ReadonlyArray<readonly [string, string]> = [
    ['MainActivity.onTrimMemory',      govde(mainActivitySrc)],
    ['CarLauncherPlugin.handleOnTrimMemory', govde(pluginSrc)],
  ];

  for (const [ad, src] of kaynaklar) {
    it(`KİLİT: ${ad} — arka plan seviyeleri (>= UI_HIDDEN) baskı SAYILMAZ`, () => {
      /* Bu eşik olmadan UI_HIDDEN(20)/BACKGROUND(40)/MODERATE(60)/COMPLETE(80)
         "CRITICAL"a düşer ve uygulamayı arka plana almak SAFE_MODE'a sokar. */
      expect(
        src,
        `${ad}: TRIM_MEMORY_UI_HIDDEN eşiği yok — arka plan sinyali baskı sayılır, SAFE_MODE tuzağı geri döner`,
      ).toMatch(/TRIM_MEMORY_UI_HIDDEN/);
    });

    it(`KİLİT: ${ad} — CRITICAL yalnız RUNNING_CRITICAL'dan üretilir`, () => {
      expect(src).toMatch(/TRIM_MEMORY_RUNNING_CRITICAL[\s\S]{0,120}?"CRITICAL"/);
    });

    it(`KİLİT: ${ad} — MODERATE dalı ARKA PLAN sabitini (TRIM_MEMORY_MODERATE) KULLANMAZ`, () => {
      /* Eski kusur: `else if (level >= TRIM_MEMORY_MODERATE (60))`. Bu dal
         hem ERİŞİLEMEZDİ (60 >= 15 zaten ilk dala düşer) hem de yanlış
         aileden bir sabitti. Doğrusu RUNNING_MODERATE (5) — ön plan baskısı.
         NOT: "TRIM_MEMORY_RUNNING_MODERATE" dizisi "TRIM_MEMORY_MODERATE"
         alt dizisini İÇERMEZ, bu yüzden bu ölçüm kesindir. */
      expect(
        src,
        `${ad}: arka plan sabiti TRIM_MEMORY_MODERATE severity karşılaştırmasında kullanılmış`,
      ).not.toMatch(/TRIM_MEMORY_MODERATE/);
      expect(src).toMatch(/TRIM_MEMORY_RUNNING_MODERATE/);
    });
  }

  it('KİLİT: iki kaynak da AYNI eşleştirmeyi kullanır (çift güvence ayrışamaz)', () => {
    /* Plugin "çift güvence" olarak aynı olayı ayrıca alabilir. İki yer farklı
       eşik kullanırsa biri düzeltilip diğeri unutulur — kusur yarım kapanır. */
    for (const [, src] of kaynaklar) {
      expect(src).toMatch(/TRIM_MEMORY_UI_HIDDEN/);
      expect(src).toMatch(/TRIM_MEMORY_RUNNING_CRITICAL/);
      expect(src).toMatch(/TRIM_MEMORY_RUNNING_MODERATE/);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   KÖK 2 — mod değişimi log'u kapıdan bağımsız olmalı
   ══════════════════════════════════════════════════════════════════════════ */

describe('SAFE_MODE kökü #2 — geçiş log\'u kendi geçişi tarafından susturulmamalı', () => {
  const _origWarn = console.warn;
  const _origInfo = console.info;
  const _origLog  = console.log;

  afterEach(() => {
    console.warn = _origWarn;
    console.info = _origInfo;
    console.log  = _origLog;
    vi.resetModules();
  });

  it('KİLİT: SAFE_MODE\'a geçiş satırı log kapısı kuruluyken bile YAZILIR', async () => {
    const yakalanan: string[] = [];

    /* Gerçek console'u casusla değiştir — `rawConsole` import edilirken
       BUNU yakalayacak, yani "gate kurulmadan önceki gerçek console" rolünü
       bu casus üstlenir. */
    console.warn = (...a: unknown[]): void => { yakalanan.push(String(a[0])); };
    console.info = (...a: unknown[]): void => { yakalanan.push(String(a[0])); };
    console.log  = (...a: unknown[]): void => { yakalanan.push(String(a[0])); };

    vi.resetModules();
    const { installConsoleGate } = await import('../platform/system/logGate');
    const { runtimeManager }     = await import('../core/runtime/AdaptiveRuntimeManager');
    const { RuntimeMode }        = await import('../core/runtime/runtimeTypes');

    // Kapıyı KUR — bundan sonra düz console.warn düşük modlarda susar.
    installConsoleGate();

    const oncekiMod = runtimeManager.getMode();
    expect(
      oncekiMod,
      'test önkoşulu: yönetici zaten SAFE_MODE\'da başlamamalı',
    ).not.toBe(RuntimeMode.SAFE_MODE);

    yakalanan.length = 0;

    // Downgrade → anlık commit (histerezis yok).
    runtimeManager.setMode(RuntimeMode.SAFE_MODE, 'test-safe-mode-kok');

    expect(runtimeManager.getMode()).toBe(RuntimeMode.SAFE_MODE);

    /* ASIL KİLİT: mod SAFE_MODE ('silent') olmasına rağmen geçiş satırı
       yakalanmış olmalı. Kusurlu kodda bu dizi BOŞ kalıyordu. */
    const gecisSatiri = yakalanan.find(s => s.includes('runtime_mode_changed'));
    expect(
      gecisSatiri,
      'SAFE_MODE geçiş satırı yutuldu — sahada tetikleyici yine bulunamaz',
    ).toBeDefined();
    expect(gecisSatiri).toContain('SAFE_MODE');
    expect(gecisSatiri).toContain('test-safe-mode-kok');
  });

  it('KİLİT: kapı ASIL işini yapmaya devam eder — sıradan warn SAFE_MODE\'da susar', async () => {
    /* #2'nin düzeltmesi kapıyı devre dışı bırakmamalı; yoksa eMMC/CPU
       koruması (kapının var oluş sebebi) kaybolur. */
    const yakalanan: string[] = [];
    console.warn = (...a: unknown[]): void => { yakalanan.push(String(a[0])); };
    console.info = (...a: unknown[]): void => { yakalanan.push(String(a[0])); };
    console.log  = (...a: unknown[]): void => { yakalanan.push(String(a[0])); };

    vi.resetModules();
    const { installConsoleGate } = await import('../platform/system/logGate');
    const { runtimeManager }     = await import('../core/runtime/AdaptiveRuntimeManager');
    const { RuntimeMode }        = await import('../core/runtime/runtimeTypes');

    installConsoleGate();
    runtimeManager.setMode(RuntimeMode.SAFE_MODE, 'test-kapi-hala-calisiyor');

    yakalanan.length = 0;
    console.warn('SIRADAN-UYARI-SUSMALI');
    console.info('SIRADAN-BILGI-SUSMALI');
    console.log('SIRADAN-LOG-SUSMALI');

    expect(
      yakalanan,
      'log kapısı devre dışı kalmış — düşük modda IO koruması kayboldu',
    ).toEqual([]);
  });
});
