/**
 * F5 · HAFTALIK ÖZET + PAYLAŞILABİLİR RAPOR — veri dürüstlüğü kilidi.
 *
 * ── NEDEN BU TESTLER VAR ─────────────────────────────────────────────────
 * Özet ve rapor, "ürün bitmiş görünsün" diye en kolay yalan söylenecek iki
 * yüzeydir: okunmamış kaynağı `0` saymak, ölçülmemiş mesafeyi toplamaya
 * katmak, kullanıcı kaydını ölçüm gibi sunmak, kanıtı olmayan odometreyi/
 * tüketimi/arıza geçmişini yazmak.
 *
 * Buradaki her test MUTASYON TESTİDİR: yalanın karşılığı olan metin/sayı
 * çıktıda ARANIR ve BULUNMAMASI gerekir.
 *
 * KİLİTLENEN INVARIANTLAR:
 *   NOT_READ ≠ ZERO · UNREADABLE ≠ EMPTY · TRIP DISTANCE ≠ ODOMETER ·
 *   USER RECORD ≠ MEASUREMENT · NO HEALTH READ ≠ HEALTHY ·
 *   FUEL PURCHASE ≠ FUEL CONSUMED
 */

import { describe, it, expect } from 'vitest';
import {
  buildWeeklySummary,
  WEEKLY_WINDOW_MS,
  type WeeklySummaryInput,
} from '@/lib/home/weeklySummary';
import { buildVehicleShareReport } from '@/lib/reports/vehicleShareReport';
import { buildVehicleHealthSummary } from '@/lib/diagnostics/vehicleHealth';
import { buildVehicleFreshness } from '@/lib/fleet/vehicleTelemetryFreshness';
import {
  buildVehicleMemory,
  type VehicleMemoryEvent,
} from '@/lib/memory/vehicleMemory';
import type { TripRow } from '@/lib/fleet/vehicleTripsView';
import type { FuelEntry, ServiceEntry } from '@/lib/recordsService';
import type { DtcOutcome } from '@/lib/diagnostics/dtcResultContract';

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const OK_COMPLETENESS = { stored: 'ok', pending: 'ok', permanent: 'ok' } as const;

/** Pencere İÇİNDE biten yolculuk. */
function trip(over: Partial<TripRow> = {}): TripRow {
  return {
    trip_key: `t-${Math.random().toString(36).slice(2, 8)}`,
    ended_at: new Date(NOW - 2 * 86_400_000).toISOString(),
    distance_km: 12.4,
    duration_min: 24,
    distance_source: 'MEASURED',
    ...over,
  };
}

function fuelEntry(over: Partial<FuelEntry> = {}): FuelEntry {
  return { id: 'f-1', filledOn: '2026-09-15', odometerKm: null, liters: 32.5, pricePerL: 44, ...over };
}

function serviceEntry(over: Partial<ServiceEntry> = {}): ServiceEntry {
  return { id: 's-1', serviceKey: 'oil', performedOn: '2026-09-14', odometerKm: null, ...over };
}

function weekly(over: Partial<WeeklySummaryInput> = {}) {
  return buildWeeklySummary({
    now: NOW, trips: [trip()], fuel: [], services: [], ...over,
  });
}

function factById(s: ReturnType<typeof weekly>, id: string) {
  return s.facts.find((f) => f.id === id) ?? null;
}

/* ═══ A · HAFTALIK ÖZET ═══════════════════════════════════════════════════ */

