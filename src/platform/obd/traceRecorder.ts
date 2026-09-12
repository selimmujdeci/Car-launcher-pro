/**
 * traceRecorder — P0-VDK-F2A · ÜRÜN YOLLARINDAN KANONİK İZE TEK GİRİŞ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN AYRI DOSYA ──────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `canonicalTrace` SAFTIR (defter + bütünlük). Bu dosya onun tek yan-etkili
 * kabuğudur: **maskelemeyi uygular**, işlem bağlamını toplar ve olayı yazar.
 *
 * Böylece maskeleme TEK yerde olur ve hiçbir çağıran onu unutamaz — bir kanıt
 * yazma noktasının PII sızdırması, ancak maskeleme her çağrı yerinde ELLE
 * tekrarlanırsa mümkündür; burada yapısal olarak imkânsızdır.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── MASKELEME: MEVCUT OTORİTE YENİDEN KULLANILIR ──────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `devtools/obdTrafficMask` ürünün TEK maskeleme otoritesidir (VIN · MAC ·
 * e-posta · UUID · IBAN · kart · telefon · sağlayıcı anahtarı). İkinci bir
 * maskeleme kuralı KURULMAZ — iki yerde tutulan bir gizlilik kuralı, birinin
 * güncellenmeden kalması demektir.
 *
 * ── PII ≠ PROTOKOL PAYLOAD'I ──────────────────────────────────────────────
 * Ham hex geliştiricinin ASIL verisidir ve körlemesine maskelenmez. Yalnız
 * KİMLİK taşıyan yükler gizlenir (Mode 09 PID 02 / VIN yanıtı, ASCII VIN,
 * MAC, anahtar…). Tanı için gerekli protokol baytları KORUNUR — aksi hâlde
 * iz analiz için değersizleşirdi.
 */

import { maskCommonSecrets, maskObdTrafficEntry } from '../devtools/obdTrafficMask';
import {
  recordTraceEvent, getTraceEvents, getDroppedEventCount, getTraceId,
  type RedactionState, type TraceDirection, type TraceEvent,
  type TraceOperation, type TraceTransport,
} from './canonicalTrace';
import {
  buildTracePackage, buildTracePackageFileName, type ExportResult,
} from './traceExport';
import type { DiagnosticTransaction } from './diagnosticTransaction';

/** Çağıranın verdiği ölçümler — hiçbiri uydurulmaz, ölçülmediyse `null`. */
export interface TraceRecordInput {
  readonly operation: TraceOperation;
  readonly direction?: TraceDirection;
  readonly subFunction?: string | null;
  readonly rawRequest?: string | null;
  readonly rawResponse?: string | null;
  readonly transportOutcome?: string | null;
  readonly nrc?: number | null;
  readonly latencyMs?: number | null;
  readonly byteCount?: number | null;
  readonly frameCount?: number | null;
  readonly ecuTxHeader?: string | null;
  readonly ecuRxHeader?: string | null;
  readonly ecuLabel?: string | null;
  readonly protocol?: string | null;
  readonly transport?: TraceTransport;
  readonly sessionEpoch?: number | null;
  readonly sessionLeaseRef?: string | null;
  readonly adapterKind?: string | null;
  readonly isoTpTuningRef?: string | null;
}

/**
 * Maskeler ve maskeleme DURUMUNU ölçer.
 *
 * `NOT_APPLIED` yalnız girdi hiç işlenmediğinde oluşur — bu fonksiyondan
 * geçen her şey en az `CLEAN` olur. Export fail-closed kapısı `NOT_APPLIED`
 * gördüğünde dışa aktarmayı REDDEDER, yani maskelemeyi atlayan bir yol
 * eklenirse export ANINDA bloklanır (sessiz sızıntı imkânsız).
 */
function _mask(
  rawRequest: string | null, rawResponse: string | null,
): { req: string | null; resp: string | null; state: RedactionState } {
  if (rawRequest === null && rawResponse === null) {
    /* Ölçüm YOK — maskelenecek bir şey de yok. Bu bir sızıntı riski
       DEĞİLDİR ve export'u bloklamamalıdır. */
    return { req: null, resp: null, state: 'CLEAN' };
  }
  const masked = maskObdTrafficEntry(rawRequest ?? '', rawResponse ?? '');
  const req = rawRequest === null ? null : maskCommonSecrets(masked.cmd);
  const resp = rawResponse === null ? null : maskCommonSecrets(masked.resp);
  const changed = (rawRequest !== null && req !== rawRequest)
    || (rawResponse !== null && resp !== rawResponse);
  return { req, resp, state: changed ? 'REDACTED' : 'CLEAN' };
}

