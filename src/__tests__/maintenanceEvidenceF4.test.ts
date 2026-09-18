/**
 * F4 · BAKIM HÜKMÜ — KANIT DÜRÜSTLÜĞÜ.
 *
 * ── ÖLÇÜLEN GERÇEK (production + kod, 2026-09-18) ────────────────────────
 *   · `vehicles` tablosunda **1083 aracın tamamında `odometer_km = 0`**
 *     (tek farklı değer) — gerçek bir odometre HİÇ yazılmamış
 *   · `vehicle_service_records` = **0 satır**, `vehicle_fuel_logs` = **0 satır**
 *   · ECU odometre PID'i okunmuyor (OBD katmanında karşılığı yok)
 *   · `CarLauncher.persistOdometer` / `getPersistedOdometer` **Java tarafında
 *     TANIMSIZ** → `?.()` ile 5 saniyede bir SESSİZ NO-OP
 *
 * Yani bugün ARAÇ KİLOMETRESİ KANITI YOKTUR.
 *
 * ── ÖLÇÜLEN KUSUR ────────────────────────────────────────────────────────
 * `vehicleMaintenanceService` `useVehicleStore.odometer`i araç kilometresi
 * sanıyordu. O alan VehicleCompute'un GPS/DR tick'lerinden integre ettiği
 * UYGULAMA İÇİ mesafe sayacıdır ve HAL sınırında tam bu karışıklığı önlemek
 * için `trip_distance` adına taşınmıştı (halAdapter T7). Kullanıcının girdiği
 * hedef km ise gerçek araç kilometresidir (ör. 92.000) — ikisini çıkarmak
 * "91.999 km kaldı" gibi anlamsız bir sayı üretiyordu.
 *
 * Ayrıca kilometre bilinmediğinde durum **`ok`** yazılıyordu:
 * "değerlendiremiyorum" → "sorun yok". Kanıtsız güven beyanı.
 *
 * ── KİLİTLENEN INVARIANTLAR ──────────────────────────────────────────────
 * UNKNOWN ODOMETER ≠ OVERDUE · UNKNOWN ≠ OK ·
 * TAHMİN ≠ ÖLÇÜM · TIME-BASED ≠ KM-BASED · KAYIT YOK ≠ BAKIM YAPILMADI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/* Kalıcı depo taklidi — gerçek servis fonksiyonu sınanır, depo değil. */
const store = vi.hoisted(() => ({ map: new Map<string, string>() }));
vi.mock('../platform/sensitiveKeyStore', () => ({
  sensitiveKeyStore: {
    get: async (k: string) => store.map.get(k) ?? null,
    set: async (k: string, v: string) => { store.map.set(k, v); },
  },
}));
/* Bildirim/TTS yan etkileri bu testin konusu değil. */
vi.mock('../platform/notificationService', () => ({ addSystemNotification: vi.fn() }));
vi.mock('../platform/ttsService', () => ({ speakAlert: vi.fn() }));

/**
 * Uygulama içi mesafe sayacı KASITLI olarak gerçekçi bir değerle beslenir:
 * eski kod bunu "araç km'si" sanıp hesaba katıyordu. Test, yeni davranışın
 * bu değere BAKMADIĞINI kanıtlar.
 */
const vehicleStore = vi.hoisted(() => ({ odometer: 1234 }));
vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => ({
  useUnifiedVehicleStore: Object.assign(
    (sel: (s: { odometer: number }) => unknown) => sel(vehicleStore),
    { getState: () => vehicleStore },
  ),
}));

import {
  getMaintenanceAssessment,
  type MaintenanceAssessment,
} from '../platform/vehicleMaintenanceService';

const isoInDays = (d: number) =>
  new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

function find(list: MaintenanceAssessment[], id: MaintenanceAssessment['id']) {
  return list.find((a) => a.id === id);
}

beforeEach(() => { store.map.clear(); vehicleStore.odometer = 1234; });

/* ═══ 1 · Odometre kanıtı yok ═══════════════════════════════════════════ */

