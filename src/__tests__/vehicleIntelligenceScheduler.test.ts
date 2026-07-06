/**
 * vehicleIntelligenceScheduler.test.ts — FAZ 14/16: ilk tüketici migrasyonu doğrulaması.
 *
 * vehicleIntelligenceService.ts artık sabit `setInterval(_tick, 500)` yerine
 * `runtimeManager.scheduleTask({ id: 'vehicle-intel', periodMs: 500, ... })`
 * kullanıyor (§L.0, docs/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md:1176-1241).
 *
 * FAZ 16 NOTU (dürüst yuvarlama analizi): periodMs=500, MASTER_TICK_MS=333'e
 * göre KÜÇÜK bir periyot — BALANCED'ta round(500/333)=2 tik (~666ms, %33 fazla)
 * ama BASIC_JS'te round(500×2/333)=round(1000/333)=3 tik (~999ms) çıkıyor;
 * NAİF beklenti "666×2=1332ms→4 tik" olurdu ama effectiveMs HER ZAMAN ham
 * `periodMs`den (500), önceki YUVARLANMIŞ değerden DEĞİL yeniden hesaplanıyor
 * (mod geçişleri arasında rounding drift birikmesin diye — kasıtlı tasarım).
 * Sonuç: gözlenen yavaşlama oranı 2× değil ~1.5× (999/666). Bu sapma yalnız
 * MASTER_TICK_MS'e yakın KÜÇÜK periyotlarda anlamlı; FAZ 16'da taşınan diğer
 * 5 tüketicinin periyotları (8s/10s/30s/60s/5dk) MASTER_TICK_MS'in onlarca
 * katı olduğundan orada oran tam 2.0 (bkz. runtimeScheduler.test.ts + rapor).
 *
 * Bu test, PRODUCTION singleton'ın (AdaptiveRuntimeManager.ts'nin export ettiği
 * `runtimeManager` const'ı) vehicleIntelligenceService.ts'in bağlı olduğu AYNI
 * nesne olduğunu kullanır — `AdaptiveRuntimeManager._resetForTest()` ÇAĞRILMAZ,
 * çünkü o, sınıfın statik `_instance`'ını değiştirir ama vehicleIntelligenceService
 * içindeki ÖNCEDEN import edilmiş `runtimeManager` referansını GÜNCELLEMEZ (stale
 * referans olurdu). Bunun yerine gerçek uygulama akışıyla birebir aynı şekilde
 * doğrudan `runtimeManager.setMode()` çağrılır (thermalWatchdog/SystemOrchestrator
 * de tam olarak böyle yapar).
 *
 * Donanım mock'ları (deviceCapabilities/detectWeakGpu) + globalThis Worker/SAB/
 * crossOriginIsolated `vi.hoisted()` ile İMPORT'LARDAN ÖNCE kurulur — çünkü
 * AdaptiveRuntimeManager singleton'ı modül ilk yüklendiğinde (constructor'da)
 * BİR KEZ `_detectCapabilities()` çalıştırır; bu iş imports'tan SONRA yapılırsa
 * geç kalınmış olur ve baseline BASIC_JS'e düşer (jsdom'da Worker/SAB/COI yok).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.hoisted(() => {
  (globalThis as { Worker?: unknown }).Worker = class {} as unknown as typeof Worker;
  (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer = class {} as unknown;
  Object.defineProperty(globalThis, 'crossOriginIsolated', { value: true, configurable: true });
});
vi.mock('../platform/deviceCapabilities', () => ({ getDeviceTier: () => 'high' }));
vi.mock('../utils/detectWeakGpu', () => ({ hasWeakGpu: () => false, getGpuRenderer: () => '' }));

import { runtimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../core/runtime/runtimeTypes';
import { startVehicleIntelligenceService, stopVehicleIntelligenceService } from '../platform/vehicleIntelligenceService';
import { useVehicleIntelligenceStore } from '../store/useVehicleIntelligenceStore';

afterEach(() => {
  stopVehicleIntelligenceService();
  vi.useRealTimers();
});

describe('FAZ 14 — vehicleIntelligenceService scheduler migrasyonu', () => {
  it('BALANCED baseline: singleton doğru kuruldu (mod çarpanı=1 varsayımı geçerli)', () => {
    expect(runtimeManager.getMode(), 'Worker/SAB/COI mock\'ları singleton\'ı BALANCED\'a getiremedi — test ortamı varsayımı bozuldu')
      .toBe(RuntimeMode.BALANCED);
  });

  it('BASIC_JS moduna geçince vehicle-intel tetiklenme sıklığı yavaşlar (periodMs×2, yuvarlamayla ~1.5×)', () => {
    vi.useFakeTimers();

    const stop = startVehicleIntelligenceService();
    const baseline = useVehicleIntelligenceStore.getState().sampleCount;

    // BALANCED (mod çarpanı=1): effectiveMs=500 → round(500/333)=2 tik (~666ms).
    // 8 master tik boyunca 4 tetiklenme beklenir.
    vi.advanceTimersByTime(333 * 8);
    const countBalanced = useVehicleIntelligenceStore.getState().sampleCount - baseline;

    // Downgrade (BASIC_JS rank2 < BALANCED rank3) → anlık uygulanır, 30s hysteresis beklemez.
    runtimeManager.setMode(RuntimeMode.BASIC_JS, 'test:FAZ14');
    const beforeBasic = useVehicleIntelligenceStore.getState().sampleCount;

    // BASIC_JS (mod çarpanı=2): effectiveMs=500×2=1000 (ham periodMs'den yeniden
    // hesaplanır) → round(1000/333)=3 tik (~999ms). 8 tik pencerede 3 tetiklenme
    // beklenir — 4'ten 3'e (yavaşladı) ama yuvarlama nedeniyle tam 2× DEĞİL,
    // ~1.5× (999ms/666ms). Bkz. dosya başı FAZ 16 notu.
    vi.advanceTimersByTime(333 * 8);
    const countBasic = useVehicleIntelligenceStore.getState().sampleCount - beforeBasic;

    stop();

    expect(countBalanced, 'BALANCED\'da beklenen tetiklenme sayısı yanlış — taban periyot bozulmuş olabilir')
      .toBe(4);
    expect(countBasic, 'BASIC_JS\'te tetiklenme yavaşlamadı — scheduler mod ölçeklemesi migrasyonda kaybolmuş olabilir')
      .toBe(3);
    expect(countBasic, 'BASIC_JS güncelleme sıklığı BALANCED\'dan yavaş olmalı (düşük-tier CPU tasarrufu)')
      .toBeLessThan(countBalanced);
  });
});