describe('F5 · haftalık özet: OKUNMADI ≠ SIFIR', () => {
  it('okunmamış kaynak için hiçbir sayı üretmez', () => {
    const s = weekly({ fuel: undefined, services: undefined });

    expect(factById(s, 'FUEL_RECORDS')).toBeNull();
    expect(factById(s, 'SERVICE_RECORDS')).toBeNull();
    /* Okunmadığı AYRICA taşınır — sessizce yutulmaz. */
    expect(s.uncoveredSources).toEqual(['Yakıt kayıtları', 'Servis kayıtları']);
    expect(s.unreadableSources).toEqual([]);
  });

  it('OKUNAMAYAN kaynak "kayıt yok" sayılmaz', () => {
    const s = weekly({ services: null });

    expect(factById(s, 'SERVICE_RECORDS')).toBeNull();
    expect(s.unreadableSources).toContain('Servis kayıtları');
    /* Mutasyon: "0 servis kaydı" iddiası ÇIKMAMALI. */
    expect(s.facts.some((f) => f.id === 'SERVICE_RECORDS' && f.value === '0')).toBe(false);
  });

  it('OKUNAN ama boş kaynak için 0 demek dürüsttür', () => {
    const s = weekly({ services: [], fuel: [] });

    expect(factById(s, 'SERVICE_RECORDS')?.value).toBe('0');
    expect(factById(s, 'FUEL_RECORDS')?.value).toBe('0');
    expect(s.unreadableSources).toEqual([]);
    expect(s.uncoveredSources).toEqual([]);
  });
});

describe('F5 · haftalık özet: mesafe ODOMETRE değildir', () => {
  it('ölçülmemiş mesafe toplama 0 olarak girmez', () => {
    const s = weekly({
      trips: [
        trip({ distance_km: 10 }),
        trip({ distance_km: null }),
        trip({ distance_km: '' }),      // PostgREST numeric boş metin tuzağı
      ],
    });

    expect(factById(s, 'TRIPS')?.value).toBe('3');
    expect(factById(s, 'DISTANCE')?.value).toBe('10.0 km');
    /* Kapsam boşluğu SESSİZ GEÇİLMEZ. */
    expect(factById(s, 'DISTANCE')?.detail).toBe('2 yolculuğun mesafesi ölçülmedi');
  });

  it('hiçbir mesafe ölçülmemişse sayı UYDURULMAZ', () => {
    const s = weekly({ trips: [trip({ distance_km: null }), trip({ distance_km: null })] });

    expect(factById(s, 'DISTANCE')?.value).toBe('—');
    expect(factById(s, 'DISTANCE')?.value).not.toBe('0.0 km');
    expect(s.headline).toBe('Bu hafta 2 yolculuk kaydedildi');
  });

  it('özetin hiçbir yerinde toplam araç kilometresi iddiası yoktur', () => {
    const s = weekly({ trips: [trip({ distance_km: 120 })] });
    const blob = JSON.stringify(s).toLocaleLowerCase('tr');

    expect(blob).not.toContain('toplam kilometre');
    expect(blob).not.toContain('odometre');
    /* Ortalama tüketim de ÜRETİLMEZ (ölçüm yok). */
    expect(blob).not.toContain('tüketim');
  });
});

describe('F5 · haftalık özet: pencere sınırı', () => {
  it('pencere DIŞINDA biten yolculuk sayılmaz', () => {
    const s = weekly({
      trips: [
        trip({ ended_at: new Date(NOW - WEEKLY_WINDOW_MS - 60_000).toISOString() }),
        trip({ ended_at: new Date(NOW - 60_000).toISOString() }),
      ],
    });

    expect(factById(s, 'TRIPS')?.value).toBe('1');
  });

  it('zamanı bilinmeyen yolculuk pencereye ZORLA sokulmaz', () => {
    const s = weekly({ trips: [trip({ ended_at: null }), trip({ ended_at: 'çöp' })] });

    expect(factById(s, 'TRIPS')?.value).toBe('0');
    expect(s.headline).toBe('Bu hafta kayıtlı yolculuk yok');
  });

  it('yakıt kaydı ALIM olarak etiketlenir, tüketim olarak DEĞİL', () => {
    const s = weekly({ fuel: [fuelEntry({ liters: 30 })] });
    const detail = factById(s, 'FUEL_RECORDS')?.detail ?? '';

    expect(detail).toContain('alındı');
    expect(detail).toContain('kendi kaydınız');
    expect(detail).not.toContain('harcan');
  });
});

