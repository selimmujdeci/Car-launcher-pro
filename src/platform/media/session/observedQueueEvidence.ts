/**
 * observedQueueEvidence.ts — F3.2 · Sağlayıcı/native timeline KANIT PORTU.
 *
 * PAZARLIKSIZ: buraya yazılan sıra, CarOS'un İSTEDİĞİ sıra (DesiredQueue) DEĞİL,
 * sağlayıcının GERÇEKTEN bildirdiği sıradır. DesiredQueue'dan türetilmiş bir
 * "gözlem" üretmek YASAKTIR — bu, uydurma bir senkron iddiası olurdu.
 *
 * Bu modül kanıtı TAŞIR; kanıtı YORUMLAMAZ (hizalama `queueReconciliation`,
 * karar `sessionContinuity` sorumluluğundadır) ve hiçbir komut GÖNDERMEZ.
 */
import type { SourceClass } from '../authority/sourceCapabilities';
import { noteObservedEvidence, noteObservedRejected, noteObservedStaleRead } from './sessionTelemetry';

export type ObservedQueueAvailability = 'AVAILABLE' | 'UNAVAILABLE';
export type ObservedQueueCompleteness = 'FULL' | 'PREFIX' | 'PARTIAL' | 'UNKNOWN';
export type ObservedQueueProvenance = 'NATIVE_MEDIA3' | 'PROVIDER_ADAPTER';

export interface ObservedQueueEvidence {
  /** Kanıtın ait olduğu kaynak — otorite yokken `null` (uydurma kaynak YAZILMAZ). */
  readonly source: SourceClass | null;
  readonly entries: readonly string[];
  readonly currentIndex: number | null;
  readonly revision: number | null;
  readonly observedAtMs: number;
  readonly provenance: ObservedQueueProvenance;
  readonly completeness: ObservedQueueCompleteness;
  readonly availability: ObservedQueueAvailability;
  /** UNAVAILABLE ise NEDEN (sahte "sağlıklı" üretilmez). */
  readonly unavailableReason: string | null;
}

/** Bu yaştan eski kanıt CANLI gözlem sayılmaz (Cross-Domain §13 · §17). */
export const OBSERVED_QUEUE_MAX_AGE_MS = 15_000;
/** Native tarafın da uyguladığı üst sınır — daha büyüğü BOZUK sayılır. */
export const OBSERVED_QUEUE_MAX_ENTRIES = 120;

let evidence: ObservedQueueEvidence | null = null;
const subs = new Set<() => void>();

function notify(): void {
  subs.forEach((fn) => { try { fn(); } catch { /* abone hatası kanıt akışını bozmaz */ } });
}

/**
 * Canlı kanıt yayını. Yalnız native/provider publisher çağırır.
 *
 * Bozuk yük SESSİZCE KABUL EDİLMEZ: reddedilir ve sayaca yazılır — "gözlem yok"
 * ile "gözlem bozuk" ayrı teşhislerdir.
 */
export function publishObservedQueueEvidence(input: ObservedQueueEvidence): boolean {
  if (!Number.isFinite(input.observedAtMs) || input.entries.length > OBSERVED_QUEUE_MAX_ENTRIES) {
    noteObservedRejected();
    return false;
  }
  const currentIndex =
    input.currentIndex !== null
      && Number.isInteger(input.currentIndex)
      && input.currentIndex >= 0
      && input.currentIndex < input.entries.length
      ? input.currentIndex
      : null;

  evidence = Object.freeze({
    ...input,
    currentIndex,
    entries: Object.freeze([...input.entries]),
  });
  noteObservedEvidence(evidence);
  notify();
  return true;
}

/**
 * CANLI kanıt. Bayat / kullanılamaz kanıt `null` döner — son bilinen sıra
 * "şu anki gerçek" gibi SUNULMAZ.
 */
export function getObservedQueueEvidence(nowMs = Date.now()): ObservedQueueEvidence | null {
  if (!evidence || evidence.availability !== 'AVAILABLE') return null;
  if (nowMs - evidence.observedAtMs > OBSERVED_QUEUE_MAX_AGE_MS) {
    noteObservedStaleRead();
    return null;
  }
  return evidence;
}

/** Ham kanıt (bayat/UNAVAILABLE dâhil) — YALNIZ salt-okunur teşhis içindir. */
export function peekObservedQueueEvidence(): ObservedQueueEvidence | null {
  return evidence;
}

/** Kanıt bu ana göre kaç ms önce alındı — kanıt yoksa `null`. */
export function observedQueueAgeMs(nowMs = Date.now()): number | null {
  return evidence ? Math.max(0, nowMs - evidence.observedAtMs) : null;
}

export function subscribeObservedQueueEvidence(listener: () => void): () => void {
  subs.add(listener);
  return () => { subs.delete(listener); };
}

export function _resetObservedQueueEvidenceForTest(): void { evidence = null; subs.clear(); }
