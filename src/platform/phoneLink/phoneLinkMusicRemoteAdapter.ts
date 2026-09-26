/**
 * phoneLinkMusicRemoteAdapter.ts — PHONE LINK F1 · Music Remote Command Adapter.
 *
 * İNCE ADAPTÖR — yeni bir playback sistemi YAZMAZ. Her komut:
 *
 *   Guest Session → Capability validation → BU ADAPTÖR → mediaCommandGateway
 *
 * yolunu izler. Doğrudan backend/player çağrısı YOKTUR; yalnız kanonik
 * `mediaCommandGateway.{play,pause,next,previous}` ve salt-okunur kanonik
 * projeksiyonlar (`musicCanonicalSnapshot`, `musicIndex`) okunur/çağrılır.
 *
 * Bu turda desteklenmeyen (ZORUNLU değil): arama, queue mutation, volume,
 * artwork binary transfer.
 */

import {
  authorizeGuestMediaCommand, canExecuteGuestMediaCommand,
  isGuestMediaDispatchStillLive, type PhoneLinkSessionRef,
} from './phoneLinkCapabilityGrant';
import * as mediaCommandGateway from '../media/authority/mediaCommandGateway';
import { getMusicCanonicalSnapshot } from '../media/authority/musicCanonicalSnapshot';
import { getMusicLibrarySnapshot } from '../media/musicIndex';
import type { CommandTruth } from '../media/authority/playbackTruth';

export type PhoneLinkMusicCommand =
  | 'GET_NOW_PLAYING' | 'PLAY' | 'PAUSE' | 'NEXT' | 'PREVIOUS' | 'GET_QUEUE';

export type PhoneLinkCommandDenialCode = 'NOT_ATTACHED' | 'NO_GRANT' | 'STALE';

export type { PhoneLinkSessionRef };

export interface PhoneLinkNowPlaying {
  readonly trackId: string | null;
  readonly title: string | null;
  readonly artist: string | null;
  readonly album: string | null;
  readonly artworkIdentity: string | null;
  readonly durationMs: number | null;
  readonly positionMs: number | null;
  readonly playing: boolean;
}

export interface PhoneLinkQueueEntry {
  readonly trackId: string;
  readonly title: string | null;
  readonly artist: string | null;
}

export type PhoneLinkCommandResult =
  | { readonly ok: true; readonly command: 'GET_NOW_PLAYING'; readonly nowPlaying: PhoneLinkNowPlaying }
  | {
      readonly ok: true; readonly command: 'GET_QUEUE';
      readonly queue: readonly PhoneLinkQueueEntry[]; readonly currentIndex: number | null;
    }
  | { readonly ok: true; readonly command: 'PLAY' | 'PAUSE' | 'NEXT' | 'PREVIOUS'; readonly truth: CommandTruth }
  | { readonly ok: false; readonly command: PhoneLinkMusicCommand; readonly denialCode: PhoneLinkCommandDenialCode };

/** Provenance only — `mediaCommandGateway` ya da yetki kararını DEĞİŞTİRMEZ. */
const PHONE_LINK_REQUESTER = 'phone_link_guest';

/** Kısıtlı yanıt — sınırsız kuyruk taşınmaz (bounded). */
const MAX_QUEUE_ENTRIES_RETURNED = 200;

function readNowPlaying(): PhoneLinkNowPlaying {
  const snapshot = getMusicCanonicalSnapshot();
  if (!snapshot.authorityAvailable) {
    return {
      trackId: null, title: null, artist: null, album: null, artworkIdentity: null,
      durationMs: null, positionMs: null, playing: false,
    };
  }
  const ids = snapshot.queueEntryIds ?? [];
  const idx = typeof snapshot.currentIndex === 'number' ? snapshot.currentIndex : -1;
  const trackId = idx >= 0 && idx < ids.length ? ids[idx] : null;
  const track = trackId
    ? getMusicLibrarySnapshot().tracks.find((t) => t.id === trackId) ?? null
    : null;
  return {
    trackId,
    title: track?.title ?? null,
    artist: track?.artist ?? null,
    album: track?.album ?? null,
    artworkIdentity: track?.artworkIdentity ?? null,
    durationMs: typeof snapshot.durationMs === 'number' ? snapshot.durationMs : null,
    positionMs: typeof snapshot.positionMs === 'number' ? snapshot.positionMs : null,
    playing: snapshot.playing === true,
  };
}

