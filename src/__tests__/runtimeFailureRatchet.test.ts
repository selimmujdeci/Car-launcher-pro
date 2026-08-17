/**
 * runtimeFailureRatchet.test.ts — #606 KİLİT: arıza merdiveni tek yönlü circir olmasın.
 *
 * SAHA KÖKÜ (kütük #604, cihazda canlı yakalandı):
 *   [Runtime] runtime_mode_changed: BASIC_JS   → POWER_SAVE | reason=failure:OBD
 *   [Runtime] runtime_mode_changed: POWER_SAVE → SAFE_MODE  | reason=failure:OBD
 *
 * `obdService._scheduleReconnect()` RUTİN yeniden-bağlanma yoludur ve
 * `reportFailure('OBD')`'yi 10 çağrı yerinden tetikler. Eski `reportFailure`
 * HER çağrıda bir kademe iniyor, yukarı çıkaran karşılığı ise HİÇ YOKTU →
 * dongle beslenmiyorsa runtime ~40 sn'de SAFE_MODE'a çakılıyor, üstelik
 * `rt-last-mode` üzerinden sonraki AÇILIŞLARA da sızıyordu.
 *
 * Bu dosya dört invaryantı kilitler:
 *   (1) Bileşen başına TEK kademe — aynı arızanın tekrarı modu düşürmez.
 *   (2) Taban POWER_SAVE — biriken arızalar SAFE_MODE'a indiremez.
 *   (3) `reportRecovery()` arıza öncesi moda geri çıkarır (histerezise tabi).
 *   (4) Başka bir otorite (kullanıcı/termal/RAM) modu devraldıysa kurtarma
 *       onu SESSİZCE EZMEZ.
 *
 * NOT: bu kilitler ZAYIFLATILMAZ/SİLİNMEZ (CLAUDE.md regresyon kasası kuralı).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

/* ── Donanım mock'ları — BALANCED baseline üretsin (cleanup.runtime ile aynı desen) ── */
const env = vi.hoisted(() => ({ tier: 'high' as 'low' | 'mid' | 'high', weakGpu: false }));
vi.mock('../platform/deviceCapabilities', () => ({ getDeviceTier: () => env.tier }));
vi.mock('../utils/detectWeakGpu', () => ({ hasWeakGpu: () => env.weakGpu, getGpuRenderer: () => '' }));
/* safeStorage: persist KAPALI — PERSIST_KEY testler arası taşınıp start()'ı
   crash-recovery'ye sokmasın. */
vi.mock('../utils/safeStorage', () => ({
  safeStorage:  { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  safeFlushKey: () => {},
  safeGetRaw:   () => null,
  safeSetRaw:   () => {},
}));

import { AdaptiveRuntimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../core/runtime/runtimeTypes';
import { forceMode, makeMockWorker } from './sim/runtimeSimulator';

/** setMode() upgrade histerezis penceresi (AdaptiveRuntimeManager.UPGRADE_DELAY_MS). */
const UPGRADE_DELAY_MS = 30_000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  AdaptiveRuntimeManager._resetForTest();
  env.tier = 'high'; env.weakGpu = false;
  vi.clearAllMocks();
});

describe('#606 — (1) bileşen başına TEK kademe', () => {
  it('AYNI bileşenin tekrar eden arızası modu yalnız BİR kez düşürür', () => {
    const m = forceMode(RuntimeMode.BALANCED);
    expect(m.getMode()).toBe(RuntimeMode.BALANCED);

    // Saha izi: reconnect turu bu çağrıyı arka arkaya tetikliyordu.
    for (let i = 0; i < 10; i++) m.reportFailure('OBD');

    // ESKİ (kusurlu) davranış burada SAFE_MODE verirdi.
    expect(m.getMode()).toBe(RuntimeMode.BASIC_JS);
    expect(m.getFailedComponents()).toEqual(['OBD']);
    expect(m.getRecoveryTarget()).toBe(RuntimeMode.BALANCED);
  });

  it('FARKLI bileşenler ayrı ayrı birer kademe indirir (merdiven çalışmaya devam eder)', () => {
    const m = forceMode(RuntimeMode.BALANCED);
    m.reportFailure('OBD');
    expect(m.getMode()).toBe(RuntimeMode.BASIC_JS);
    m.reportFailure('VisionCompute');
    expect(m.getMode()).toBe(RuntimeMode.POWER_SAVE);
    expect(m.getFailedComponents()).toEqual(['OBD', 'VisionCompute']);
  });
});

