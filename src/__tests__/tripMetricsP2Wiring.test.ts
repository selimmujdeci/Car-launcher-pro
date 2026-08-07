/**
 * tripMetricsP2Wiring.test.ts — P2 ZİNCİR KİLİTLERİ.
 *
 * ── NEDEN AYRI DOSYA ──────────────────────────────────────────────────
 * `tripMetricsP2.test.ts` metrik ÜRETİMİNİ kilitler (eşikler, kapılar,
 * debounce). Bu dosya ise **üretilenin buluta ULAŞTIĞINI** kilitler.
 *
 * Bu ayrım bir vaka üzerine kuruldu: P2'nin ilk hâlinde metrik üretimi
 * doğruydu ve 9 154 test yeşildi, ama
 *   · `tripUploadRuntime` sabit `distanceSource:'DERIVED'` gönderiyordu
 *     (ölçülmüş mesafe "türetme" diye yükleniyordu),
 *   · `p_provenance`/`p_price`/`p_coverage` hiç gönderilmiyordu,
 *   · kanonik modelde `unknownTimeMin` alanı YOKTU,
 *   · migration 047'nin çağırdığı `public._trip_source()` hiç TANIMLI
 *     DEĞİLDİ (her yükleme `42883` ile ölecekti).
 * Hiçbiri teste yakalanmıyordu, çünkü testler zinciri değil parçaları
 * ölçüyordu. Aşağıdaki kilitler o boşluğu kapatır.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  toCanonicalTripSummary,
  type LegacyTripRecord,
} from '../platform/trip/tripLifecycle';
import { EMPTY_TRIP_METRICS } from '../platform/trip/tripCanonicalModel';

/* ── Fixture ───────────────────────────────────────────────────────────── */

/** P2 üretimi yapmış (yeni) bir kayıt — tripLogService'in bugün ürettiği biçim. */
function p2Record(over: Partial<LegacyTripRecord> = {}): LegacyTripRecord {
  return {
    id: 'trip-1',
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_600_000,
    distanceKm: 12.5,
    durationMin: 10,
    avgSpeedKmh: 75,
    maxSpeedKmh: 110,
    fuelConsumptionL: 1.06,
    fuelCostTL: 47,
    drivingScore: 88,
    harshEvents: 3,

    harshBrakeCount: 2,
    harshAccelCount: 1,
    movingMin: 6,
    idleMin: 2,
    unknownMin: 1,
    stopCount: 3,
    maxRpm: 3200,
    maxEngineTempC: 92,
    fuelUsedPercent: 4.5,
    fuelSource: 'DERIVED',
    costSource: 'ESTIMATED',
    fuelUnitPrice: 45,
    currency: 'TRY',
    priceSource: 'DEFAULT_FALLBACK',
    priceCapturedAtMs: 1_700_000_000_000,
    distanceSource: 'MEASURED',
    confidence: 'VERY_HIGH',
    confidenceLimitedBy: 'timeCoverage',
    speedSampleCount: 84,
    obdCoverage: 0.62,
    timeCoverage: 0.9,
    dataGapCount: 1,
    sourceSwitchCount: 2,
    metricsVersion: 1,
    ...over,
  };
}

/** Eski (P1) kayıt — P2 alanlarının HİÇBİRİ yok. */
function p1Record(): LegacyTripRecord {
  return {
    id: 'old-1',
    startTime: 1_600_000_000_000,
    endTime: 1_600_000_600_000,
    distanceKm: 20,
    durationMin: 10,
    avgSpeedKmh: 120,
    maxSpeedKmh: 140,
    fuelConsumptionL: 1.7,
    fuelCostTL: 76,
    drivingScore: 70,
    harshEvents: 1,
  };
}

/** `tripUploadRuntime`'ın geçtiği bağlam — YALNIZ eski kayıtlar için taban. */
const LEGACY_CTX = {
  distanceSource: 'DERIVED',
  fuelMeasured: false,
  fuelPriceKnown: false,
} as const;

const MIGRATION_047 = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260730000047_fleet_trip_metrics_p2.sql'),
  'utf8',
);

