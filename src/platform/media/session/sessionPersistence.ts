/**
 * sessionPersistence.ts — F3 · Dinleme bağlamının kalıcılık dikişi (recovery seam).
 *
 * BU FAZ IGNITION RECOVERY'Yİ YENİDEN TASARLAMAZ. Yaptığı tek şey, oturum ve
 * istenen kuyruğun süreç ölümünden sonra GERİ YÜKLENEBİLİR biçimde modellenmesidir.
 *
 * PAZARLIKSIZ: **Persisted session ≠ şu an çalıyor.** Geri yükleme hiçbir koşulda
 * `PLAYING` üretmez; oynatma gerçeği yine native kanıt ister (F0 `playbackTruth`).
 * Bu yüzden kayıtta "playing" alanı YOKTUR — olmayan bir alan yanlış okunamaz.
 */

import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../../utils/safeStorage';
import { isKnownSourceClass, type SourceClass } from '../authority/sourceCapabilities';
import type { QueueEntry } from './playQueue';
import type { ListeningIntent } from './listeningSession';
import type { CanonicalMediaIdentity } from './mediaIdentityMatching';

export const SESSION_STATE_KEY = 'caros_listening_session';
export const SESSION_SCHEMA = 1;
/** Diske yazılan en fazla kuyruk girdisi (CLAUDE.md §3 — büyük blob yazımı yasak). */
export const MAX_PERSISTED_ENTRIES = 60;
/** Bu süreden eski bağlam geri YÜKLENMEZ. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const INTENTS: readonly ListeningIntent[] = [
  'TRACKS', 'ALBUM', 'ARTIST', 'FOLDER', 'PLAYLIST', 'RADIO', 'EXTERNAL_UNKNOWN',
];

export interface PersistedListeningSession {
  readonly schema: 1;
  readonly sessionId: string;
  readonly intent: ListeningIntent;
  readonly intentRef: string | null;
  readonly originSource: SourceClass;
  readonly currentSource: SourceClass;
  readonly queueId: string;
  readonly queueRevision: number;
  readonly entries: readonly QueueEntry[];
  readonly currentIndex: number;
  readonly startedAt: number;
  readonly savedAtMs: number;
  readonly ignitionRef: string | null;
}

export type RestoreRejection =
  | 'absent' | 'corrupt' | 'schema_mismatch' | 'expired' | 'unknown_source' | 'empty_queue';

export interface RestoreResult {
  readonly restored: PersistedListeningSession | null;
  readonly rejection: RestoreRejection | null;
  readonly reason: string;
  /**
   * Sabit `NONE`. Kalıcı kayıt asla bir oynatma iddiası taşımaz — bu alan o
   * sözleşmeyi kodda görünür kılar ve testle kilitlenir.
   */
  readonly playbackClaim: 'NONE';
}

const isEntry = (v: unknown): v is QueueEntry => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const item = o.item as Record<string, unknown> | undefined;
  return typeof o.entryId === 'string' && o.entryId.length > 0
    && !!item && typeof item.id === 'string' && typeof item.uri === 'string'
    && (o.origin === 'LIBRARY' || o.origin === 'PROVIDER' || o.origin === 'RECOVERED')
    && !!o.identity && typeof o.identity === 'object';
};

const clamp = (entries: readonly QueueEntry[], index: number): { entries: QueueEntry[]; index: number } => {
  if (entries.length <= MAX_PERSISTED_ENTRIES) return { entries: [...entries], index };
  const half = Math.floor(MAX_PERSISTED_ENTRIES / 2);
  const start = Math.min(Math.max(0, index - half), entries.length - MAX_PERSISTED_ENTRIES);
  return { entries: entries.slice(start, start + MAX_PERSISTED_ENTRIES), index: index - start };
};

export interface PersistSessionInput {
  readonly sessionId: string;
  readonly intent: ListeningIntent;
  readonly intentRef: string | null;
  readonly originSource: SourceClass;
  readonly currentSource: SourceClass;
  readonly queueId: string;
  readonly queueRevision: number;
  readonly entries: readonly QueueEntry[];
  readonly currentIndex: number;
  readonly startedAt: number;
  readonly ignitionRef: string | null;
  readonly nowMs: number;
}

