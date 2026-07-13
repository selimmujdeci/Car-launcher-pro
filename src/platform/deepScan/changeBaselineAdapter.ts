/**
 * changeBaselineAdapter — W5-3c-2. Offline change-detection handler'a GERÇEK baseline
 * sağlayan SALT-OKUNUR adapter katmanı.
 *
 * NE YAPAR: iki mevcut, pasif veri kaynağını `ChangeBaseline`'a (yalnız normalize ECU
 * kümesi) çevirir:
 *  - PRIOR   → `deepScanPersistence.load(hash).discoveredEcus`  (son TAM taramanın diske
 *    yazılı çıktısı)
 *  - CURRENT → `vehicleKnowledgeBase.get(hash).discoveredEcus`  (AutoLearning'in PASİF
 *    öğrendiği, araç zaten HAL/VDL üzerinden akarken toplanan gözlem — read-only store)
 * İkisi de SALT-OKUNUR: hiçbir `save`/`completeScan`/active-record/discovery/CAN/OBD YOK.
 * Deep-scan araca TEK sorgu bile göndermez — iki küme de zaten elde olan veridir.
 *
 * TASARIM:
 *  - Factory + Dependency Injection: `createChangeBaselineAdapter({persistence?, knowledgeBase?})`.
 *    Üretim varsayılanları paylaşılan singleton'lar; test için fake enjekte edilir.
 *  - Handler'a `OfflineChangeDetectionDeps` şeklinde bağlanır (loadPriorBaseline/
 *    loadCurrentBaseline) — ADAPTER handler'ı ÇAĞIRMAZ, yalnız onun tükettiği veriyi üretir.
 *  - Handler bu modülü import ETMEZ (bağımlılık yönü: adapter → kaynaklar; handler saf kalır).
 *
 * NE YAPMAZ: firmware EKLEMEZ (handler `changedFirmware=false` üretmeye devam eder);
 * VIN/firmware sürümü/PID-DID/koordinat/secret TAŞIMAZ (yalnız normalize ECU kimlikleri);
 * trigger/wiring/runtime/persistence-yazımı/Event Bus/Capability/HAL DEĞİŞTİRMEZ.
 *
 * FAIL-SOFT: kaynak throw ederse / kayıt yoksa / hash geçersizse → `null` (değişim iddiası
 * handler tarafında fail-closed). Çıktı IMMUTABLE (dondurulmuş).
 */

import { deepScanPersistenceStore } from './deepScanPersistence';
import { vehicleKnowledgeBaseStore } from '../vehicleKnowledgeBase';
import type { ChangeBaseline, OfflineChangeDetectionDeps } from './offlineChangeDetectionHandler';

/** Yalnız `discoveredEcus` okunan minimal, yapısal kayıt arayüzü (kaynak-agnostik). */
interface EcuRecordLike {
  readonly discoveredEcus?: readonly string[];
}
interface PersistenceLike {
  load(vehicleFingerprintHash: string): EcuRecordLike | null;
}
interface KnowledgeLike {
  get(vehicleFingerprintHash: string): EcuRecordLike | null;
}

/** Enjekte edilebilir kaynaklar (varsayılan: paylaşılan salt-okunur singleton'lar). */
export interface ChangeBaselineAdapterDeps {
  readonly persistence?: PersistenceLike;
  readonly knowledgeBase?: KnowledgeLike;
}

/** Adapter yüzeyi = handler'ın tükettiği bağımlılık şekli (DI ile bağlanır). */
export type ChangeBaselineAdapter = OfflineChangeDetectionDeps;

/** Normalize ECU listesi: trim + upper + `0x` at + dedup + boş at (sıra korunur). */
function _normEcus(list: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  if (!Array.isArray(list)) return out;
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const key = raw.trim().toUpperCase().replace(/\s+/g, '').replace(/^0X/, '');
    if (key && !seen.has(key)) { seen.add(key); out.push(key); }
  }
  return out;
}

/** Kayıt → bounded + immutable `ChangeBaseline` (yalnız ECU). Kayıt yoksa null. */
function _toBaseline(rec: EcuRecordLike | null): ChangeBaseline | null {
  if (!rec || typeof rec !== 'object') return null;
  return Object.freeze({ ecus: Object.freeze(_normEcus(rec.discoveredEcus)) });
}

function _validHash(hash: string): boolean {
  return typeof hash === 'string' && hash.length > 0;
}

/**
 * Offline change-detection için baseline sağlayıcılarını üretir. Dönen nesne DOĞRUDAN
 * `createOfflineChangeDetectionHandler(...)`'a geçirilebilir (W5-3c-3 wiring — AYRI PR).
 */
export function createChangeBaselineAdapter(
  deps: ChangeBaselineAdapterDeps = {},
): ChangeBaselineAdapter {
  const persistence = deps.persistence ?? deepScanPersistenceStore;
  const knowledgeBase = deps.knowledgeBase ?? vehicleKnowledgeBaseStore;

  return {
    loadPriorBaseline: (hash: string): ChangeBaseline | null => {
      if (!_validHash(hash)) return null;
      let rec: EcuRecordLike | null = null;
      try { rec = persistence.load(hash); } catch { rec = null; }   // salt-okunur, fail-soft
      return _toBaseline(rec);
    },
    loadCurrentBaseline: (hash: string): ChangeBaseline | null => {
      if (!_validHash(hash)) return null;
      let rec: EcuRecordLike | null = null;
      try { rec = knowledgeBase.get(hash); } catch { rec = null; }   // salt-okunur, fail-soft
      return _toBaseline(rec);
    },
  };
}