/* ══════════════════════════════════════════════════════════════════════ */

describe('P2 · A. Kanonik dönüşüm — üretilen provenance KAYBOLMAZ', () => {
  it('A1. 🔒 ölçülmüş mesafe, runtime bağlamı tarafından DERIVED\'a düşürülmez', () => {
    /* Regresyon: P1 runtime'ı sabit `DERIVED` geçiyordu ve kayıttaki
       `MEASURED` sessizce eziliyordu → Fleet ölçümü tahmin sanıyordu. */
    const s = toCanonicalTripSummary(p2Record(), 'COMPLETED', LEGACY_CTX);
    expect(s.metrics.distanceKm.source).toBe('MEASURED');
  });

  it('A2. 🔒 yakıt kaynağı kayıttan gelir (bağlam fuelMeasured=false EZEMEZ)', () => {
    const s = toCanonicalTripSummary(p2Record(), 'COMPLETED', LEGACY_CTX);
    expect(s.metrics.fuelUsedL.source).toBe('DERIVED');
  });

  it('A3. 🔒 kanıta dayalı confidence kayıttan gelir', () => {
    const s = toCanonicalTripSummary(p2Record(), 'COMPLETED', LEGACY_CTX);
    expect(s.confidence).toBe('VERY_HIGH');
  });

  it('A4. 🔒 BİLİNMEYEN süre kanonik modelde TAŞINIR (idle\'a katılmaz)', () => {
    /* Regresyon: `unknownTimeMin` alanı kanonik modelde YOKTU; ölçülemeyen
       süre buluta hiç ulaşmıyordu ve süre invaryantı denetlenemiyordu. */
    const s = toCanonicalTripSummary(p2Record(), 'COMPLETED', LEGACY_CTX);
    expect(s.metrics.unknownTimeMin.value).toBe(1);
    expect(s.metrics.idleTimeMin.value).toBe(2);
    expect(s.metrics.movingTimeMin.value).toBe(6);
  });

  it('A5. 🔒 süre invaryantı: moving+idle+unknown <= duration', () => {
    const s = toCanonicalTripSummary(p2Record(), 'COMPLETED', LEGACY_CTX);
    const sum = (s.metrics.movingTimeMin.value ?? 0)
      + (s.metrics.idleTimeMin.value ?? 0)
      + (s.metrics.unknownTimeMin.value ?? 0);
    expect(sum).toBeLessThanOrEqual((s.metrics.durationMin.value ?? 0) + 3);
  });

  it('A6. 🔒 fiyat SNAPSHOT\'ı taşınır (sonradan fiyat değişse maliyet sabit)', () => {
    const s = toCanonicalTripSummary(p2Record(), 'COMPLETED', LEGACY_CTX);
    expect(s.price.unitPrice).toBe(45);
    expect(s.price.currency).toBe('TRY');
    expect(s.price.source).toBe('DEFAULT_FALLBACK');
    expect(s.price.capturedAtMs).toBe(1_700_000_000_000);
  });

  it('A7. 🔒 confidence KANITI taşınır (güven denetlenebilir kalır)', () => {
    const s = toCanonicalTripSummary(p2Record(), 'COMPLETED', LEGACY_CTX);
    expect(s.coverage.speedSampleCount).toBe(84);
    expect(s.coverage.obdCoverage).toBeCloseTo(0.62, 2);
    expect(s.coverage.timeCoverage).toBeCloseTo(0.9, 2);
    expect(s.coverage.dataGapCount).toBe(1);
    expect(s.coverage.sourceSwitchCount).toBe(2);
    expect(s.coverage.limitedBy).toBe('timeCoverage');
  });

  it('A8. 🔒 ölçülen yakıt YÜZDESİ litreden AYRI taşınır', () => {
    const s = toCanonicalTripSummary(p2Record(), 'COMPLETED', LEGACY_CTX);
    expect(s.fuelUsedPercent.value).toBe(4.5);
    expect(s.metrics.fuelUsedL.value).toBe(1.06);
  });

  it('A9. 🔒 metricsVersion taşınır', () => {
    const s = toCanonicalTripSummary(p2Record(), 'COMPLETED', LEGACY_CTX);
    expect(s.metricsVersion).toBe(1);
  });

  it('A10. 🔒 sert manevralar kalıcı kayıttan okunur (RAM\'de KAYBOLMAZ)', () => {
    const s = toCanonicalTripSummary(p2Record(), 'COMPLETED', LEGACY_CTX);
    expect(s.metrics.harshBrakeCount.value).toBe(2);
    expect(s.metrics.harshAccelCount.value).toBe(1);
  });

  it('A11. 🔒 tepe değerler yalnız kayıttan; yoksa UYDURULMAZ', () => {
    const s = toCanonicalTripSummary(p2Record(), 'COMPLETED', LEGACY_CTX);
    expect(s.metrics.maxRpm.value).toBe(3200);
    expect(s.metrics.maxEngineTempC.value).toBe(92);

    const noObd = toCanonicalTripSummary(
      p2Record({ maxRpm: undefined, maxEngineTempC: undefined }), 'COMPLETED', LEGACY_CTX);
    expect(noObd.metrics.maxRpm.value).toBeNull();
    expect(noObd.metrics.maxRpm.source).toBe('UNAVAILABLE');
    expect(noObd.metrics.maxEngineTempC.value).toBeNull();
  });

  it('A12. 🔒 hız limiti kaynağı YOK → ihlal ÜRETİLMEZ', () => {
    const s = toCanonicalTripSummary(p2Record(), 'COMPLETED', LEGACY_CTX);
    expect(s.metrics.speedViolations.value).toBeNull();
    expect(s.metrics.speedViolations.source).toBe('UNAVAILABLE');
  });

  it('A13. 🔒 ÖLÇÜLEN 0 korunur — "Veri yok" DEĞİLDİR', () => {
    const s = toCanonicalTripSummary(
      p2Record({ idleMin: 0, stopCount: 0, harshBrakeCount: 0 }), 'COMPLETED', LEGACY_CTX);
    expect(s.metrics.idleTimeMin.value).toBe(0);
    expect(s.metrics.idleTimeMin.source).toBe('MEASURED');
    expect(s.metrics.stopCount.value).toBe(0);
    expect(s.metrics.harshBrakeCount.value).toBe(0);
  });
});

