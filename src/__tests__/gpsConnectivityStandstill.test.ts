/**
 * gpsConnectivityStandstill.test.ts — #553 · ARAÇ DURUNCA GPS ÖLÜ SAYILMAZ.
 *
 * ── SAHA ARIZASI (2026-08-12, gerçek araç · CAROS LAB kopyası) ──────────────
 * Tek snapshot, iki zıt cümle:
 *   `GPS connected:false · confidence:0 · errorReason:"Sinyal kesildi"`
 *   `konumFixYasMs: 427 · konumBayat:false · konumKaynagi:"GPS"`
 * `lastSignalAt` (…164420) tam olarak aracın DURDUĞU ana (…163598) düşüyor.
 *
 * KÖK: `VehicleConnectivityManager`'ın GPS beslemesi `onGPSLocation`'dır ve o
 * abonelik konum nesnesinin REFERANS DEĞİŞİMİNİ dinler. Araç durunca koordinat
 * değişmez → callback susar → 10 s sonra kaynak "ölü" ilan edilir. Bedeli
 * kozmetik değildir: kaynak seçimi ve füzyon güveni bu bayrağa bakar.
 *
 * Kütük #327'nin dersi burada tekrar uygulanır:
 * **sağlık "değer değişti mi"den DEĞİL "paket geldi mi"den türetilir.**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* Konum kanıtı tek yerden mock'lanır — testin sürdüğü olgu BUDUR. */
let _fixAgeMs: number | null = 427;
vi.mock('../platform/gpsService', () => ({
  /* Tek bir fix veriliyor ve SONRA susuyor — sahadaki "araç durdu, koordinat
     donmuş" hâlinin ta kendisi. Kaynak bu ilk fix'le bağlanır; devamında
     canlılığın tek delili fix YAŞIDIR. */
  onGPSLocation: (fn: (loc: unknown) => void) => {
    fn({ latitude: 41.0, longitude: 29.0, accuracy: 5 });
    return () => {};
  },
  getLocationEvidence: () => ({ fixAgeMs: _fixAgeMs }),
}));
vi.mock('../platform/obdService', () => ({ onOBDData: () => () => {} }));

describe('#553 · GPS canlılığı konum kanıtından okunur', () => {
  beforeEach(() => { vi.useFakeTimers(); _fixAgeMs = 427; });
  afterEach(() => { vi.useRealTimers(); vi.resetModules(); });

  /** GPS'i "bağlı" duruma getirip sonra koordinatı DONDURAN senaryo. */
  async function runStandstill(fixAge: number | null, elapsedMs: number) {
    const mod = await import('../platform/canBus/VehicleConnectivityManager');
    const stop = mod.startConnectivityManager();
    // Araç hareket hâlindeyken bir fix geldi → kaynak bağlandı.
    _fixAgeMs = 100;
    vi.advanceTimersByTime(3_000);
    // Araç durdu: `onGPSLocation` artık ateşlenmiyor, yalnız fix yaşı akıyor.
    _fixAgeMs = fixAge;
    vi.advanceTimersByTime(elapsedMs);
    const health = mod.getSourceHealth('GPS');
    stop();
    return health;
  }

  it('🔒 fix TAZE iken 30 s durmak GPS\'i ÖLÜ yapmaz', async () => {
    /* Eski davranış: 10 s eşiği aşılır, "Sinyal kesildi" yazılırdı. */
    const h = await runStandstill(427, 30_000);
    expect(h.connected, 'araç durdu diye GPS ölü ilan edildi (#553 geri geldi)').toBe(true);
    expect(h.errorReason).not.toBe('Sinyal kesildi');
    expect(h.confidence).toBeGreaterThan(0);
  });

  it('🔒 fix GERÇEKTEN bayatsa GPS ölü ilan EDİLİR (kapı körelmedi)', async () => {
    /* Düzeltme "hep canlı de" DEĞİLDİR: gerçek sinyal kaybı hâlâ görülmeli. */
    const h = await runStandstill(45_000, 15_000);
    expect(h.connected, 'gerçek sinyal kaybı artık görülmüyor').toBe(false);
    expect(h.errorReason).toBe('Sinyal kesildi');
  });

  it('🔒 konum kanıtı OKUNAMAZSA eski davranış sürer (fail-soft)', async () => {
    /* `null` = BİLİNMİYOR. "Taze" de denmez, kanıt uydurulmaz. */
    const h = await runStandstill(null, 15_000);
    expect(h.connected).toBe(false);
  });
});
