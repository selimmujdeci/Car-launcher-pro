/**
 * guardianTickPolicy.test.ts — GUARDIAN-AI-G16 · TICK KARARININ KİLİTLERİ.
 *
 * Bu dosya Guardian'ın kadans/bütçe kararını KİLİTLER. Kilitler zayıflatılmaz;
 * karar bilinçli değişirse kilit YENİ doğru davranışa GÜNCELLENİR (kaldırılmaz).
 *
 * Ayrıca iki PARİTE kilidi taşır — sessiz ayrışmayı yakalamak için KAYNAK
 * DOSYALARI OKUR (statik iddia yetmez, ölçülen metin karşılaştırılır):
 *   1. `MODE_MULTIPLIER` aynası ↔ `AdaptiveRuntimeManager` gerçeği.
 *   2. Guardian eşikleri ↔ `VehicleCompute.worker` + `BatteryProtectionService`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { RuntimeMode } from '../core/runtime/runtimeTypes';
import { RUNTIME_CONFIGS } from '../core/runtime/runtimeConfig';
import {
  GUARDIAN_TASK_ID, GUARDIAN_BASE_PERIOD_MS, GUARDIAN_TASK_CRITICALITY,
  GUARDIAN_DEFER_IDLE, GUARDIAN_TICK_BUDGET_MS, GUARDIAN_TICK_HARD_LIMIT_MS,
  guardianEffectivePeriodMs, guardianWorstCaseDetectionLatencyMs,
  guardianKeepsUpWithObd, isGuardianTickOverBudget,
} from '../platform/navigation/guardian/runtime/guardianTickPolicy';
import {
  GUARDIAN_COOLANT_HIGH_C, GUARDIAN_COOLANT_CRITICAL_C,
  GUARDIAN_BATTERY_LOW_V, GUARDIAN_BATTERY_CRITICAL_V,
  GUARDIAN_VEHICLE_HEALTH_POLICY,
} from '../platform/navigation/guardian/runtime/guardianVehicleHealthPolicy';

const ALL_MODES = [
  RuntimeMode.PERFORMANCE, RuntimeMode.BALANCED, RuntimeMode.BASIC_JS,
  RuntimeMode.POWER_SAVE, RuntimeMode.SAFE_MODE,
] as const;

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1) Kadans sözleşmesi — ASIL KİLİT
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Guardian kadansı — "zincirin en yavaş halkası olma" sözleşmesi', () => {
  it('HER modda Guardian periyodu OBD anket periyodunu AŞMAZ', () => {
    for (const mode of ALL_MODES) {
      expect(
        guardianKeepsUpWithObd(mode),
        `${mode}: Guardian ${guardianEffectivePeriodMs(mode)} ms > OBD ${RUNTIME_CONFIGS[mode].obdPollingMs} ms`,
      ).toBe(true);
    }
  });

  it('etkin periyot mod çarpanına göre BEKLENEN tablodadır (333 ms tikine yuvarlı)', () => {
    // taban 1000 ms · çarpan 1/1/2/3/4 · wheel 333 ms → 3/3/6/9/12 tik
    expect(guardianEffectivePeriodMs(RuntimeMode.PERFORMANCE)).toBe(999);
    expect(guardianEffectivePeriodMs(RuntimeMode.BALANCED)).toBe(999);
    expect(guardianEffectivePeriodMs(RuntimeMode.BASIC_JS)).toBe(1998);
    expect(guardianEffectivePeriodMs(RuntimeMode.POWER_SAVE)).toBe(2997);
    expect(guardianEffectivePeriodMs(RuntimeMode.SAFE_MODE)).toBe(3996);
  });

  it('EN KÖTÜ tespit gecikmesi = OBD anketi + Guardian periyodu (dürüst toplam)', () => {
    for (const mode of ALL_MODES) {
      expect(guardianWorstCaseDetectionLatencyMs(mode))
        .toBe(RUNTIME_CONFIGS[mode].obdPollingMs + guardianEffectivePeriodMs(mode));
    }
    // Düşük-uçtaki (BASIC_JS) gerçek sayı — belgede iddia edilen değer.
    expect(guardianWorstCaseDetectionLatencyMs(RuntimeMode.BASIC_JS)).toBe(5000 + 1998);
  });

  it('düşük-uçta (BASIC_JS) Guardian periyodu GPS güncelleme periyoduyla AYNI ölçektedir', () => {
    // Guardian 1998 ms · GPS 2000 ms — hız kaynağından daha hızlı koşmanın anlamı yok.
    expect(guardianEffectivePeriodMs(RuntimeMode.BASIC_JS))
      .toBeLessThanOrEqual(RUNTIME_CONFIGS[RuntimeMode.BASIC_JS].gpsUpdateMs);
  });
});

describe('Guardian görev tanımı — sabitler', () => {
  it('taban periyot 1000 ms ve wheel çözünürlüğünün TAM katıdır', () => {
    expect(GUARDIAN_BASE_PERIOD_MS).toBe(1000);
    expect(Math.round(GUARDIAN_BASE_PERIOD_MS / 333)).toBe(3);
  });

  it('kritiklik NORMAL — SAFETY olsaydı düşük tier\'da aynı örnek 5 kez hesaplanırdı', () => {
    expect(GUARDIAN_TASK_CRITICALITY).toBe('NORMAL');
  });

  it('deferIdle KAPALI — risk katmanının kadansı belirsiz olamaz', () => {
    expect(GUARDIAN_DEFER_IDLE).toBe(false);
  });

  it('görev kimliği sabittir (idempotent kayıt — çift tick yok)', () => {
    expect(GUARDIAN_TASK_ID).toBe('guardian-ai');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) Bütçe
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Guardian bütçesi — TEK bütçe, tier başına tablo YOK', () => {
  it('bütçe #494 tavanının yarısıdır', () => {
    expect(GUARDIAN_TICK_HARD_LIMIT_MS).toBe(16);
    expect(GUARDIAN_TICK_BUDGET_MS).toBe(8);
    expect(GUARDIAN_TICK_BUDGET_MS * 2).toBe(GUARDIAN_TICK_HARD_LIMIT_MS);
  });

  it('aşım sınıflandırması sınırda doğrudur (eşitlik aşım DEĞİL)', () => {
    expect(isGuardianTickOverBudget(7.99)).toBe(false);
    expect(isGuardianTickOverBudget(8)).toBe(false);
    expect(isGuardianTickOverBudget(8.01)).toBe(true);
    expect(isGuardianTickOverBudget(Number.NaN)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) PARİTE — mod çarpanı aynası ↔ manager gerçeği
 * ══════════════════════════════════════════════════════════════════════════ */

