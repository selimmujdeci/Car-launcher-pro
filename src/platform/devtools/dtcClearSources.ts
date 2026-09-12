/**
 * dtcClearSources — CAROS LAB · DTC Silme Kanıtı TEK okuma katmanı (P0-OBD-10).
 *
 * Desen (A3–A8 turlarıyla aynı): senkron getter, her biri KENDİ try/catch'i
 * içinde. HİÇBİR silme başlatmaz, komut göndermez, timer kurmaz.
 *
 * GİZLİLİK: taşınan tek şey OBD protokol verisidir (komut, ham hex yanıt, DTC
 * kodu, protokol numarası, süre). **VIN · konum · kullanıcı verisi · API
 * anahtarı BU KATMANDAN GEÇMEZ** (CLAUDE.md gözlemlenebilirlik kuralı 6).
 */

import {
  getDtcClearEvidence, summarizeDtcClearEvidence,
  type DtcClearAttempt, type DtcClearEvidenceSummary,
} from '../obd/dtcClearEvidence';
import { getObdSessionEpoch } from '../obdService';
import { CarLauncher } from '../nativePlugin';

export interface DtcClearSnapshot {
  readonly readAt: number;
  readonly attempts: readonly DtcClearAttempt[];
  readonly summary: DtcClearEvidenceSummary;
  /**
   * ŞU ANKİ OBD oturumu. Okunamazsa `null` — sahte `0` YASAK
   * ("0. oturum" gerçek bir değerdir, "bilinmiyor" değildir).
   */
  readonly sessionEpoch: number | null;
  /**
   * Native köprü KANITLI silme metodunu taşıyor mu. `false` ise ham TX/RX
   * ölçülemez ve ekran bunu dürüstçe söyler ("eski plugin — kanıt taşınmıyor").
   */
  readonly detailedBridgeAvailable: boolean;
}

function _safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

const _EMPTY_SUMMARY: DtcClearEvidenceSummary = summarizeDtcClearEvidence([]);

/** Tek senkron okuma. ASLA throw etmez. */
export function readDtcClearSnapshot(): DtcClearSnapshot {
  const attempts = _safe(() => getDtcClearEvidence(), [] as readonly DtcClearAttempt[]);
  return {
    readAt:   Date.now(),
    attempts,
    summary:  _safe(() => summarizeDtcClearEvidence(attempts), _EMPTY_SUMMARY),
    sessionEpoch: _safe<number | null>(() => getObdSessionEpoch(), null),
    /* Dinamik import YOK: köprü sözleşmesini okumak için modülü statik almak
       yeterli — bu katman hiçbir native çağrı YAPMAZ, yalnız metodun VARLIĞINI
       ölçer (VAR/YOK; içerik taşınmaz). */
    detailedBridgeAvailable: _safe(
      () => typeof (CarLauncher as { clearDtcCodes?: unknown }).clearDtcCodes === 'function',
      false,
    ),
  };
}
