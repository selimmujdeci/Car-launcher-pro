/**
 * mediaRecovery.ts — MÜZİK HUB PAKET A · Process-death kurtarma politikası.
 *
 * ÖNCESİ: kurtarma yoktu. Uygulama/WebView öldüğünde çalma durumu tamamen
 * kayboluyordu; `carosMediaLayer` yalnız "son parça" saklıyor ve play tuşuna
 * basılınca onu çalıyordu (kuyruk/pozisyon/durum otoritesi yoktu).
 *
 * BU PAKETTEKİ POLİTİKA:
 *   - Kurtarma OTOMATİK ÇALMAZ. Eski durum kör şekilde autoplay YAPMAZ.
 *   - Kullanıcının manuel duraklatması KORUNUR — restore sonrası çalmaz.
 *   - Süresi geçmiş oturum (varsayılan 12 saat) restore EDİLMEZ.
 *   - Uzak kaynak oturumları (Spotify Connect / harici uygulama) restore
 *     EDİLMEZ: o oturumun hâlâ geçerli olduğu doğrulanamaz.
 *   - Bozuk kayıt fail-soft SİLİNİR.
 *   - Kurtarma denemesi SINIRLIDIR (sonsuz döngü yok).
 *
 * SAFLIK: kalıcılık `safeStorage` üzerinden; zaman parametreyle verilebilir.
 */

import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../../utils/safeStorage';
import type { PlayItem } from './sourceCoordinator';
import { isKnownSourceClass, type SourceClass } from './sourceCapabilities';

const KEY = 'caros_media_authority_state';

/** Diske yazılan en fazla kuyruk öğesi — büyük blob yazımı yasak (CLAUDE.md §3). */
export const MAX_PERSISTED_ITEMS = 60;

/** Bu süreden eski kayıt restore EDİLMEZ. */
export const RECOVERY_TTL_MS = 12 * 60 * 60 * 1000;

/** Ardışık en fazla kurtarma denemesi — sonsuz döngü koruması. */
export const MAX_RECOVERY_ATTEMPTS = 3;

/** Kurtarılabilir kaynaklar — yalnız yerel otoritenin sahip olduğu kaynaklar. */
const RECOVERABLE: readonly SourceClass[] = ['LOCAL', 'STREAM', 'INTERNET_RADIO'];

export interface PersistedPlaybackState {
  readonly version: 1;
  readonly source: SourceClass;
  readonly queueRevision: number;
  readonly items: readonly PlayItem[];
  readonly currentIndex: number;
  readonly positionMs: number;
  readonly shuffle: boolean;
  readonly repeat: 'off' | 'one' | 'all';
  /** Kullanıcı bilerek duraklattı mı — restore sonrası ÇALMAMA gerekçesi. */
  readonly userPaused: boolean;
  readonly lastObservedPlaying: boolean;
  readonly savedAtMs: number;
  readonly recoveryAttempts: number;
}

function clampItems(items: readonly PlayItem[], index: number): {
  items: PlayItem[]; index: number;
} {
  if (items.length <= MAX_PERSISTED_ITEMS) return { items: [...items], index };
  const half = Math.floor(MAX_PERSISTED_ITEMS / 2);
  const start = Math.min(Math.max(0, index - half), items.length - MAX_PERSISTED_ITEMS);
  return { items: items.slice(start, start + MAX_PERSISTED_ITEMS), index: index - start };
}