describe('#606 — (2) arıza tabanı POWER_SAVE', () => {
  it('biriken arızalar SAFE_MODE\'a indiremez', () => {
    const m = forceMode(RuntimeMode.BALANCED);
    m.reportFailure('OBD');               // → BASIC_JS
    m.reportFailure('VisionCompute');     // → POWER_SAVE
    m.reportFailure('NavigationCompute'); // taban — düşüş YOK
    m.reportFailure('VehicleCompute');
    m.reportFailure('RAM');

    expect(m.getMode()).toBe(RuntimeMode.POWER_SAVE);
  });

  it('tabanda/altında gelen arıza ÖLÜ LATCH bırakmaz (başka bileşenin kurtulmasını bloklamaz)', () => {
    const m = forceMode(RuntimeMode.BALANCED);
    m.reportFailure('OBD');           // → BASIC_JS, latch: OBD
    m.reportFailure('VisionCompute'); // → POWER_SAVE (taban), latch: +VisionCompute

    // Taban aşıldı: bu çağrı bir kademe TÜKETMEZ → latch de yazılmaz.
    m.reportFailure('RAM');
    expect(m.getFailedComponents()).toEqual(['OBD', 'VisionCompute']);

    // Gerçek arızalar kurtulunca mod geri çıkabilmeli — 'RAM' bunu bloklamamalı.
    m.reportRecovery('OBD');
    m.reportRecovery('VisionCompute');
    vi.advanceTimersByTime(UPGRADE_DELAY_MS);
    expect(m.getMode()).toBe(RuntimeMode.BALANCED);
  });

  it('SAFE_MODE\'daki bir sistemde arıza bildirimi modu değiştirmez ve latch yazmaz', () => {
    const m = forceMode(RuntimeMode.SAFE_MODE);
    m.reportFailure('OBD');
    expect(m.getMode()).toBe(RuntimeMode.SAFE_MODE);
    expect(m.getFailedComponents()).toEqual([]);
  });
});

