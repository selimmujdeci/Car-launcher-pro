/**
 * F4.3 · ARAÇ HAFIZASI — projeksiyon dürüstlüğü.
 *
 * ── PRODUCTION GERÇEĞİ (salt-okuma denetimi, 2026-09-18) ─────────────────
 *   vehicle_trips            157 satır · 3 araç · hepsinde ended_at
 *   vehicle_service_records    0 satır
 *   vehicle_fuel_logs          0 satır
 *   vehicle_commands          54 satır · tamamlanmış read_dtc: **0**
 *
 * ── SAKLAMA GERÇEĞİ (migration'dan ölçüldü) ──────────────────────────────
 *   vehicle_commands  : terminal satırlar **14 GÜN** sonra SİLİNİYOR
 *   vehicle_events    : obd_diag/critical_error/voice_diag **30 GÜN** sonra
 *                       siliniyor; kalanı heartbeat (52k) / location_delta
 *                       (30k) gibi telemetri gürültüsü
 *   vehicle_trips     : TTL YOK → kalıcı
 *
 * Yani KALICI TEŞHİS GEÇMİŞİ YOKTUR ve bu dosya `DIAGNOSTIC` olayı üreten
 * bir yol sınamaz — çünkü öyle bir yol KURULMADI.
 *
 * ── KİLİTLENEN INVARIANTLAR ──────────────────────────────────────────────
 * Hafıza PROJEKSİYONDUR, otorite DEĞİLDİR · yolculuk mesafesi odometre
 * OLAMAZ · kullanıcı km'si ECU okuması OLAMAZ · yakıt ALIMI tüketim ölçümü
 * OLAMAZ · ESTIMATED asla MEASURED olmaz · zamanı bilinmeyen kayıt "şimdi"
 * damgası ALMAZ.
 */

import { describe, it, expect } from 'vitest';
import {
  buildVehicleMemory,
  tripToMemoryEvent,
  fuelEntryToMemoryEvent,
  serviceEntryToMemoryEvent,
  provenanceLabel,
  toEpochMs,
  MEMORY_PAGE_SIZE,
  type VehicleMemoryEvent,
} from '@/lib/memory/vehicleMemory';
import type { TripRow } from '@/lib/fleet/vehicleTripsView';
import type { FuelEntry, ServiceEntry } from '@/lib/recordsService';

const V = 'veh-A';
const LABELS = { oil: 'Yağ Değişimi', tires: 'Lastik Rotasyonu' };

function trip(over: Partial<TripRow> = {}): TripRow {
  return {
    trip_key: 't1', ended_at: '2026-09-17T10:00:00.000Z',
    distance_km: 18.4, duration_min: 34,
    distance_source: 'MEASURED', fuel_source: 'UNAVAILABLE', fuel_used_l: null,
    ...over,
  } as TripRow;
}

const fuel = (over: Partial<FuelEntry> = {}): FuelEntry => ({
  id: 'f1', filledOn: '2026-09-16', odometerKm: 92_000,
  liters: 35.5, pricePerL: 45, ...over,
});

const service = (over: Partial<ServiceEntry> = {}): ServiceEntry => ({
  id: 's1', serviceKey: 'oil', performedOn: '2026-09-12', odometerKm: 91_500, ...over,
});

function mem(over: Partial<Parameters<typeof buildVehicleMemory>[0]> = {}) {
  return buildVehicleMemory({
    vehicleId: V, trips: [], fuel: [], services: [], serviceLabels: LABELS, ...over,
  });
}

/* ═══ 1 · Yolculuk ≠ odometre ═══════════════════════════════════════════ */

describe('F4.3 · yolculuk mesafesi odometre olamaz', () => {
  it('2/18 — mesafe "Mesafe" diye etiketlenir, toplam km DEĞİL', () => {
    const e = tripToMemoryEvent(trip(), V)!;
    const labels = e.measurements.map((m) => m.label);
    expect(labels).toContain('Mesafe');
    /* Hiçbir alan aracın toplam kilometresini İDDİA ETMEZ. */
    for (const bad of ['Kilometre', 'Toplam km', 'Odometre', 'Toplam Kilometre']) {
      expect(labels, bad).not.toContain(bad);
    }
    expect(JSON.stringify(e)).not.toMatch(/odometre|toplam km/i);
  });

  it('18 — yolculukların TOPLAMI da toplam kilometre üretmez', () => {
    const m = mem({ trips: [trip({ trip_key: 'a' }), trip({ trip_key: 'b' })] });
    /* Projeksiyon hiçbir yerde kümülatif mesafe hesaplamaz. */
    expect(JSON.stringify(m)).not.toMatch(/totalMileage|toplamKm|odometer/i);
    expect(m.events).toHaveLength(2);
  });

  it(`mesafe provenance'ı kaynağın BEYANINDAN taşınır`, () => {
    expect(tripToMemoryEvent(trip({ distance_source: 'MEASURED' }), V)!.provenance).toBe('MEASURED');
    expect(tripToMemoryEvent(trip({ distance_source: 'DERIVED' }), V)!.provenance).toBe('DERIVED');
    /* Bilinmeyen beyan MEASURED'a YÜKSELTİLMEZ. */
    expect(tripToMemoryEvent(trip({ distance_source: null }), V)!.provenance).toBe('ESTIMATED');
  });
});

