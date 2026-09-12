/**
 * sessionProjection.ts — F3 · UI dikişi (SALT-OKUNUR projeksiyon).
 *
 * F1 MiniPlayer/NowPlaying yeniden TASARLANMAZ. Bu modül yalnız dört şeyi
 * okunabilir kılar: kuyruk konumu · kuyruk kullanılabilirliği · süreklilik durumu ·
 * kuyruk uzlaştırma durumu. Kuyruk ekranının UX'i sonraki yüzey fazına aittir.
 *
 * UI bir PROJEKSİYONDUR (Cross-Domain §14): buradan hiçbir truth YAZILMAZ.
 */

import { useSyncExternalStore } from 'react';
import {
  alignDesiredObserved, QUEUE_ALIGNMENT_LABEL,
  type QueueAlignment, type QueueAlignmentResult,
} from '../authority/queueReconciliation';
import type { SourceClass } from '../authority/sourceCapabilities';
import {
  CONTINUITY_LABEL, type ContinuityState,
} from './sessionContinuity';
import {
  getListeningSession, subscribeListeningSession,
  LISTENING_INTENT_LABEL, type ListeningIntent, type ListeningSession,
} from './listeningSession';
import { getDesiredQueue, subscribeDesiredQueue, type DesiredQueue } from './playQueue';
import { sourceSupportsQueue } from './listeningSessionRuntime';
import { getObservedQueueEvidence, subscribeObservedQueueEvidence } from './observedQueueEvidence';
import { noteAlignment } from './sessionTelemetry';

/** Native'in bildirdiği geçerli öğe ile istenen öğe uyuşuyor mu. */
export type CurrentItemAgreement = 'AGREE' | 'DISAGREE' | 'UNKNOWN';

export interface ListeningProjection {
  readonly hasSession: boolean;
  readonly intent: ListeningIntent | null;
  readonly intentLabel: string;
  readonly intentRef: string | null;
  readonly originSource: SourceClass | null;
  readonly currentSource: SourceClass | null;
  /** 1 tabanlı konum — yalnız gösterim içindir. */
  readonly queuePosition: Readonly<{ index: number; length: number }> | null;
  /** Kaynak çok öğeli kuyruk semantiğini destekliyor mu. */
  readonly queueAvailable: boolean;
  /** Kuyruk düzenleme (ekle/çıkar/sırala) bu kaynakta MEŞRU mu. */
  readonly queueEditable: boolean;
  readonly continuity: ContinuityState;
  readonly continuityLabel: string;
  readonly alignment: QueueAlignment;
  readonly alignmentLabel: string;
  readonly alignmentReason: string;
  /** İstenen sıra sağlayıcıya uygulanmış SAYILABİLİR mi. */
  readonly desiredApplied: boolean;
  readonly currentItemAgreement: CurrentItemAgreement;
  /** Kalıcı kayıttan geldi mi — "çalıyor" ANLAMINA GELMEZ. */
  readonly restored: boolean;
}

export const EMPTY_LISTENING_PROJECTION: ListeningProjection = Object.freeze({
  hasSession: false, intent: null, intentLabel: '—', intentRef: null,
  originSource: null, currentSource: null, queuePosition: null,
  queueAvailable: false, queueEditable: false,
  continuity: 'UNKNOWN', continuityLabel: CONTINUITY_LABEL.UNKNOWN,
  alignment: 'UNKNOWN', alignmentLabel: QUEUE_ALIGNMENT_LABEL.UNKNOWN,
  alignmentReason: 'Dinleme bağlamı yok.', desiredApplied: false,
  currentItemAgreement: 'UNKNOWN', restored: false,
});

export interface ProjectionInput {
  readonly session: ListeningSession | null;
  readonly queue: DesiredQueue;
  readonly supportsQueue: boolean;
  /**
   * Sağlayıcının GERÇEKTEN bildirdiği sıra. Bugün hiçbir backend öğe listesini
   * dışarı vermediği için üretimde `null`'dır ve sonuç dürüstçe `UNKNOWN` olur —
   * "bizim gönderdiğimiz pencere" gözlem yerine KOYULMAZ.
   */
  readonly observedItemIds: readonly string[] | null;
  /** Native'in bildirdiği geçerli öğe kimliği (varsa). */
  readonly observedCurrentItemId: string | null;
}

