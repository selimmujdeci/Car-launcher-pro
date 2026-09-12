/**
 * recordsService.test.ts — Kayıtlar sekmesi (yakıt/servis) DÜRÜSTLÜK kilitleri.
 *
 * Kilitlenen ölçülen kusurlar (2026-08-14):
 *   1. Kayıtlar tamamen `localStorage`taydı → telefon değişince YOK OLUYORDU
 *      ve kullanıcıya bu HİÇ söylenmiyordu.
 *   2. Depo anahtarı SABİTTİ → iki araç eşleştiren kullanıcıda kayıtlar
 *      birbirine KARIŞIYORDU.
 *   3. `vehicle?.odometer ?? 0` → kilometresi bilinmeyen araçta bakım hükmü
 *      SAHTE "İyi" çıkıyordu.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const _store = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (k: string) => _store.get(k) ?? null,
  setItem: (k: string, v: string) => { _store.set(k, v); },
  removeItem: (k: string) => { _store.delete(k); },
  clear: () => { _store.clear(); },
});

// Oturum YOK senaryosu — sunucuya yazılamaz, yerel kalır.
vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabaseBrowser: null,
}));

import {
  migrateLegacyFuelLog, migrateLegacyServiceLog,
  addFuelEntry, loadFuelEntries,
  averageConsumption, totalCost,
  STORAGE_MODE_LABEL, STORAGE_MODE_HINT,
  type FuelEntry,
} from '@/lib/recordsService';
import { judgeService } from '@/components/pwa/RecordsPanel';

const V1 = 'vehicle-1';
const V2 = 'vehicle-2';

beforeEach(() => { _store.clear(); });

describe('araç kapsamı — kayıtlar KARIŞMAZ', () => {
  it('KİLİT: iki araç ayrı depolara yazar', async () => {
    await addFuelEntry(V1, { filledOn: '2026-08-01', odometerKm: 1000, liters: 40, pricePerL: 45 });
    await addFuelEntry(V2, { filledOn: '2026-08-02', odometerKm: 2000, liters: 30, pricePerL: 45 });

    const a = await loadFuelEntries(V1);
    const b = await loadFuelEntries(V2);

    expect(a.entries).toHaveLength(1);
    expect(b.entries).toHaveLength(1);
    expect(a.entries[0].liters).toBe(40);
    expect(b.entries[0].liters).toBe(30);
  });

  it('KİLİT: eski SABİT anahtardaki veri kaybolmaz (göç edilir)', () => {
    _store.set('caros_fuel_log', JSON.stringify([
      { id: 'x1', date: '2026-07-01', km: 90000, liters: 35, pricePerL: 44 },
    ]));
    const migrated = migrateLegacyFuelLog(V1);
    expect(migrated).toHaveLength(1);
    expect(migrated[0].odometerKm).toBe(90000);
    expect(migrated[0].filledOn).toBe('2026-07-01');
    // Kaynak SİLİNMEZ — hangi araca ait olduğu bilinmediği için ikinci araç da okuyabilmeli.
    expect(_store.get('caros_fuel_log')).toBeTruthy();
  });

  it('eski servis kaydı da göç eder', () => {
    _store.set('caros_service_log', JSON.stringify({
      oil: { lastKm: 80000, lastDate: '2026-06-15' },
      tires: {},   // tarihi yok → taşınmaz
    }));
    const migrated = migrateLegacyServiceLog(V1);
    expect(migrated).toHaveLength(1);
    expect(migrated[0].serviceKey).toBe('oil');
    expect(migrated[0].odometerKm).toBe(80000);
  });
});

describe('depo modu — kullanıcı verinin NEREDE olduğunu bilir', () => {
  it('KİLİT: oturum yokken mod LOCAL_ONLY ve uyarı metni vardır', async () => {
    const res = await loadFuelEntries(V1);
    expect(res.mode).toBe('LOCAL_ONLY');
    expect(STORAGE_MODE_HINT.LOCAL_ONLY).toMatch(/yalnız bu telefonda|kaybolur/i);
    expect(STORAGE_MODE_LABEL.LOCAL_ONLY.length).toBeGreaterThan(0);
  });

  it('KİLİT: yerel yazma başarılıysa `saved` true, mod dürüst kalır', async () => {
    const r = await addFuelEntry(V1, { filledOn: '2026-08-01', odometerKm: null, liters: 20, pricePerL: null });
    expect(r.saved).toBe(true);
    // "Sunucuya kaydedildi" İDDİA EDİLMEZ.
    expect(r.mode).toBe('LOCAL_ONLY');
  });
});

describe('sahte 0 yasağı', () => {
  it('KİLİT: bilinmeyen kilometre ve fiyat null olarak saklanır', async () => {
    await addFuelEntry(V1, { filledOn: '2026-08-01', odometerKm: null, liters: 25, pricePerL: null });
    const res = await loadFuelEntries(V1);
    expect(res.entries[0].odometerKm).toBeNull();
    expect(res.entries[0].pricePerL).toBeNull();
  });

  it('KİLİT: eski biçimdeki 0 km "bilinmiyor"a çevrilir (0 bir ölçüm değildi)', () => {
    _store.set('caros_fuel_log', JSON.stringify([
      { id: 'x1', date: '2026-07-01', km: 0, liters: 35, pricePerL: 44 },
    ]));
    expect(migrateLegacyFuelLog(V1)[0].odometerKm).toBeNull();
  });
});

describe('hesaplamalar — ölçülemeyen değer SAYI üretmez', () => {
  const mk = (km: number | null, liters: number, price: number | null): FuelEntry =>
    ({ id: `${km}-${liters}`, filledOn: '2026-08-01', odometerKm: km, liters, pricePerL: price });

  it('KİLİT: iki geçerli kilometre yoksa tüketim null (0 L/100km YAZILMAZ)', () => {
    expect(averageConsumption([])).toBeNull();
    expect(averageConsumption([mk(1000, 40, 45)])).toBeNull();
    // Kilometresi bilinmeyen kayıtlar hesaba GİRMEZ.
    expect(averageConsumption([mk(null, 40, 45), mk(null, 30, 45)])).toBeNull();
  });

  it('geçerli iki ölçümle tüketim hesaplanır (en eski dolum düşülür)', () => {
    // 1000 km'de 40 L alındı, 1500 km'de 45 L alındı → 500 km'de 45 L.
    const v = averageConsumption([mk(1500, 45, 45), mk(1000, 40, 45)]);
    expect(v).toBeCloseTo((45 / 500) * 100, 5);
  });

  it('KİLİT: fiyatı bilinmeyen kayıt harcamaya GİRMEZ', () => {
    expect(totalCost([mk(1000, 40, null)])).toBeNull();
    expect(totalCost([mk(1000, 40, 50), mk(1200, 10, null)])).toBe(2000);
  });
});

describe('servis hükmü — sahte "İyi" yasağı', () => {
  const DEF = { key: 'oil', label: 'Yağ', icon: '🛢', intervalKm: 10_000, intervalDays: 365 };

  it('KİLİT: aracın kilometresi bilinmiyorsa hüküm UNKNOWN (yeşil verilmez)', () => {
    const last = { serviceKey: 'oil', performedOn: '2026-01-01', odometerKm: 80_000 };
    // ÖNCEDEN: `?? 0` yüzünden kmSince = -80000 → "İyi" çıkıyordu.
    expect(judgeService(DEF, last, null)).toBe('unknown');
  });

  it('KİLİT: servis kaydının kilometresi bilinmiyorsa da UNKNOWN', () => {
    const last = { serviceKey: 'oil', performedOn: '2026-01-01', odometerKm: null };
    expect(judgeService(DEF, last, 90_000)).toBe('unknown');
  });

  it('kayıt yoksa UNKNOWN', () => {
    expect(judgeService(DEF, undefined, 90_000)).toBe('unknown');
  });

  it('gerçek ölçümlerle doğru hüküm verilir', () => {
    const last = { serviceKey: 'oil', performedOn: '2026-01-01', odometerKm: 80_000 };
    expect(judgeService(DEF, last, 82_000)).toBe('ok');       // 8000 km kaldı
    expect(judgeService(DEF, last, 89_500)).toBe('soon');     // 500 km kaldı (<%15)
    expect(judgeService(DEF, last, 95_000)).toBe('overdue');  // 5000 km geçti
  });

  it('KİLİT: kilometre GERİYE gitmişse veri güvenilmez → UNKNOWN', () => {
    const last = { serviceKey: 'oil', performedOn: '2026-01-01', odometerKm: 90_000 };
    expect(judgeService(DEF, last, 80_000)).toBe('unknown');
  });
});
