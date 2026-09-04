/**
 * listeningSession.ts — F3 · Canonical dinleme bağlamı otoritesi.
 *
 * ÜRÜN KARARI: **ListeningSession = kullanıcının dinleme niyeti.**
 * Source/provider yalnız o niyeti taşıyan araçtır ve oturumun SAHİBİ DEĞİLDİR:
 * araç değişince (USB çıktı, ağ gitti) oturum ölmez, `continuity` alanı değişir.
 *
 * PAZARLIKSIZ SINIRLAR:
 *   · Bu modül playback truth YAYIMLAMAZ. "Çalıyor mu?" sorusunun cevabı burada
 *     YOKTUR — `CarosPlaybackService` / `playbackTruth` otoritedir.
 *   · Ses üretmez, native köprüyü çağırmaz, komut göndermez.
 *   · Intent UYDURULMAZ: çağıran hangi niyetle başlattığını BİLDİRİR. Gözlenemeyen
 *     kaynakta (Bluetooth/harici oturum) `EXTERNAL_UNKNOWN` meşru ve dürüst cevaptır.
 */

import type { SourceClass } from '../authority/sourceCapabilities';
import type { CanonicalMediaIdentity } from './mediaIdentityMatching';
import type { ContinuityState } from './sessionContinuity';

export type ListeningIntent =
  | 'TRACKS'
  | 'ALBUM'
  | 'ARTIST'
  | 'FOLDER'
  | 'PLAYLIST'
  | 'RADIO'
  | 'EXTERNAL_UNKNOWN';

export const LISTENING_INTENT_LABEL: Readonly<Record<ListeningIntent, string>> = {
  TRACKS: 'PARÇALAR',
  ALBUM: 'ALBÜM',
  ARTIST: 'SANATÇI',
  FOLDER: 'KLASÖR',
  PLAYLIST: 'ÇALMA LİSTESİ',
  RADIO: 'RADYO',
  EXTERNAL_UNKNOWN: 'DIŞ KAYNAK — BİLİNMİYOR',
} as const;

export interface ListeningSession {
  readonly sessionId: string;
  readonly intent: ListeningIntent;
  /** Niyetin dayandığı kanıt (albüm/sanatçı/klasör kimliği) — uydurulmaz, `null` olabilir. */
  readonly intentRef: string | null;
  /** Oturumun BAŞLADIĞI kaynak — sonradan değişse bile korunur. */
  readonly originSource: SourceClass;
  /** Niyeti ŞU AN taşıyan kaynak. */
  readonly currentSource: SourceClass;
  readonly queueId: string;
  readonly queueRevision: number;
  readonly currentItem: CanonicalMediaIdentity | null;
  readonly continuity: ContinuityState;
  readonly startedAt: number;
  /** Son GÖZLENEN etkinlik — "çalıyor" iddiası DEĞİL, yalnız son kanıt anı. */
  readonly lastObservedActivityAt: number;
  /** Kontak/oturum kanıtı varsa referansı; yoksa `null` (uydurulmaz). */
  readonly ignitionRef: string | null;
  /** Kalıcı kayıttan geri yüklendiyse true — "çalıyor" ANLAMINA GELMEZ. */
  readonly restored: boolean;
}

let session: ListeningSession | null = null;
let seq = 0;
const subs = new Set<() => void>();

const notify = (): void => { subs.forEach((fn) => fn()); };
const commit = (next: ListeningSession | null): ListeningSession | null => {
  session = next ? Object.freeze(next) : null;
  notify();
  return session;
};

export interface StartSessionInput {
  readonly intent: ListeningIntent;
  readonly intentRef?: string | null;
  readonly source: SourceClass;
  readonly queueId: string;
  readonly queueRevision: number;
  readonly currentItem?: CanonicalMediaIdentity | null;
  readonly ignitionRef?: string | null;
  readonly nowMs: number;
  readonly restored?: boolean;
}

/** Yeni dinleme bağlamı başlatır. Zaman DIŞARIDAN gelir (saf test edilebilirlik). */
export function startListeningSession(input: StartSessionInput): ListeningSession {
  seq += 1;
  return commit({
    sessionId: `listening-${seq}`,
    intent: input.intent,
    intentRef: input.intentRef ?? null,
    originSource: input.source,
    currentSource: input.source,
    queueId: input.queueId,
    queueRevision: input.queueRevision,
    currentItem: input.currentItem ?? null,
    // Yeni oturumda taşınacak bir şey yoktur; bağlam olduğu gibi duruyor.
    continuity: 'INTACT',
    startedAt: input.nowMs,
    lastObservedActivityAt: input.nowMs,
    ignitionRef: input.ignitionRef ?? null,
    restored: input.restored === true,
  })!;
}

export function getListeningSession(): ListeningSession | null { return session; }
export function subscribeListeningSession(listener: () => void): () => void {
  subs.add(listener); return () => subs.delete(listener);
}

/**
 * Kaynak değişti. **Oturum ÖLMEZ** — yalnız taşıyıcı araç ve süreklilik durumu
 * güncellenir. Süreklilik kararı `sessionContinuity` tarafından ÜRETİLİR; burada
 * hesaplanmaz (ikinci gerçek üretilmez).
 */
export function noteSourceChange(
  source: SourceClass, continuity: ContinuityState, nowMs: number,
): ListeningSession | null {
  if (!session) return null;
  if (session.currentSource === source && session.continuity === continuity) return session;
  return commit({ ...session, currentSource: source, continuity, lastObservedActivityAt: nowMs });
}

/** Kuyruk kimliği/revizyonu ilerledi. */
export function noteQueueRevision(queueId: string, queueRevision: number, nowMs: number): ListeningSession | null {
  if (!session) return null;
  if (session.queueId === queueId && session.queueRevision === queueRevision) return session;
  return commit({ ...session, queueId, queueRevision, lastObservedActivityAt: nowMs });
}

/** GÖZLENEN geçerli öğe değişti. Bu bir çalma iddiası DEĞİLDİR. */
export function noteCurrentItem(item: CanonicalMediaIdentity | null, nowMs: number): ListeningSession | null {
  if (!session) return null;
  return commit({ ...session, currentItem: item, lastObservedActivityAt: nowMs });
}

export function noteActivity(nowMs: number): ListeningSession | null {
  if (!session) return null;
  return commit({ ...session, lastObservedActivityAt: nowMs });
}

/** Süreklilik durumunu doğrudan yazar (kurtarma / yeniden doğrulama sonrası). */
export function noteContinuity(continuity: ContinuityState, nowMs: number): ListeningSession | null {
  if (!session) return null;
  if (session.continuity === continuity) return session;
  return commit({ ...session, continuity, lastObservedActivityAt: nowMs });
}

/** Dinleme bağlamı bilinçli olarak sonlandırıldı (kullanıcı durdurdu / temizledi). */
export function endListeningSession(): void { commit(null); }

export function _resetListeningSessionForTest(): void {
  session = null; seq = 0; subs.clear();
}
