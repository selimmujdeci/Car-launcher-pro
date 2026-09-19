/**
 * fieldFreshnessIntegrityF51B.test.ts — ALAN BAZLI TAZELİK BÜTÜNLÜĞÜ.
 *
 * ── MİMARİ INVARIANT ────────────────────────────────────────────────────────
 *   ROW FRESHNESS ≠ FIELD FRESHNESS
 *   Bir sensörün YENİ ölçümü, başka bir sensörün ESKİ değerini
 *   "yeni ölçülmüş" YAPAMAZ.
 *
 * ── ÖLÇÜLEN KUSUR (gerçek araç, Renault, 2026-09-18) ───────────────────────
 * 90 sn / 35 OBD paketi: `rpm` 35/35 geldi, `fuelLevel` 35/35 `-1` idi
 * (hiç ölçülmedi). Ama `obdService._current` ESKİ yakıtı saklıyor ve telemetri
 * sözleşmesi onu HER heartbeat'te `obdObservedAt = lastSeenMs` (= "şimdi")
 * damgasıyla gönderiyordu. `lastSeenMs` "linkten en son HERHANGİ bir paket
 * geldi" demektir — bir ALANIN ölçüm anı DEĞİLDİR.
 *
 * Aşağı akışta `vehicle_telemetry` tek bir `obd_observed_at` tutar ve
 * `buildVehicleFreshness` yakıt/devir/sıcaklık/hızın HEPSİNİ o tek damgadan
 * hükme bağlar → eski yakıt CANLI ölçüm gibi görünürdü.
 *
 * ── DÜZELTME ────────────────────────────────────────────────────────────────
 * Mevcut kanıt otoritesi genelleştirildi (`_lastSpeedRxMs` / `getObdSpeedFresh`
 * deseni → `getObdFieldObservedAt()`), ve sözleşme kurucusu:
 *   1. bir alanı YALNIZ kendi ölçümü tazeyse gönderir,
 *   2. `obdObservedAt`i GÖNDERİLEN alanların EN ESKİ ölçüm anına eşitler.
 * Böylece "satırdaki her OBD alanı en geç bu anda ölçüldü" YAPISAL olarak doğrudur.
 *
 * Buradaki kilitler kusuru geri getiren her mutasyonda DÜŞER.
 */

import { describe, it, expect } from 'vitest';
import { buildTelemetryFields } from '../platform/telemetry/telemetryContract';

const NOW = 1_800_000_000_000;
const WINDOW = 60_000;           // OBD tazelik penceresi (ms)
const ago = (ms: number) => NOW - ms;

/** Dört OBD alanı da DEĞER taşır; farklı olan yalnız ÖLÇÜM ANLARIdır. */
function build(fieldObservedAt: Record<string, number>) {
  return buildTelemetryFields({
    nowMs: NOW,
    obd: {
      connected: true,
      fresh: true,
      lastSeenMs: NOW,            // link canlı — "her şey taze" DEMEK DEĞİL
      freshWindowMs: WINDOW,
      rpm: 850,
      engineTempC: 80,
      speedKmh: 0,
      fuelPercent: 16,
      fieldObservedAt,
    },
    gps: null,
  });
}

/* ── 1. Çapraz alan kirlenmesi ─────────────────────────────────────────── */