/** Fail-soft: yazım hatası bağlam kaybına mal olur, doğruluğa DEĞİL. */
export function persistListeningSession(input: PersistSessionInput): boolean {
  try {
    if (!isKnownSourceClass(input.currentSource) || !isKnownSourceClass(input.originSource)) return false;
    if (input.entries.length === 0) return false;
    const { entries, index } = clamp(input.entries, Math.max(0, input.currentIndex));
    const payload: PersistedListeningSession = {
      schema: SESSION_SCHEMA,
      sessionId: input.sessionId,
      intent: input.intent,
      intentRef: input.intentRef,
      originSource: input.originSource,
      currentSource: input.currentSource,
      queueId: input.queueId,
      queueRevision: input.queueRevision,
      entries,
      currentIndex: Math.max(0, Math.min(index, entries.length - 1)),
      startedAt: input.startedAt,
      savedAtMs: input.nowMs,
      ignitionRef: input.ignitionRef,
    };
    safeSetRaw(SESSION_STATE_KEY, JSON.stringify(payload));
    return true;
  } catch { return false; }
}

export function readPersistedListeningSessionRaw(): string | null {
  try { return safeGetRaw(SESSION_STATE_KEY); } catch { return null; }
}

export function clearPersistedListeningSession(): void {
  try { safeRemoveRaw(SESSION_STATE_KEY); } catch { /* fail-soft */ }
}

const rejected = (rejection: RestoreRejection, reason: string): RestoreResult =>
  Object.freeze({ restored: null, rejection, reason, playbackClaim: 'NONE' as const });

/**
 * Saf çözümleyici — zaman parametreyle girer. Bozuk, yabancı şemalı veya süresi
 * geçmiş kayıt BÜTÜN olarak reddedilir; yarısına güvenilmez.
 */
export function parsePersistedListeningSession(raw: string | null, nowMs: number): RestoreResult {
  if (!raw) return rejected('absent', 'Kayıtlı dinleme bağlamı yok.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return rejected('corrupt', 'Kayıt okunamadı (bozuk JSON).'); }
  if (!parsed || typeof parsed !== 'object') return rejected('corrupt', 'Kayıt beklenen biçimde değil.');

  const o = parsed as Record<string, unknown>;
  if (o.schema !== SESSION_SCHEMA) return rejected('schema_mismatch', 'Yabancı şema — kayıt kullanılmadı.');
  if (typeof o.sessionId !== 'string' || typeof o.queueId !== 'string') return rejected('corrupt', 'Kimlik alanları eksik.');
  if (!INTENTS.includes(o.intent as ListeningIntent)) return rejected('corrupt', 'Bilinmeyen dinleme niyeti.');
  if (!isKnownSourceClass(o.currentSource) || !isKnownSourceClass(o.originSource)) {
    return rejected('unknown_source', 'Bilinmeyen kaynak sınıfı.');
  }
  if (typeof o.savedAtMs !== 'number' || !Number.isFinite(o.savedAtMs)) return rejected('corrupt', 'Kayıt zamanı yok.');
  if (nowMs - o.savedAtMs > SESSION_TTL_MS) return rejected('expired', 'Kayıt süresi geçmiş — geri yüklenmedi.');
  if (!Array.isArray(o.entries)) return rejected('corrupt', 'Kuyruk girdileri okunamadı.');

  const entries = (o.entries as unknown[]).filter(isEntry);
  if (entries.length === 0) return rejected('empty_queue', 'Geri yüklenecek geçerli kuyruk girdisi yok.');

  const rawIndex = typeof o.currentIndex === 'number' ? o.currentIndex : 0;
  return Object.freeze({
    restored: Object.freeze({
      schema: SESSION_SCHEMA,
      sessionId: o.sessionId,
      intent: o.intent as ListeningIntent,
      intentRef: typeof o.intentRef === 'string' ? o.intentRef : null,
      originSource: o.originSource,
      currentSource: o.currentSource,
      queueId: o.queueId,
      queueRevision: typeof o.queueRevision === 'number' ? o.queueRevision : 0,
      entries: Object.freeze(entries),
      currentIndex: Math.max(0, Math.min(Math.trunc(rawIndex), entries.length - 1)),
      startedAt: typeof o.startedAt === 'number' ? o.startedAt : o.savedAtMs,
      savedAtMs: o.savedAtMs,
      ignitionRef: typeof o.ignitionRef === 'string' ? o.ignitionRef : null,
    }),
    rejection: null,
    reason: entries.length === (o.entries as unknown[]).length
      ? 'Bağlam geri yüklenebilir — ÇALDIĞI ANLAMINA GELMEZ.'
      : 'Bağlam kısmen geri yüklenebilir; biçimsiz girdiler atıldı.',
    playbackClaim: 'NONE' as const,
  });
}

/** Kimlik alanı okunamayan kayıtlar için güvenli kimlik üreteci (uydurma YOK). */
export function identityOfEntry(entry: QueueEntry): CanonicalMediaIdentity {
  return entry.identity;
}