/**
 * Not: her giriş için `tracks.find` O(n) — GET_QUEUE kullanıcı tetiklemeli ve
 * seyrek olduğundan (event-driven, polling YOK) bu fazda kabul edilebilir.
 * Kütüphane çok büyürse bir id→track haritası eklenebilir (bu turun kapsamı
 * DEĞİL).
 */
function readQueue(): { queue: readonly PhoneLinkQueueEntry[]; currentIndex: number | null } {
  const snapshot = getMusicCanonicalSnapshot();
  if (!snapshot.authorityAvailable) return { queue: Object.freeze([]), currentIndex: null };
  const ids = (snapshot.queueEntryIds ?? []).slice(0, MAX_QUEUE_ENTRIES_RETURNED);
  const library = getMusicLibrarySnapshot();
  const queue = ids.map((id) => {
    const track = library.tracks.find((t) => t.id === id) ?? null;
    return { trackId: id, title: track?.title ?? null, artist: track?.artist ?? null };
  });
  return {
    queue: Object.freeze(queue),
    currentIndex: typeof snapshot.currentIndex === 'number' ? snapshot.currentIndex : null,
  };
}

/**
 * Guest komutunu gönderir. Her çağrı: (1) kanonik `authorize()`, (2) TOCTOU
 * `canExecute()` yeniden kontrolü, (3) yalnız BAŞARILIYSA `mediaCommandGateway`
 * çağrısı. Yetki reddi HER ZAMAN sessizce yutulmaz — typed denial döner.
 */
export async function dispatchGuestMusicCommand(
  command: PhoneLinkMusicCommand,
  operationId: string = `phone-link-${command.toLowerCase()}-${crypto.randomUUID()}`,
  session: PhoneLinkSessionRef | null = null,
): Promise<PhoneLinkCommandResult> {
  const evidence = authorizeGuestMediaCommand(operationId, Date.now(), session);
  if (evidence.decision !== 'ALLOW') {
    return {
      ok: false,
      command,
      denialCode: evidence.decision === 'CAPABILITY_NOT_GRANTED' ? 'NO_GRANT' : 'NOT_ATTACHED',
    };
  }
  if (!canExecuteGuestMediaCommand(evidence, Date.now(), session)) {
    return { ok: false, command, denialCode: 'STALE' };
  }

  /* F4.7 Race B — yan etkiden HEMEN ÖNCEki son canlılık okuması. Okuma
     komutları (`GET_*`) yan etki üretmediği için bu kapıdan MUAF değildir:
     bayat bir oturuma kanonik Music gerçeği sızdırmak da istenmez. */
  if (!isGuestMediaDispatchStillLive(Date.now(), session)) {
    return { ok: false, command, denialCode: 'STALE' };
  }

  switch (command) {
    case 'GET_NOW_PLAYING':
      return { ok: true, command, nowPlaying: readNowPlaying() };
    case 'GET_QUEUE': {
      const { queue, currentIndex } = readQueue();
      return { ok: true, command, queue, currentIndex };
    }
    case 'PLAY':
      return { ok: true, command, truth: await mediaCommandGateway.play(undefined, PHONE_LINK_REQUESTER) };
    case 'PAUSE':
      return { ok: true, command, truth: await mediaCommandGateway.pause(undefined, PHONE_LINK_REQUESTER) };
    case 'NEXT':
      return { ok: true, command, truth: await mediaCommandGateway.next(undefined, PHONE_LINK_REQUESTER) };
    case 'PREVIOUS':
      return { ok: true, command, truth: await mediaCommandGateway.previous(undefined, PHONE_LINK_REQUESTER) };
    default:
      return { ok: false, command, denialCode: 'NOT_ATTACHED' };
  }
}