describe('F5.1B · bir alanın ölçümü başka alanı TAZELEMEZ', () => {
  it('1. 🔒 yeni RPM, ESKİ yakıtı taze YAPAMAZ (sahada ölçülen tam senaryo)', () => {
    const r = build({ rpmMs: NOW, fuelMs: ago(20 * 60_000) });
    expect(r.fields.rpm).toBe(850);
    /* MUTASYON KAPISI: `fuelMeasuredAt = obdObservedAt` (yani lastSeenMs)
       yazılırsa yakıt payload'a girer ve bu DÜŞER. */
    expect(r.fields.fuel).toBeUndefined();
    expect(r.fields.fuelPercent).toBeUndefined();
    expect(r.staleFields).toContain('fuelPercent');
  });

  it('2. 🔒 yeni yakıt, ESKİ RPM\'i taze YAPAMAZ', () => {
    const r = build({ fuelMs: NOW, rpmMs: ago(10 * 60_000) });
    expect(r.fields.fuel).toBe(16);
    expect(r.fields.rpm).toBeUndefined();
    expect(r.staleFields).toContain('rpm');
  });

  it('3. 🔒 yeni RPM, ESKİ motor sıcaklığını taze YAPAMAZ', () => {
    const r = build({ rpmMs: NOW, engineTempMs: ago(5 * 60_000) });
    expect(r.fields.rpm).toBe(850);
    expect(r.fields.temp).toBeUndefined();
    expect(r.fields.engineTempC).toBeUndefined();
  });

  it('4. 🔒 yeni RPM, ESKİ hızı taze YAPAMAZ', () => {
    const r = build({ rpmMs: NOW, speedMs: ago(3 * 60_000) });
    expect(r.fields.rpm).toBe(850);
    expect(r.fields.speed).toBeUndefined();
  });

  it('5. 🔒 HİÇ ölçülmemiş alan (damga 0) gönderilmez — değeri olsa bile', () => {
    const r = build({ rpmMs: NOW, fuelMs: 0 });
    expect(r.fields.rpm).toBe(850);
    expect(r.fields.fuel).toBeUndefined();
  });
});

/* ── 2. Grup damgası hiçbir alanı kendi ölçümünden taze gösteremez ─────── */

describe('F5.1B · obdObservedAt = GÖNDERİLEN alanların EN ESKİSİ', () => {
  it('6. 🔒 damga, en eski dahil edilen ölçümdür (fail-closed yön)', () => {
    const fuelAt = ago(40_000);
    const r = build({ rpmMs: NOW, fuelMs: fuelAt });
    expect(r.fields.fuel).toBe(16);                 // 40 sn < 60 sn pencere
    expect(r.fields.obdObservedAt).toBe(fuelAt);    // rpm'in NOW'ı DEĞİL
  });

  it('7. 🔒 hiçbir alan kendi ölçümünden TAZE damgalanmaz', () => {
    const stamps = { rpmMs: NOW, engineTempMs: ago(15_000), fuelMs: ago(50_000) };
    const r = build(stamps);
    const stamp = r.fields.obdObservedAt!;
    for (const ms of Object.values(stamps)) expect(stamp).toBeLessThanOrEqual(ms);
  });

  it('8. 🔒 hiçbir alan dahil edilmediyse damga da BASILMAZ', () => {
    const r = build({ rpmMs: 0, engineTempMs: 0, speedMs: 0, fuelMs: 0 });
    expect(r.fields.obdObservedAt).toBeUndefined();
    /* Kaynak OBD İDDİA EDİLMEZ. Mevcut sözleşme burada dürüstçe `UNKNOWN`
       yazar (kaynak uydurmaz) — kilit, OBD'nin iddia EDİLMEMESİDİR. */
    expect(r.fields.source).not.toBe('HEAD_UNIT_OBD');
    expect(r.fields.fuel).toBeUndefined();
    expect(r.fields.rpm).toBeUndefined();
  });
});

/* ── 3. Kaynak grupları birbirini tazelemez ────────────────────────────── */

