/**
 * obdNativeProvenance.ts — ARCH-04/F5 · OBD NATIVE SINIRI KANITI (SALT-OKUNUR).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── MEVCUT ZİNCİR BOZULMAZ ───────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *   DiagnosticTransaction → PDU yönlendirme → genel köprü → native kapı → sonuç
 *
 * ARCH-04 bu zincire YENİ BİR KARAR EKLEMEZ. Yalnız native SINIRINDA ölçülen
 * künyeyi kanıt olarak görünür kılar.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ─────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **YÜRÜTME OTORİTESİ DEĞİLDİR.** Hiçbir PDU göndermez, hiçbir isteği
 *     durdurmaz, hiçbir kapı kararını değiştirmez. Native
 *     `DiagnosticServiceGate` son ve BAĞIMSIZ güvenlik sınırı olarak kalır.
 * (2) **İKİNCİ SONUÇ SÖZLÜĞÜ DEĞİLDİR.** `PduOutcome` aynen taşınır.
 * (3) **GERÇEK YAZMAZ.** Bayat epoch'lu bir sonuç burada işaretlenir ama
 *     hiçbir üretim gerçeğine ZATEN yazılamaz — bu modülün yazacağı bir
 *     gerçek yoktur.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── GİZLİLİK ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * HAM PDU · ham yanıt · ham yük · VIN · adaptör kimliği bu kanıta GİRMEZ.
 * Yalnız servis kimliği, uç nokta adresi, sınıf, sayı ve süre taşınır.
 */

import type { PduOutcome } from './pdu';

/* ══════════════════════════════════════════════════════════════════════════
 * 1) Sözlük
 * ════════════════════════════════════════════════════════════════════════ */

export type ObdNativeBridgeMethod =
  | 'sendDiagnosticPdu' | 'readAdvancedDtcs' | 'readDtcClass' | 'readDtcFromEcu'
  | 'sendTesterPresent' | 'virtual-replay' | 'UNKNOWN';

/** İsteğin native sınırına göre tazelik hükmü. */
export type ObdProvenanceFreshness = 'CURRENT' | 'STALE' | 'UNKNOWN';

export interface ObdNativeProvenanceRecord {
  readonly seq: number;
  readonly bridgeMethod: ObdNativeBridgeMethod;
  readonly transportClass: string | null;
  /** İşlem künyesi (varsa) — ham içerik DEĞİL, yalnız referans. */
  readonly transactionRef: string | null;
  /** İstek anındaki OBD oturum mührü; okunamadıysa `null`. */
  readonly requestEpoch: number | null;
  /** Sonuç anındaki OBD oturum mührü; okunamadıysa `null`. */
  readonly resultEpoch: number | null;
  /** Hedef ECU adresi (tx) — kimlik değil, adres. */
  readonly targetRef: string | null;
  readonly serviceRef: string;
  readonly nativeResultClass: PduOutcome;
  /** ÖLÇÜLEN gecikme; native taşımadıysa `null` — 0 UYDURULMAZ. */
  readonly latencyMs: number | null;
  readonly byteCount: number | null;
  readonly freshness: ObdProvenanceFreshness;
  /** Bayat/geç sonucun akıbeti — bu modül için her zaman "yazılmadı". */
  readonly acceptedAsCurrentTruth: false;
  readonly nativeCapabilityAvailable: boolean | null;
  readonly gateReason: string | null;
  readonly provenance: readonly string[];
}

export interface ObdNativeProvenanceInput {
  readonly bridgeMethod: ObdNativeBridgeMethod;
  readonly transportClass: string | null;
  readonly transactionRef: string | null;
  readonly requestEpoch: number | null;
  readonly resultEpoch: number | null;
  readonly targetRef: string | null;
  readonly serviceRef: string;
  readonly nativeResultClass: PduOutcome;
  readonly latencyMs: number | null;
  readonly byteCount: number | null;
  readonly nativeCapabilityAvailable: boolean | null;
  readonly gateReason: string | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2) Tazelik hükmü (SAF)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Epoch karşılaştırması. Ölçülemeyen taraf varsa hüküm `UNKNOWN`'dır —
 * sahte "bayat" da sahte "taze" de üretilmez (F1-A ile aynı kural).
 */
