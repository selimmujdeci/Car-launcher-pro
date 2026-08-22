/**
 * runtimeModeSources — CAROS LAB · Çalışma Zamanı Modu tek OKUMA katmanı (V-17).
 *
 * SENKRON · her getter kendi `try/catch`i içinde · ağ YOK · timer YOK · yazma YOK.
 * Bir kaynak patlarsa diğerleri okunmaya devam eder ve eksik alan UYDURULMAZ.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Cihazda çalışma zamanı modu her zaman `BASIC_JS` görünüyordu ama NEDENİ hiçbir
 * yerde görünmüyordu. Vizyon planı nedeni tahmin etmiş ve YANLIŞ tahmin etmişti
 * ("COEP kapalı olduğu için SAB yok"). Ölçüm gösterdi ki kapılar SIRALIDIR ve
 * SAB kapısı SONUNCUDUR — hedef donanımda `deviceTier`/`weakGpu` çok daha önce
 * tetikler. Bu ekran tam olarak bu ayrımı görünür kılar.
 */

import {
  runtimeManager, traceModeGates,
  type RuntimeModeDecision, type ModeReason,
} from '../../core/runtime/AdaptiveRuntimeManager';
import type { RuntimeMode } from '../../core/runtime/runtimeTypes';

export interface RuntimeModeSnapshot {
  /** Şu an YÜRÜRLÜKTE olan mod; okunamadıysa `null`. */
  readonly activeMode: RuntimeMode | null;
  /** Kapı tespitinin sonucu ve tüm kapı izleri; okunamadıysa `null`. */
  readonly decision: RuntimeModeDecision | null;
  /** Güç tavanı (akü koruması) — yoksa `null`. */
  readonly powerCeiling: RuntimeMode | null;
  /** Arıza merdiveninin geri çıkmayı hedeflediği mod — yoksa `null`. */
  readonly recoveryTarget: RuntimeMode | null;
  /** Arızalı bildirilen bileşenler; okunamadıysa `null`. */
  readonly failedComponents: readonly string[] | null;
  /** Son mod değişimi; hiç değişmediyse `null` ("uydurma değişim" yok). */
  readonly lastChange: {
    readonly from: RuntimeMode; readonly to: RuntimeMode;
    readonly reason: ModeReason; readonly at: number;
  } | null;
  /** Yukarıdaki alanlardan HANGİ BİRİ bile okunamadıysa `true`. */
  readonly partial: boolean;
}

export function readRuntimeModeSnapshot(): RuntimeModeSnapshot {
  let partial = false;

  let activeMode: RuntimeMode | null = null;
  try { activeMode = runtimeManager.getMode(); } catch { partial = true; }

  let decision: RuntimeModeDecision | null = null;
  try { decision = traceModeGates(); } catch { partial = true; }

  let powerCeiling: RuntimeMode | null = null;
  try { powerCeiling = runtimeManager.getPowerCeiling(); } catch { partial = true; }

  let recoveryTarget: RuntimeMode | null = null;
  try { recoveryTarget = runtimeManager.getRecoveryTarget(); } catch { partial = true; }

  let failedComponents: readonly string[] | null = null;
  try { failedComponents = runtimeManager.getFailedComponents(); } catch { partial = true; }

  let lastChange: RuntimeModeSnapshot['lastChange'] = null;
  try { lastChange = runtimeManager.getLastModeChange(); } catch { partial = true; }

  return {
    activeMode, decision, powerCeiling, recoveryTarget,
    failedComponents, lastChange, partial,
  };
}