/** Durumu kalıcılaştırır (yüksek frekansta ÇAĞRILMAMALI — çağıran throttle eder). */
export function persistPlaybackState(input: {
  source: SourceClass;
  queueRevision: number;
  items: readonly PlayItem[];
  currentIndex: number;
  positionMs: number;
  shuffle: boolean;
  repeat: 'off' | 'one' | 'all';
  userPaused: boolean;
  lastObservedPlaying: boolean;
  nowMs: number;
}): boolean {
  try {
    if (!isKnownSourceClass(input.source)) return false;
    const { items, index } = clampItems(input.items, Math.max(0, input.currentIndex));
    const state: PersistedPlaybackState = {
      version: 1,
      source: input.source,
      queueRevision: input.queueRevision,
      items,
      currentIndex: Math.max(0, Math.min(index, Math.max(0, items.length - 1))),
      positionMs: Math.max(0, input.positionMs),
      shuffle: input.shuffle === true,
      repeat: input.repeat,
      userPaused: input.userPaused === true,
      lastObservedPlaying: input.lastObservedPlaying === true,
      savedAtMs: input.nowMs,
      recoveryAttempts: 0,
    };
    safeSetRaw(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export type RecoveryDecision =
  | { readonly action: 'NONE'; readonly reason: string }
  | {
    readonly action: 'RESTORE_PAUSED';
    readonly state: PersistedPlaybackState;
    /** Kurtarma HER ZAMAN duraklatılmış yüklenir — otomatik çalma YOK. */
    readonly autoPlay: false;
  };

/** Bozuk/eski kaydı okur ve NE YAPILACAĞINA karar verir (saf karar, I/O yok). */
export function decideRecovery(
  raw: string | null,
  nowMs: number,
): RecoveryDecision {
  if (!raw) return { action: 'NONE', reason: 'no_saved_state' };

  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { action: 'NONE', reason: 'corrupt_json' }; }
  if (!parsed || typeof parsed !== 'object') return { action: 'NONE', reason: 'corrupt_shape' };

  const s = parsed as Partial<PersistedPlaybackState>;
  if (s.version !== 1) return { action: 'NONE', reason: 'version_mismatch' };
  if (!isKnownSourceClass(s.source)) return { action: 'NONE', reason: 'unknown_source' };
  if (!RECOVERABLE.includes(s.source)) {
    // Uzak/harici oturumun hâlâ geçerli olduğu DOĞRULANAMAZ → restore edilmez.
    return { action: 'NONE', reason: 'source_not_recoverable' };
  }
  if (!Array.isArray(s.items) || s.items.length === 0) {
    return { action: 'NONE', reason: 'empty_queue' };
  }
  if (typeof s.savedAtMs !== 'number' || !Number.isFinite(s.savedAtMs)) {
    return { action: 'NONE', reason: 'corrupt_timestamp' };
  }
  if (nowMs - s.savedAtMs > RECOVERY_TTL_MS) {
    return { action: 'NONE', reason: 'expired' };
  }
  if ((s.recoveryAttempts ?? 0) >= MAX_RECOVERY_ATTEMPTS) {
    return { action: 'NONE', reason: 'attempts_exhausted' };
  }

  const items = (s.items as PlayItem[])
    .filter((i) => i && typeof i.uri === 'string' && i.uri.length > 0)
    .slice(0, MAX_PERSISTED_ITEMS);
  if (items.length === 0) return { action: 'NONE', reason: 'no_valid_items' };

  const state: PersistedPlaybackState = {
    version: 1,
    source: s.source,
    queueRevision: typeof s.queueRevision === 'number' ? s.queueRevision : 0,
    items,
    currentIndex: Math.max(0, Math.min(s.currentIndex ?? 0, items.length - 1)),
    positionMs: Math.max(0, s.positionMs ?? 0),
    shuffle: s.shuffle === true,
    repeat: s.repeat === 'one' || s.repeat === 'all' ? s.repeat : 'off',
    userPaused: s.userPaused === true,
    lastObservedPlaying: s.lastObservedPlaying === true,
    savedAtMs: s.savedAtMs,
    recoveryAttempts: (s.recoveryAttempts ?? 0) + 1,
  };

  // KRİTİK: kullanıcı duraklattıysa da, çalıyorken öldüyse de SONUÇ AYNI —
  // kurtarma otomatik ses çıkarmaz. Araç kontağı/güç durumu bilinmiyorken
  // kendiliğinden çalmak sürücü için beklenmedik ve tehlikelidir.
  return { action: 'RESTORE_PAUSED', state, autoPlay: false };
}

/** Kaydı okur (I/O). */
export function readPersistedRaw(): string | null {
  try { return safeGetRaw(KEY); } catch { return null; }
}

/** Deneme sayacını artırarak geri yazar — sonsuz kurtarma döngüsünü keser. */
export function markRecoveryAttempt(state: PersistedPlaybackState): void {
  try { safeSetRaw(KEY, JSON.stringify(state)); } catch { /* fail-soft */ }
}

/** Bozuk/eskimiş kaydı temizler. */
export function clearPersistedState(): void {
  try { safeRemoveRaw(KEY); } catch { /* fail-soft */ }
}

/** Kurtarma başarıyla tamamlandı — deneme sayacı sıfırlanır. */
export function markRecoverySucceeded(state: PersistedPlaybackState): void {
  try {
    safeSetRaw(KEY, JSON.stringify({ ...state, recoveryAttempts: 0 }));
  } catch { /* fail-soft */ }
}