describe('F5.1B · kaynak grupları ayrıdır', () => {
  it('9. 🔒 GPS damgası OBD alanlarını TAZELEMEZ', () => {
    const r = buildTelemetryFields({
      nowMs: NOW,
      obd: {
        connected: true, fresh: true, lastSeenMs: NOW, freshWindowMs: WINDOW,
        fuelPercent: 16, fieldObservedAt: { fuelMs: ago(30 * 60_000) },
      },
      gps: { latitude: 41.01, longitude: 29.02, lastFixMs: NOW, freshWindowMs: WINDOW },
    });
    expect(r.fields.lat).toBe(41.01);
    expect(r.fields.gpsObservedAt).toBe(NOW);
    /* Taze GPS, bayat yakıtı KURTARMAZ. */
    expect(r.fields.fuel).toBeUndefined();
    expect(r.fields.obdObservedAt).toBeUndefined();
  });

  it('10. 🔒 OBD tamamen bayatsa GPS yine de gider (grup bağımsızlığı)', () => {
    const r = buildTelemetryFields({
      nowMs: NOW,
      obd: { connected: true, fresh: true, lastSeenMs: ago(10 * 60_000),
             freshWindowMs: WINDOW, rpm: 850, fieldObservedAt: { rpmMs: ago(10 * 60_000) } },
      gps: { latitude: 41.01, longitude: 29.02, lastFixMs: NOW, freshWindowMs: WINDOW },
    });
    expect(r.obdSkipped).toBe(true);
    expect(r.fields.rpm).toBeUndefined();
    expect(r.fields.lat).toBe(41.01);
  });
});

/* ── 4. Sıfır semantiği KORUNUR (F5.1 sözleşmesi) ──────────────────────── */

describe('F5.1B · ÖLÇÜLMÜŞ sıfır ile BİLİNMEYEN ayrı kalır', () => {
  it('11. 🔒 ÖLÇÜLMÜŞ yakıt %0 gönderilir (0 gerçek ölçüm olabilir)', () => {
    const r = buildTelemetryFields({
      nowMs: NOW,
      obd: { connected: true, fresh: true, lastSeenMs: NOW, freshWindowMs: WINDOW,
             fuelPercent: 0, fieldObservedAt: { fuelMs: NOW } },
      gps: null,
    });
    expect(r.fields.fuel).toBe(0);
    expect(r.fields.obdObservedAt).toBe(NOW);
  });

  it('12. 🔒 BİLİNMEYEN yakıt 0\'a ÇEVRİLMEZ — alan hiç yazılmaz', () => {
    const r = buildTelemetryFields({
      nowMs: NOW,
      obd: { connected: true, fresh: true, lastSeenMs: NOW, freshWindowMs: WINDOW,
             fuelPercent: -1, fieldObservedAt: { fuelMs: NOW } },
      gps: null,
    });
    expect(r.fields.fuel).toBeUndefined();
    expect(r.fields.fuel).not.toBe(0);
  });

  it('13. 🔒 ölçülmüş 0 ile bayat 0 AYRI: bayat olan gönderilmez', () => {
    const r = buildTelemetryFields({
      nowMs: NOW,
      obd: { connected: true, fresh: true, lastSeenMs: NOW, freshWindowMs: WINDOW,
             fuelPercent: 0, rpm: 850,
             fieldObservedAt: { fuelMs: ago(30 * 60_000), rpmMs: NOW } },
      gps: null,
    });
    expect(r.fields.rpm).toBe(850);
    expect(r.fields.fuel).toBeUndefined();
  });
});

/* ── 5. Geriye uyumluluk: kanıt yoksa davranış DEĞİŞMEZ ────────────────── */

describe('F5.1B · kanıt yoksa fail-soft (regresyonsuz)', () => {
  it('14. 🔒 `fieldObservedAt` verilmezse ESKİ davranış aynen korunur', () => {
    const r = buildTelemetryFields({
      nowMs: NOW,
      obd: { connected: true, fresh: true, lastSeenMs: NOW, freshWindowMs: WINDOW,
             rpm: 850, fuelPercent: 16 },
      gps: null,
    });
    expect(r.fields.rpm).toBe(850);
    expect(r.fields.fuel).toBe(16);
    expect(r.fields.obdObservedAt).toBe(NOW);
    expect(r.staleFields).toEqual([]);
  });

  it('15. 🔒 bayat alan `rejected` DEĞİL `staleFields`tir (iki kusur karışmaz)', () => {
    const r = build({ rpmMs: NOW, fuelMs: ago(30 * 60_000) });
    expect(r.staleFields).toContain('fuelPercent');
    expect(r.rejected).not.toContain('fuelPercent');
  });
});
