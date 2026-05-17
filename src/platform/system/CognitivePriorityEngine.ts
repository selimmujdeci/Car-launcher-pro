/**
 * CognitivePriorityEngine — Sürücü bilişsel yük yöneticisi.
 *
 * Üç kaynağı birleştirerek 6 seviyeli kognitif moda karar verir:
 *   • ThermalLevel  — thermalWatchdog'dan (onThermalLevelChange + getThermalSnapshot)
 *   • globalRiskScore — useHazardStore (anlık tehlike yoğunluğu)
 *   • driverAttentionBudget (DAB) — useHazardStore
 *
 * Karar matrisi (yüksek öncelik ilk):
 *   LIMP_HOME  : tempC > 85 VEYA DAB < 0.15
 *   CRITICAL   : thermalL3 (≥65°C) VEYA DAB < 0.30 VEYA risk > 0.70
 *   PROTECTION : DAB < 0.42 VEYA risk > 0.55
 *   FOCUSED    : thermalL2 (≥55°C) VEYA DAB < 0.55 VEYA risk > 0.45
 *   AWARE      : thermalL1 (≥45°C) VEYA DAB < 0.80 VEYA risk > 0.20
 *   IMMERSIVE  : varsayılan
 *
 * Histerezis:
 *   Eskalasyon anlık uygulanır.
 *   Kurtarma (düşük mod) 15s kararlı bekleme sonrası uygulanır.
 *
 * Servis Shedding:
 *   PROTECTION/CRITICAL → communityService ve voiceService PAUSE edilir (stop değil).
 *   PROTECTION/CRITICAL → runtimeManager üzerinden animasyonlar kısıtlanır.
 *   Kurtarma → tüm servisler resume edilir.
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
import { runtimeManager }             from '../../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode }                from '../../core/runtime/runtimeTypes';
import { setCommunityPaused }         from '../communityService';
import { setVoicePaused }             from '../voiceService';

/* ── Sabitler ──────────────────────────────────────────────────────────── */

const RECOVERY_DELAY_MS = 15_000;
const POLL_INTERVAL_MS  = 1_000;

/* ── Modül düzeyi engine state ─────────────────────────────────────────── */

let _running          = false;
let _pollTimer:       ReturnType<typeof setInterval>  | null = null;
let _thermalUnsub:    (() => void) | null = null;
let _hazardUnsub:     (() => void) | null = null;
let _modeUnsub:       (() => void) | null = null;
let _recoveryTimer:   ReturnType<typeof setTimeout>   | null = null;
let _pendingMode:     CognitiveMode | null = null;
let _recoveryStartTs: number        | null = null;

/* ── Karar matrisi ─────────────────────────────────────────────────────── */

function _computeTarget(
  thermalLevel: number,
  tempC: number,
  dab: number,
  risk: number,
): CognitiveMode {
  if (tempC > 85 || dab < 0.15 || (thermalLevel >= 3 && dab < 0.20)) return 'LIMP_HOME';
  if (thermalLevel >= 3 || dab < 0.30 || risk > 0.70)                 return 'CRITICAL';
  // PROTECTION: DAB ve risk eşikleri CRITICAL ile FOCUSED arasında
  if (dab < 0.42 || risk > 0.55)                                       return 'PROTECTION';
  if (thermalLevel >= 2 || dab < 0.55 || risk > 0.45)                  return 'FOCUSED';
  if (thermalLevel >= 1 || dab < 0.80 || risk > 0.20)                  return 'AWARE';
  return 'IMMERSIVE';
}

/* ── Servis Shedding ────────────────────────────────────────────────────── */

/**
 * Mod değiştiğinde servis kısıtlamalarını uygular.
 * PROTECTION / CRITICAL → pause (servisler canlı, işlemler atlanır).
 * LIMP_HOME            → stop zaten SystemBoot LIMP lifecycle'ı üstleniyor.
 * Kurtarma             → pause kaldırılır.
 *
 * Animasyon kısıtı: PROTECTION/CRITICAL → BASIC_JS (--rt-anim:0).
 * Kurtarma → BALANCED'a izin ver (30s histerezis runtimeManager içinde).
 */
function _applySheddingForMode(mode: CognitiveMode): void {
  const isPaused = mode === 'PROTECTION' || mode === 'CRITICAL';

  // Servis Pause / Resume
  setCommunityPaused(isPaused);
  setVoicePaused(isPaused);

  // Animasyon kısıtı — PROTECTION ve CRITICAL'da BASIC_JS (animasyonlar kapalı)
  if (isPaused) {
    runtimeManager.setMode(RuntimeMode.BASIC_JS, 'cognitive-protection');
  } else if (mode === 'IMMERSIVE' || mode === 'AWARE') {
    // Tam kurtarma: runtimeManager kendi donanım tespitine dönsün
    // setMode ile BALANCED teklif et — termal/güç tavandan kısıtlanabilir
    runtimeManager.setMode(RuntimeMode.BALANCED, 'cognitive-recovery');
  }
  // FOCUSED / LIMP_HOME için runtimeManager'a müdahale yok (kendi kuralları yeterli)
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
    _cancelRecovery();
    useCognitiveStore.getState().setMode(target);
  } else if (targetRank < currentRank) {
    if (_pendingMode !== target) {
      _scheduleRecovery(target);
    }
  } else {
    if (_pendingMode !== null && MODE_RANK[_pendingMode] < currentRank) {
      // Hâlâ daha düşük moda doğru bekliyoruz — bırak çalışsın
    } else {
      _cancelRecovery();
    }
  }
}

/* ── Public API ────────────────────────────────────────────────────────── */

export function getCognitivePendingMode(): CognitiveMode | null {
  return _pendingMode;
}

export function getCognitiveRecoveryRemainingMs(): number {
  if (_recoveryStartTs === null || _pendingMode === null) return 0;
  return Math.max(0, RECOVERY_DELAY_MS - (Date.now() - _recoveryStartTs));
}

export function startCognitiveEngine(): void {
  if (_running) return;
  _running = true;

  _evaluate();

  _thermalUnsub = onThermalLevelChange(() => _evaluate());
  _hazardUnsub  = useHazardStore.subscribe(() => _evaluate());
  _pollTimer    = setInterval(_evaluate, POLL_INTERVAL_MS);

  // Mod değişimlerini izle → shedding uygula
  _modeUnsub = useCognitiveStore.subscribe((state) => {
    _applySheddingForMode(state.currentMode);
  });
}

export function stopCognitiveEngine(): void {
  if (!_running) return;
  _running = false;

  if (_pollTimer !== null)  { clearInterval(_pollTimer); _pollTimer = null; }
  if (_thermalUnsub)        { _thermalUnsub(); _thermalUnsub = null; }
  if (_hazardUnsub)         { _hazardUnsub();  _hazardUnsub  = null; }
  if (_modeUnsub)           { _modeUnsub();    _modeUnsub    = null; }
  _cancelRecovery();

  // Cleanup: tüm pause'ları kaldır
  setCommunityPaused(false);
  setVoicePaused(false);
}
