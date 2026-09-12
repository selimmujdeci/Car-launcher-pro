/**
 * tripAiModel.test.ts — TRIP AI gözlem modeli DAVRANIŞ KİLİTLERİ.
 *
 * Motorlar (koridor + öneri) zaten kendi testlerine sahiptir. Bu dosya
 * **zinciri ve dürüstlük kapılarını** kilitler:
 *   1. ÜÇ AYRI "veri yok" durumu birbirinin yerine geçmez
 *      (rota yok · POI yok · depo OKUNAMADI).
 *   2. Hesap koşmadıysa sonuç `null`dır — "0 aday" DEĞİL.
 *   3. Koridorda aday çıkmaması bir ÖLÇÜMDÜR (`NO_CANDIDATE`), yokluk değil.
 *   4. Kullanıcı verisi (ad · adres · koordinat · kimlik) çıktıya SIZMAZ.
 */

import { describe, it, expect } from 'vitest';

import {
  buildTripAiSummary, EMPTY_TRIP_AI_SUMMARY,
} from '../platform/devtools/tripAiModel';
import type { TripAiRawInputs } from '../platform/devtools/tripAiSources';
import type { StoredLocation } from '../platform/offlineSearchService';

/** Ankara–Konya yönünde kaba bir rota parçası `[lon, lat][]`. */
const GEOMETRY: [number, number][] = [
  [32.8597, 39.9334],
  [32.8000, 39.8000],
  [32.7000, 39.6000],
  [32.6000, 39.4000],
];

function poi(over: Partial<StoredLocation> = {}): StoredLocation {
  return {
    id: 'poi-gizli-1',
    name: 'Anneannem',            // ← kişisel: çıktıya SIZMAMALI
    address: 'Gizli Mah. 3/7',    // ← kişisel
    lat: 39.80,
    lng: 32.80,
    source: 'favorite',
    queryText: 'anneannem ev',
    timestamp: 1_700_000_000_000,
    useCount: 4,
    ...over,
  };
}

function inputs(over: Partial<TripAiRawInputs> = {}): TripAiRawInputs {
  return {
    readAt: 1_000,
    geometry: GEOMETRY,
    pois: [poi()],
    poiStoreReadable: true,
    ...over,
  };
}

const CORRIDOR_M = 5_000;
const MAX = 20;

describe('TRIP AI modeli — üç ayrı "veri yok" durumu', () => {
  it('POI deposu OKUNAMADIYSA "kayıt yok" DENMEZ', () => {
    const s = buildTripAiSummary(
      inputs({ pois: [], poiStoreReadable: false }), CORRIDOR_M, MAX);
    expect(s.state).toBe('POI_STORE_UNREADABLE');
    expect(s.poiCount).toBeNull();            // sahte 0 YOK
    expect(s.candidateCount).toBeNull();      // hesap koşmadı
  });

  it('rota yoksa koridor tanımsızdır (POI okunmuş olsa bile)', () => {
    const s = buildTripAiSummary(inputs({ geometry: null }), CORRIDOR_M, MAX);
    expect(s.state).toBe('NO_ROUTE');
    expect(s.pathPointCount).toBeNull();
    expect(s.poiCount).toBe(1);               // depo okundu — bu GERÇEK 0 değil 1
    expect(s.candidateCount).toBeNull();
  });

  it('depo okundu ama boşsa "kayıt yok" (ölçülmüş sıfır)', () => {
    const s = buildTripAiSummary(inputs({ pois: [] }), CORRIDOR_M, MAX);
    expect(s.state).toBe('NO_POI');
    expect(s.poiCount).toBe(0);               // burada 0 GERÇEKTİR
    expect(s.candidateCount).toBeNull();
  });

  it('hiç koşmamış özet "0 aday" demez', () => {
    expect(EMPTY_TRIP_AI_SUMMARY.state).toBe('NOT_RUN');
    expect(EMPTY_TRIP_AI_SUMMARY.candidateCount).toBeNull();
    expect(EMPTY_TRIP_AI_SUMMARY.recommendationCount).toBeNull();
  });
});

describe('TRIP AI modeli — zincir gerçekten koşuyor', () => {
  it('rota üstündeki kayıt aday olur ve öneri satırı üretir', () => {
    const s = buildTripAiSummary(inputs(), CORRIDOR_M, MAX);
    expect(s.state).toBe('OK');
    expect(s.candidateCount).toBe(1);
    expect(s.recommendationCount).toBe(1);
    const row = s.rows[0]!;
    expect(row.rank).toBe(1);
    expect(row.score).toBeGreaterThanOrEqual(0);
    expect(row.score).toBeLessThanOrEqual(1);
    expect(row.distanceToRouteM).toBeGreaterThanOrEqual(0);
  });

  it('KONTROL — koridorun ÇOK dışındaki kayıt aday olmaz (ölçülmüş sıfır)', () => {
    /* ~700 km uzakta bir nokta: 5 km koridora giremez. */
    const s = buildTripAiSummary(
      inputs({ pois: [poi({ lat: 36.90, lng: 30.70 })] }), CORRIDOR_M, MAX);
    expect(s.state).toBe('NO_CANDIDATE');
    expect(s.candidateCount).toBe(0);         // hesap koştu → 0 GERÇEK
    expect(s.rows).toEqual([]);
  });
});

describe('TRIP AI modeli — gizlilik (kural 6)', () => {
  it('kullanıcı verisi çıktının HİÇBİR yerinde geçmez', () => {
    const s = buildTripAiSummary(inputs(), CORRIDOR_M, MAX);
    const dump = JSON.stringify(s);
    for (const secret of ['Anneannem', 'Gizli Mah', 'anneannem ev', 'poi-gizli-1']) {
      expect(dump, `sızıntı: ${secret}`).not.toContain(secret);
    }
    /* Koordinat da sızmamalı (rota mesafesi türev bir sayıdır, konum değil). */
    expect(dump).not.toContain('39.8');
    expect(dump).not.toContain('32.8');
  });
});
