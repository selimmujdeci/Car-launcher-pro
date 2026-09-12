/**
 * guardianRuntimeSources.ts — CAROS LAB · Guardian Runtime TEK okuma katmanı.
 *
 * Desen (A3–A8 turlarıyla aynı): senkron getter, kendi try/catch'i içinde.
 * HİÇBİR şey başlatmaz/durdurmaz, komut göndermez, timer kurmaz, ağa çıkmaz.
 * Guardian tick'ini TETİKLEYEMEZ, kadansını DEĞİŞTİREMEZ, kuralları ÇALIŞTIRAMAZ.
 *
 * ── GİZLİLİK (CLAUDE.md gözlemlenebilirlik kuralı 6) ────────────────────────
 * KOORDİNAT bu katmandan GEÇMEZ — Guardian zaten GPS'ten yalnız HIZ okur.
 * Risk olaylarının serbest metinleri (başlık/mesaj/öneri) TAŞINMAZ; yalnız
 * kimlik · tip · severity · güven · mesafe geçer. Hata MESAJI değil yalnız
 * hata SINIFI ve boru hattı AŞAMASI taşınır.
 */

import {
  getGuardianRuntimeSnapshot, type GuardianRuntimeSnapshot,
} from '../navigation/guardian/runtime/guardianRuntime';
import {
  GUARDIAN_TICK_POLICY_VERSION, GUARDIAN_BASE_PERIOD_MS, GUARDIAN_TASK_ID,
  GUARDIAN_TICK_BUDGET_MS, GUARDIAN_TICK_HARD_LIMIT_MS,
} from '../navigation/guardian/runtime/guardianTickPolicy';
import {
  GUARDIAN_COOLANT_HIGH_C, GUARDIAN_COOLANT_CRITICAL_C,
  GUARDIAN_BATTERY_LOW_V, GUARDIAN_BATTERY_CRITICAL_V,
} from '../navigation/guardian/runtime/guardianVehicleHealthPolicy';

export interface GuardianRuntimeRawSnapshot {
  readonly readAt:   number;
  readonly runtime:  GuardianRuntimeSnapshot;
  /** Kullanılan eşiklerin kaynak otoritesiyle birlikte gösterimi. */
  readonly coolantHighC:      number;
  readonly coolantCriticalC:  number;
  readonly batteryLowV:       number;
  readonly batteryCriticalV:  number;
}

/** Guardian okunamazsa: sahte "çalışıyor" ÜRETİLMEZ — her şey null/0 kalır. */
const _FALLBACK: GuardianRuntimeSnapshot = {
  running: false,
  policyVersion: GUARDIAN_TICK_POLICY_VERSION,
  taskId: GUARDIAN_TASK_ID,
  owner: 'ADAPTIVE_RUNTIME_WHEEL',
  criticality: 'NORMAL',
  deferIdle: false,
  mode: null,
  basePeriodMs: GUARDIAN_BASE_PERIOD_MS,
  effectivePeriodMs: null,
  worstCaseLatencyMs: null,
  keepsUpWithObd: null,
  sources: [],
  wiredSourceCount: 0,
  tickCount: 0,
  lastTickAtWallMs: null,
  lastTickAgeMs: null,
  errorCount: 0,
  lastErrorKind: null,
  lastErrorStage: null,
  lastErrorAgeMs: null,
  evaluatedRuleCount: null,
  riskEventCount: null,
  highestSeverity: null,
  overallRiskScore: null,
  events: [],
  lastOutputAtWallMs: null,
  lastOutputAgeMs: null,
  budgetMs: GUARDIAN_TICK_BUDGET_MS,
  hardLimitMs: GUARDIAN_TICK_HARD_LIMIT_MS,
  lastDurationMs: null,
  maxDurationMs: null,
  p50DurationMs: null,
  p95DurationMs: null,
  durationSampleCount: 0,
  overBudgetCount: 0,
  overHardLimitCount: 0,
};

function _safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

/** Tek senkron okuma — çağrıldığı anın anlık görüntüsü. Sayaçları KİRLETMEZ. */
export function readGuardianRuntimeSnapshot(): GuardianRuntimeRawSnapshot {
  return {
    readAt:  Date.now(),
    runtime: _safe(() => getGuardianRuntimeSnapshot(), _FALLBACK),
    coolantHighC:     GUARDIAN_COOLANT_HIGH_C,
    coolantCriticalC: GUARDIAN_COOLANT_CRITICAL_C,
    batteryLowV:      GUARDIAN_BATTERY_LOW_V,
    batteryCriticalV: GUARDIAN_BATTERY_CRITICAL_V,
  };
}
