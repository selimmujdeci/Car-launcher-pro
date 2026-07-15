/**
 * offlineChangeDetectionHandler — `change_detection` offline fazının GERÇEK handler'ı (W5-3c-3).
 *
 * Bu, offline pass'te `skipped` olmayan İLK fazdır. Yalnız PASİF okuma yapar
 * (ChangeBaselineAdapter üzerinden fingerprint store + deep scan geçmişi):
 * araca sorgu YOK · yazma YOK · Event Bus YOK · yeni scheduler YOK.
 *
 * ÇIKTI SÖZLEŞMESİ (bounded): yalnız `status` + kapalı-küme `reason` + gerektiğinde
 * `changedEcu: true`. Keşif yükü (`ecus/pids/dids/firmware`) ÜRETİLMEZ; ham kimlik
 * (VIN/ECU adresi) faz sonucuna ASLA konmaz.
 *
 * FAIL-CLOSED:
 *  - Baseline yok → `no_baseline`. "Değişiklik yok" DEĞİLDİR; `changedEcu` bildirilmez.
 *  - Okuma hatası → `status:'error'` (`baseline_unavailable`) → faz BAŞARILI SAYILMAZ.
 *  - `changedFirmware` HİÇBİR ZAMAN bildirilmez: offline pass firmware envanteri
 *    toplamaz (DID sorgusu = aktif faz) → kanıt yok → iddia yok.
 *
 * Orchestrator sözleşmesi: yalnız `changedEcu === true` iken `recordChangeDetection()`
 * tetiklenir; `undefined` bırakmak "bilinmiyor" demektir (bkz. `_applyOfflineResult`).
 */

import { createChangeBaselineAdapter, type ChangeBaselineAdapter, type ChangeBaselineDeps } from './changeBaselineAdapter';
import type { PhaseContext, PhaseHandler, PhaseResult } from './deepScanOrchestrator';

/** Faz sonucu gerekçesi — KAPALI KÜME (serbest metin yok → bounded + PII-güvenli). */
export type ChangeDetectionReason = 'no_baseline' | 'unchanged_offline' | 'ecu_set_changed';

export interface OfflineChangeDetectionDeps extends ChangeBaselineDeps {
  /** Hazır adapter (test/DI). Verilmezse varsayılan store'larla lazy kurulur. */
  readonly baseline?: ChangeBaselineAdapter;
}

const RESULT_NO_BASELINE: PhaseResult = Object.freeze({
  status: 'success', reason: 'no_baseline' satisfies ChangeDetectionReason,
});
const RESULT_UNCHANGED: PhaseResult = Object.freeze({
  status: 'success', reason: 'unchanged_offline' satisfies ChangeDetectionReason,
});
const RESULT_ECU_CHANGED: PhaseResult = Object.freeze({
  status: 'success', reason: 'ecu_set_changed' satisfies ChangeDetectionReason, changedEcu: true,
});
const RESULT_UNAVAILABLE: PhaseResult = Object.freeze({
  status: 'error', errorCode: 'baseline_unavailable',
});

/**
 * `change_detection` handler'ı üretir. Kurulum I/O YAPMAZ — baseline yalnız faz
 * çalışınca (aşağıdaki `resolve()`) okunur.
 */
export function createOfflineChangeDetectionHandler(deps: OfflineChangeDetectionDeps = {}): PhaseHandler {
  const adapter = deps.baseline ?? createChangeBaselineAdapter(deps);

  return (_ctx: PhaseContext): PhaseResult => {
    const resolution = adapter.resolve();      // LAZY: disk okuması burada

    switch (resolution.kind) {
      case 'ecu_set_changed':
        return RESULT_ECU_CHANGED;             // tek gerçek değişim iddiası — kanıtı var
      case 'match':
      case 'match_via_vin':
        return RESULT_UNCHANGED;               // ECU seti aynı; firmware BİLİNMİYOR → iddia yok
      case 'unavailable':
        return RESULT_UNAVAILABLE;             // fail-closed: faz başarılı sayılmaz
      case 'no_baseline':
      default:
        return RESULT_NO_BASELINE;             // "değişiklik yok" DEĞİL
    }
  };
}
