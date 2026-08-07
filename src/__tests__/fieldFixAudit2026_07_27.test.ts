/**
 * fieldFixAudit2026_07_27.test.ts — Araç sonrası P0 düzeltme DENETİMİ.
 *
 * Bu dosya 2026-07-27 saha oturumundan çıkan düzeltmelerin DAVRANIŞINI kilitler
 * (kaynak-metin kontrolü değil). Kapsam:
 *   §2 Termal: die/kasa ölçek ayrımı, birim, bozuk sysfs, yanlış kalıcı L3 regresyonu
 *   §5 OBD adresi: çift katman, öncelik, çelişki, boş değer, temizleme
 *   §6 Kanıt sayacı: epoch alanları sayaca girmez
 *
 * Kütük: #141 (termal ölçek regresyonu) · #142 (Duster saha kusurları).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isDieZone, selectDieTempC, dieLevelFor, type ThermalZoneLike,
} from '../platform/thermalWatchdog';
import { deriveDiagnosticEvidence } from '../platform/aiCore/runtime/diagnosticEvidence';

/* ══════════════════════════════════════════════════════════════════════════
 * §2 TERMAL — die ↔ kasa ölçek ayrımı
 * ════════════════════════════════════════════════════════════════════════ */

describe('§2 Termal — sensör sınıflandırma (die vs kasa)', () => {
  it('die sınıfı etiketler TANINIR', () => {
    for (const t of ['cpu_thermal_zone', 'gpu_thermal_zone', 'ddr_thermal_zone',
      'soc-thermal', 'tsens_tz_sensor0', 'CPU_DIE']) {
      expect(isDieZone(t), `die sayılmalı: ${t}`).toBe(true);
    }
  });

  it('KASA/ÇEVRE sensörleri die SAYILMAZ (die eşiği onlara uygulanamaz)', () => {
    for (const t of ['battery', 'batt_therm', 'ambient', 'board_thermal',
      'case-therm', 'skin-therm', 'pmic_therm', 'charger_therm', 'usb_port_temp']) {
      expect(isDieZone(t), `die SAYILMAMALI: ${t}`).toBe(false);
    }
  });

  it('etiket yok/boş/tanınmıyor → die DEĞİL (tahmin edilmez)', () => {
    expect(isDieZone(undefined)).toBe(false);
    expect(isDieZone('')).toBe(false);
    expect(isDieZone('thermal_zone9')).toBe(false);
    expect(isDieZone('mystery-sensor')).toBe(false);
  });
});

describe('§2 Termal — die sıcaklığı seçimi', () => {
  it('gerçek cihaz düzeni: en sıcak DIE bölgesi seçilir', () => {
    // K24 SMART SERIES gerçek çıktısı (kütük #139).
    const zones: ThermalZoneLike[] = [
      { type: 'cpu_thermal_zone', tempC: 85.6 },
      { type: 'gpu_thermal_zone', tempC: 82.8 },
      { type: 'ddr_thermal_zone', tempC: 85.4 },
    ];
    expect(selectDieTempC(zones)).toBeCloseTo(85.6, 1);
  });

  it('YALNIZ kasa sensörü varsa null — die eşiği kasaya UYGULANMAZ', () => {
    const zones: ThermalZoneLike[] = [
      { type: 'battery', tempC: 41 },
      { type: 'ambient', tempC: 38 },
    ];
    expect(selectDieTempC(zones), 'kasa sensörü die yerine geçemez').toBeNull();
  });

  it('okunamayan bölge (tempC yok) ATLANIR — 0 °C sayılmaz', () => {
    const zones: ThermalZoneLike[] = [
      { type: 'cpu_thermal_zone' },              // okunamadı
      { type: 'gpu_thermal_zone', tempC: 71.2 },
    ];
    expect(selectDieTempC(zones)).toBeCloseTo(71.2, 1);
  });

  it('bozuk/eksik sysfs → null (uydurma değer yok)', () => {
    expect(selectDieTempC([])).toBeNull();
    expect(selectDieTempC(undefined)).toBeNull();
    expect(selectDieTempC([{ type: 'cpu', tempC: Number.NaN }])).toBeNull();
    expect(selectDieTempC([{ type: 'cpu', tempC: Infinity }])).toBeNull();
  });
});