/**
 * Kanonik ize olay yazar. ASLA throw etmez.
 *
 * İşlem bağlamı (`transactionId` · `evidenceCorrelationId` · `sessionEpoch` ·
 * `protocol`) F1-A `DiagnosticTransaction`tan alınır — ikinci bir korelasyon
 * otoritesi KURULMAZ. İşlem yoksa alanlar `null` kalır (uydurma YOK).
 */
export function traceFromTransaction(
  txn: DiagnosticTransaction | null,
  input: TraceRecordInput,
): TraceEvent | null {
  const { req, resp, state } = _mask(input.rawRequest ?? null, input.rawResponse ?? null);
  return recordTraceEvent({
    transactionId: txn?.transactionId ?? null,
    evidenceCorrelationId: txn?.evidenceCorrelationId ?? null,
    sessionEpoch: input.sessionEpoch ?? txn?.sessionEpoch ?? null,
    ecuTxHeader: input.ecuTxHeader ?? null,
    ecuRxHeader: input.ecuRxHeader ?? null,
    ecuLabel: input.ecuLabel ?? null,
    protocol: input.protocol ?? txn?.protocol ?? null,
    transport: input.transport ?? 'unknown',
    direction: input.direction ?? 'request_response',
    operation: input.operation,
    subFunction: input.subFunction ?? null,
    rawRequest: req,
    rawResponse: resp,
    transportOutcome: input.transportOutcome ?? null,
    nrc: input.nrc ?? null,
    latencyMs: input.latencyMs ?? null,
    byteCount: input.byteCount ?? null,
    frameCount: input.frameCount ?? null,
    sessionLeaseRef: input.sessionLeaseRef ?? null,
    adapterKind: input.adapterKind ?? null,
    isoTpTuningRef: input.isoTpTuningRef ?? null,
    redactionState: state,
  });
}

/** İşlem sınırı olayı — kronolojinin başı/sonu tek bakışta görünür. */
export function traceTransactionBoundary(
  txn: DiagnosticTransaction, phase: 'begin' | 'end',
): TraceEvent | null {
  return traceFromTransaction(txn, {
    operation: 'transaction_boundary',
    direction: 'observation',
    subFunction: phase,
    transportOutcome: phase === 'end' ? txn.state : null,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   P0-VDK-F2C2 · SAHA YAKALAMA — izi cihazdan DIŞARI alınabilir hâle getirir
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bu süreçteki kanonik izden taşınabilir paket üretir.
 *
 * ── NEDEN GEREKLİ ─────────────────────────────────────────────────────────
 * F2-A paket biçimini, F2-B replay'i, F2-C1 kanonik çözümleyiciyi getirdi —
 * ama `buildTracePackage` ÜRÜN YOLUNDA HİÇBİR YERDEN ÇAĞRILMIYORDU. Yani
 * gerçek araçta üretilen iz cihazın içinde KALIYORDU ve masada oynatılamıyordu.
 * Saha doğrulamasının önündeki fiili engel buydu.
 *
 * Bu fonksiyon defter okur (saf DEĞİL) ama I/O YAPMAZ: dosyaya yazma/paylaşma
 * çağıranın işidir (`RawObdTrafficScreen` ile AYNI desen). Maskeleme zaten
 * yazım anında `traceFromTransaction` içinde uygulanmıştır; export kapısı
 * maskelenmemiş tek olay görürse paketi REDDEDER (fail-closed).
 *
 * @param generatedAtWallMs duvar saati damgası; ölçülemiyorsa `null` geçin —
 *        sahte tarih YAZILMAZ.
 */
export function buildCurrentTracePackage(
  generatedAtWallMs: number | null,
): ExportResult {
  return buildTracePackage(
    getTraceEvents(), getDroppedEventCount(), getTraceId(), generatedAtWallMs,
  );
}

/** Paket dosya adı — `rawTrafficExport` deseniyle tutarlı. */
export function currentTracePackageFileName(wallMs: number | null): string {
  return buildTracePackageFileName(wallMs);
}
