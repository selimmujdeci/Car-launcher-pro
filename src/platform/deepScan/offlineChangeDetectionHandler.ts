/**
 * offlineChangeDetectionHandler — Deep Scan offline pass için İLK gerçek değer üreten
 * handler (W5-3c-1). YALNIZ `change_detection` offline fazı için.
 *
 * NE YAPAR: ÖNCEDEN-VAROLAN iki baseline'ın ECU kümesi FARKINI hesaplar → `changedEcu`.
 *  - PRIOR  baseline: son TAM taramanın diske yazılmış çıktısı (deepScanPersistence.load
 *    ile beslenir — AYRI PR).
 *  - CURRENT baseline: pasif öğrenilmiş güncel gözlem (vehicleKnowledgeBase.get ile
 *    beslenir — AYRI PR).
 * Deep-scan ARACA HİÇBİR sorgu göndermez: iki küme de zaten elde olan veridir. Aktif
 * ECU/PID/DID sorgusu YOK · CAN frame YOK · OBD isteği YOK.
 *
 * NE YAPMAZ (bilinçli — W5-3c-1 yalnız SAF HANDLER'dır):
 *  - `deepScanPersistence`/`vehicleKnowledgeBase`'i DOĞRUDAN import ETMEZ → bağımlılıklar
 *    closure ile ENJEKTE edilir (test edilebilir, izole, kaynak-agnostik).
 *  - `completeScan`/`_finalize`/`_applyResult`/`saveSnapshot`/runtime aktif-kayıt API'leri
 *    ÇAĞIRMAZ (handler saf → yalnız enjekte provider'ları okur). `hasCompletedFullScan`/
 *    `completedScanCount`/`changeCheckCount` DOKUNULMAZ.
 *  - Trigger/wiring DEĞİŞTİRMEZ · Event Bus/Capability/Assistant/Native/HAL'e DOKUNMAZ ·
 *    firmware DEĞERLENDİRMEZ (`changedFirmware` daima `false` — pasif firmware kaynağı yok,
 *    dürüst fail-closed).
 *
 * FAIL-CLOSED: parmak izi yok / baseline eksik / baseline boş → değişim İDDİA EDİLMEZ
 * (`changedEcu=false`). Sahte pozitif üretilmez (persistence ECU listesi opsiyonel olduğu
 * için boş baseline OLAĞANDIR — bunu "değişti" saymak yanlış olur).
 *
 * GİZLİLİK: çıktı yalnız `{status, changedEcu, changedFirmware, reason(kategori)}` taşır —
 * ham ECU/PID/DID listesi, firmware sürümü, VIN, koordinat, secret, parmak izi hash'i YOK.
 */

import type {
  PhaseContext,
  PhaseHandler,
  PhaseResult,
  PhaseOutcomeStatus,
} from './deepScanOrchestrator';

/** Karşılaştırma baseline'ı — yalnız normalize ECU adres kimlikleri (ham response DEĞİL). */
export interface ChangeBaseline {
  readonly ecus: readonly string[];
}

/** Değişim kategorisi (ham veri DEĞİL — bounded enum). */
export type ChangeDetectionReason =
  | 'ecu_set_changed'     // iki baseline'ın ECU kümesi FARKLI → değişim var
  | 'no_change'           // ECU kümeleri AYNI
  | 'baseline_unavailable' // prior veya current baseline sağlanamadı (null)
  | 'baseline_incomplete'  // baseline'lardan biri BOŞ → anlamlı karşılaştırma yok
  | 'no_fingerprint';     // araç parmak izi yok → kimlik yok, karşılaştırılamaz

/**
 * Enjekte edilen bağımlılıklar — closure ile geçilir; handler bunları DOĞRUDAN import
 * etmez. Üretimde `loadPriorBaseline` deepScanPersistence.load'dan, `loadCurrentBaseline`
 * vehicleKnowledgeBase.get'ten türetilir (ADAPTER ayrı PR — W5-3c-2). İkisi de SALT-OKUNUR.
 */
export interface OfflineChangeDetectionDeps {
  readonly loadPriorBaseline: (vehicleFingerprintHash: string) => ChangeBaseline | null;
  readonly loadCurrentBaseline: (vehicleFingerprintHash: string) => ChangeBaseline | null;
}

/** Normalize ECU kümesi (dedup + upper + trim + `0x` at). Ham liste dışarı SIZMAZ. */
function _normEcuSet(list: readonly string[] | undefined): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(list)) return out;
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const key = raw.trim().toUpperCase().replace(/\s+/g, '').replace(/^0X/, '');
    if (key) out.add(key);
  }
  return out;
}

/** İki küme farklı mı (simetrik fark boş değil mi). O(n). */
function _setsDiffer(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return true;
  for (const x of a) if (!b.has(x)) return true;
  return false;
}

/** Bounded + dondurulmuş sonuç. `changedFirmware` daima false (bu PR firmware değerlendirmez). */
function _result(
  status: PhaseOutcomeStatus,
  changedEcu: boolean,
  reason: ChangeDetectionReason,
): PhaseResult {
  return Object.freeze({
    status,
    changedEcu,
    changedFirmware: false,
    reason,
  });
}

/**
 * Offline `change_detection` handler fabrikası. Bağımlılıklar closure ile enjekte edilir;
 * dönen handler `PhaseHandler` sözleşmesine SADIKTIR (PhaseContext genişletilmez) ve SAF'tır
 * (yan etkisiz, yalnız enjekte salt-okunur provider'ları okur).
 */
export function createOfflineChangeDetectionHandler(
  deps: OfflineChangeDetectionDeps,
): PhaseHandler {
  const loadPrior = deps.loadPriorBaseline;
  const loadCurrent = deps.loadCurrentBaseline;

  return (ctx: PhaseContext): PhaseResult => {
    // İptal önce — fail-soft; hiçbir hesap/okuma yapma.
    try { if (ctx.isCancelled()) return _result('cancelled', false, 'no_change'); } catch { /* fail-soft */ }

    const hash = ctx?.snapshot?.vehicleFingerprintHash ?? null;
    // FAIL-CLOSED: parmak izi yoksa araç kimliği yok → değişim iddia edilmez.
    if (typeof hash !== 'string' || hash.length === 0) {
      return _result('success', false, 'no_fingerprint');
    }

    let prior: ChangeBaseline | null = null;
    let current: ChangeBaseline | null = null;
    try { prior = loadPrior(hash); } catch { prior = null; }       // fail-soft
    try { current = loadCurrent(hash); } catch { current = null; } // fail-soft

    // FAIL-CLOSED: baseline'lardan biri yoksa karşılaştırılamaz.
    if (!prior || !current) {
      return _result('success', false, 'baseline_unavailable');
    }

    const priorSet = _normEcuSet(prior.ecus);
    const currentSet = _normEcuSet(current.ecus);

    // FAIL-CLOSED: boş baseline anlamlı karşılaştırma vermez (persistence ECU listesi
    // opsiyonel → boş OLAĞAN). Sahte pozitif üretme.
    if (priorSet.size === 0 || currentSet.size === 0) {
      return _result('success', false, 'baseline_incomplete');
    }

    const changedEcu = _setsDiffer(priorSet, currentSet);
    return _result('success', changedEcu, changedEcu ? 'ecu_set_changed' : 'no_change');
  };
}
