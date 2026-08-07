/**
 * vehicleTelemetryFreshness.test.ts — TAZELİK VE DÜRÜSTLÜK KİLİTLERİ.
 *
 * Onarılan yanlışlar:
 *   · tek `updated_at < 11dk` ölçütü cihaz/konum/motor gerçeklerini karıştırıyordu
 *   · NULL rpm/temp UI'da `0` görünüyordu
 *   · bayat konum "şu anki konum" gibi sunuluyordu
 */

import { describe, it, expect } from 'vitest';
import {
  buildVehicleFreshness,
  measurementLabel,
  locationLabel,
  freshnessLabel,
  normalizeDataSource,
  ageLabel,
  toEpochMs,
  FRESHNESS_WINDOWS_MS,
  type TelemetryRow,
} from '../lib/fleet/vehicleTelemetryFreshness';

const NOW = 1_700_000_000_000;
const iso = (offsetMs: number) => new Date(NOW - offsetMs).toISOString();

function row(over: Partial<TelemetryRow> = {}): TelemetryRow {
  return {
    updatedAt: iso(10_000),
    gpsObservedAt: iso(20_000),
    obdObservedAt: iso(5_000),
    healthObservedAt: iso(60_000),
    lat: 41.01, lng: 29.02, accuracyM: 7.5,
    speed: 62, rpm: 2450, temp: 91, fuel: 55,
    telemetrySource: 'HEAD_UNIT_OBD',
    locationSource: 'HEAD_UNIT_GPS',
    ...over,
  };
}

const build = (over: Partial<TelemetryRow> = {}, readable = true) =>
  buildVehicleFreshness({ now: NOW, row: readable ? row(over) : null, readable });

describe('freshness · üç gerçek ayrılır', () => {
  it('1. 🔒 her şey taze → cihaz LIVE, konum LIVE, motor LIVE', () => {
    const f = build();
    expect(f.device).toBe('LIVE');
    expect(f.location).toBe('LIVE');
    expect(f.engine).toBe('LIVE');
    expect(f.locationIsLive).toBe(true);
  });

  it('2. 🔒 heartbeat TAZE ama GPS ESKİ → cihaz LIVE, konum STALE', () => {
    const f = build({ gpsObservedAt: iso(FRESHNESS_WINDOWS_MS.LOCATION + 60_000) });
    expect(f.device).toBe('LIVE');          // araç ayakta
    expect(f.location).toBe('STALE');       // ama konum eski
    expect(f.locationIsLive).toBe(false);
    expect(locationLabel(f)).toBe('Son bilinen konum');
  });

  it('3. 🔒 GPS TAZE ama OBD YOK → konum LIVE, motor verisi yok', () => {
    const f = build({ obdObservedAt: null, rpm: null, temp: null, speed: null, fuel: null });
    expect(f.location).toBe('LIVE');
    expect(f.engine).toBe('NEVER_SEEN');
    expect(f.rpm.value).toBeNull();
    expect(f.engineTempC.value).toBeNull();
  });

  it('4. 🔒 cihaz çevrimdışı → alt sinyaller STALE değil OFFLINE', () => {
    const old = FRESHNESS_WINDOWS_MS.DEVICE + 60_000;
    const f = build({ updatedAt: iso(old), gpsObservedAt: iso(old), obdObservedAt: iso(old) });
    expect(f.device).toBe('OFFLINE');
    expect(f.location).toBe('OFFLINE');
    expect(f.engine).toBe('OFFLINE');
    expect(locationLabel(f)).toBe('Son bilinen konum (araç çevrimdışı)');
  });
});

