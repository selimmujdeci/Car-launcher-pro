/**
 * nativeBoundarySources.ts — ARCH-04/F5 · Native Boundary / HAL LAB okuma katmanı.
 *
 * TEK OKUMA KATMANI: her getter kendi `try/catch`indedir; hiçbir servis
 * başlatılmaz, hiçbir izin istenmez, hiçbir komut gönderilmez, timer/abonelik
 * KURULMAZ. Ekran bunu yalnız açılışta bir kez ve elle YENİLE ile çağırır.
 */

import { readNativeHalEvidence, type NativeHalSnapshot } from '../native/nativeHalEvidence';
import {
  buildNativeConformanceMatrix, type NativeConformanceMatrix,
} from '../native/nativeConformanceMatrix';
import {
  summarizeNativeNegotiation, type NativeNegotiationSummary,
} from '../native/nativeCapabilityNegotiation';
import {
  getPhoneHubIngressEvidence, type PhoneIngressEvidence,
} from '../phoneHub/phoneHubNativeIngress';
import {
  getObdNativeProvenanceEvidence, type ObdNativeProvenanceEvidence,
} from '../obd/obdNativeProvenance';
import {
  getCanNativeProvenanceEvidence, type CanNativeProvenanceEvidence,
} from '../vehicleDataLayer/canNativeProvenance';
import {
  getStorageWriteEvidence, type StorageWriteEvidence,
} from '../../utils/safeStorageWriteEvidence';

export interface NativeBoundarySnapshot {
  readonly hal: NativeHalSnapshot;
  readonly conformance: NativeConformanceMatrix;
  readonly negotiation: NativeNegotiationSummary;
  readonly phoneIngress: PhoneIngressEvidence | null;
  readonly obdProvenance: ObdNativeProvenanceEvidence | null;
  readonly canProvenance: CanNativeProvenanceEvidence | null;
  readonly storageWrites: StorageWriteEvidence | null;
}

function _safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

/**
 * Native sınır kanıdının tamamı. Kaynak okunamazsa `null` döner — ekran
 * "KAYNAK YOK" gösterir, sahte satır ÜRETİLMEZ.
 */
export function readNativeBoundarySnapshot(): NativeBoundarySnapshot | null {
  const hal = _safe(() => readNativeHalEvidence());
  if (hal === null) return null;
  const conformance = _safe(() => buildNativeConformanceMatrix(hal));
  if (conformance === null) return null;
  const negotiation = _safe(() => summarizeNativeNegotiation(hal.negotiation));
  if (negotiation === null) return null;
  return Object.freeze({
    hal,
    conformance,
    negotiation,
    phoneIngress: _safe(() => getPhoneHubIngressEvidence()),
    obdProvenance: _safe(() => getObdNativeProvenanceEvidence()),
    canProvenance: _safe(() => getCanNativeProvenanceEvidence()),
    storageWrites: _safe(() => getStorageWriteEvidence()),
  });
}