/* ═══ 2 · Yakıt semantiği ═══════════════════════════════════════════════ */

describe('F4.3 · yakıt alımı ≠ yakıt tüketimi', () => {
  it('4 — kullanıcı yakıt kaydı ALIM olarak sunulur', () => {
    const e = fuelEntryToMemoryEvent(fuel(), V)!;
    expect(e.type).toBe('FUEL_RECORD');
    expect(e.title).toBe('Yakıt alındı');
    expect(e.provenance).toBe('USER_RECORDED');
    expect(e.limitations.join(' ')).toContain('ALIMIDIR');
  });

  it('3 — kullanıcının girdiği kilometre ECU ölçümü SAYILMAZ', () => {
    for (const e of [fuelEntryToMemoryEvent(fuel(), V)!,
                     serviceEntryToMemoryEvent(service(), V, 'Yağ Değişimi')!]) {
      const km = e.measurements.find((m) => m.label.includes('Kilometre'))!;
      expect(km.provenance).toBe('USER_RECORDED');
      expect(km.provenance).not.toBe('MEASURED');
      /* Etiket de kullanıcıya kaynağı söyler. */
      expect(km.label).toContain('kullanıcı');
    }
  });

  it('5 — ESTIMATED litre ölçüm gibi GÖSTERİLMEZ (F3.2 sınırı)', () => {
    const e = tripToMemoryEvent(
      trip({ fuel_used_l: 1.1, fuel_source: 'ESTIMATED' }), V)!;
    expect(e.measurements.map((m) => m.label)).not.toContain('Yakıt');
    expect(e.limitations.join(' ')).toContain('ölçülmedi');
  });

  it('gerçekten türetilmiş litre GÖSTERİLİR (kapı tek yönlü değil)', () => {
    const e = tripToMemoryEvent(trip({ fuel_used_l: 4.2, fuel_source: 'DERIVED' }), V)!;
    const f = e.measurements.find((m) => m.label === 'Yakıt')!;
    expect(f.provenance).toBe('DERIVED');
  });
});

/* ═══ 3 · Servis kaydı ══════════════════════════════════════════════════ */

describe('F4.3 · servis kaydı kullanıcı beyanıdır', () => {
  it('doğrulanmış gibi sunulmaz', () => {
    const e = serviceEntryToMemoryEvent(service(), V, 'Yağ Değişimi')!;
    expect(e.provenance).toBe('USER_RECORDED');
    expect(e.limitations.join(' ')).toContain('araçtan doğrulanmadı');
    expect(JSON.stringify(e)).not.toMatch(/doğrulandı(?!\w)|onaylandı/);
  });

  it('etiket mevcut servis sözlüğünden gelir', () => {
    const m = mem({ services: [service({ serviceKey: 'tires' })] });
    expect(m.events[0].title).toBe('Lastik Rotasyonu');
  });

  it('bilinmeyen servis anahtarı UYDURULMAZ', () => {
    const m = mem({ services: [service({ serviceKey: 'bilinmeyen' })] });
    expect(m.events[0].title).toBe('Servis kaydı');
  });
});

/* ═══ 4 · Zaman semantiği ═══════════════════════════════════════════════ */

describe('F4.3 · zaman uydurulmaz', () => {
  it('9 — occurredAt yoksa olay HİÇ üretilmez ("şimdi" damgası yok)', () => {
    expect(tripToMemoryEvent(trip({ ended_at: null }), V)).toBeNull();
    expect(tripToMemoryEvent(trip({ ended_at: 'bozuk' }), V)).toBeNull();
    expect(fuelEntryToMemoryEvent(fuel({ filledOn: '' }), V)).toBeNull();
    expect(serviceEntryToMemoryEvent(service({ performedOn: 'x' }), V, 'Yağ')).toBeNull();
  });

  it('zamansız kayıt çizelgeye SESSİZCE eklenmez', () => {
    const m = mem({ trips: [trip({ ended_at: null }), trip({ trip_key: 'ok' })] });
    expect(m.events).toHaveLength(1);
    expect(m.events[0].id).toBe('trip:ok');
  });

  it('toEpochMs geçersiz girdide null döner', () => {
    for (const v of ['', '   ', 'abc', null, undefined]) {
      expect(toEpochMs(v as string | null), String(v)).toBeNull();
    }
  });
});

/* ═══ 5 · Sıralama / sayfalama ══════════════════════════════════════════ */