describe('freshness · bilinmeyen ASLA 0 değildir', () => {
  it('5. 🔒 NULL rpm/temp → değer null, metin "Veri yok" (0 DEĞİL)', () => {
    const f = build({ rpm: null, temp: null });
    expect(f.rpm.value).toBeNull();
    expect(f.engineTempC.value).toBeNull();
    expect(measurementLabel(f.rpm, 'rpm')).toBe('Veri yok');
    expect(measurementLabel(f.engineTempC, '°C')).toBe('Veri yok');
  });

  it('6. 🔒 ölçülen 0 GÖSTERİLİR ("Veri yok" DEĞİL)', () => {
    const f = build({ speed: 0, rpm: 0 });
    expect(f.speedKmh.value).toBe(0);
    expect(measurementLabel(f.speedKmh, 'km/h')).toBe('0 km/h');
    expect(measurementLabel(f.rpm, 'rpm')).toBe('0 rpm');
  });

  it('7. 🔒 NaN/undefined ölçüm → null', () => {
    const f = build({ speed: NaN, fuel: undefined });
    expect(f.speedKmh.value).toBeNull();
    expect(f.fuelPercent.value).toBeNull();
  });

  it('8. 🔒 bayat değer GÖSTERİLİR ama ETİKETLENİR', () => {
    const f = build({ obdObservedAt: iso(FRESHNESS_WINDOWS_MS.ENGINE + 60_000) });
    expect(f.engine).toBe('STALE');
    expect(measurementLabel(f.speedKmh, 'km/h')).toBe('62 km/h · eski veri');
  });
});

describe('freshness · okunamadı ≠ veri yok', () => {
  it('9. 🔒 satır OKUNAMADI → UNKNOWN (NEVER_SEEN DEĞİL)', () => {
    const f = buildVehicleFreshness({ now: NOW, row: null, readable: false });
    expect(f.device).toBe('UNKNOWN');
    expect(f.location).toBe('UNKNOWN');
    expect(f.engine).toBe('UNKNOWN');
    expect(f.rpm.value).toBeNull();
    expect(freshnessLabel(f.device)).toBe('Okunamadı');
    expect(locationLabel(f)).toBe('Konum okunamadı');
  });

  it('10. 🔒 satır HİÇ YOK ama okunabildi → NEVER_SEEN', () => {
    const f = buildVehicleFreshness({ now: NOW, row: null, readable: true });
    expect(f.device).toBe('NEVER_SEEN');
    expect(freshnessLabel(f.device)).toBe('Veri yok');
  });

  it('11. 🔒 koordinat yoksa konum NEVER_SEEN', () => {
    const f = build({ lat: null, lng: null });
    expect(f.location).toBe('NEVER_SEEN');
    expect(f.latitude).toBeNull();
    expect(locationLabel(f)).toBe('Konum verisi yok');
  });
});

describe('freshness · kaynak dürüstlüğü', () => {
  it('12. 🔒 tanınmayan kaynak UNKNOWN olur (uydurulmaz)', () => {
    expect(normalizeDataSource('MAGIC')).toBe('UNKNOWN');
    expect(normalizeDataSource(null)).toBe('UNKNOWN');
    expect(normalizeDataSource('HEAD_UNIT_GPS')).toBe('HEAD_UNIT_GPS');
    expect(build({ locationSource: 'MAGIC' }).locationSource).toBe('UNKNOWN');
  });

  it('13. 🔒 042 ÖNCESİ satır (damga yok, koordinat var) CANLI SAYILMAZ', () => {
    const f = build({ gpsObservedAt: null });
    expect(f.location).toBe('STALE');
    expect(f.locationIsLive).toBe(false);
  });

  it('14. 🔒 accuracy taşınır, geçersizse null', () => {
    expect(build().accuracyM).toBe(7.5);
    expect(build({ accuracyM: null }).accuracyM).toBeNull();
  });

  it('15. 🔒 geçersiz tarih uydurulmaz', () => {
    expect(toEpochMs('bozuk-tarih')).toBeNull();
    expect(toEpochMs(null)).toBeNull();
    expect(toEpochMs(NaN)).toBeNull();
    expect(build({ updatedAt: 'bozuk' }).device).toBe('NEVER_SEEN');
  });

  it('16. 🔒 veri yaşı insan diline çevrilir; bilinmiyorsa "Bilinmiyor"', () => {
    expect(ageLabel(null)).toBe('Bilinmiyor');
    expect(ageLabel(30_000)).toBe('Az önce');
    expect(ageLabel(5 * 60_000)).toBe('5 dk önce');
    expect(ageLabel(3 * 3_600_000)).toBe('3 sa önce');
    expect(ageLabel(2 * 86_400_000)).toBe('2 gün önce');
  });

  it('17. 🔒 sağlık penceresi ayrı değerlendirilir', () => {
    expect(build({ healthObservedAt: iso(FRESHNESS_WINDOWS_MS.HEALTH + 60_000) }).health).toBe('STALE');
    expect(build({ healthObservedAt: null }).health).toBe('NEVER_SEEN');
  });
});
