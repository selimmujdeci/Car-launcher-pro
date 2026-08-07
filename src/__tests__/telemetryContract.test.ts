/**
 * telemetryContract.test.ts — TELEMETRİ SÖZLEŞMESİ KİLİTLERİ.
 *
 * Bu kilitler, telefonda/veritabanında ölçülen kusurların sessizce geri
 * gelmesini engeller:
 *   · `rpm` / `engineTempC` payload'a HİÇ girmiyordu → DB'de kalıcı 0
 *   · bilinmeyen hız `0` olarak gönderiliyordu
 *   · bayat OBD/GPS verisi canlı gibi gönderiliyordu
 * Bu dosyayı ZAYIFLATMA; davranış bilinçli değişirse kilidi GÜNCELLE.
 */

import { describe, it, expect } from 'vitest';
import {
  buildTelemetryFields,
  sanitizeMetric,
  sanitizeObdMetric,
  TELEMETRY_RANGES,
} from '../platform/telemetry/telemetryContract';

const NOW = 1_700_000_000_000;

/** Taze, bağlı OBD gözlemi. */
function freshObd(over: Record<string, unknown> = {}) {
  return {
    connected: true, fresh: true,
    lastSeenMs: NOW - 1_000, freshWindowMs: 5_000,
    rpm: 2450, engineTempC: 91, speedKmh: 62, fuelPercent: 55,
    ...over,
  };
}

function freshGps(over: Record<string, unknown> = {}) {
  return {
    latitude: 41.01, longitude: 29.02, headingDeg: 180, accuracyM: 7.5,
    lastFixMs: NOW - 2_000, freshWindowMs: 300_000,
    ...over,
  };
}

describe('telemetryContract · sayısal süzgeç', () => {
  it('1. 🔒 ölçülen 0 GEÇER (bilinmiyor değildir)', () => {
    expect(sanitizeMetric(0, 'rpm')).toBe(0);
    expect(sanitizeMetric(0, 'speedKmh')).toBe(0);
    expect(sanitizeMetric(0, 'fuelPercent')).toBe(0);
  });

  it('2. 🔒 NaN · Infinity · null · undefined · metin → null', () => {
    for (const bad of [NaN, Infinity, -Infinity, null, undefined, '5', {}, []]) {
      expect(sanitizeMetric(bad, 'rpm')).toBeNull();
    }
  });

  it('3. 🔒 aralık dışı değer REDDEDİLİR', () => {
    expect(sanitizeMetric(TELEMETRY_RANGES.rpm.max + 1, 'rpm')).toBeNull();
    expect(sanitizeMetric(-1, 'speedKmh')).toBeNull();
    expect(sanitizeMetric(101, 'fuelPercent')).toBeNull();
    expect(sanitizeMetric(-91, 'latitude')).toBeNull();
    expect(sanitizeMetric(181, 'longitude')).toBeNull();
    expect(sanitizeMetric(361, 'headingDeg')).toBeNull();
    expect(sanitizeMetric(-1, 'accuracyM')).toBeNull();
    expect(sanitizeMetric(-51, 'engineTempC')).toBeNull();
    expect(sanitizeMetric(251, 'engineTempC')).toBeNull();
  });

  it('4. 🔒 sınır değerler KABUL edilir', () => {
    expect(sanitizeMetric(20_000, 'rpm')).toBe(20_000);
    expect(sanitizeMetric(-50, 'engineTempC')).toBe(-50);
    expect(sanitizeMetric(360, 'headingDeg')).toBe(360);
  });

  it('5. 🔒 OBD `-1` = desteklenmiyor → null (0 DEĞİL)', () => {
    expect(sanitizeObdMetric(-1, 'rpm')).toBeNull();
    expect(sanitizeObdMetric(-1, 'engineTempC')).toBeNull();
    // Ham süzgeç -1'i aralık dışı sayar; OBD süzgeci de null döner.
    expect(sanitizeObdMetric(0, 'rpm')).toBe(0);
  });
});

describe('telemetryContract · RPM ve motor sıcaklığı', () => {
  it('6. 🔒 rpm ve temp payload\'a GERÇEK değerle girer (RPC anahtarlarıyla)', () => {
    const r = buildTelemetryFields({ nowMs: NOW, obd: freshObd(), gps: freshGps() });
    // RPC `payload->>'rpm'` ve `payload->>'temp'` okur → bu anahtarlar ŞART.
    expect(r.fields.rpm).toBe(2450);
    expect(r.fields.temp).toBe(91);
    // Normalize adlar da taşınır.
    expect(r.fields.engineTempC).toBe(91);
    expect(r.presentKeys).toContain('rpm');
    expect(r.presentKeys).toContain('temp');
  });

  it('7. 🔒 EV aracında (rpm/temp = -1) anahtar HİÇ konmaz', () => {
    const r = buildTelemetryFields({
      nowMs: NOW,
      obd: freshObd({ rpm: -1, engineTempC: -1 }),
    });
    expect(r.fields.rpm).toBeUndefined();
    expect(r.fields.temp).toBeUndefined();
    expect(r.presentKeys).not.toContain('rpm');
  });
});

