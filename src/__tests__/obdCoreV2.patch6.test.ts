/**
 * obdCoreV2.patch6.test.ts — Patch 6 (AdaptivePollingController + ek PID'ler)
 *
 * İki saf birimi kilitler:
 *  1. sanitizeNativeOBDPacket — yeni alanlar (throttle/intakeTemp/boostPressure/voltage):
 *     sınır içi kabul, -1 sentinel atlama (staggered polling sözleşmesi), sınır dışı eleme,
 *     voltage → batteryVoltage eşlemesi. Eski 4 alanın davranışı DEĞİŞMEDİ.
 *  2. computeObdPollProfile — tier tabanları (250/500/1000ms), weak head unit eşiği
 *     (obdPollingMs >= 5s → moda uy), geçersiz config fail-soft (3s native varsayılanı).
 */
import { describe, it, expect } from 'vitest';
import { sanitizeNativeOBDPacket } from '../platform/obdSanitizer';
import {
  computeObdPollProfile,
  WEAK_MODE_THRESHOLD_MS,
} from '../platform/obd/AdaptivePollingController';

describe('Patch 6 — sanitizer yeni alanlar', () => {
  it('sınır içi throttle/intakeTemp/boostPressure kabul edilir', () => {
    const { patch } = sanitizeNativeOBDPacket(
      { speed: 50, rpm: 2000, throttle: 42, intakeTemp: 35, boostPressure: 120 },
      null,
    );
    expect(patch).not.toBeNull();
    expect(patch!.throttle).toBe(42);
    expect(patch!.intakeTemp).toBe(35);
    expect(patch!.boostPressure).toBe(120);
  });

  it('voltage sınır içindeyse batteryVoltage olarak eşlenir', () => {
    const { patch } = sanitizeNativeOBDPacket({ voltage: 14.2 }, null);
    expect(patch).not.toBeNull();
    expect(patch!.batteryVoltage).toBe(14.2);
  });

  it('-1 sentinel (bu turda sorgulanmadı) alanları ATLAR — önceki değer korunur', () => {
    // Staggered polling: SLOW grup turda değilse native -1 gönderir → patch'e girmemeli.
    const { patch } = sanitizeNativeOBDPacket(
      { speed: 50, rpm: 2000, throttle: -1, intakeTemp: -1, boostPressure: -1, voltage: -1 },
      null,
    );
    expect(patch).not.toBeNull();
    expect(patch!.throttle).toBeUndefined();
    expect(patch!.intakeTemp).toBeUndefined();
    expect(patch!.boostPressure).toBeUndefined();
    expect(patch!.batteryVoltage).toBeUndefined();
  });

  it('sınır dışı değerler elenir, paket düşürülmez (fail-soft)', () => {
    // throttle >100%, voltage 5V (adaptör glitch), boost 300kPa (1 bayt PID üst sınırı 255)
    const { patch } = sanitizeNativeOBDPacket(
      { speed: 50, throttle: 150, voltage: 5, boostPressure: 300 },
      null,
    );
    expect(patch).not.toBeNull();     // speed geçerli → paket yaşar
    expect(patch!.speed).toBe(50);
    expect(patch!.throttle).toBeUndefined();
    expect(patch!.batteryVoltage).toBeUndefined();
    expect(patch!.boostPressure).toBeUndefined();
  });

  it('yalnız geçersiz yeni alanlar varsa patch null (kabul edilen alan yok)', () => {
    const { patch } = sanitizeNativeOBDPacket({ voltage: 3.3 }, null);
    expect(patch).toBeNull();
  });

  it('eski 4 alanın davranışı değişmedi (regresyon)', () => {
    const { patch, nextRpm } = sanitizeNativeOBDPacket(
      { speed: 90, rpm: 3000, engineTemp: 88, fuelLevel: 60 },
      2500,
    );
    expect(patch).toEqual({ speed: 90, rpm: 3000, engineTemp: 88, fuelLevel: 60 });
    expect(nextRpm).toBe(3000);
  });
});

describe('Patch 6 — computeObdPollProfile', () => {
  it('normal modda (obdPollingMs < 5s) FAST grup tier tabanına iner', () => {
    expect(computeObdPollProfile('high', 3_000).fastMs).toBe(250);
    expect(computeObdPollProfile('mid',  3_000).fastMs).toBe(500);
    expect(computeObdPollProfile('low',  3_000).fastMs).toBe(1_000);
    expect(computeObdPollProfile('high', 1_000).fastMs).toBe(250);
  });

  it('weak head unit modunda (obdPollingMs >= 5s) native poll moda birebir uyar', () => {
    expect(computeObdPollProfile('high', 5_000).fastMs).toBe(5_000);
    expect(computeObdPollProfile('low', 15_000).fastMs).toBe(15_000);
    expect(computeObdPollProfile('high', 5_000).uiHz).toBe(1);
  });

  it('weak eşiği tam sınırda devreye girer', () => {
    expect(computeObdPollProfile('high', WEAK_MODE_THRESHOLD_MS - 1).fastMs).toBe(250);
    expect(computeObdPollProfile('high', WEAK_MODE_THRESHOLD_MS).fastMs)
      .toBe(WEAK_MODE_THRESHOLD_MS);
  });

  it('geçersiz config → native varsayılanı 3s (fail-soft)', () => {
    expect(computeObdPollProfile('high', NaN).fastMs).toBe(3_000);
    expect(computeObdPollProfile('mid', 0).fastMs).toBe(3_000);
    expect(computeObdPollProfile('low', -500).fastMs).toBe(3_000);
  });

  it('uiHz tier tablosunu izler (normal mod)', () => {
    expect(computeObdPollProfile('high', 1_000).uiHz).toBe(10);
    expect(computeObdPollProfile('mid',  1_000).uiHz).toBe(5);
    expect(computeObdPollProfile('low',  1_000).uiHz).toBe(2);
  });
});
