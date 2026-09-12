/**
 * kwpSpeedTruth.test.ts — P0 HIZ DOĞRULUĞU SÖZLEŞMESİ (kilit).
 *
 * ── SAHA KANITI (Renault Trafic · V-LINK · KWP2000 proto 5 · 2026-07-22) ────
 *   - `010D` (hız PID) HİÇ gelmiyor → ekran motor 1702 rpm iken bile "0 km/h"
 *   - `[SafetyGate] Rejected Speed: undefined` saniyede ~1 kez
 *   - araç dururken hız kendi kendine değişiyor (GPS Doppler, fix doğruluğu 400 m)
 *   - avgPollIntervalMs 7770 · maxLatencyMs 21475 · 2 reconnect
 *
 * ── KANITLANAN KÖK NEDENLER ────────────────────────────────────────────────
 *   1. `OBDData.speed` tipi `number`, varsayılanı `0` → "veri yok" ile "duruyor"
 *      ayırt edilemiyordu (obdTypes.ts:103).
 *   2. `ObdAdapter` `obd.speed >= 0` diyordu; varsayılan 0 bu dalı HEP doğru yapıyor
 *      → "hiç 010D gelmedi" aşağı akışa geçerli "0 km/h" olarak sızıyordu.
 *   3. `UnifiedVehicleStore` `speed: undefined` gelince `cur.speed`'i geri yazıyordu
 *      → değer SONSUZA DEK canlı kalıyordu (expiry yok).
 *   4. Aynı store, "smooth handover" adıyla GPS Doppler hızını ARAÇ HIZI alanına
 *      yazıyordu; kaynak işaretlenmiyor, `_vehicleSpeedTs` tazelenmiyordu.
 *   5. `index.ts` reverse-flush sonrası `speed` anahtarını `undefined` olarak
 *      bırakıyordu → sonraki her flush `speed: undefined` gönderiyordu.
 *
 * Bu dosya düzeltme sonrası GÜVENLİ davranışı KİLİTLER.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../platform/cameraService', () => ({ openRearCamera: vi.fn(), closeRearCamera: vi.fn() }));
vi.mock('../utils/safeStorage', () => ({
  safeStorage:  { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  safeFlushKey: () => {},
  safeGetRaw:   () => null,
  safeSetRaw:   () => {},
}));

import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import obdServiceSrc from '../platform/obdService.ts?raw';
import obdAdapterSrc from '../platform/vehicleDataLayer/ObdAdapter.ts?raw';
import storeSrc from '../platform/vehicleDataLayer/UnifiedVehicleStore.ts?raw';

const store = useUnifiedVehicleStore;
const set = (patch: Parameters<typeof store.getState>['0'] extends never ? never : Record<string, unknown>): void =>
  store.getState().updateVehicleState(patch as never);

beforeEach(() => { set({ speed: 0, rpm: 0, fuel: 0 }); });

/* ── 1) Geçerli hız ────────────────────────────────────────────────────────── */

describe('geçerli 010D → doğru hız', () => {
  it('geçerli değer aynen geçer', () => {
    set({ speed: 87 });
    expect(store.getState().speed).toBe(87);
  });

  it('araç dururken GEÇERLİ 010D=0 → gerçekten 0 km/h (bilinmiyor DEĞİL)', () => {
    set({ speed: 42 });
    set({ speed: 0 });
    expect(store.getState().speed).toBe(0);   // ölçülmüş sıfır KORUNUR
  });
});

/* ── 2) Geçersiz/eksik veri → null ─────────────────────────────────────────── */

describe('NO_DATA · timeout · bozuk hex → hız NULL (asla eski değer, asla 0)', () => {
  it('kaynak açıkça null derse hız düşer', () => {
    set({ speed: 55 });
    set({ speed: null });
    expect(store.getState().speed).toBeNull();
  });

  it('imkânsız değer (>300) eski hızı KORUMAZ → null', () => {
    set({ speed: 55 });
    set({ speed: 999 });
    expect(store.getState().speed).toBeNull();
  });

  it('NaN / Infinity → null', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      set({ speed: 60 });
      set({ speed: bad });
      expect(store.getState().speed).toBeNull();
    }
  });

  it('geçersiz veri ASLA 0 olarak yazılmaz ("araç duruyor" varsayımı yasak)', () => {
    set({ speed: 70 });
    set({ speed: 999 });
    expect(store.getState().speed).not.toBe(0);
    expect(store.getState().speed).toBeNull();
  });
});

/* ── 3) Bayatlama ──────────────────────────────────────────────────────────── */

