/**
 * obdCoreV2.patch9.query.test.ts — Patch 9B (sensorQueryService)
 *
 * Kilitler:
 *  - resolveSensor: Türkçe eşleştirme (spesifik alias kazanır, "hararet"→engineTemp).
 *  - CORE cevap: obdService anlık verisinden senkron; -1/geçersiz → dürüst "okunamıyor".
 *  - EXTENDED: taze önbellek anında; desteklenmiyor → dürüst; geçici abonelik taze
 *    değeri bekler (bayat önbellek yankısı yoksayılır) ve aboneliği BIRAKIR.
 *  - Eşleşmeyen soru → null (sahte cevap yok).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  obdData: {} as Record<string, unknown>,
  cached: undefined as { value: number; def: { pid: string; name: string; unit: string }; updatedAt: number } | undefined,
  supported: null as boolean | null,
  watchers: [] as Array<(v: { value: number; def: unknown; updatedAt: number }) => void>,
  unsubCount: 0,
}));

vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: vi.fn(() => M.obdData),
}));

vi.mock('../platform/obd/extendedPidService', () => ({
  getPidValue: vi.fn(() => M.cached),
  isPidSupported: vi.fn(() => M.supported),
  watchPid: vi.fn((_pid: string, cb: (v: { value: number; def: unknown; updatedAt: number }) => void) => {
    M.watchers.push(cb);
    return () => { M.unsubCount++; };
  }),
}));

import { querySensor, resolveSensor } from '../platform/obd/sensorQueryService';
import { STANDARD_PID_MAP } from '../platform/obd/StandardPidRegistry';

beforeEach(() => {
  M.obdData = { speed: 90, rpm: 2500, engineTemp: 88, fuelLevel: 60, throttle: 25,
    intakeTemp: 30, boostPressure: 110, batteryVoltage: 14.2, estimatedRangeKm: 420 };
  M.cached = undefined;
  M.supported = null;
  M.watchers = [];
  M.unsubCount = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('Patch 9B — resolveSensor eşleştirme', () => {
  it('hararet → core engineTemp', () => {
    const t = resolveSensor('hararet kaç');
    expect(t).toMatchObject({ kind: 'core', field: 'engineTemp' });
  });

  it('spesifik alias kazanır: "yağ sıcaklığı" → 5C (genel "sıcaklık" değil)', () => {
    expect(resolveSensor('motor yağı sıcaklığı kaç derece')).toMatchObject({ kind: 'ext', pid: '5C' });
    expect(resolveSensor('yag sicakligi')).toMatchObject({ kind: 'ext', pid: '5C' });
  });

  it('aksan/büyük harf toleransı: "HARARET", "yakıt tüketimi"', () => {
    expect(resolveSensor('HARARET')).toMatchObject({ kind: 'core', field: 'engineTemp' });
    expect(resolveSensor('yakıt tüketimi ne durumda')).toMatchObject({ kind: 'ext', pid: '5E' });
  });

  it('eşleşmeyen soru → null', () => {
    expect(resolveSensor('bugün hava nasıl')).toBe(null);
  });

  it('tüm EXTENDED alias hedefleri registry\'de tanımlı', () => {
    for (const q of ['yag sicakligi', 'motor yuku', 'ortam sicakligi', 'tuketim', 'katalizor', 'maf', 'avans', 'barometrik basinc', 'yakit trim', 'modul voltaji']) {
      const t = resolveSensor(q);
      expect(t?.kind).toBe('ext');
      expect(STANDARD_PID_MAP.has((t as { pid: string }).pid)).toBe(true);
    }
  });
});

describe('Patch 9B — CORE cevaplar', () => {
  it('hız senkron cevaplanır, TTS metni doğru', async () => {
    const a = await querySensor('hızım kaç');
    expect(a).not.toBeNull();
    expect(a!.value).toBe(90);
    expect(a!.text).toBe('Hız saatte 90 kilometre.');
  });

  it('yüzde birimi: yakıt → "yüzde 60"', async () => {
    const a = await querySensor('yakıt ne kadar');
    expect(a!.text).toBe('Yakıt seviyesi yüzde 60.');
  });

  it('ondalık volt: akü → "14,2 volt"', async () => {
    const a = await querySensor('akü voltajı');
    expect(a!.text).toBe('Akü voltajı 14,2 volt.');
  });

  it('-1 (veri yok) → dürüst "okunamıyor", sahte değer YOK', async () => {
    M.obdData = { ...M.obdData, engineTemp: -1 };
    const a = await querySensor('hararet');
    expect(a!.value).toBe(null);
    expect(a!.text).toBe('Motor sıcaklığı şu anda okunamıyor.');
  });
});

describe('Patch 9B — EXTENDED cevaplar', () => {
  it('taze önbellek anında cevaplanır (abonelik açılmaz)', async () => {
    M.cached = { value: 104, def: { pid: '5C', name: 'x', unit: 'y' }, updatedAt: Date.now() - 5_000 };
    const a = await querySensor('yağ sıcaklığı');
    expect(a!.value).toBe(104);
    expect(a!.text).toBe('Motor yağı sıcaklığı 104 derece.');
    expect(M.watchers.length).toBe(0);
  });

  it('araç desteklemiyorsa dürüst cevap, bekleme yok', async () => {
    M.supported = false;
    const a = await querySensor('katalizör sıcaklığı');
    expect(a!.value).toBe(null);
    expect(a!.text).toContain('desteklenmiyor');
    expect(M.watchers.length).toBe(0);
  });

  it('önbellek yoksa geçici abonelik taze değeri bekler ve BIRAKIR', async () => {
    const p = querySensor('motor yükü');
    await vi.advanceTimersByTimeAsync(0); // watcher kurulsun
    expect(M.watchers.length).toBe(1);
    M.watchers[0]!({ value: 42, def: STANDARD_PID_MAP.get('04'), updatedAt: Date.now() + 1 });
    const a = await p;
    expect(a!.value).toBe(42);
    expect(a!.text).toBe('Hesaplanan motor yükü yüzde 42.');
    expect(M.unsubCount).toBe(1); // abonelik bırakıldı → polling durur
  });

  it('bayat önbellek yankısı yoksayılır, taze okuma beklenir', async () => {
    const p = querySensor('motor yükü');
    await vi.advanceTimersByTimeAsync(0);
    M.watchers[0]!({ value: 99, def: STANDARD_PID_MAP.get('04'), updatedAt: Date.now() - 60_000 }); // bayat
    M.watchers[0]!({ value: 37, def: STANDARD_PID_MAP.get('04'), updatedAt: Date.now() + 1 });      // taze
    const a = await p;
    expect(a!.value).toBe(37);
  });

  it('timeout → dürüst "okunamıyor" + abonelik bırakılır', async () => {
    const p = querySensor('motor yükü');
    await vi.advanceTimersByTimeAsync(13_000); // EXT_WAIT_TIMEOUT_MS aşıldı
    const a = await p;
    expect(a!.value).toBe(null);
    expect(a!.text).toContain('okunamıyor');
    expect(M.unsubCount).toBe(1);
  });
});

describe('Patch 9B — dürüstlük', () => {
  it('eşleşmeyen soru null döner (sahte onay/cevap yasak)', async () => {
    expect(await querySensor('şarkı çal')).toBe(null);
  });
});
