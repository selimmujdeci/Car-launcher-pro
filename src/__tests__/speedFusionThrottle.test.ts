/**
 * speedFusionThrottle.test.ts — kısıcı penceresine düşen hız değişimi KAYBOLMAZ.
 *
 * Saha 2026-09-23 (araç, telefon + V-LINK): hıza bağlı ses açılışta "kaynak
 * yok" örneğinde takılı kaldı. Kök: füzyon, 200 ms kısıcı penceresine düşen
 * değişimi düşürüyor ve önceki HESAPLA karşılaştırdığı için sabit kalan yeni
 * değeri bir daha hiç yayınlamıyordu (araç durunca son "0" da aynı sınıf).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let obdHandler: ((d: { speed: number; source?: string }) => void) | null = null;

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('../platform/nativePlugin', () => ({ CarLauncher: { addListener: vi.fn() } }));
vi.mock('../platform/obdService', () => ({
  onOBDData: (fn: (d: { speed: number; source?: string }) => void) => { obdHandler = fn; return () => { obdHandler = null; }; },
}));
vi.mock('../platform/gpsService', () => ({ onGPSLocation: () => () => {} }));
vi.mock('../platform/performanceMode', () => ({ getPerformanceMode: () => 'balanced' }));

describe('speedFusion · kısıcı', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(1_000_000); obdHandler = null; });
  afterEach(() => { vi.useRealTimers(); });

  it('🔒 pencereye düşen son değer (araç durdu → 0) pencere sonunda İLETİLİR', async () => {
    const { onFusedSpeed } = await import('../platform/speedFusion');
    const seen: number[] = [];
    onFusedSpeed((d) => { if (d.source !== 'none') seen.push(d.speed); });

    obdHandler?.({ speed: 12, source: 'real' });          // iletilir
    vi.setSystemTime(1_000_100);
    obdHandler?.({ speed: 0, source: 'real' });           // 100 ms sonra → pencere içinde
    expect(seen).toEqual([12]);

    await vi.advanceTimersByTimeAsync(250);              // pencere biter, sonra hiç yeni veri yok
    expect(seen).toEqual([12, 0]);
  });

  it('değişmeyen değer yeniden iletilmez (kısıcı sıklığı sınırlamaya devam eder)', async () => {
    const { onFusedSpeed } = await import('../platform/speedFusion');
    let count = 0;
    onFusedSpeed((d) => { if (d.source !== 'none') count++; });
    obdHandler?.({ speed: 30, source: 'real' });
    for (let i = 1; i <= 5; i++) { vi.setSystemTime(1_000_000 + i * 50); obdHandler?.({ speed: 30, source: 'real' }); }
    await vi.advanceTimersByTimeAsync(1_000);
    expect(count).toBe(1);
  });
});
