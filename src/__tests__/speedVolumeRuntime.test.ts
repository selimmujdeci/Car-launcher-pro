/**
 * speedVolumeRuntime.test.ts — hıza bağlı ses (SVC).
 *
 * Kilitler: yalnız KISAR (kullanıcı seviyesini aşmaz) · hız bilinmiyorsa
 * (füzyon `source:'none'` → sahte 0 km/h) NÖTR · 1 sn aralık + %2 histerezis
 * (ses yoluna gereksiz yazım yok) · nötre dönüş beklemez · durdurunca kısma
 * ses yolunda KALMAZ.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  computeSpeedCompensation, startSpeedVolumeCompensation, stopSpeedVolumeCompensation,
  type SpeedSample, type SvcLevel,
} from '../platform/media/loudness/speedVolumeRuntime';

describe('computeSpeedCompensation (saf)', () => {
  it('kapalıyken ya da hız bilinmiyorken NÖTR', () => {
    expect(computeSpeedCompensation(0, 'OFF')).toBe(1);
    expect(computeSpeedCompensation(null, 'HIGH')).toBe(1);
    expect(computeSpeedCompensation(-5, 'HIGH')).toBe(1);
    expect(computeSpeedCompensation(Number.NaN, 'HIGH')).toBe(1);
  });

  it('🔒 dururken kısılır, hız arttıkça kullanıcı seviyesine çıkar; ASLA 1\'i aşmaz', () => {
    expect(computeSpeedCompensation(0, 'LOW')).toBe(0.85);
    expect(computeSpeedCompensation(0, 'MEDIUM')).toBe(0.75);
    expect(computeSpeedCompensation(50, 'MEDIUM')).toBe(0.88);
    expect(computeSpeedCompensation(100, 'HIGH')).toBe(1);
    expect(computeSpeedCompensation(180, 'HIGH')).toBe(1);
    for (let v = 0; v <= 200; v += 10) expect(computeSpeedCompensation(v, 'HIGH')).toBeLessThanOrEqual(1);
  });
});

describe('speedVolumeRuntime', () => {
  let emit: (s: SpeedSample) => void = () => {};
  let levelChanged: () => void = () => {};
  let level: SvcLevel = 'MEDIUM';
  let now = 0;
  const applied: number[] = [];

  const start = () => startSpeedVolumeCompensation({
    subscribeSpeed: (fn) => { emit = fn; return () => { emit = () => {}; }; },
    subscribeLevel: (fn) => { levelChanged = fn; return () => { levelChanged = () => {}; }; },
    getLevel: () => level,
    apply: async (f) => { applied.push(f); },
    now: () => now,
  });

  beforeEach(async () => { level = 'MEDIUM'; now = 0; applied.length = 0; await start(); });
  afterEach(() => { stopSpeedVolumeCompensation(); vi.restoreAllMocks(); });

  it('🔒 füzyon kaynağı yoksa (sahte 0 km/h) KISILMAZ', () => {
    emit({ speed: 0, source: 'none' });
    expect(applied).toEqual([]);
  });

  it('gerçek hızda uygulanır; 1 sn içindeki küçük değişim YAZILMAZ', () => {
    emit({ speed: 0, source: 'obd' });                 // 0.75 yazılır
    now = 300; emit({ speed: 20, source: 'obd' });     // 0.80 — 1 sn dolmadı → YAZILMAZ
    now = 1500; emit({ speed: 20, source: 'obd' });    // 0.80 — süre doldu → yazılır
    now = 2600; emit({ speed: 22, source: 'obd' });    // 0.81 — son yazılana fark 0.01 < %2 → YAZILMAZ
    now = 3700; emit({ speed: 60, source: 'obd' });    // 0.90 yazılır
    expect(applied).toEqual([0.75, 0.8, 0.9]);
  });

  it('seviye kapatılınca BEKLEMEDEN nötre döner', () => {
    emit({ speed: 0, source: 'gps' });
    level = 'OFF'; now = 100; levelChanged();
    expect(applied).toEqual([0.75, 1]);
  });

  it('hız kaynağı kaybolursa BEKLEMEDEN nötre döner', () => {
    emit({ speed: 10, source: 'can' });
    now = 200; emit({ speed: 0, source: 'none' });
    expect(applied).toEqual([0.78, 1]);
  });

  it('🔒 durdurunca kısma ses yolunda KALMAZ', () => {
    emit({ speed: 0, source: 'obd' });
    stopSpeedVolumeCompensation();
    expect(applied).toEqual([0.75, 1]);
  });
});
