/**
 * observedQueueDerivation.ts — F3.2 · Native anlık görüntüden KANIT türetme (SAF).
 *
 * NEDEN AYRI MODÜL: "gözlenen kuyruk" iddiası, üretim akışının ortasında
 * gömülü bir `if` olamaz — test edilebilir ve tek yerde okunabilir olmalıdır.
 *
 * PAZARLIKSIZ KURALLAR:
 *   1. DesiredQueue'dan gözlem TÜRETİLMEZ. Girdi YALNIZ native/provider yüküdür.
 *   2. Otorite yoksa, kaynak tanınmıyorsa, sağlayıcı çok öğeli kuyruk semantiğini
 *      DESTEKLEMİYORSA veya timeline hiç bildirilmediyse sonuç UNAVAILABLE'dır —
 *      "boş kuyruk" ile "kuyruk görünmüyor" AYNI ŞEY DEĞİLDİR.
 *   3. Native pencere yazımı `PREFIX` olarak işaretlenir; kısaltılmış bir liste
 *      `FULL` diye SUNULMAZ.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR;
 * zaman DIŞARIDAN verilir.
 */
import { getSource, isKnownSourceClass, type SourceClass } from '../authority/sourceCapabilities';
import {
  OBSERVED_QUEUE_MAX_ENTRIES,
  type ObservedQueueEvidence, type ObservedQueueProvenance,
} from './observedQueueEvidence';

export interface NativeTimelineInput {
  readonly authorityAvailable: boolean;
  /** Native'in bildirdiği kaynak adı — tanınmayan değer UNAVAILABLE üretir. */
  readonly activeSource: string;
  /** Media3 timeline'ındaki mediaId dizisi; `undefined` = HİÇ bildirilmedi. */
  readonly queueEntryIds: readonly string[] | undefined;
  /** Timeline'ın GERÇEK uzunluğu (pencere kısaltmasını görünür kılar). */
  readonly queueLength: number | undefined;
  readonly currentIndex: number | undefined;
  readonly queueRevision: number | undefined;
  readonly nowMs: number;
  readonly provenance?: ObservedQueueProvenance;
}

const unavailable = (
  source: SourceClass | null, nowMs: number, reason: string,
  provenance: ObservedQueueProvenance,
): ObservedQueueEvidence => Object.freeze({
  source,
  entries: Object.freeze([] as readonly string[]),
  currentIndex: null,
  revision: null,
  observedAtMs: nowMs,
  provenance,
  completeness: 'UNKNOWN' as const,
  availability: 'UNAVAILABLE' as const,
  unavailableReason: reason,
});

/** Bu kaynak GERÇEK bir çok öğeli timeline sunabiliyor mu (yetenek kaydından). */
export function sourceCanReportTimeline(source: SourceClass): boolean {
  try { return getSource(source).capabilities.supportsQueue === true; } catch { return false; }
}

/**
 * Native yükünden kanıt üretir. HER ZAMAN bir kanıt döner: gözlem yoksa
 * UNAVAILABLE + gerekçe. `null` DÖNMEZ — "yayın yapmamak" bir gözlem değildir
 * ve eski kanıdın bayatlamasına terk edilmesi teşhisi zorlaştırır.
 */
export function deriveObservedQueueEvidence(input: NativeTimelineInput): ObservedQueueEvidence {
  const provenance: ObservedQueueProvenance = input.provenance ?? 'NATIVE_MEDIA3';
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : 0;

  if (!input.authorityAvailable) {
    return unavailable(null, nowMs, 'authority_unavailable', provenance);
  }
  if (!isKnownSourceClass(input.activeSource)) {
    return unavailable(null, nowMs, 'unknown_source_class', provenance);
  }
  const source = input.activeSource;
  if (!sourceCanReportTimeline(source)) {
    // Sağlayıcı kuyruk semantiğini hiç desteklemiyor: DESTEK VARMIŞ GİBİ davranmayız.
    return unavailable(source, nowMs, 'source_reports_no_timeline', provenance);
  }
  if (!Array.isArray(input.queueEntryIds)) {
    return unavailable(source, nowMs, 'timeline_not_reported', provenance);
  }

  const raw = input.queueEntryIds;
  if (raw.length > OBSERVED_QUEUE_MAX_ENTRIES) {
    return unavailable(source, nowMs, 'timeline_overflow', provenance);
  }
  // Kimliksiz öğe bir gözlem taşımaz; kısmi liste FULL sayılamaz.
  const entries = raw.filter((id): id is string => typeof id === 'string' && id.length > 0);
  const idsLost = entries.length !== raw.length;

  const reportedLength = Number.isInteger(input.queueLength) ? (input.queueLength as number) : null;
  const completeness =
    idsLost ? 'PARTIAL'
      : reportedLength !== null && reportedLength > entries.length ? 'PREFIX'
        : reportedLength !== null && reportedLength === entries.length ? 'FULL'
          : 'UNKNOWN';

  const currentIndex =
    Number.isInteger(input.currentIndex)
      && (input.currentIndex as number) >= 0
      && (input.currentIndex as number) < entries.length
      ? (input.currentIndex as number)
      : null;

  return Object.freeze({
    source,
    entries: Object.freeze(entries),
    currentIndex,
    revision: Number.isFinite(input.queueRevision) ? (input.queueRevision as number) : null,
    observedAtMs: nowMs,
    provenance,
    completeness,
    // Boş timeline GERÇEK bir gözlemdir ("kuyruk boşaldı"); görünmezlik DEĞİLDİR.
    availability: 'AVAILABLE' as const,
    unavailableReason: null,
  });
}
