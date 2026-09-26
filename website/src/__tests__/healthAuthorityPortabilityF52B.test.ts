/**
 * healthAuthorityPortabilityF52B.test.ts — SAĞLIK OTORİTESİ TEK ve TAŞINABİLİR.
 *
 * ── NEDEN ───────────────────────────────────────────────────────────────
 * Bildirim kararı SUNUCUDA verilmek zorunda (tarayıcı kapalıyken de çalışmalı).
 * Sunucuda aynı hükmü ELDE YENİDEN YAZMAK iki kopya kural seti üretir; zamanla
 * ayrışırlar ve kullanıcı EKRANDA başka, BİLDİRİMDE başka bir gerçek görür.
 *
 * Bu yüzden iki şey yapısal olarak garanti edilmeli:
 *   1. Kanonik sağlık zinciri TAŞINABİLİR olmalı (React/Next/Supabase/tarayıcı
 *      API'si taşımamalı) ki Deno Edge Function içinde AYNEN koşsun.
 *   2. Sunucu tetikleyicisi kendi eşiğini/severity'sini ÜRETMEMELİ; kanonik
 *      kurucuları çağırmalı.
 *
 * Kilitler, ikinci bir kural seti doğuran her değişiklikte DÜŞER.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(__dirname, '../');

const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');

/** Yorumları söker; `://` korunur (URL yorum değildir). */
const codeOf = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

/** Kanonik sağlık zinciri — sunucuda AYNEN koşması gereken saf çekirdek. */
const PURE_CHAIN = [
  'lib/fleet/vehicleTelemetryFreshness.ts',
  'lib/diagnostics/dtcResultContract.ts',
  'lib/console/evidenceModel.ts',
  'lib/diagnostics/vehicleHealth.ts',
  'lib/notifications/consumerNotificationPolicy.ts',
  'lib/notifications/serverNotificationTrigger.ts',
  /* F5.4: teşhis geçmişi de sunucuda koşar (consumer-notify-scan onu import
     eder). `dtcResultReader` Supabase istemcisi taşır ve BU ZİNCİRE GİREMEZ;
     bu yüzden güven penceresi sabiti saf `dtcResultContract`a taşındı. */
  'lib/diagnostics/diagnosticHistory.ts',
  'lib/diagnostics/diagnosticPersistencePlan.ts',
];

/** Taşınabilirliği bozan bağımlılıklar. */
const NON_PORTABLE = [
  /from\s+['"]react['"]/,
  /from\s+['"]react-dom/,
  /from\s+['"]next\//,
  /from\s+['"]zustand/,
  /from\s+['"]@supabase\//,
  /from\s+['"].*\/supabase['"]/,
];

/* ── 1. Zincir taşınabilir ─────────────────────────────────────────────── */

describe('F5.2B · kanonik sağlık zinciri sunucuda koşabilir', () => {
  for (const rel of PURE_CHAIN) {
    it(`1.x 🔒 ${rel} taşınabilirliği bozan bağımlılık taşımaz`, () => {
      const code = codeOf(rel);
      for (const pattern of NON_PORTABLE) {
        expect(code).not.toMatch(pattern);
      }
    });
  }

  it('2. 🔒 zincir tarayıcı API\'si / I/O / timer kullanmaz', () => {
    for (const rel of PURE_CHAIN) {
      const code = codeOf(rel);
      expect(code).not.toContain('localStorage');
      expect(code).not.toContain('sessionStorage');
      expect(code).not.toContain('window.');
      expect(code).not.toContain('navigator.');
      expect(code).not.toContain('fetch(');
      expect(code).not.toContain('setTimeout(');
      expect(code).not.toContain('setInterval(');
    }
  });

  /**
   * SAAT DİSİPLİNİ.
   *
   * `Date.now()` taşınabilirliği BOZMAZ (Deno'da da vardır); bozan şey GİZLİ
   * saattir: değerlendirme anı içeriden okunursa aynı girdi farklı sonuç
   * verir ve sunucu ile PWA sessizce ayrışır.
   *
   * ÖLÇÜLEN İSTİSNA: `dtcResultContract` iki yerde `input.now ?? Date.now()`
   * yedeği taşır — YALNIZ çağıran `now` vermezse devreye girer. Sunucu
   * tetikleyicisi `now`u DAİMA geçirir, dolayısıyla o yedek bu zincirde HİÇ
   * çalışmaz. Yedeği kaldırmak bu turun kapsamı dışındadır; yerine gerçek
   * sözleşme (enjekte edilebilirlik) kilitlenir.
   */
  const CLOCK_FREE = PURE_CHAIN.filter((r) => !r.endsWith('dtcResultContract.ts'));

  it('3. 🔒 hüküm veren modüller KENDİ saatini okumaz', () => {
    for (const rel of CLOCK_FREE) {
      expect(codeOf(rel)).not.toContain('Date.now(');
    }
  });

  it('4. 🔒 dtcResultContract değerlendirme anını ENJEKTE edilebilir tutar', () => {
    expect(codeOf('lib/diagnostics/dtcResultContract.ts'))
      .toMatch(/input\.now\s*\?\?\s*Date\.now\(\)/);
  });
});

/* ── 2. İkinci kural seti yok ──────────────────────────────────────────── */

describe('F5.2B · sunucu tetikleyicisi kendi hükmünü ÜRETMEZ', () => {
  const trigger = codeOf('lib/notifications/serverNotificationTrigger.ts');

  it('3. 🔒 kanonik kurucuları ÇAĞIRIR', () => {
    expect(trigger).toContain('buildVehicleFreshness');
    expect(trigger).toContain('buildVehicleHealthSummary');
    expect(trigger).toContain('decideConsumerNotification');
  });

  it('4. 🔒 kendi eşiğini/severity tablosunu TANIMLAMAZ', () => {
    /* MUTASYON KAPISI: `temp > 110`, `volts < 11.8`, `rpm > 6000` gibi bir
       eşik buraya sızarsa ikinci karar motoru doğmuş demektir. */
    expect(trigger).not.toMatch(/\b(temp|volts|voltage|rpm|speed|fuel)\s*[<>]=?\s*\d/);
    expect(trigger).not.toMatch(/THRESHOLD|_RULE\s*=/);
    expect(trigger).not.toMatch(/severity\s*===\s*['"]critical['"]/);
  });

  it('5. 🔒 Verdict değerlerini kendi başına YORUMLAMAZ', () => {
    /* Verdict → bildirim çevirisi TEK yerde: consumerNotificationPolicy.
       Tetikleyici onu yeniden yapmamalı. */
    expect(trigger).not.toMatch(/verdict\s*===\s*['"](CRITICAL|WARNING|VERIFIED|NO_EVIDENCE)['"]/);
  });
});

/* ── 3. Tarayıcı watchdog'u otorite değildir ───────────────────────────── */

describe('F5.2B · tarayıcı watchdog bildirim otoritesi olamaz', () => {
  it('6. 🔒 sunucu tetikleyicisi vehicleStore/watchdog\'a BAĞLI DEĞİL', () => {
    const trigger = codeOf('lib/notifications/serverNotificationTrigger.ts');
    expect(trigger).not.toContain('vehicleStore');
    expect(trigger).not.toContain('startWatchdog');
  });

  it('7. 🔒 politika modülü de tarayıcı durumuna bağlı değil', () => {
    const policy = codeOf('lib/notifications/consumerNotificationPolicy.ts');
    expect(policy).not.toContain('vehicleStore');
    expect(policy).not.toContain('useStore');
  });
});