describe('son geçerli hız sonsuza dek tutulmaz', () => {
  it('`speed: undefined` tazelik penceresi İÇİNDE değeri korur', () => {
    set({ speed: 64 });
    set({ speed: undefined });                 // "bu yamada hız yok"
    expect(store.getState().speed).toBe(64);   // henüz taze
  });

  it('tazelik penceresi AŞILINCA hız invalidate edilir (null)', () => {
    set({ speed: 64 });
    // Zaman ilerlet: store `performance.now()` okur.
    const realNow = performance.now.bind(performance);
    const t0 = realNow();
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => t0 + 31_000);
    try {
      set({ speed: undefined });
      expect(store.getState().speed).toBeNull();   // 30 sn tavanı aşıldı → bilinmiyor
    } finally {
      spy.mockRestore();
    }
  });

  it('010D yokken BAŞKA PID değişimi hız alanını DEĞİŞTİREMEZ', () => {
    set({ speed: 33 });
    set({ rpm: 2500 });                        // yamada speed anahtarı YOK
    expect(store.getState().speed).toBe(33);
    set({ rpm: 3000, fuel: 55 });
    expect(store.getState().speed).toBe(33);   // hız yalnız hız yamasıyla değişir
  });
});

/* ── 4) Hayalet hız kaynağı kapatıldı ──────────────────────────────────────── */

describe('GPS Doppler hızı ARAÇ HIZI alanına YAZILAMAZ (hayalet hız)', () => {
  it('store kaynağında "smooth handover" GPS devralması KALDIRILDI', () => {
    expect(storeSrc).not.toMatch(/if \(stale && next\?\.speed != null\)/);
    expect(storeSrc).not.toMatch(/const clamped = kmh >= 0 \? kmh : 0/);
    expect(storeSrc).toMatch(/HAYALET HIZ KALDIRILDI/);
  });

  it('GPS hızı kaybolmadı — `location` alanında ham haliyle taşınır', () => {
    expect(storeSrc).toMatch(/u\.location = next/);
  });

  it('undefined dalında MUTLAK son kullanma süresi var (sonsuz tutma yok)', () => {
    expect(storeSrc).toMatch(/SPEED_EXPIRY_MS/);
    expect(storeSrc).toMatch(/age > SPEED_EXPIRY_MS \? null : cur\.speed/);
  });
});

/* ── 5) Kaynak doğruluğu + oturum yalıtımı (yapısal kilitler) ──────────────── */

describe('obdService — hız kaynak doğruluğu ve oturum yalıtımı', () => {
  it('ayrı bir hız damgası tutulur ve YALNIZ gerçek hız alanında tazelenir', () => {
    expect(obdServiceSrc).toMatch(/let _lastSpeedRxMs = 0;/);
    expect(obdServiceSrc).toMatch(/if \(patch\.speed !== undefined\) _lastSpeedRxMs = _rxNow;/);
  });

  it('`getObdSpeedFresh()` hiç hız gelmediyse null döner', () => {
    expect(obdServiceSrc).toMatch(/export function getObdSpeedFresh\(\): number \| null/);
    expect(obdServiceSrc).toMatch(/if \(_lastSpeedRxMs === 0\) return null;/);
  });

  it('tazelik penceresi protokol kadansından türer (KWP\'de sahte "veri yok" üretmez)', () => {
    expect(obdServiceSrc).toMatch(/windowMs = _staleThresholdMs\(\)/);
    expect(obdServiceSrc).toMatch(/Date\.now\(\) - _lastSpeedRxMs > windowMs/);
  });

  it('OTURUM YALITIMI: reconnect/gate temizliğinde hız damgası sıfırlanır', () => {
    // `_clearDataGate()` reconnect yolunda çağrılır → yeni oturum eski hızı MİRAS ALMAZ.
    const gate = obdServiceSrc.slice(
      obdServiceSrc.indexOf('function _clearDataGate'),
      obdServiceSrc.indexOf('function _clearDataGate') + 500,
    );
    expect(gate).toMatch(/_lastSpeedRxMs = 0;/);
  });
});

describe('ObdAdapter — varsayılan 0 artık geçerli hız sayılmaz', () => {
  it('hız damgalı kapıdan geçer; doğrulanmamış/bayat → undefined', () => {
    expect(obdAdapterSrc).toMatch(/const freshSpeed = getObdSpeedFresh\(\)/);
    expect(obdAdapterSrc).toMatch(/this\._data\.speed = freshSpeed === null \? undefined : freshSpeed/);
    // Eski kusurlu dal kaldırıldı.
    expect(obdAdapterSrc).not.toMatch(/if \(obd\.speed >= 0\) \{\s*this\._data\.speed = obd\.speed;/);
  });
});