/* ═══ B · PAYLAŞILABİLİR RAPOR ═══════════════════════════════════════════ */

function freshness(ageMs = 60_000) {
  const at = new Date(NOW - ageMs).toISOString();
  return buildVehicleFreshness({
    now: NOW, readable: true,
    row: { updatedAt: at, obdObservedAt: at, gpsObservedAt: at, lat: 41, lng: 29, temp: 84, fuel: 48, rpm: 800, speed: 0 },
  });
}

const noDtc: DtcOutcome = {
  kind: 'NO_DTC', partial: false,
  readAt: new Date(NOW - 60_000).toISOString(), completeness: OK_COMPLETENESS,
};

function memoryEvents(): readonly VehicleMemoryEvent[] {
  return buildVehicleMemory({
    vehicleId: 'v-1',
    trips: [trip()],
    fuel: [fuelEntry()],
    services: [serviceEntry({ odometerKm: 120_000 })],
    serviceLabels: { oil: 'Yağ değişimi' },
  }).events;
}

function report(over: Partial<Parameters<typeof buildVehicleShareReport>[0]> = {}) {
  return buildVehicleShareReport({
    now: NOW,
    title: '34 ABC 123',
    subtitle: 'Renault Megane',
    health: buildVehicleHealthSummary({ now: NOW, freshness: freshness(), dtc: noDtc, voltage: null }),
    weekly: weekly(),
    events: memoryEvents(),
    ...over,
  });
}

describe('F5 · paylaşılan rapor: okunmamış sağlık "sorun yok" DEĞİLDİR', () => {
  it('sağlık okunamadıysa rapor sağlıklı iddiası kurmaz', () => {
    const r = report({ health: null });

    expect(r.text).toContain('Araç durumu bu özet alınırken okunamadı');
    expect(r.text).not.toContain('sorun görülmedi');
    expect(r.limitations.some((l) => l.includes('sağlık hükmü içermiyor'))).toBe(true);
  });

  it('geçmiş kayıtlar okunamadıysa "kayıt yok" yazılmaz', () => {
    const r = report({ events: null });

    expect(r.text).not.toContain('Kayıtlı servis işlemi yok');
    expect(r.limitations.some((l) => l.includes('Geçmiş kayıtlar okunamadı'))).toBe(true);
  });
});

describe('F5 · paylaşılan rapor: kanıtı olmayan iddia DAİMA reddedilir', () => {
  it('odometre · tüketim · arıza geçmişi eksiklik olarak yazılır', () => {
    const r = report();

    expect(r.text).toContain('Aracın toplam kilometresi bu özette yer almaz');
    expect(r.text).toContain('Ortalama yakıt tüketimi bu özette yer almaz');
    expect(r.text).toContain('Geçmiş arıza kodları bu özette yer almaz');
  });

  it('kullanıcı kaydı ÖLÇÜM gibi sunulmaz', () => {
    const r = report();

    expect(r.text).toContain('kullanıcı girişi');
    expect(r.limitations.some((l) => l.includes('araçtan doğrulanmamıştır'))).toBe(true);
  });

  it('fiziksel durum (park · kilit) iddiası hiç geçmez', () => {
    const blob = report().text.toLocaleLowerCase('tr');

    expect(blob).not.toContain('park edildi');
    expect(blob).not.toContain('kilitli');
  });

  it('gerçek arıza kodu varsa raporda AYNEN yer alır', () => {
    const withDtc: DtcOutcome = {
      kind: 'RESULT', partial: false,
      readAt: new Date(NOW - 60_000).toISOString(), completeness: OK_COMPLETENESS,
      dtcs: [{ code: 'P0571', severity: 'warning', system: 'Fren', desc: 'Fren Pedalı Anahtarı Devresi' }],
    };
    const r = report({
      health: buildVehicleHealthSummary({ now: NOW, freshness: freshness(), dtc: withDtc, voltage: null }),
    });

    expect(r.text).toContain('P0571');
    expect(r.text).toContain('Fren Pedalı Anahtarı Devresi');
  });
});