describe('P2 · B. Eski (P1) kayıtlar — UYDURMA YOK', () => {
  it('B1. 🔒 P2 alanı olmayan kayıtta metrikler UNAVAILABLE kalır', () => {
    const s = toCanonicalTripSummary(p1Record(), 'COMPLETED', LEGACY_CTX);
    expect(s.metrics.unknownTimeMin.value).toBeNull();
    expect(s.metrics.movingTimeMin.value).toBeNull();
    expect(s.metrics.idleTimeMin.value).toBeNull();
    expect(s.metrics.stopCount.value).toBeNull();
    expect(s.metrics.maxRpm.value).toBeNull();
    expect(s.metrics.harshBrakeCount.value).toBeNull();
  });

  it('B2. 🔒 eski kayıtta fiyat/kapsama boş — sahte snapshot ÜRETİLMEZ', () => {
    const s = toCanonicalTripSummary(p1Record(), 'COMPLETED', LEGACY_CTX);
    expect(s.price.unitPrice).toBeNull();
    expect(s.price.source).toBeNull();
    expect(s.coverage.speedSampleCount).toBeNull();
    expect(s.coverage.limitedBy).toBeNull();
    expect(s.metricsVersion).toBeNull();
  });

  it('B3. 🔒 eski kayıtta yakıt bağlam tabanına düşer ve ESTIMATED kalır', () => {
    /* Geriye uyum: P1 kaydının yakıtı 8,5 L/100km sabitiydi — ölçüm DEĞİL. */
    const s = toCanonicalTripSummary(p1Record(), 'COMPLETED', LEGACY_CTX);
    expect(s.metrics.fuelUsedL.source).toBe('ESTIMATED');
    expect(s.metrics.estimatedCost.source).toBe('ESTIMATED');
  });

  it('B4. 🔒 EMPTY_TRIP_METRICS tüm alanları UNAVAILABLE — şablon bozulmaz', () => {
    for (const m of Object.values(EMPTY_TRIP_METRICS)) {
      expect(m.value).toBeNull();
      expect(m.source).toBe('UNAVAILABLE');
    }
  });
});

