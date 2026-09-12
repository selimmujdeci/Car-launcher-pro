import type { UdsDtc } from './udsDtc';
import { classifyNrc } from './capabilityOutcome';

export type AdvancedDtcOutcome =
  | 'ok' | 'unsupported' | 'security_required' | 'condition_required'
  | 'no_response' | 'timeout' | 'malformed' | 'transport_error' | 'not_addressable';

export interface AdvancedDtcEvidenceEntry {
  readonly atMs: number; readonly sessionEpoch: number;
  /** P0-OBD-DIAG-02: '13' = ISO 14230-3 eski nesil readDTC (0x18 öncesi). */
  readonly service: '19' | '18' | '13'; readonly subFunction: string;
  readonly tx: string; readonly rx: string; readonly protocol: string | null;
  readonly outcome: AdvancedDtcOutcome; readonly nrc: number | null;
  readonly raw: string | null; readonly dtcs: readonly string[];
  readonly statusBytes: readonly string[];
  readonly statusAvailabilityMask: string | null;
  readonly snapshotReferences: readonly string[];
  readonly extendedDataReferences: readonly string[];
  readonly error: string | null;
}

export const ADVANCED_DTC_EVIDENCE_MAX = 160;
let _entries: AdvancedDtcEvidenceEntry[] = [];

export function normalizeAdvancedOutcome(
  outcome: string, nrc: number | null,
): AdvancedDtcOutcome {
  if (outcome === 'negative_nrc') {
    const c = classifyNrc(nrc ?? -1);
    if (c === 'unsupported') return 'unsupported';
    if (c === 'security_required') return 'security_required';
    return 'condition_required';
  }
  if (outcome === 'ok' || outcome === 'no_response' || outcome === 'timeout'
      || outcome === 'malformed' || outcome === 'transport_error'
      || outcome === 'not_addressable') return outcome;
  return 'malformed';
}

export function recordAdvancedDtcEvidence(e: AdvancedDtcEvidenceEntry): void {
  try {
    if (_entries.length > 0 && _entries[_entries.length - 1]!.sessionEpoch !== e.sessionEpoch) _entries = [];
    _entries.push(Object.freeze({ ...e, dtcs: [...e.dtcs], statusBytes: [...e.statusBytes],
      snapshotReferences: [...e.snapshotReferences], extendedDataReferences: [...e.extendedDataReferences] }));
    if (_entries.length > ADVANCED_DTC_EVIDENCE_MAX) _entries.splice(0, _entries.length - ADVANCED_DTC_EVIDENCE_MAX);
  } catch { /* evidence ürünü düşürmez */ }
}
export function getAdvancedDtcEvidence(): readonly AdvancedDtcEvidenceEntry[] { return [..._entries]; }
export function _resetAdvancedDtcEvidenceForTest(): void { _entries = []; }

/** 0x19-01: availability mask + DTC format + 16-bit count. */
export function parseStatusAvailability(raw: string): {
  valid: boolean; availabilityMask: string | null; formatIdentifier: string | null; count: number | null;
} {
  const h = clean(raw); if (h.length !== 8) return { valid: false, availabilityMask: null, formatIdentifier: null, count: null };
  return { valid: true, availabilityMask: h.slice(0, 2), formatIdentifier: h.slice(2, 4), count: parseInt(h.slice(4, 8), 16) };
}

/** 0x19-03: DTC(3 bayt) + snapshot record number(1 bayt) kayıtları. */
export function parseSnapshotIdentification(raw: string): { valid: boolean; references: string[] } {
  const h = clean(raw); if ((h.length % 8) !== 0) return { valid: false, references: [] };
  const references: string[] = [];
  for (let i = 0; i < h.length; i += 8) {
    const dtc = h.slice(i, i + 6), record = h.slice(i + 6, i + 8);
    if (dtc !== '000000') references.push(`${dtc}:${record}`);
  }
  return { valid: true, references };
}

/** 0x19-06 kanıtı: istenen DTC/record seçicisi; veri şeması OEM'e özgüdür ve uydurulmaz. */
export function extendedDataReference(dtc: UdsDtc, selector = 'FF'): string {
  return `${dtc.rawDtc}:${selector.toUpperCase()}`;
}

function clean(v: string): string { return (v ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase(); }
