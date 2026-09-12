/**
 * recordsEdit.test.ts — Kayıt DÜZENLEME (UPDATE) ve elle kilometre kilitleri.
 *
 * ── KİLİTLENEN ÖLÇÜLEN BOŞLUKLAR (2026-08-14 devir belgesi) ────────────────
 *  · B4: `vehicle_fuel_logs` / `vehicle_service_records` tablolarında UPDATE
 *    ayrıcalığı ve politikası VARDI, ama ne yazma katmanı ne arayüz vardı.
 *    Yanlış girilen bir litre/kilometre yalnızca kaydı SİLİP yeniden girerek
 *    düzeltilebiliyordu — bu, sunucudaki kimliği ve kaydın tarihçesini
 *    kaybettiriyordu.
 *  · B5: "Yapıldı" düğmesi, aracın kilometresi okunamıyorken kullanıcıya
 *    HİÇ SORMADAN `null` yazıyordu; oysa kilometreyi bilen tek kişi oydu.
 *
 * Bu dosya oturumsuz (yalnız cihaz) yolu ölçer: Supabase yapılandırılmamış →
 * her kayıt `LOCAL`tır. Sunucu yolunun kendi kilitleri yazma katmanındadır.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const _store = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (k: string) => _store.get(k) ?? null,
  setItem: (k: string, v: string) => { _store.set(k, v); },
  removeItem: (k: string) => { _store.delete(k); },
  clear: () => { _store.clear(); },
});

// Oturum YOK — sunucuya yazılamaz, kayıtlar yerelde kalır.
vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabaseBrowser: null,
}));

import {
  addFuelEntry, loadFuelEntries, updateFuelEntry,
  addServiceEntry, loadServiceEntries, updateServiceEntry,
  UPDATE_MODE_MESSAGE,
} from '@/lib/recordsService';
import { validateOdometerInput, ODOMETER_MAX_KM, judgeService } from '@/components/pwa/RecordsPanel';

const V = 'vehicle-edit';

beforeEach(() => { _store.clear(); });

describe('yakıt kaydı düzenleme', () => {
  it('KİLİT: düzenleme kaydı SİLİP yeniden oluşturmaz — aynı kayıt güncellenir', async () => {
    await addFuelEntry(V, { filledOn: '2026-08-01', odometerKm: 1000, liters: 40, pricePerL: 45 });
    const before = await loadFuelEntries(V);
    const ref = before.entries[0].clientRef;

    const res = await updateFuelEntry(V, before.entries[0], {
      filledOn: '2026-08-01', odometerKm: 1000, liters: 42.5, pricePerL: 45,
    });
    expect(res.saved).toBe(true);

    const after = await loadFuelEntries(V);
    expect(after.entries).toHaveLength(1);          // kopya ÜRETİLMEDİ
    expect(after.entries[0].liters).toBe(42.5);
    // Kimlik korunur: `clientRef` idempotency anahtarıdır, düzenlemede DEĞİŞMEZ.
    expect(after.entries[0].clientRef).toBe(ref);
  });

  it('KİLİT: yalnız düzenlenen kayıt değişir, diğerleri DOKUNULMAZ', async () => {
    await addFuelEntry(V, { filledOn: '2026-08-01', odometerKm: 1000, liters: 40, pricePerL: 45 });
    await addFuelEntry(V, { filledOn: '2026-08-02', odometerKm: 1300, liters: 30, pricePerL: 46 });

    const list = await loadFuelEntries(V);
    const target = list.entries.find((e) => e.liters === 40)!;
    await updateFuelEntry(V, target, {
      filledOn: target.filledOn, odometerKm: 1111, liters: 40, pricePerL: 45,
    });

    const after = await loadFuelEntries(V);
    expect(after.entries).toHaveLength(2);
    expect(after.entries.find((e) => e.liters === 40)?.odometerKm).toBe(1111);
    expect(after.entries.find((e) => e.liters === 30)?.odometerKm).toBe(1300);
  });

  it('KİLİT: bilinen kilometre düzenlemeyle "bilinmiyor"a çekilebilir (sahte 0 YOK)', async () => {
    await addFuelEntry(V, { filledOn: '2026-08-01', odometerKm: 1000, liters: 40, pricePerL: 45 });
    const list = await loadFuelEntries(V);

    await updateFuelEntry(V, list.entries[0], {
      filledOn: '2026-08-01', odometerKm: null, liters: 40, pricePerL: 45,
    });

    const after = await loadFuelEntries(V);
    expect(after.entries[0].odometerKm).toBeNull();
    expect(after.entries[0].odometerKm).not.toBe(0);
  });

  it('cihazda bulunamayan kayıt için başarı İDDİA EDİLMEZ', async () => {
    const ghost = {
      id: 'yok', filledOn: '2026-01-01', odometerKm: null,
      liters: 1, pricePerL: null, clientRef: 'yok', sync: 'LOCAL' as const,
    };
    const res = await updateFuelEntry(V, ghost, {
      filledOn: '2026-01-01', odometerKm: 5, liters: 1, pricePerL: null,
    });
    expect(res.saved).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('düzenleme mesajı kaydın GERÇEK yerini söyler', async () => {
    await addFuelEntry(V, { filledOn: '2026-08-01', odometerKm: 1, liters: 10, pricePerL: null });
    const list = await loadFuelEntries(V);
    const res = await updateFuelEntry(V, list.entries[0], {
      filledOn: '2026-08-01', odometerKm: 2, liters: 10, pricePerL: null,
    });
    // Oturum yok → "hesabınızda güncellendi" DENMEZ.
    expect(UPDATE_MODE_MESSAGE[res.mode]).toContain('cihazda');
    expect(UPDATE_MODE_MESSAGE[res.mode]).not.toContain('hesab');
  });
});

describe('servis kaydı düzenleme', () => {
  it('KİLİT: kalem anahtarı DEĞİŞMEZ — düzenleme kaydı başka kaleme taşımaz', async () => {
    await addServiceEntry(V, { serviceKey: 'oil', performedOn: '2026-08-01', odometerKm: null });
    const list = await loadServiceEntries(V);

    await updateServiceEntry(V, list.entries[0], { performedOn: '2026-07-20', odometerKm: 90_000 });

    const after = await loadServiceEntries(V);
    expect(after.entries).toHaveLength(1);
    expect(after.entries[0].serviceKey).toBe('oil');
    expect(after.entries[0].performedOn).toBe('2026-07-20');
    expect(after.entries[0].odometerKm).toBe(90_000);
  });

  it('KİLİT: kilometre sonradan girilince bakım hükmü ARTIK KURULABİLİR', async () => {
    const DEF = { key: 'oil', label: 'Yağ', icon: '', intervalKm: 10_000, intervalDays: 365 };

    // Kilometresiz kayıt: hüküm kurulamaz (bu, B5'in ölçülen sonucuydu).
    await addServiceEntry(V, { serviceKey: 'oil', performedOn: '2026-08-01', odometerKm: null });
    let list = await loadServiceEntries(V);
    expect(judgeService(DEF, list.entries[0], 100_000, null)).toBe('unknown');

    // Kullanıcı kilometreyi düzenlemeyle veriyor → hüküm gerçek ölçüme dayanır.
    await updateServiceEntry(V, list.entries[0], { performedOn: '2026-08-01', odometerKm: 95_000 });
    list = await loadServiceEntries(V);
    expect(judgeService(DEF, list.entries[0], 100_000, null)).toBe('ok');
  });
});

describe('validateOdometerInput — elle girilen kilometre', () => {
  it('KİLİT: BOŞ girdi geçerlidir ve `null` üretir (uydurma 0 YOK)', () => {
    expect(validateOdometerInput('', null)).toEqual({ km: null });
    expect(validateOdometerInput('   ', null)).toEqual({ km: null });
  });

  it('sayıya çevrilemeyen girdi REDDEDİLİR (kayıt yapılmaz)', () => {
    expect(validateOdometerInput('abc', null).error).toBeTruthy();
    expect(validateOdometerInput('12abc', null).error).toBeTruthy();
  });

  it('KİLİT: aralık dışı değer REDDEDİLİR (DB CHECK ile aynı sınır)', () => {
    expect(validateOdometerInput('-1', null).error).toBeTruthy();
    expect(validateOdometerInput(String(ODOMETER_MAX_KM + 1), null).error).toBeTruthy();
    expect(validateOdometerInput(String(ODOMETER_MAX_KM), null).error).toBeUndefined();
  });

  it('ondalık ve virgüllü giriş tam sayıya yuvarlanır', () => {
    expect(validateOdometerInput('85000.6', null).km).toBe(85_001);
    expect(validateOdometerInput('85000,4', null).km).toBe(85_000);
  });

  it('KİLİT: bilinen alt sınırın ALTINDAKİ değer reddedilmez ama UYARILIR', () => {
    /* Araç kilometresi geriye gitmez. Yine de kullanıcı eski bir bakımı
       sonradan giriyor olabilir → kayıt kabul edilir, ama sessiz GEÇİLMEZ:
       bu kayıtla bakım hükmü kurulamayacağı söylenir. */
    const r = validateOdometerInput('50000', 90_000);
    expect(r.km).toBe(50_000);
    expect(r.error).toBeUndefined();
    expect(r.warning).toBeTruthy();
  });

  it('alt sınırın üstündeki değer uyarısız kabul edilir', () => {
    const r = validateOdometerInput('95000', 90_000);
    expect(r.km).toBe(95_000);
    expect(r.warning).toBeUndefined();
  });
});