describe('telemetryContract · bilinmeyen ASLA 0 değildir', () => {
  it('8. 🔒 hız bilinmiyorsa `speed` anahtarı KONMAZ (0 gönderilmez)', () => {
    const r = buildTelemetryFields({ nowMs: NOW, obd: null, gps: null });
    expect(r.fields.speed).toBeUndefined();
    expect(r.presentKeys).not.toContain('speed');
  });

  it('9. 🔒 OBD bağlı değilse TÜM OBD alanları atlanır', () => {
    const r = buildTelemetryFields({ nowMs: NOW, obd: freshObd({ connected: false }) });
    expect(r.obdSkipped).toBe(true);
    expect(r.obdSkipReason).toBe('not_connected');
    expect(r.fields.rpm).toBeUndefined();
    expect(r.fields.temp).toBeUndefined();
  });

  it('10. 🔒 ölçülen 0 km/h GÖNDERİLİR (durmuş araç gerçeğidir)', () => {
    const r = buildTelemetryFields({ nowMs: NOW, obd: freshObd({ speedKmh: 0, rpm: 0 }) });
    expect(r.fields.speed).toBe(0);
    expect(r.fields.rpm).toBe(0);
  });
});

describe('telemetryContract · bayatlık kapıları', () => {
  it('11. 🔒 BAYAT OBD gönderilmez (eski veri canlı gibi sunulmaz)', () => {
    const r = buildTelemetryFields({
      nowMs: NOW,
      obd: freshObd({ lastSeenMs: NOW - 30_000, freshWindowMs: 5_000 }),
    });
    expect(r.obdSkipped).toBe(true);
    expect(r.obdSkipReason).toBe('stale_window');
    expect(r.fields.rpm).toBeUndefined();
    expect(r.fields.obdObservedAt).toBeUndefined();
  });

  it('12. 🔒 `dataFresh=false` → OBD atlanır', () => {
    const r = buildTelemetryFields({ nowMs: NOW, obd: freshObd({ fresh: false }) });
    expect(r.obdSkipReason).toBe('not_fresh');
  });

  it('13. 🔒 BAYAT GPS gönderilmez (konum güncellenmez)', () => {
    const r = buildTelemetryFields({
      nowMs: NOW,
      gps: freshGps({ lastFixMs: NOW - 600_000, freshWindowMs: 300_000 }),
    });
    expect(r.gpsSkipped).toBe(true);
    expect(r.gpsSkipReason).toBe('stale_window');
    expect(r.fields.lat).toBeUndefined();
    expect(r.fields.lng).toBeUndefined();
  });

  it('14. 🔒 geçersiz koordinat reddedilir ve konum yazılmaz', () => {
    const r = buildTelemetryFields({ nowMs: NOW, gps: freshGps({ latitude: 999 }) });
    expect(r.gpsSkipped).toBe(true);
    expect(r.gpsSkipReason).toBe('invalid_coords');
    expect(r.rejected).toContain('latitude');
  });
});

describe('telemetryContract · gözlem anı ve kaynak', () => {
  it('15. 🔒 kaynak damgaları GERÇEK gözlem anıdır (şimdi değil)', () => {
    const r = buildTelemetryFields({ nowMs: NOW, obd: freshObd(), gps: freshGps() });
    expect(r.fields.obdObservedAt).toBe(NOW - 1_000);
    expect(r.fields.gpsObservedAt).toBe(NOW - 2_000);
    // observedAt = en TAZE alt kaynak
    expect(r.fields.observedAt).toBe(NOW - 1_000);
  });

  it('16. 🔒 kaynak alanı OBD/GPS ayrımını taşır', () => {
    const obdOnly = buildTelemetryFields({ nowMs: NOW, obd: freshObd() });
    expect(obdOnly.fields.source).toBe('HEAD_UNIT_OBD');
    expect(obdOnly.fields.locationSource).toBeUndefined();

    const gpsOnly = buildTelemetryFields({ nowMs: NOW, gps: freshGps() });
    expect(gpsOnly.fields.source).toBe('HEAD_UNIT_GPS');
    expect(gpsOnly.fields.locationSource).toBe('HEAD_UNIT_GPS');
  });

  it('17. 🔒 hiç ölçüm yoksa kaynak UNKNOWN, ölçüm alanı YOK', () => {
    const r = buildTelemetryFields({ nowMs: NOW });
    expect(r.fields.source).toBe('UNKNOWN');
    expect(r.fields.observedAt).toBe(NOW);
    expect(r.presentKeys).not.toContain('rpm');
    expect(r.presentKeys).not.toContain('lat');
  });

  it('18. 🔒 accuracy payload\'da taşınır (kalıcılık için)', () => {
    const r = buildTelemetryFields({ nowMs: NOW, gps: freshGps() });
    expect(r.fields.accuracyM).toBe(7.5);
  });

  it('19. 🔒 OBD hızı yoksa füzyonlanmış hız yedeğe geçer', () => {
    const r = buildTelemetryFields({
      nowMs: NOW,
      obd: freshObd({ speedKmh: -1 }),   // desteklenmiyor
      fusedSpeedKmh: 48,
    });
    expect(r.fields.speed).toBe(48);
    expect(r.fields.speedKmh).toBe(48);
  });

  it('20. 🔒 speedConfidence 0–1 aralığına kırpılır', () => {
    expect(buildTelemetryFields({ nowMs: NOW, speedConfidence: 5 }).fields.speedConfidence).toBe(1);
    expect(buildTelemetryFields({ nowMs: NOW, speedConfidence: -2 }).fields.speedConfidence).toBe(0);
    expect(buildTelemetryFields({ nowMs: NOW, speedConfidence: NaN }).fields.speedConfidence).toBeUndefined();
  });
});
