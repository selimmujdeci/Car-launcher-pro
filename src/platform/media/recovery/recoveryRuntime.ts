/**
 * recoveryRuntime.ts — MUSIC F21 · Süreklilik kanıtının TEK okuma dikişi.
 *
 * ── NE YAPAR / NE YAPMAZ ─────────────────────────────────────────────────
 * Bu modül **çalma BAŞLATMAZ**, kuyruğa yazmaz, native'e komut göndermez ve
 * yeni bir kurtarma otoritesi KURMAZ. Yaptığı tek şey:
 *   1. Geri yükleme sonrası kanıtı toplamak (salt okuma),
 *   2. `decideAutoResume` (SAF) ile FAIL-CLOSED bir karar üretmek,
 *   3. Kararı ve kanıtı bounded telemetriye yazmak.
 *
 * Kararın YÜRÜTÜLMESİ çağıranındır ve bugün yalnız `OFFER` düzeyinde
 * anlamlıdır: **kullanıcı dokunmadan ses BAŞLAMAZ** (F8 #1121 kuralı F21'de
 * de geçerlidir; `policyAllowsAutoResume` varsayılan olarak `false`'dur ve
 * bu tur bir açma yolu EKLENMEMİŞTİR — açık borç olarak yazılır).
 *
 * TIMER/POLLING YOKTUR.
 */

import {
  decideAutoResume, type AutoResumeOutcome, type IgnitionEvidence,
} from './recoveryModel';
import {
  readIgnitionEvidence, readOnline, readQueueRecovery, readSessionRestored, readUserPaused,
} from './recoverySources';
import { noteAutoResume, getRecoveryTelemetry } from './recoveryTelemetry';

/**
 * UI'sız otomatik devam politikası.
 *
 * **Bugün DAİMA `false`.** Kanıt zinciri tamam olsa bile CarOS kendiliğinden
 * ses başlatmaz; bu bir ürün kararıdır ve saha doğrulaması olmadan
 * değiştirilmez (kütük #1121). Bayrak burada durur ki karar TEK yerde,
 * görünür ve test edilebilir olsun — gizli bir `if` içinde saklanmasın.
 */
export const POLICY_ALLOWS_AUTO_RESUME = false;

export interface RecoveryEvidence {
  readonly sessionRestored: boolean;
  readonly playableEntries: number;
  readonly userPaused: boolean;
  readonly ignition: IgnitionEvidence;
  readonly online: boolean;
  readonly requiresNetwork: boolean;
  readonly queueSource: string | null;
}

/** Kanıtı OKUR — hiçbir şeyi değiştirmez (LAB güvenle çağırır). */
export function readRecoveryEvidence(): RecoveryEvidence {
  const queue = readQueueRecovery();
  return Object.freeze({
    sessionRestored: readSessionRestored(),
    playableEntries: queue.entries,
    userPaused: readUserPaused(),
    ignition: readIgnitionEvidence(),
    online: readOnline(),
    requiresNetwork: queue.requiresNetwork,
    queueSource: queue.source,
  });
}

/**
 * Otomatik devam kararını ÜRETİR (yürütmez).
 *
 * Yan etkisi yalnız bounded telemetridir. `RESUME` bugün üretilemez:
 * `POLICY_ALLOWS_AUTO_RESUME` kapalıdır — karar en fazla `OFFER` olur.
 */
export function evaluateAutoResume(nowMs = Date.now()): AutoResumeOutcome {
  const evidence = readRecoveryEvidence();
  const outcome = decideAutoResume({
    sessionRestored: evidence.sessionRestored,
    playableEntries: evidence.playableEntries,
    userPaused: evidence.userPaused,
    ignition: evidence.ignition,
    requiresNetwork: evidence.requiresNetwork,
    online: evidence.online,
    policyAllowsAutoResume: POLICY_ALLOWS_AUTO_RESUME,
  });
  noteAutoResume({
    outcome, ignition: evidence.ignition, online: evidence.online, atMs: nowMs,
  });
  return outcome;
}

export { getRecoveryTelemetry };