describe('#606 — (3) reportRecovery: yukarı karşılık', () => {
  it('arıza geçince mod arıza ÖNCESİ seviyeye geri çıkar — histerezise tabi', () => {
    const m = forceMode(RuntimeMode.BALANCED);
    m.reportFailure('OBD');
    expect(m.getMode()).toBe(RuntimeMode.BASIC_JS);

    m.reportRecovery('OBD');
    // Upgrade ANLIK DEĞİL: 30 sn stabilite penceresi (setMode sözleşmesi).
    expect(m.getMode()).toBe(RuntimeMode.BASIC_JS);

    vi.advanceTimersByTime(UPGRADE_DELAY_MS);
    expect(m.getMode()).toBe(RuntimeMode.BALANCED);
    expect(m.getFailedComponents()).toEqual([]);
    expect(m.getRecoveryTarget()).toBeNull();
  });

  it('hâlâ arızalı bileşen varken mod yükseltilmez', () => {
    const m = forceMode(RuntimeMode.BALANCED);
    m.reportFailure('OBD');
    m.reportFailure('VisionCompute');
    expect(m.getMode()).toBe(RuntimeMode.POWER_SAVE);

    m.reportRecovery('OBD');
    vi.advanceTimersByTime(UPGRADE_DELAY_MS);
    expect(m.getMode()).toBe(RuntimeMode.POWER_SAVE);

    m.reportRecovery('VisionCompute');
    vi.advanceTimersByTime(UPGRADE_DELAY_MS);
    expect(m.getMode()).toBe(RuntimeMode.BALANCED);
  });

  it('bilinmeyen bileşen için no-op (idempotent)', () => {
    const m = forceMode(RuntimeMode.BALANCED);
    m.reportRecovery('OBD');
    m.reportRecovery('OBD');
    vi.advanceTimersByTime(UPGRADE_DELAY_MS);
    expect(m.getMode()).toBe(RuntimeMode.BALANCED);
  });

  it('CANLI worker referansıyla registerWorker o bileşenin latch\'ini düşürür', () => {
    const m = forceMode(RuntimeMode.BALANCED);
    m.reportFailure('VisionCompute');
    expect(m.getMode()).toBe(RuntimeMode.BASIC_JS);

    // Çökme yolu null yazar; restart yolu CANLI referansla döner = kurtarma kanıtı.
    m.registerWorker('VisionCompute', null, 'OPTIONAL');
    expect(m.getFailedComponents()).toEqual(['VisionCompute']);

    m.registerWorker('VisionCompute', makeMockWorker().worker, 'OPTIONAL');
    vi.advanceTimersByTime(UPGRADE_DELAY_MS);
    expect(m.getMode()).toBe(RuntimeMode.BALANCED);
  });

  it('arıza→kurtarma→arıza döngüsü kademe BİRİKTİRMEZ', () => {
    const m = forceMode(RuntimeMode.BALANCED);
    for (let i = 0; i < 5; i++) {
      m.reportFailure('OBD');
      expect(m.getMode()).toBe(RuntimeMode.BASIC_JS);
      m.reportRecovery('OBD');
      vi.advanceTimersByTime(UPGRADE_DELAY_MS);
      expect(m.getMode()).toBe(RuntimeMode.BALANCED);
    }
  });
});

describe('#606 — (4) kurtarma başka otoriteyi sessizce EZMEZ', () => {
  it('kullanıcı modu devraldıysa kurtarma eski tabana geri çıkmaz', () => {
    const m = forceMode(RuntimeMode.BALANCED);
    m.reportFailure('OBD');
    expect(m.getMode()).toBe(RuntimeMode.BASIC_JS);

    // Kullanıcı runtimeOverride ile POWER_SAVE seçti (useLayoutServices → 'user').
    m.setMode(RuntimeMode.POWER_SAVE, 'user');
    expect(m.getMode()).toBe(RuntimeMode.POWER_SAVE);
    expect(m.getRecoveryTarget()).toBeNull(); // taban devredildi

    m.reportRecovery('OBD');
    vi.advanceTimersByTime(UPGRADE_DELAY_MS);
    expect(m.getMode()).toBe(RuntimeMode.POWER_SAVE); // kullanıcı kararı korunur
  });

  it('güç/termal tavanı kurtarmanın üstündedir', () => {
    const m = forceMode(RuntimeMode.BALANCED);
    m.reportFailure('OBD');                            // → BASIC_JS
    m.setPowerCeiling(RuntimeMode.BASIC_JS);           // akü koruma tavanı
    m.reportRecovery('OBD');
    vi.advanceTimersByTime(UPGRADE_DELAY_MS);
    expect(m.getMode()).toBe(RuntimeMode.BASIC_JS);    // tavan üstüne çıkılmadı
  });

  it('devralma latch\'i DÜŞÜRMEZ — circir geri açılmaz', () => {
    const m = forceMode(RuntimeMode.BALANCED);
    m.reportFailure('OBD');
    m.setMode(RuntimeMode.POWER_SAVE, 'user');
    expect(m.getFailedComponents()).toEqual(['OBD']);

    // Kopuk dongle yeniden bildirse bile ikinci kademe YOK.
    for (let i = 0; i < 10; i++) m.reportFailure('OBD');
    expect(m.getMode()).toBe(RuntimeMode.POWER_SAVE);
  });
});