/** Saf projeksiyon — I/O, timer ve global durum okumadan test edilebilir. */
export function buildListeningProjection(input: ProjectionInput): ListeningProjection {
  const { session, queue, supportsQueue, observedItemIds, observedCurrentItemId } = input;
  if (!session) return EMPTY_LISTENING_PROJECTION;

  const desiredIds = queue.entries.map((e) => e.item.id);
  const alignmentResult: QueueAlignmentResult =
    alignDesiredObserved(desiredIds, observedItemIds, supportsQueue);

  const desiredCurrentId = queue.currentIndex >= 0
    ? queue.entries[queue.currentIndex]?.item.id ?? null : null;
  const agreement: CurrentItemAgreement =
    observedCurrentItemId === null || desiredCurrentId === null ? 'UNKNOWN'
      : observedCurrentItemId === desiredCurrentId ? 'AGREE' : 'DISAGREE';

  return Object.freeze({
    hasSession: true,
    intent: session.intent,
    intentLabel: LISTENING_INTENT_LABEL[session.intent],
    intentRef: session.intentRef,
    originSource: session.originSource,
    currentSource: session.currentSource,
    queuePosition: queue.entries.length > 0 && queue.currentIndex >= 0
      ? Object.freeze({ index: queue.currentIndex + 1, length: queue.entries.length })
      : null,
    queueAvailable: queue.entries.length > 0,
    queueEditable: supportsQueue,
    continuity: session.continuity,
    continuityLabel: CONTINUITY_LABEL[session.continuity],
    alignment: alignmentResult.alignment,
    alignmentLabel: QUEUE_ALIGNMENT_LABEL[alignmentResult.alignment],
    alignmentReason: alignmentResult.reason,
    desiredApplied: alignmentResult.desiredApplied,
    currentItemAgreement: agreement,
    restored: session.restored,
  });
}

let cache: { key: string; value: ListeningProjection } | null = null;

/**
 * Canlı projeksiyon. Gözlenen öğe kimliği native anlık görüntüsünden okunur;
 * sağlayıcı öğe listesi bugün DIŞARI VERİLMEDİĞİ için hizalama dürüstçe
 * `UNKNOWN` kalır (uydurma "senkron" iddiası üretilmez).
 */
export function getListeningProjection(observedCurrentItemId: string | null = null): ListeningProjection {
  const session = getListeningSession();
  const queue = getDesiredQueue();
  const observed = getObservedQueueEvidence();
  const supportsQueue = sourceSupportsQueue(queue.source ?? session?.currentSource ?? null);
  const key = [
    session?.sessionId ?? '', session?.continuity ?? '', session?.currentSource ?? '',
    session?.restored ? 1 : 0, queue.queueId, queue.revision, queue.currentIndex,
    queue.entries.length, supportsQueue ? 1 : 0, observedCurrentItemId ?? '', observed?.revision ?? '', observed?.observedAtMs ?? '',
  ].join('|');
  if (cache?.key === key) return cache.value;
  const value = buildListeningProjection({
    session, queue, supportsQueue, observedItemIds: observed?.entries ?? null,
    observedCurrentItemId: observedCurrentItemId ?? (observed?.currentIndex !== null && observed ? observed.entries[observed.currentIndex] ?? null : null),
  });
  cache = { key, value };
  // Yalnız kanıt yazımı: LAB burada hesaplanan hiçbir değeri karara geri beslemez.
  if (session) noteAlignment(value.alignment);
  return value;
}

function subscribeBoth(listener: () => void): () => void {
  const stopSession = subscribeListeningSession(listener);
  const stopQueue = subscribeDesiredQueue(listener);
  const stopObserved = subscribeObservedQueueEvidence(listener);
  return () => { stopSession(); stopQueue(); stopObserved(); };
}

const snapshot = () => getListeningProjection(null);

/** F1 yüzeylerinin okuyabileceği salt-okunur kanca. Truth YAZMAZ. */
export function useListeningProjection(): ListeningProjection {
  return useSyncExternalStore(subscribeBoth, snapshot, snapshot);
}

export function _resetProjectionCacheForTest(): void { cache = null; }