describe('F4.3 · deterministik sıralama ve sınır', () => {
  it('14 — occurredAt DESC, eşitlikte tip sonra id ile kırılır', () => {
    const same = '2026-09-17T10:00:00.000Z';
    const m = mem({
      trips: [trip({ trip_key: 'b', ended_at: same }), trip({ trip_key: 'a', ended_at: same })],
      fuel: [fuel({ id: 'f', filledOn: '2026-09-17' })],
    });
    const ids = m.events.map((e) => e.id);
    /* Aynı anda başlayanlar STABİL sırada: FUEL_RECORD < TRIP (alfabetik),
       trip'ler kendi içinde id'ye göre. */
    expect(ids).toEqual(['trip:a', 'trip:b', 'fuel:f']);

    /* İki kez kurmak AYNI sırayı vermeli. */
    const ids2 = mem({
      trips: [trip({ trip_key: 'a', ended_at: same }), trip({ trip_key: 'b', ended_at: same })],
      fuel: [fuel({ id: 'f', filledOn: '2026-09-17' })],
    }).events.map((e) => e.id);
    expect(ids2).toEqual(ids);
  });

  it('15 — sayfa sınırı aşılırsa kırpılır ve BİLDİRİLİR', () => {
    const many = Array.from({ length: MEMORY_PAGE_SIZE + 5 }, (_, i) =>
      trip({ trip_key: `t${i}`, ended_at: new Date(1_700_000_000_000 + i * 1000).toISOString() }));
    const m = mem({ trips: many });
    expect(m.events).toHaveLength(MEMORY_PAGE_SIZE);
    expect(m.truncated).toBe(true);
  });
});

/* ═══ 6 · Boş / okunamadı ═══════════════════════════════════════════════ */

describe('F4.3 · boşluk uydurulmaz', () => {
  it('10 — kaynaklar boşsa SAHTE olay üretilmez', () => {
    const m = mem();
    expect(m.events).toHaveLength(0);
    expect(m.unreadableSources).toHaveLength(0);
    expect(m.truncated).toBe(false);
  });

  it('11 — OKUNAMADI ile KAYIT YOK ayrı taşınır', () => {
    const m = mem({ trips: null, fuel: [], services: null });
    expect(m.events).toHaveLength(0);
    expect(m.unreadableSources).toEqual(['Yolculuklar', 'Servis kayıtları']);
    /* Okunamayan kaynak "kayıt yok" DEĞİLDİR. */
    expect(m.unreadableSources).not.toContain('Yakıt kayıtları');
  });
});

/* ═══ 7 · Araç izolasyonu ══════════════════════════════════════════════ */

describe('F4.3 · araç kapsamı', () => {
  it('1 — her olay istenen araç kimliğini taşır', () => {
    const m = buildVehicleMemory({
      vehicleId: 'veh-B', trips: [trip()], fuel: [fuel()], services: [service()],
      serviceLabels: LABELS,
    });
    expect(m.vehicleId).toBe('veh-B');
    for (const e of m.events) expect(e.vehicleId).toBe('veh-B');
    /* A aracının kimliği hiçbir olayda görünmez. */
    expect(JSON.stringify(m)).not.toContain('veh-A');
  });
});

/* ═══ 8 · Provenance ═══════════════════════════════════════════════════ */

describe('F4.3 · provenance kaybolmaz', () => {
  it('her olay ve her ölçüm provenance taşır', () => {
    const m = mem({ trips: [trip()], fuel: [fuel()], services: [service()] });
    expect(m.events.length).toBeGreaterThan(0);
    for (const e of m.events as VehicleMemoryEvent[]) {
      expect(e.provenance).toBeTruthy();
      expect(e.sourceRef).toBeTruthy();
      for (const mm of e.measurements) expect(mm.provenance).toBeTruthy();
    }
  });

  it('kullanıcıya düz Türkçeye çevrilir', () => {
    expect(provenanceLabel('USER_RECORDED')).toBe('Kullanıcı kaydı');
    expect(provenanceLabel('MEASURED')).toBe('Araçtan ölçüldü');
    expect(provenanceLabel('ESTIMATED')).toBe('Tahmini');
  });
});

/* ═══ 9 · Teşhis geçmişi YOK ═══════════════════════════════════════════ */

describe('F4.3 · kalıcı teşhis geçmişi üretilmez', () => {
  it('6/7/8 — DIAGNOSTIC olay türü SÖZLEŞMEDE YOK', () => {
    /* `vehicle_commands` 14 günde siliniyor, `vehicle_events`in anlamlı
       türleri 30 günde. Kalıcı kaynak olmadığı için tür hiç açılmadı —
       böylece "3 ay önce şu arıza vardı" iddiası YAPISAL OLARAK imkânsız. */
    const m = mem({ trips: [trip()], fuel: [fuel()], services: [service()] });
    const types = new Set(m.events.map((e) => e.type));
    expect([...types].sort()).toEqual(['FUEL_RECORD', 'SERVICE_RECORD', 'TRIP']);
    expect(JSON.stringify(m)).not.toMatch(/DIAGNOSTIC|arıza yok|DTC/i);
  });
});
