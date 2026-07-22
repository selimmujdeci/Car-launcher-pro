/**
 * obdStaleThresholdCadence.test.ts — KİLİT: watchdog eşiği ile GERÇEK poll kadansı
 * arasındaki sözleşme.
 *
 * ── KÖK NEDEN (2026-07-22) ──────────────────────────────────────────────────
 * `computeStaleThresholdMs(floor, fastMs)` formülü, `fastMs`'in "çekirdek PID'lerin
 * en yavaş geliş periyodu" olduğu VARSAYIMI üzerine kuruluydu. Bu varsayım
 * `computeObdPollProfile` zayıf modda `fastMs = modePollingMs` döndürdüğü sürece
 * doğruydu.
 *
 * `WEAK_FAST_FLOOR_MS` (RPM/hız göstergesi zayıf modda da akıcı olsun diye) FAST
 * grubunu çekirdek kadanstan AYIRDI → `fastMs` 15s yerine 1.5s oldu → eşik 47s'den
 * 12s'ye DÜŞTÜ. Sonuç: POWER_SAVE'de 15s'de bir gelen SAĞLIKLI poll, 12s eşiğini
 * aşıp `link_dead` sayıldı → her turda teardown + reconnect (dalgalanma).
 *
 * ⚠️ Kritik ayrım: `fastMs` native'e gönderilen bir TALEPTİR, garanti değil
 * (`setObdPollProfile` eski APK'da yok / köprü hatasında düşer / native clamp'ler).
 * Bu yüzden watchdog EN YAVAŞ olası kadansa göre boyutlanmalıdır (fail-closed).
 *
 * Bu dosya o sözleşmeyi KİLİTLER — davranış testi + kaynak-metin değişmezi.
 */
/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';

import obdServiceSrc from '../platform/obdService.ts?raw';
import {
  computeObdPollProfile,
  WEAK_FAST_FLOOR_MS,
} from '../platform/obd/AdaptivePollingController';
import {
  computeStaleThresholdMs,
  STALE_JITTER_MARGIN_MS,
  STALE_MISSED_POLLS,
  STALE_THRESHOLD_MS,
} from '../platform/obdRetryPolicy';
import type { DeviceTier } from '../platform/deviceCapabilities';

const TIERS: readonly DeviceTier[] = ['high', 'mid', 'low'];

/** Üretimdeki `_staleThresholdMs()` ile AYNI türetme (fail-closed kadans seçimi). */
function staleThresholdFor(tier: DeviceTier, modePollingMs: number, floor = STALE_THRESHOLD_MS): number {
  const fastMs = computeObdPollProfile(tier, modePollingMs).fastMs;
  const worstCase = Number.isFinite(modePollingMs) && modePollingMs > 0
    ? Math.max(fastMs, modePollingMs)
    : fastMs;
  return computeStaleThresholdMs(floor, worstCase);
}

describe('KÖK KİLİDİ — watchdog eşiği gerçek kadansın ALTINA düşemez', () => {
  it('zayıf modlarda (POWER_SAVE 15s · SAFE_MODE 10s) eşik poll periyodunu AŞAR', () => {
    for (const tier of TIERS) {
      for (const modePollingMs of [10_000, 15_000, 30_000]) {
        const threshold = staleThresholdFor(tier, modePollingMs);
        // Sağlıklı bir poll turu ASLA "link öldü" sayılmamalı.
        expect(threshold).toBeGreaterThan(modePollingMs);
        // Formül gerçekten kadanstan türemeli (STALE_MISSED_POLLS tur + jitter).
        expect(threshold).toBe(modePollingMs * STALE_MISSED_POLLS + STALE_JITTER_MARGIN_MS);
      }
    }
  });

  it('REGRESYON: yalnız fastMs kullanılırsa eşik ÇÖKER (bu yüzden max alınır)', () => {
    const fastOnly = computeStaleThresholdMs(
      STALE_THRESHOLD_MS,
      computeObdPollProfile('low', 15_000).fastMs,
    );
    // Hatalı türetme protokol tabanına çöker (12s) ve 15s'lik kadansın ALTINDA kalır.
    expect(fastOnly).toBe(STALE_THRESHOLD_MS);
    expect(fastOnly).toBeLessThan(15_000);
    // Doğru türetme aynı senaryoda kadansın ÜSTÜNDE kalır.
    expect(staleThresholdFor('low', 15_000)).toBeGreaterThan(15_000);
  });

  it('hızlı modlarda (BALANCED 1s · ECO 3s) davranış BİREBİR aynı — protokol tabanı üstte', () => {
    for (const tier of TIERS) {
      for (const modePollingMs of [500, 1_000, 3_000]) {
        expect(staleThresholdFor(tier, modePollingMs)).toBe(STALE_THRESHOLD_MS);
      }
    }
  });

  /**
   * EN GÜÇLÜ KİLİT: gerçek RuntimeMode periyotlarının HEPSİNDE eşik, WEAK_FAST_FLOOR_MS
   * regresyonundan ÖNCEKİ değerle birebir aynı olmalı.
   *
   * Referans: zayıf modda eski `fastMs === modePollingMs` türetmesi. Hızlı modlarda eski
   * türetme TIER_FAST_MS kullanıyordu ama protokol tabanı (12s) her iki formülde de üstte
   * kaldığı için sonuç yine aynıdır → tek referans formül yeterli.
   * runtimeConfig.ts periyotları: 1s · 3s · 5s · 10s · 15s.
   */
  it('gerçek RuntimeMode periyotlarında eşik, regresyon ÖNCESİ değerle birebir aynı', () => {
    const preRegressionThreshold = (modePollingMs: number): number =>
      computeStaleThresholdMs(STALE_THRESHOLD_MS, modePollingMs);   // eski: fastMs = modePollingMs

    for (const tier of TIERS) {
      for (const modePollingMs of [1_000, 3_000, 5_000, 10_000, 15_000]) {
        expect(staleThresholdFor(tier, modePollingMs)).toBe(preRegressionThreshold(modePollingMs));
      }
    }
  });

  it('geçersiz mod değeri (0/NaN) fail-soft: profil tabanına düşer, kadans UYDURULMAZ', () => {
    for (const bad of [0, -1, Number.NaN]) {
      expect(staleThresholdFor('mid', bad)).toBe(STALE_THRESHOLD_MS);
    }
  });

  it('WEAK_FAST_FLOOR_MS korunur — gösterge akıcılığı feda edilmedi', () => {
    // Kök düzeltme FAST grubunu YAVAŞLATMAZ; yalnız watchdog'un kadans okumasını düzeltir.
    expect(computeObdPollProfile('low', 15_000).fastMs).toBe(WEAK_FAST_FLOOR_MS);
    expect(computeObdPollProfile('low', 15_000).fastMs).toBeLessThan(15_000);
  });
});

describe('YAPISAL DEĞİŞMEZ — _staleThresholdMs en yavaş kadansı seçmeli', () => {
  it('obdService eşiği fastMs ile modePollingMs\'in MAKSİMUMUNDAN türetir', () => {
    // Desen geri alınırsa (yalnız `.fastMs`) bu kilit düşer ve dalgalanma geri gelir.
    expect(obdServiceSrc).toMatch(/Math\.max\(fastMs,\s*modePollingMs\)/);
    expect(obdServiceSrc).toContain('worstCaseCadenceMs');
    expect(obdServiceSrc).toMatch(/computeStaleThresholdMs\(floor,\s*worstCaseCadenceMs\)/);
  });
});
