/**
 * CognitivePriorityEngine — Sürücü bilişsel yük yöneticisi.
 *
 * Üç kaynağı birleştirerek 5 seviyeli kognitif moda karar verir:
 *   • ThermalLevel  — thermalWatchdog'dan (onThermalLevelChange + getThermalSnapshot)
 *   • globalRiskScore — useHazardStore (anlık tehlike yoğunluğu)
 *   • driverAttentionBudget (DAB) — useHazardStore
 *
 * Karar matrisi (yüksek öncelik ilk):
 *   LIMP_HOME  : tempC > 80 VEYA DAB < 0.10
 *   CRITICAL   : thermalL3 (≥65°C) VEYA DAB < 0.30 VEYA risk > 0.70
 *   FOCUSED    : thermalL2 (≥55°C) VEYA DAB < 0.55 VEYA risk > 0.45
 *   AWARE      : thermalL1 (≥45°C) VEYA DAB < 0.80 VEYA risk > 0.20
 *   IMMERSIVE  : varsayılan
 *
 * Histerezis:
 *   Eskalasyon anlık uygulanır.
 *   Kurtarma (düşük mod) 5s kararlı bekleme sonrası uygulanır.
 *
 * MALI-400 safe: yalnızca Zustand subscribe + onThermalLevelChange + 1s poll.
 * Zero-Leak: stopCognitiveEngine() tüm abonelikleri ve zamanlayıcıları iptal eder.
 */

import { useHazardStore }    from '../../store/useHazardStore';
import { useCognitiveStore, MODE_RANK } from '../../store/useCognitiveStore';
import type { CognitiveMode } from '../../store/useCognitiveStore';
import {
  getThermalLevel,
  getThermalSnapshot,
  onThermalLevelChange,
} from '../thermalWatchdog';

/* ── Sabitler ──────────────────────────────────────────────────────────── */

const RECOVERY_DELAY_MS = 15_000; // LIMP_HOME'dan çıkış için 15s soğuma payı
const POLL_INTERVAL_MS  = 1_000;

/* ── Modül düzeyi engine state ─────────────────────────────────────────── */

let _running          = false;
let _pollTimer:       ReturnType<typeof setInterval>  | null = null;
let _thermalUnsub:    (() => void) | null = null;
let _hazardUnsub:     (() => void) | null = null;
let _recoveryTimer:   ReturnType<typeof setTimeout>   | null = null;
let _pendingMode:     CognitiveMode | null = null;   // recovery bekleyen mod
let _recoveryStartTs: number        | null = null;   // recovery geri sayım başlangıcı

/* ── Karar matrisi ─────────────────────────────────────────────────────── */

function _computeTarget(
  thermalLevel: number,
  tempC: number,
  dab: number,
  risk: number,
): CognitiveMode {
  // LIMP_HOME: Termal ≥ 85°C | DAB < 0.15 | (Termal L3+ VE DAB < 0.20)
  if (tempC > 85 || dab < 0.15 || (thermalLevel >= 3 && dab < 0.20)) return 'LIMP_HOME';
  if (thermalLevel >= 3 || dab < 0.30 || risk > 0.70)                 return 'CRITICAL';
  if (thermalLevel >= 2 || dab < 0.55 || risk > 0.45)                 return 'FOCUSED';
  if (thermalLevel >= 1 || dab < 0.80 || risk > 0.20)                 return 'AWARE';
  return 'IMMERSIVE';
}

/* ── Recovery yardımcıları ─────────────────────────────────────────────── */

function _cancelRecovery(): void {
  if (_recoveryTimer !== null) {
    clearTimeout(_recoveryTimer);
    _recoveryTimer = null;
  }
  _pendingMode     = null;
  _recoveryStartTs = null;
}

function _scheduleRecovery(mode: CognitiveMode): void {
  _cancelRecovery();
  _pendingMode     = mode;
  _recoveryStartTs = Date.now();
  _recoveryTimer   = setTimeout(() => {
    _recoveryTimer   = null;
    _pendingMode     = null;
    _recoveryStartTs = null;
    useCognitiveStore.getState().setMode(mode);
  }, RECOVERY_DELAY_MS);
}

/* ── Değerlendirme döngüsü ─────────────────────────────────────────────── */

function _evaluate(): void {
  const { globalRiskScore, driverAttentionBudget } = useHazardStore.getState();
  const thermalLevel = getThermalLevel();
  const snap         = getThermalSnapshot();
  const tempC        = isNaN(snap.tempC) ? 0 : snap.tempC;

  const target  = _computeTarget(thermalLevel, tempC, driverAttentionBudget, globalRiskScore);
  const current = useCognitiveStore.getState().currentMode;

  const targetRank  = MODE_RANK[target];
  const currentRank = MODE_RANK[current];

  if (targetRank > currentRank) {
    // Eskalasyon — anlık, bekleyen kurtarmayı iptal et
    _cancelRecovery();
    useCognitiveStore.getState().setMode(target);
  } else if (targetRank < currentRank) {
    // Kurtarma gerekli — henüz bu mod için beklemiyorsak başlat
    if (_pendingMode !== target) {
      _scheduleRecovery(target);
    }
  } else {
    // Aynı mod — kurtarma gerekmiyorsa iptal et
    if (_pendingMode !== null && MODE_RANK[_pendingMode] < currentRank) {
      // Hâlâ daha düşük bir moda doğru bekliyoruz; bırak çalışsın
    } else {
      _cancelRecovery();
    }
  }
}

/* ── Public API ────────────────────────────────────────────────────────── */

/** Inspector telemetrisi: recovery beklenen hedef mod (null = recovery yok). */
export function getCognitivePendingMode(): CognitiveMode | null {
  return _pendingMode;
}

/** Inspector telemetrisi: recovery geri sayımında kalan ms (0 = aktif değil). */
export function getCognitiveRecoveryRemainingMs(): number {
  if (_recoveryStartTs === null || _pendingMode === null) return 0;
  return Math.max(0, RECOVERY_DELAY_MS - (Date.now() - _recoveryStartTs));
}

export function startCognitiveEngine(): void {
  if (_running) return;
  _running = true;

  _evaluate(); // ilk değerlendirme

  _thermalUnsub = onThermalLevelChange(() => _evaluate());
  _hazardUnsub  = useHazardStore.subscribe(() => _evaluate());
  _pollTimer    = setInterval(_evaluate, POLL_INTERVAL_MS);
}

export function stopCognitiveEngine(): void {
  if (!_running) return;
  _running = false;

  if (_pollTimer !== null)  { clearInterval(_pollTimer); _pollTimer = null; }
  if (_thermalUnsub)        { _thermalUnsub(); _thermalUnsub = null; }
  if (_hazardUnsub)         { _hazardUnsub();  _hazardUnsub  = null; }
  _cancelRecovery();
}
