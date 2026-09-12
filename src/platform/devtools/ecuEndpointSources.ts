/**
 * ecuEndpointSources — CAROS LAB · ECU Uç Noktaları & Rol Kanıtı TEK okuma katmanı.
 *
 * Desen mevcut LAB turlarıyla AYNI: senkron getter'lar, her biri kendi
 * try/catch'i içinde. **HİÇBİR ŞEY BAŞLATMAZ**: keşif koşturmaz, kimlik
 * çözmez, PDU göndermez, araç bağlamı aktive etmez, depoya yazmaz, timer
 * kurmaz, ağa çıkmaz.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Ham kimlik gövdesi (seri/parça/donanım numarası) bu katmandan GEÇMEZ çünkü
 * kanıt defterinde de YOKTUR — yalnız DID kimliği, sonuç sınıfı, NRC, gecikme
 * ve gövde UZUNLUĞU taşınır.
 */

import {
  ecuIdentityEverEvaluated, getLastEcuIdentityRun,
  type EcuIdentityRunEvidence,
} from '../obd/ecu/ecuIdentityResolver';
import {
  getEcuRoleHealth, getEcuRoleScope, getEcuRoleStorageKey,
  getEcuRoleBlockedWrites, getStoredEcuRoles, type StoredEcuRole,
} from '../obd/ecu/ecuRoleStore';
import type { StoreHealth } from '../obd/capability/capabilityStore';
import { getCapabilityScope } from '../obd/capability/capabilityStore';
import type { GapLedgerScope } from '../obd/gapLedgerScope';
import { getActiveObdProtocol, getActiveProtocolClass } from '../obd/activeProtocol';
import { genericBridgeAvailable } from '../obd/genericPduTransport';
import {
  getPhysicalProbes, getPhysicalProbeSkipped,
  /* B7 — sessiz adres eleme merdiveni (salt-okuma). */
  getProbeSuppressionStates, getProbeSuppressionSavings, getSuppressedProbes,
  PROBE_SILENCE_CONFIRM,
  type PhysicalProbeEvidence,
} from '../obd/physicalEcuProbe';

export interface EcuEndpointRawSnapshot {
  readonly readAt: number;
  /** Kimlik çözümü HİÇ değerlendirildi mi — `false` ile KARIŞTIRILMAZ. */
  readonly everEvaluated: boolean | null;
  readonly lastRun: EcuIdentityRunEvidence | null;
  readonly learnedRoles: readonly StoredEcuRole[];
  readonly roleScope: GapLedgerScope | null;
  readonly roleHealth: StoreHealth | null;
  readonly roleStorageKey: string | null;
  readonly roleBlockedWrites: number | null;
  /** Yetenek deposunun kapsamı — bölüm PARİTESİ kanıtı. */
  readonly capabilityScope: GapLedgerScope | null;
  readonly protocol: string | null;
  readonly protocolClass: string | null;
  readonly bridgeAvailable: boolean | null;
  /** Standart fiziksel adres yoklamalarının ÖLÇÜLMÜŞ sonucu. */
  readonly physicalProbes: readonly PhysicalProbeEvidence[];
  readonly physicalProbeSkipped: number | null;
  /**
   * P0-VDK-B7 — sessiz adres eleme merdiveni (salt-okuma).
   * `null` = okunamadı; boş dizi = "bastırma yok" (İKİSİ AYRI).
   */
  readonly probeSuppression: readonly {
    readonly txHeader: string;
    readonly silentStreak: number;
    readonly inconclusiveCount: number;
    readonly nextEligibleAtMs: number;
    readonly backoffStepIndex: number;
    readonly savedRequests: number;
    readonly savedMs: number | null;
  }[] | null;
  readonly probeSavings: {
    readonly savedRequests: number;
    readonly savedMs: number | null;
    readonly avgProbeMs: number | null;
    readonly suppressedAddresses: number;
  } | null;
  /** Son planlamada merdiven yüzünden sorulMAYAN hedefler (gerekçeli). */
  readonly suppressedNow: readonly {
    readonly txHeader: string;
    readonly reason: string;
    readonly silentStreak: number;
    readonly nextEligibleAtMs: number;
    readonly remainingMs: number;
  }[] | null;
  readonly silenceConfirmThreshold: number;
}

function _safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export function readEcuEndpointSnapshot(): EcuEndpointRawSnapshot {
  return {
    readAt: Date.now(),
    everEvaluated: _safe(ecuIdentityEverEvaluated),
    lastRun: _safe(getLastEcuIdentityRun),
    learnedRoles: _safe(getStoredEcuRoles) ?? [],
    roleScope: _safe(getEcuRoleScope),
    roleHealth: _safe(getEcuRoleHealth),
    roleStorageKey: _safe(getEcuRoleStorageKey),
    roleBlockedWrites: _safe(getEcuRoleBlockedWrites),
    capabilityScope: _safe(getCapabilityScope),
    protocol: _safe(getActiveObdProtocol),
    protocolClass: _safe(getActiveProtocolClass),
    bridgeAvailable: _safe(genericBridgeAvailable),
    physicalProbes: _safe(getPhysicalProbes) ?? [],
    physicalProbeSkipped: _safe(getPhysicalProbeSkipped),
    /* B7: LAB salt-okur — bu üç getter hiçbir prob TETİKLEMEZ. */
    probeSuppression: _safe(getProbeSuppressionStates),
    probeSavings:     _safe(getProbeSuppressionSavings),
    suppressedNow:    _safe(getSuppressedProbes),
    silenceConfirmThreshold: PROBE_SILENCE_CONFIRM,
  };
}
