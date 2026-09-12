/**
 * earlyIdentitySources — CAROS LAB · Erken Araç Kimliği TEK okuma katmanı.
 *
 * Desen mevcut LAB turlarıyla AYNI: senkron getter'lar, her biri kendi
 * try/catch'i içinde. **HİÇBİR ŞEY BAŞLATMAZ**: kimlik turu koşturmaz, ECU
 * keşfi yapmaz, PDU göndermez, bağlam AKTİVE ETMEZ, timer kurmaz, ağa çıkmaz.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Kalibrasyon DEĞERİ bu katmandan geçmez çünkü kanıt defterinde de YOKTUR
 * (`earlyVehicleIdentity` yalnız karma taşır). Buraya yalnız DID kimliği,
 * sonuç sınıfı, NRC, gecikme ve gövde UZUNLUĞU gelir.
 */

import {
  earlyIdentityEverEvaluated, getEarlyIdentityAnchor, getLastEarlyIdentity,
  getLastIdentityReconciliation,
  type EarlyIdentityAnchor, type EarlyIdentityEvidence,
  type IdentityReconciliationEvidence,
} from '../obd/identity/earlyVehicleIdentity';
import { genericBridgeAvailable } from '../obd/genericPduTransport';
import { getActiveObdProtocol, getActiveProtocolClass } from '../obd/activeProtocol';
import { getCapabilityScope } from '../obd/capability/capabilityStore';
import type { GapLedgerScope } from '../obd/gapLedgerScope';

export interface EarlyIdentityRawSnapshot {
  readonly readAt: number;
  /** Erken kimlik HİÇ değerlendirildi mi — `false` ile KARIŞTIRILMAZ. */
  readonly everEvaluated: boolean | null;
  readonly last: EarlyIdentityEvidence | null;
  readonly anchor: EarlyIdentityAnchor | null;
  readonly reconciliation: IdentityReconciliationEvidence | null;
  /** Ortam ölçümü — köprü yoksa tur yapısal olarak ENGELLİDİR. */
  readonly bridgeAvailable: boolean | null;
  readonly protocol: string | null;
  readonly protocolClass: string | null;
  /** Yetenek deposunun AKTİF kapsamı — bölüm paritesinin kanıtı. */
  readonly capabilityScope: GapLedgerScope | null;
}

function _safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export function readEarlyIdentitySnapshot(): EarlyIdentityRawSnapshot {
  return {
    readAt: Date.now(),
    everEvaluated: _safe(earlyIdentityEverEvaluated),
    last: _safe(getLastEarlyIdentity),
    anchor: _safe(getEarlyIdentityAnchor),
    reconciliation: _safe(getLastIdentityReconciliation),
    bridgeAvailable: _safe(genericBridgeAvailable),
    protocol: _safe(getActiveObdProtocol),
    protocolClass: _safe(getActiveProtocolClass),
    capabilityScope: _safe(getCapabilityScope),
  };
}
