/**
 * canNativeProvenance.ts — ARCH-04/F5 · CAN NATIVE SINIRI KANITI (SALT-OKUNUR).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KÖPRÜ SAFLIĞI (PAZARLIKSIZ) ──────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * CAN köprüsü bir GÖZLEM taşımasıdır. Şunları ÜRETEMEZ ve bu modül de üretmez:
 *   · araç kimliği (VIN · marka · model · parmak izi)
 *   · ECU rolü
 *   · sinyal ANLAMI (bir sayının "yakıt" olduğu hükmü)
 *   · sağlık hükmü ("araç iyi/kötü")
 *   · kalibrasyon gerçeği
 *
 * Bu modül YALNIZ şunları taşır: kaynak referansı · dinleyici nesli · zaman
 * temeli · oturum bağlamı · çerçeve kaynağı sınıfı · düşme/hata sınıfı ·
 * native yetenek · köken.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── SAHTE ZAMAN DAMGASI YASAK ────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bugünkü native `canData` sözleşmesi bir zaman damgası TAŞIMAZ. Bu yüzden
 * `timestampBasis` **`JS_ARRIVAL`**'dır ve `nativeObservedAtMs` **`null`**
 * kalır. VARIŞ zamanını "native gözlem zamanı" diye sunmak ölçüm uydurmaktır.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * 1) Sözlük
 * ════════════════════════════════════════════════════════════════════════ */

/** Zaman temeli — native gözlem ile JS varışı KARIŞTIRILAMAZ. */
export type CanTimestampBasis = 'NATIVE_OBSERVED' | 'JS_ARRIVAL' | 'UNKNOWN';

/** Çerçeve kaynağı sınıfı — anlam DEĞİL, taşıma sınıfı. */
export type CanFrameSourceClass = 'NATIVE_DECODED_STREAM' | 'UNKNOWN';

export type CanListenerEventClass =
  | 'REGISTERED'
  | 'DUPLICATE_REGISTRATION_BLOCKED'
  | 'FIRST_FRAME'
  | 'STALE_CALLBACK_REJECTED'
  | 'LATE_HANDLE_DISPOSED'
  | 'STATUS'
  | 'DISPOSED';

export type CanDropErrorClass = 'NONE' | 'NO_FRAME_TIMEOUT' | 'TRANSPORT_ABSENT' | 'UNKNOWN';

export interface CanNativeProvenanceRecord {
  readonly seq: number;
  readonly sourceRef: string;
  readonly eventClass: CanListenerEventClass;
  /** Olayın ait olduğu dinleyici nesli; ölçülemediyse `null`. */
  readonly listenerGeneration: number | null;
  /** Kayıt anındaki GEÇERLİ nesil — bayat karşılaştırması için. */
  readonly currentGeneration: number | null;
  readonly timestampBasis: CanTimestampBasis;
  /** Native'in bildirdiği gözlem anı; sözleşme taşımıyorsa `null`. */
  readonly nativeObservedAtMs: number | null;
  /** Taşıma oturumu bağlamı (mod/port sınıfı) — cihaz kimliği DEĞİL. */
  readonly busContext: string | null;
  readonly frameSourceClass: CanFrameSourceClass;
  readonly dropErrorClass: CanDropErrorClass;
  readonly nativeAvailable: boolean | null;
  /** Köprünün ürettiği anlam sayısı — YAPISAL OLARAK 0. */
  readonly semanticInferences: 0;
  readonly provenance: readonly string[];
}

export interface CanNativeProvenanceInput {
  readonly sourceRef: string;
  readonly eventClass: CanListenerEventClass;
  readonly listenerGeneration: number | null;
  readonly currentGeneration: number | null;
  readonly busContext: string | null;
  readonly dropErrorClass?: CanDropErrorClass;
  readonly nativeAvailable: boolean | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2) Saf hüküm
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Geç gelen bir geri çağrının bayat olup olmadığı. Neslin biri ölçülemiyorsa
 * hüküm verilmez (`null`) — sahte "bayat" da sahte "taze" de üretilmez.
 */
export function isStaleCanCallback(
  callbackGeneration: number | null, currentGeneration: number | null,
): boolean | null {
  if (callbackGeneration === null || currentGeneration === null) return null;
  return callbackGeneration !== currentGeneration;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3) Bounded kanıt defteri
 * ════════════════════════════════════════════════════════════════════════ */

const CAPACITY = 32;

const PROVENANCE: readonly string[] = Object.freeze([
  'CanAdapter.start()/stop() listener generation',
  'CarLauncher listener registrations: canData / canStatus',
  'native canData sözleşmesi zaman damgası TAŞIMAZ → JS_ARRIVAL',
]);

let _seq = 0;
let _records: CanNativeProvenanceRecord[] = [];
let _registrations = 0;
let _duplicateBlocked = 0;
let _staleRejected = 0;
let _lateDisposed = 0;
let _frames = 0;

export function recordCanNativeProvenance(
  input: CanNativeProvenanceInput,
): CanNativeProvenanceRecord {
  _seq += 1;
  const record: CanNativeProvenanceRecord = Object.freeze({
    seq: _seq,
    sourceRef: input.sourceRef,
    eventClass: input.eventClass,
    listenerGeneration: input.listenerGeneration,
    currentGeneration: input.currentGeneration,
    /* Native sözleşme zaman damgası taşımadığı için tek dürüst değer budur. */
    timestampBasis: 'JS_ARRIVAL',
    nativeObservedAtMs: null,
    busContext: typeof input.busContext === 'string' && input.busContext.length <= 32
      ? input.busContext : null,
    frameSourceClass: 'NATIVE_DECODED_STREAM',
    dropErrorClass: input.dropErrorClass ?? 'NONE',
    nativeAvailable: input.nativeAvailable,
    semanticInferences: 0,
    provenance: PROVENANCE,
  });
  switch (input.eventClass) {
    case 'REGISTERED': _registrations += 1; break;
    case 'DUPLICATE_REGISTRATION_BLOCKED': _duplicateBlocked += 1; break;
    case 'STALE_CALLBACK_REJECTED': _staleRejected += 1; break;
    case 'LATE_HANDLE_DISPOSED': _lateDisposed += 1; break;
    case 'FIRST_FRAME': _frames += 1; break;
    default: break;
  }
  _records.push(record);
  if (_records.length > CAPACITY) _records.shift();
  return record;
}

export interface CanNativeProvenanceEvidence {
  readonly registrations: number;
  readonly duplicateRegistrationsBlocked: number;
  readonly staleCallbacksRejected: number;
  readonly lateHandlesDisposed: number;
  readonly firstFrames: number;
  /** Köprüde üretilen araç kimliği / ECU rolü / sinyal anlamı — 0. */
  readonly semanticInferences: 0;
  readonly recent: readonly CanNativeProvenanceRecord[];
  readonly provenance: readonly string[];
}

export function getCanNativeProvenanceEvidence(): CanNativeProvenanceEvidence {
  return Object.freeze({
    registrations: _registrations,
    duplicateRegistrationsBlocked: _duplicateBlocked,
    staleCallbacksRejected: _staleRejected,
    lateHandlesDisposed: _lateDisposed,
    firstFrames: _frames,
    semanticInferences: 0,
    recent: Object.freeze([..._records]),
    provenance: PROVENANCE,
  });
}

/** @internal — testler arası izolasyon. */
export function _resetCanNativeProvenanceForTest(): void {
  _seq = 0;
  _records = [];
  _registrations = 0;
  _duplicateBlocked = 0;
  _staleRejected = 0;
  _lateDisposed = 0;
  _frames = 0;
}