describe('PARİTE — MODE_MULTIPLIER aynası AdaptiveRuntimeManager ile ayrışamaz', () => {
  const src = read('src/core/runtime/AdaptiveRuntimeManager.ts');

  it('manager çarpanları politikanın varsaydığı 1/1/2/3/4 değerleridir', () => {
    const block = src.slice(
      src.indexOf('const MODE_MULTIPLIER'),
      src.indexOf('const UPGRADE_DELAY_MS'),
    );
    expect(block.length).toBeGreaterThan(0);
    const expected: ReadonlyArray<readonly [string, number]> = [
      ['PERFORMANCE', 1], ['BALANCED', 1], ['BASIC_JS', 2], ['POWER_SAVE', 3], ['SAFE_MODE', 4],
    ];
    for (const [mode, mult] of expected) {
      const re = new RegExp(`RuntimeMode\\.${mode}\\]:\\s*${mult}\\s*,`);
      expect(re.test(block), `MODE_MULTIPLIER[${mode}] ${mult} olmalı`).toBe(true);
    }
  });

  it('wheel çözünürlüğü (MASTER_TICK_MS) 333 ms\'tir', () => {
    expect(/const MASTER_TICK_MS\s*=\s*333\s*;/.test(src)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4) PARİTE — eşikler ikinci otorite kurmuyor
 * ══════════════════════════════════════════════════════════════════════════ */

describe('PARİTE — Guardian eşikleri ürünün mevcut otoriteleriyle AYNI sayıdır', () => {
  it('soğutucu eşikleri VehicleCompute.worker ENGINE_OVERHEAT_ON/OFF ile aynıdır', () => {
    const worker = read('src/platform/vehicleDataLayer/VehicleCompute.worker.ts');
    const on  = /const ENGINE_OVERHEAT_ON\s*=\s*(\d+)\s*;/.exec(worker);
    const off = /const ENGINE_OVERHEAT_OFF\s*=\s*(\d+)\s*;/.exec(worker);
    expect(on, 'ENGINE_OVERHEAT_ON bulunamadı').not.toBeNull();
    expect(off, 'ENGINE_OVERHEAT_OFF bulunamadı').not.toBeNull();
    expect(GUARDIAN_COOLANT_CRITICAL_C).toBe(Number(on![1]));
    expect(GUARDIAN_COOLANT_HIGH_C).toBe(Number(off![1]));
  });

  it('akü eşikleri BatteryProtectionService THRESH_WARN/THRESH_SLEEP ile aynıdır', () => {
    const bps = read('src/platform/power/BatteryProtectionService.ts');
    const warn  = /const THRESH_WARN\s*=\s*([\d.]+)\s*;/.exec(bps);
    const sleep = /const THRESH_SLEEP\s*=\s*([\d.]+)\s*;/.exec(bps);
    expect(warn, 'THRESH_WARN bulunamadı').not.toBeNull();
    expect(sleep, 'THRESH_SLEEP bulunamadı').not.toBeNull();
    expect(GUARDIAN_BATTERY_LOW_V).toBe(Number(warn![1]));
    expect(GUARDIAN_BATTERY_CRITICAL_V).toBe(Number(sleep![1]));
  });

  it('politika kuralın doğrulama kapısını geçer (eşik YÖNLERİ doğru)', () => {
    const t = GUARDIAN_VEHICLE_HEALTH_POLICY.thresholds;
    expect(t.coolant.high).toBeLessThanOrEqual(t.coolant.critical);           // YÜKSEK kötü
    expect(t.oilPressure.critical).toBeLessThanOrEqual(t.oilPressure.low);    // DÜŞÜK kötü
    expect(t.batteryVoltage.critical).toBeLessThanOrEqual(t.batteryVoltage.low);
  });

  it('politika DONMUŞTUR — tik gövdesinde kazara mutasyona uğrayamaz', () => {
    expect(Object.isFrozen(GUARDIAN_VEHICLE_HEALTH_POLICY)).toBe(true);
    expect(Object.isFrozen(GUARDIAN_VEHICLE_HEALTH_POLICY.thresholds)).toBe(true);
  });
});