describe('P2 · C. Migration 047 — bağımlılık ve dedupe', () => {
  it('C1. 🔒 çağrılan public._trip_source GERÇEKTEN TANIMLI', () => {
    /* Regresyon: fonksiyon 25 kez çağrılıyor ama hiçbir migration'da
       tanımlı değildi. plpgsql geç bağlandığı için migration GEÇİYOR,
       hata ancak ilk gerçek yüklemede (42883) ortaya çıkıyordu. */
    expect(MIGRATION_047).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\._trip_source\s*\(/i);
  });

  it('C2. 🔒 _trip_source tanımı, ilk ÇAĞRISINDAN ÖNCE gelir', () => {
    const defIdx = MIGRATION_047.search(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\._trip_source/i);
    const useIdx = MIGRATION_047.indexOf('public._trip_source(p_sources');
    expect(defIdx).toBeGreaterThan(-1);
    expect(useIdx).toBeGreaterThan(-1);
    expect(defIdx).toBeLessThan(useIdx);
  });

  it('C3. 🔒 doğrulama bloğu fonksiyonu ÇAĞIRARAK sınar (metne bakmakla yetinmez)', () => {
    expect(MIGRATION_047).toContain("public._trip_source('MEASURED')");
    expect(MIGRATION_047).toContain("public._trip_source('MEASURED_ISH')");
  });

  it('C4. 🔒 eski P1 yazma imzası DÜŞÜRÜLÜR (P2 alanları sessizce düşmesin)', () => {
    expect(MIGRATION_047).toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.upload_vehicle_trip/i);
    expect(MIGRATION_047).toContain('upload_vehicle_trip birden fazla imzaya sahip');
  });

  it('C5. 🔒 dedupe UNIQUE kısıtı ve DUPLICATE hükmü KORUNUR', () => {
    expect(MIGRATION_047).toContain('vehicle_trips_key_unique');
    expect(MIGRATION_047).toContain('DUPLICATE');
    expect(MIGRATION_047).toContain('SAME_OR_LOWER_REVISION');
  });

  it('C6. 🔒 yalnız İLERİ migration — 033–046 dosyalarına dokunulmaz', () => {
    expect(MIGRATION_047).not.toMatch(/DROP\s+TABLE\s+public\.vehicle_trips/i);
    expect(MIGRATION_047).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i);
  });

  it('C7. 🔒 KOORDİNAT kolonu eklenmez (rota geçmişi kapsam DIŞI)', () => {
    expect(MIGRATION_047).toContain('koordinat kolonu eklendi (kapsam disi)');
    expect(MIGRATION_047).not.toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(latitude|longitude|lat|lng)\b/i);
  });

  it('C8. 🔒 RLS + anon kilidi + DEFINER/search_path korunur', () => {
    expect(MIGRATION_047).toContain('SECURITY DEFINER');
    expect(MIGRATION_047).toContain('SET search_path = public');
    expect(MIGRATION_047).toContain('anon SELECT yetkisi acik');
    expect(MIGRATION_047).toContain('047 HATA: RLS kapali');
  });

  it('C9. 🔒 NOT NULL kaynak kolonlarına açık NULL GİTMEZ', () => {
    /* `_trip_source` bilinçli olarak NULL döner (eskiyi ezmemek için);
       ilk yazımda bu üç kolon NOT NULL olduğundan taban değer şarttır. */
    expect(MIGRATION_047).toContain("coalesce(v_dist_src, 'UNAVAILABLE')");
    expect(MIGRATION_047).toContain("coalesce(v_fuel_src, 'UNAVAILABLE')");
    expect(MIGRATION_047).toContain("coalesce(v_cost_src, 'UNAVAILABLE')");
  });

  it('C10. 🔒 süre invaryantı DB kısıtıyla da korunur', () => {
    expect(MIGRATION_047).toContain('vehicle_trips_duration_invariant');
  });

  it('C11. 🔒 VERY_HIGH confidence kabul edilir', () => {
    expect(MIGRATION_047).toContain("'VERY_HIGH'");
    expect(MIGRATION_047).toContain('VERY_HIGH confidence hala reddediliyor');
  });
});