describe('§2 Termal — die kademe eşikleri ve REGRESYON kilidi', () => {
  it('REGRESYON: gerçek cihazın NORMAL aralığı kademe ÜRETMEZ', () => {
    // Kütük #139: uygulama kapalı 73-79 °C, açık 82-94 °C.
    // Bu değerler kasa eşiklerine (45/55/65) beslendiğinde cihaz KALICI L3'e
    // düşmüştü (parlaklık %30 + minimum yük modu). Bir daha OLMAMALI.
    for (const t of [73, 77, 79, 82, 85.6, 90, 93.7, 99.9]) {
      expect(dieLevelFor(t, 0), `${t} °C normal aralık — kademe 0 olmalı`).toBe(0);
    }
  });

  it('die eşikleri: 100 → L1, 105 → L2, 110 → L3', () => {
    expect(dieLevelFor(99.9)).toBe(0);
    expect(dieLevelFor(100)).toBe(1);
    expect(dieLevelFor(104.9)).toBe(1);
    expect(dieLevelFor(105)).toBe(2);
    expect(dieLevelFor(109.9)).toBe(2);
    expect(dieLevelFor(110)).toBe(3);
    expect(dieLevelFor(130)).toBe(3);
  });

  it('histerezis: yükseldikten sonra hemen bırakmaz, soğuyunca bırakır', () => {
    // L1'e çıktık (100). 98 °C hâlâ histerezis bandında → seviye korunur.
    expect(dieLevelFor(98, 1)).toBe(1);
    // 96 °C bandın altı → serbest bırak.
    expect(dieLevelFor(96, 1)).toBe(0);
    // Hiç yükselmemişken 98 °C kademe üretmez.
    expect(dieLevelFor(98, 0)).toBe(0);
  });

  it('geçersiz sıcaklık kademe üretmez', () => {
    expect(dieLevelFor(Number.NaN)).toBe(0);
    expect(dieLevelFor(Infinity, 2)).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §5 OBD ADRESİ — çift katmanlı saklama
 * ════════════════════════════════════════════════════════════════════════ */

// vi.mock fabrikası HOIST edilir → haritalar da hoisted olmalı.
const { memLocal, memSafe, safeWrites } = vi.hoisted(() => ({
  memLocal: new Map<string, string>(),
  memSafe: new Map<string, string>(),
  /** Yedek katmana yapılan yazma çağrıları (immediate bayrağı denetlenir). */
  safeWrites: [] as Array<{ key: string; value: string; immediate: boolean }>,
}));

// KISMİ mock: safeStorage'ın diğer export'ları KORUNUR — başka modüller onları
// import ediyor, tam mock import zincirini kırıyordu. safeRemoveRaw da SAHTE:
// gerçek silme yolunun yedek katmana ulaştığı ancak böyle kanıtlanır.
vi.mock('../utils/safeStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/safeStorage')>();
  return {
    ...actual,
    safeGetRaw: (k: string) => (memSafe.has(k) ? memSafe.get(k)! : null),
    safeSetRaw: (k: string, v: string, _d?: number, immediate = false) => {
      safeWrites.push({ key: k, value: v, immediate });
      memSafe.set(k, v);
    },
    safeRemoveRaw: (k: string) => { memSafe.delete(k); },
  };
});

describe('§5 OBD adresi — çift katman', () => {
  beforeEach(() => {
    memLocal.clear(); memSafe.clear(); safeWrites.length = 0;
    // NOT: global setup.ts her testten önce `localStorage.clear()` çağırıyor →
    // sahte nesne `clear`/`key`/`length` da sağlamalı, yoksa setup patlar.
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (memLocal.has(k) ? memLocal.get(k)! : null),
      setItem: (k: string, v: string) => { memLocal.set(k, v); },
      removeItem: (k: string) => { memLocal.delete(k); },
      clear: () => { memLocal.clear(); },
      key: (i: number) => [...memLocal.keys()][i] ?? null,
      get length() { return memLocal.size; },
    });
  });

  it('kaydetme HER İKİ katmana yazar', async () => {
    const { saveObdAddress, OBD_ADDRESS_KEY } = await import('../platform/obdStorage');
    saveObdAddress('AA:BB:CC:DD:EE:FF');
    expect(memLocal.get(OBD_ADDRESS_KEY)).toBe('AA:BB:CC:DD:EE:FF');
    expect(memSafe.get(OBD_ADDRESS_KEY), 'yedek katman da yazılmalı').toBe('AA:BB:CC:DD:EE:FF');
  });

  it('okuma önceliği: birincil (localStorage) kazanır', async () => {
    const { loadObdAddress, OBD_ADDRESS_KEY } = await import('../platform/obdStorage');
    memLocal.set(OBD_ADDRESS_KEY, 'PRIMARY');
    memSafe.set(OBD_ADDRESS_KEY, 'BACKUP');
    expect(loadObdAddress()).toBe('PRIMARY');
  });

  it('ORIGIN DEĞİŞİMİ regresyonu: birincil boşsa yedekten okunur + self-healing', async () => {
    const { loadObdAddress, OBD_ADDRESS_KEY } = await import('../platform/obdStorage');
    // Origin değişti → localStorage boş, safeStorage (dosya) duruyor.
    memSafe.set(OBD_ADDRESS_KEY, 'AA:BB:CC:DD:EE:FF');
    expect(loadObdAddress(), 'adres KAYBOLMAMALI').toBe('AA:BB:CC:DD:EE:FF');
    expect(memLocal.get(OBD_ADDRESS_KEY), 'birincil katman geri doldurulmalı')
      .toBe('AA:BB:CC:DD:EE:FF');
  });

  it('yalnız birincil kaynak varsa yedek gerekmeden okunur', async () => {
    const { loadObdAddress, OBD_ADDRESS_KEY } = await import('../platform/obdStorage');
    memLocal.set(OBD_ADDRESS_KEY, 'ONLY-PRIMARY');
    expect(loadObdAddress()).toBe('ONLY-PRIMARY');
  });

  it('hiçbir kaynak yoksa null (uydurma yok)', async () => {
    const { loadObdAddress } = await import('../platform/obdStorage');
    expect(loadObdAddress()).toBeNull();
  });

  it('temizleme İKİ katmanı da siler — yedek adresi DİRİLTMEZ', async () => {
    const { saveObdAddress, clearObdAddress, loadObdAddress, OBD_ADDRESS_KEY } =
      await import('../platform/obdStorage');
    saveObdAddress('AA:BB:CC:DD:EE:FF');
    clearObdAddress();
    expect(loadObdAddress(), 'silinen adres geri gelmemeli').toBeNull();
    // DENETİM 2026-07-28: "boş string mezar taşı" YETMEZ. Native'de _fsWriteAtomic
    // boş içeriği reddeder (stat.size === 0 → throw) → dosya + _fsCache eski adresi
    // TUTMAYA DEVAM ederdi. Kayıt gerçekten SİLİNMİŞ olmalı.
    expect(memSafe.has(OBD_ADDRESS_KEY), 'yedek kayıt gerçekten silinmeli').toBe(false);
  });

  it('yedek katmana yazma ERTELENMEZ (immediate) — kontak kesilirse kaybolmasın', async () => {
    const { saveObdAddress, OBD_ADDRESS_KEY } = await import('../platform/obdStorage');
    saveObdAddress('AA:BB:CC:DD:EE:FF');
    const w = safeWrites.filter((x) => x.key === OBD_ADDRESS_KEY);
    expect(w, 'yedek katmana yazılmalı').toHaveLength(1);
    // Varsayılan yol 5 sn debounce + idle kuyruğu → o pencerede process kill
    // olursa yedek HİÇ oluşmaz ve origin koruması son adres için çalışmaz.
    expect(w[0]!.immediate, 'yedek yazımı debounce kuyruğuna BIRAKILMAMALI').toBe(true);
  });

  it('FAIL-CLOSED: bozuk yedek kayıt bağlantı yoluna sokulmaz ve geri yazılmaz', async () => {
    const { loadObdAddress, OBD_ADDRESS_KEY } = await import('../platform/obdStorage');
    for (const corrupt of ['AA:BB CC:DD', 'AA:BB\nCC', 'X'.repeat(65), ' ']) {
      memLocal.clear();
      memSafe.set(OBD_ADDRESS_KEY, corrupt);
      expect(loadObdAddress(), `bozuk kayıt kabul edilmemeli: ${JSON.stringify(corrupt)}`).toBeNull();
      expect(memLocal.has(OBD_ADDRESS_KEY), 'bozuk değer birincil katmana yazılmamalı').toBe(false);
    }
  });

  it('GERİYE UYUMLULUK: gerçek adres biçimleri yedek kapısından geçer', async () => {
    const { loadObdAddress, OBD_ADDRESS_KEY, isPlausibleObdAddress } =
      await import('../platform/obdStorage');
    for (const ok of ['AA:BB:CC:DD:EE:FF', 'aa-bb-cc-dd-ee-ff', '192.168.0.10:35000',
      '00:1D:A5:68:98:8B', 'OBDII_ELM327']) {
      expect(isPlausibleObdAddress(ok), `geçerli sayılmalı: ${ok}`).toBe(true);
      memLocal.clear();
      memSafe.set(OBD_ADDRESS_KEY, ok);
      expect(loadObdAddress()).toBe(ok);
    }
  });

  it('yeni cihaz seçimi iki katmanı da GÜNCELLER (eski adres kalmaz)', async () => {
    const { saveObdAddress, loadObdAddress, OBD_ADDRESS_KEY } = await import('../platform/obdStorage');
    saveObdAddress('OLD');
    saveObdAddress('NEW');
    expect(loadObdAddress()).toBe('NEW');
    expect(memSafe.get(OBD_ADDRESS_KEY)).toBe('NEW');
  });

  it('boş string yedeği geçerli adres SAYILMAZ', async () => {
    const { loadObdAddress, OBD_ADDRESS_KEY } = await import('../platform/obdStorage');
    memSafe.set(OBD_ADDRESS_KEY, '');
    expect(loadObdAddress()).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §6 KANIT SAYACI — epoch alanları sayaca girmez
 * ════════════════════════════════════════════════════════════════════════ */

describe('§6 Kanıt sayacı — epoch ↔ counter ayrımı', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  const summaryOf = (cl: Record<string, unknown>): string | undefined =>
    deriveDiagnosticEvidence({ obdDeep: { connLifecycle: cl } }, 5000)
      .find((e) => e.key === 'recovery.lifecycle')?.summary;

  it('YALNIZ epoch alanları → kanıt ÜRETİLMEZ', () => {
    expect(summaryOf({
      lastResetAt: 1785169103492, lastDisconnectAt: 1785169105216,
      lastReconnectAt: 1785169105220, ranAt: 1785169237761, updatedAt: 1785169350251,
    })).toBeUndefined();
  });

  it('gerçek sayaçlar korunur ve doğru toplanır', () => {
    const s = summaryOf({
      resetRequestedCount: 1, resetCompletedCount: 1,
      disconnectCalledCount: 2, reconnectRequestedCount: 2,
    });
    expect(s).toContain('6');
  });

  it('karışık snapshot: epoch sızmaz (10+ haneli sayı YOK)', () => {
    const s = summaryOf({
      resetRequestedCount: 1, lastResetAt: 1785169103492,
      lastSignalAt: 1785169350252, disconnectCalledCount: 2,
    });
    expect(s).toContain('3');
    expect(s, 'epoch değeri metne sızmamalı').not.toMatch(/\b\d{10,}\b/);
  });

  it('null/undefined/eski şema hata üretmez', () => {
    expect(() => summaryOf({})).not.toThrow();
    expect(() => summaryOf({ resetCount: null, foo: undefined })).not.toThrow();
    expect(summaryOf({})).toBeUndefined();
  });

  it('bilinmeyen alan UYDURULMAZ (sayaca girmez)', () => {
    // `mysteryValue` bir sayaç değildir — toplama katılmamalı.
    const s = summaryOf({ resetRequestedCount: 1, mysteryValue: 9999 });
    expect(s).toContain('1');
    expect(s).not.toContain('9999');
  });
});
