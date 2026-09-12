/**
 * dtcAuthoritySources — CAROS LAB · Kanonik DTC Otoritesi TEK okuma katmanı
 * (P0-OBD-CORE-03).
 *
 * Senkron getter, KENDİ try/catch'i içinde. HİÇBİR tarama BAŞLATMAZ, komut
 * GÖNDERMEZ, timer KURMAZ — yalnız `dtcAuthority` defterinin kopyasını okur.
 *
 * GİZLİLİK: yalnız OBD protokol verisi (DTC kodu · sınıf · ECU adresi/rolü ·
 * protokol numarası). VIN, konum ve kullanıcı verisi bu katmandan GEÇMEZ.
 */

import {
  getDtcAuthoritySnapshot, summarizeDtcAuthority, evaluateVehicleDtcVerdict,
  type DtcAuthoritySnapshot, type DtcAuthoritySummary, type VehicleDtcVerdictResult,
} from '../obd/dtcAuthority';

export interface DtcAuthorityLabSnapshot {
  readonly readAt: number;
  readonly snap: DtcAuthoritySnapshot;
  readonly summary: DtcAuthoritySummary;
  readonly verdict: VehicleDtcVerdictResult;
}

function _safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

const _EMPTY: DtcAuthoritySnapshot = {
  sessionEpoch: -1, observations: [], scans: [], lastScanAt: null,
};

/** Tek senkron okuma. ASLA throw etmez. */
export function readDtcAuthoritySnapshot(): DtcAuthorityLabSnapshot {
  const snap = _safe(() => getDtcAuthoritySnapshot(), _EMPTY);
  return {
    readAt:  Date.now(),
    snap,
    summary: _safe(() => summarizeDtcAuthority(snap), summarizeDtcAuthority(_EMPTY)),
    verdict: _safe(() => evaluateVehicleDtcVerdict(snap), evaluateVehicleDtcVerdict(_EMPTY)),
  };
}