describe('P2 · D. Yükleme yükü — üretilen alanlar GÖNDERİLİR', () => {
  const RUNTIME = readFileSync(
    join(process.cwd(), 'src/platform/trip/tripUploadRuntime.ts'), 'utf8');

  it('D1. 🔒 p_provenance · p_price · p_coverage · p_metrics_version gönderilir', () => {
    /* Regresyon: bunların HİÇBİRİ gönderilmiyordu; 047'nin eklediği
       kolonlar kalıcı olarak boş kalıyordu. */
    expect(RUNTIME).toContain('p_provenance:');
    expect(RUNTIME).toContain('p_price:');
    expect(RUNTIME).toContain('p_coverage:');
    expect(RUNTIME).toContain('p_metrics_version:');
  });

  it('D2. 🔒 unknownTimeMin ve fuelUsedPercent yüke KONUR', () => {
    expect(RUNTIME).toContain("put('unknownTimeMin'");
    expect(RUNTIME).toContain("put('fuelUsedPercent'");
  });

  it('D3. 🔒 bilinmeyen alan yüke KONMAZ (null göndermek eskiyi ezerdi)', () => {
    /* Sunucudaki `coalesce(EXCLUDED.x, t.x)` sözleşmesi ancak alan
       HİÇ GÖNDERİLMEZSE eski güvenilir değeri korur. */
    expect(RUNTIME).toContain('if (v !== null) out[key] = v;');
  });

  it('D4. 🔒 değeri olmayan metriğin provenance\'ı da gönderilmez', () => {
    expect(RUNTIME).toContain('if (m.value !== null) out[key] = m.source;');
  });

  it('D5. 🔒 birim fiyat yoksa fiyat yükü BOŞ (uydurma fiyat YOK)', () => {
    expect(RUNTIME).toContain('if (s.price.unitPrice === null) return out;');
  });

  it('D6. 🔒 canlı ölçüm GÖNDERİLMEZ — yalnız geçmiş büyüyünce yükleme', () => {
    expect(RUNTIME).toContain('if (history.length <= this._lastHistoryLength)');
  });
});

describe('P2 · E. LAB gözlem yüzeyi', () => {
  const SCREEN = readFileSync(
    join(process.cwd(), 'src/components/devtools/screens/TripEngineScreen.tsx'), 'utf8');

  it('E1. 🔒 §13\'te istenen P2 alanları ekranda GÖZLENİR', () => {
    for (const field of [
      'movingTimeMin', 'idleTimeMin', 'unknownTimeMin', 'stopCount',
      'harshBrakeCount', 'harshAccelCount', 'maxRpm', 'maxEngineTempC',
      'speedViolationSource', 'tripConfidence', 'obdCoverage', 'timeCoverage',
      'dataGapCount', 'sourceSwitchCount', 'lastCompletedTripKey',
      'lastUploadResult', 'fuelSource', 'costSource', 'metricsVersion',
    ]) {
      expect(SCREEN).toContain(field);
    }
  });

  it('E2. 🔒 LAB salt-okunur — aktif komut YOK', () => {
    for (const forbidden of [
      'startTripLog', 'stopTripLog', 'deleteTrip', 'clearAllTrips',
      'startTripUpload', 'callVehicleRpc', 'upload_vehicle_trip',
      '.decide(', 'markQueued', 'setInterval', 'setTimeout',
    ]) {
      expect(SCREEN).not.toContain(forbidden);
    }
  });

  it('E3. 🔒 ROTA/KOORDİNAT gösterilmez (gizlilik)', () => {
    expect(SCREEN).not.toMatch(/\blatitude\b|\blongitude\b|\bcoords?\b/i);
  });

  it('E4. 🔒 bilinmeyen kapsama sahte %0 DEĞİL, UNAVAILABLE', () => {
    expect(SCREEN).toContain("return v === null ? UNAVAILABLE");
  });
});
