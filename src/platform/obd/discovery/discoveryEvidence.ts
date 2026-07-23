/**
 * discoveryEvidence — P0 Deep PID/DID Explorer Faz-1 · bounded tek-satır kanıt (§I).
 *
 * DESEN (extendedPollEvidence.ts / kwpRecoveryEvidence.ts ile AYNI aile): sabit halka
 * tampon + üretimde de görünür `console.warn` satırı. VIN/kimlik gibi hassas alanlar
 * maskelenir (yalnız ilk 6 karakter + '…' — ham kimlik ASLA loglanmaz).
 */

export type DiscoveryEventType =
  | 'PID_DID_DISCOVERY_START'
  | 'PID_DID_DISCOVERY_CANDIDATE'
  | 'PID_DID_DISCOVERY_RESPONSE'
  | 'PID_DID_DISCOVERY_VERIFIED'
  | 'PID_DID_DISCOVERY_UNKNOWN'
  | 'PID_DID_DISCOVERY_REJECTED'
  | 'PID_DID_DISCOVERY_PAUSED'
  | 'PID_DID_DISCOVERY_CANCELLED'
  | 'PID_DID_DISCOVERY_COMPLETE';

export interface DiscoveryEvidenceInput {
  type: DiscoveryEventType;
  /** Zaten hash'lenmiş araç kimliği (ham VIN ASLA verilmez) — burada AYRICA kısaltılır. */
  vehicleFingerprint?: string | null;
  protocol?: string | null;
  ecuAddress?: string | null;
  request?: string | null;
  responseClass?: string | null;
  latencyMs?: number | null;
  responseLength?: number | null;
  negativeResponseCode?: number | null;
  validationStatus?: string | null;
  confidence?: number | null;
  queueDepth?: number | null;
  connectionState?: string | null;
  sessionHealth?: string | null;
}

export interface DiscoveryEvidenceEntry extends Required<Omit<DiscoveryEvidenceInput, 'type' | 'vehicleFingerprint'>> {
  type: DiscoveryEventType;
  ts: number;
  /** Kısaltılmış/maskelenmiş kimlik — ham hash bile tam saklanmaz (savunma derinliği). */
  vehicleFingerprint: string | null;
}

const MAX_ENTRIES = 128;
const _ring: DiscoveryEvidenceEntry[] = [];

/** Kimliği kısaltır — ilk 6 karakter + '…' (tam hash bile loglanmaz). */
function maskFingerprint(fp: string | null | undefined): string | null {
  if (typeof fp !== 'string' || fp.length === 0) return null;
  return fp.length <= 6 ? fp : `${fp.slice(0, 6)}…`;
}

/** Tek satır kanıt üretir + bounded halkaya ekler + üretimde de görünür console.warn basar. */
export function emitDiscoveryEvidence(input: DiscoveryEvidenceInput): DiscoveryEvidenceEntry {
  const entry: DiscoveryEvidenceEntry = {
    type: input.type,
    ts: Date.now(),
    vehicleFingerprint: maskFingerprint(input.vehicleFingerprint),
    protocol: input.protocol ?? null,
    ecuAddress: input.ecuAddress ?? null,
    request: input.request ?? null,
    responseClass: input.responseClass ?? null,
    latencyMs: input.latencyMs ?? null,
    responseLength: input.responseLength ?? null,
    negativeResponseCode: input.negativeResponseCode ?? null,
    validationStatus: input.validationStatus ?? null,
    confidence: input.confidence ?? null,
    queueDepth: input.queueDepth ?? null,
    connectionState: input.connectionState ?? null,
    sessionHealth: input.sessionHealth ?? null,
  };
  _ring.push(entry);
  if (_ring.length > MAX_ENTRIES) _ring.shift();
  try {
    console.warn(`[Discovery:${entry.type}]`, JSON.stringify(entry));
  } catch {
    /* serileştirme hatası — kanıt halkası zaten güncellendi, fail-soft */
  }
  return entry;
}

/** Bounded kanıt geçmişi (kopya) — teşhis raporu/UI okur. */
export function getDiscoveryEvidence(): readonly DiscoveryEvidenceEntry[] {
  return _ring.slice();
}

/** Test yardımcıları — üretim kodu çağırmaz. */
export const _internals = {
  reset(): void { _ring.length = 0; },
};