export function judgeObdProvenanceFreshness(
  requestEpoch: number | null, resultEpoch: number | null,
): ObdProvenanceFreshness {
  if (requestEpoch === null || resultEpoch === null) return 'UNKNOWN';
  if (requestEpoch < 0 || resultEpoch < 0) return 'UNKNOWN';
  return requestEpoch === resultEpoch ? 'CURRENT' : 'STALE';
}

/** Ham içerik sızmasına karşı yapısal kapı — yalnız adres/servis biçimi geçer. */
function _ref(v: string | null, maxLen: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().toUpperCase();
  if (t.length === 0 || t.length > maxLen) return null;
  return /^[0-9A-Z_.:-]+$/.test(t) ? t : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3) Bounded kanıt defteri
 * ════════════════════════════════════════════════════════════════════════ */

const CAPACITY = 32;

let _seq = 0;
let _records: ObdNativeProvenanceRecord[] = [];
let _staleCount = 0;
let _deniedCount = 0;
let _unsupportedCount = 0;

const PROVENANCE: readonly string[] = Object.freeze([
  'genericPduTransport.GenericPduTransport.send()',
  'obdService.getObdSessionEpoch()',
  'native DiagnosticServiceGate (bağımsız son kapı)',
]);

/** Native sınır kanıdını kaydeder. ASLA throw etmez; ürün yolunu bozamaz. */
export function recordObdNativeProvenance(
  input: ObdNativeProvenanceInput,
): ObdNativeProvenanceRecord {
  _seq += 1;
  const freshness = judgeObdProvenanceFreshness(input.requestEpoch, input.resultEpoch);
  const record: ObdNativeProvenanceRecord = Object.freeze({
    seq: _seq,
    bridgeMethod: input.bridgeMethod,
    transportClass: _ref(input.transportClass, 32),
    transactionRef: _ref(input.transactionRef, 48),
    requestEpoch: input.requestEpoch,
    resultEpoch: input.resultEpoch,
    targetRef: _ref(input.targetRef, 8),
    serviceRef: _ref(input.serviceRef, 6) ?? 'UNKNOWN',
    nativeResultClass: input.nativeResultClass,
    latencyMs: typeof input.latencyMs === 'number' && Number.isFinite(input.latencyMs)
      ? input.latencyMs : null,
    byteCount: typeof input.byteCount === 'number' && Number.isFinite(input.byteCount)
      ? input.byteCount : null,
    freshness,
    acceptedAsCurrentTruth: false,
    nativeCapabilityAvailable: input.nativeCapabilityAvailable,
    gateReason: _ref(input.gateReason, 48),
    provenance: PROVENANCE,
  });
  if (freshness === 'STALE') _staleCount += 1;
  if (input.nativeResultClass === 'DENIED_BY_SAFETY_GATE') _deniedCount += 1;
  if (input.nativeResultClass === 'NOT_SUPPORTED_BY_TRANSPORT') _unsupportedCount += 1;
  _records.push(record);
  if (_records.length > CAPACITY) _records.shift();
  return record;
}

export interface ObdNativeProvenanceEvidence {
  readonly total: number;
  readonly staleEpochResults: number;
  readonly safetyGateDenials: number;
  readonly transportUnsupported: number;
  /** Bayat sonucun üretim gerçeğine yazılma sayısı — YAPISAL OLARAK 0. */
  readonly staleResultsAcceptedAsTruth: 0;
  readonly recent: readonly ObdNativeProvenanceRecord[];
  readonly provenance: readonly string[];
}

export function getObdNativeProvenanceEvidence(): ObdNativeProvenanceEvidence {
  return Object.freeze({
    total: _seq,
    staleEpochResults: _staleCount,
    safetyGateDenials: _deniedCount,
    transportUnsupported: _unsupportedCount,
    staleResultsAcceptedAsTruth: 0,
    recent: Object.freeze([..._records]),
    provenance: PROVENANCE,
  });
}

/** @internal — testler arası izolasyon. */
export function _resetObdNativeProvenanceForTest(): void {
  _seq = 0;
  _records = [];
  _staleCount = 0;
  _deniedCount = 0;
  _unsupportedCount = 0;
}