describe('F4 · araç kilometresi bilinmiyor', () => {
  it('1/9 — güncel km yoksa "kalan km" UYDURULMAZ', async () => {
    store.map.set('maint_oil_change_km', '92000');
    const oil = find(await getMaintenanceAssessment(), 'oil_change')!;

    expect(oil.status).toBe('unknown');
    /* Alan HİÇ konmaz — `0` da değil. */
    expect(oil.kmsLeft).toBeUndefined();
    expect(oil.message).toBe('Aracın güncel kilometresi bilinmiyor');
  });

  it(`15 — UNKNOWN asla OK/CRITICAL'e dönüşmez`, async () => {
    store.map.set('maint_oil_change_km', '92000');
    const oil = find(await getMaintenanceAssessment(), 'oil_change')!;
    expect(oil.status).not.toBe('ok');
    expect(oil.status).not.toBe('critical');
    expect(oil.status).not.toBe('warning');
  });

  it('13 — bilinmeyen km "bakım gecikti" İDDİASI üretmez', async () => {
    store.map.set('maint_oil_change_km', '100');   // çok düşük hedef
    const oil = find(await getMaintenanceAssessment(), 'oil_change')!;
    expect(oil.status).toBe('unknown');
    expect(oil.message).not.toMatch(/dolmuş|geçmiş|gecikti/);
  });

  it('uygulama içi TRIP MESAFESİ araç kilometresi SAYILMAZ', async () => {
    /* Eski kod `92000 - 1234 = 90766 km kaldı` yazardı. */
    store.map.set('maint_oil_change_km', '92000');
    vehicleStore.odometer = 1234;
    const a = find(await getMaintenanceAssessment(), 'oil_change')!;
    expect(a.kmsLeft).toBeUndefined();

    /* Sayaç değişse bile hüküm DEĞİŞMEZ — o değer girdi değildir. */
    vehicleStore.odometer = 50_000;
    const b = find(await getMaintenanceAssessment(), 'oil_change')!;
    expect(b.status).toBe('unknown');
    expect(b.kmsLeft).toBeUndefined();
  });

  it('8 — hedef km hiç girilmemişse kalem ÜRETİLMEZ (sahte due yok)', async () => {
    const list = await getMaintenanceAssessment();
    expect(find(list, 'oil_change')).toBeUndefined();
  });
});

/* ═══ 2 · Tarih ekseni çalışmaya devam eder (§15 çift eksen) ════════════ */

describe('F4 · zaman tabanlı kalemler susturulmaz', () => {
  it('10 — muayene tarihi varsa zaman hükmü ÜRETİLİR', async () => {
    store.map.set('maint_inspection_date', isoInDays(120));
    const i = find(await getMaintenanceAssessment(), 'inspection')!;
    expect(i.status).toBe('ok');
    expect(i.daysLeft).toBeGreaterThan(100);
  });

  it('geçmiş tarih dürüstçe bildirilir', async () => {
    store.map.set('maint_insurance_date', isoInDays(-5));
    const s = find(await getMaintenanceAssessment(), 'insurance')!;
    expect(s.status).toBe('critical');
    expect(s.message).toContain('dolmuş');
  });

  it('12 — km BİLİNMEZ iken zaman kalemi yine de hüküm verir', async () => {
    /* İki eksen AYRIDIR: birinin bilinmemesi ötekini susturmaz. */
    store.map.set('maint_oil_change_km', '92000');
    store.map.set('maint_inspection_date', isoInDays(10));
    const list = await getMaintenanceAssessment();
    expect(find(list, 'oil_change')!.status).toBe('unknown');
    expect(find(list, 'inspection')!.status).toBe('warning');
  });

  it('7 — kayıt yoksa "bakım yapılmadı" DENMEZ (liste boş kalır)', async () => {
    const list = await getMaintenanceAssessment();
    expect(list).toHaveLength(0);
    /* Boş liste bir iddia değildir; UI "kayıt girilmemiş" der. */
  });
});

/* ═══ 3 · Randevu/uyarı sızıntısı ═══════════════════════════════════════ */

describe('F4 · bilinmeyenden uyarı doğmaz', () => {
  it('16 — unknown kalem randevu önerisi TAŞIMAZ', async () => {
    store.map.set('maint_oil_change_km', '92000');
    const oil = find(await getMaintenanceAssessment(), 'oil_change')!;
    /* `checkAndSignalAIDoctor` yalnız `critical` kalemler için sesli uyarı
       üretir; unknown oraya HİÇ giremez. */
    expect(oil.appointmentSuggestion).toBeUndefined();
    expect(oil.status).not.toBe('critical');
  });

  it('gerçek kanıt varsa hüküm ve öneri ÜRETİLİR (kapı tek yönlü değil)', async () => {
    store.map.set('maint_inspection_date', isoInDays(3));
    const i = find(await getMaintenanceAssessment(), 'inspection')!;
    expect(i.status).toBe('critical');
    expect(i.appointmentSuggestion).toBeTruthy();
  });
});
