/**
 * useFavoriteStatus.ts — MUSIC F13 · Now Playing kalp kontrolü için TEK
 * okuma noktası (SALT-OKUNUR projeksiyon, Cross-Domain §14).
 *
 * Kimlik F3'ün ZATEN var olan `ListeningSession.currentItem`sinden gelir —
 * burada YENİ bir "şu an çalan" kavramı İCAT EDİLMEZ. Kimlik kanıtsızsa
 * (oturum yok / `currentItem` yok / kalıcı favori kimliği kurulamıyor)
 * `available: false` döner — kalp kontrolü HİÇ ÇİZİLMEMELİDİR (spec §5).
 *
 * Mutasyon: `toggle()` doğrudan `musicCollectionAuthority`yi çağırır — bu
 * hook KENDİ favori state'ini TUTMAZ, yalnız otoriteyi PROJEKSİYONLAR.
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';
import { getListeningSession, subscribeListeningSession } from '../../platform/media/session/listeningSession';
import {
  isFavorite as isFavoriteInCollection, toggleFavorite as toggleFavoriteInCollection,
  subscribeFavorites,
} from '../../platform/media/collection/musicCollectionAuthority';
import { favoriteKeyFor, type FavoriteMutationResult } from '../../platform/media/collection/musicCollectionEntry';

export interface FavoriteStatus {
  /** Kalp kontrolü render EDİLMELİ Mİ — kanıtsız kimlik varken `false`. */
  readonly available: boolean;
  readonly isFavorite: boolean;
  /** `available: false` iken çağrılırsa `null` döner — mutasyon denenmez. */
  readonly toggle: () => FavoriteMutationResult | null;
}

const NOOP_TOGGLE = (): null => null;
const UNAVAILABLE: FavoriteStatus = Object.freeze({
  available: false, isFavorite: false, toggle: NOOP_TOGGLE,
});

function subscribeBoth(listener: () => void): () => void {
  const stopSession = subscribeListeningSession(listener);
  const stopFavorites = subscribeFavorites(listener);
  return () => { stopSession(); stopFavorites(); };
}

export function useFavoriteStatus(): FavoriteStatus {
  const cache = useRef<{ key: string; value: FavoriteStatus } | null>(null);

  const getSnapshot = useCallback((): FavoriteStatus => {
    const session = getListeningSession();
    const identity = session?.currentItem ?? null;
    const key = identity ? favoriteKeyFor(identity) : null;
    if (!session || !identity || key === null) {
      cache.current = null;
      return UNAVAILABLE;
    }
    const fav = isFavoriteInCollection(identity);
    const cacheKey = `${key}|${fav}`;
    if (cache.current?.key === cacheKey) return cache.current.value;
    const sourceClass = session.currentSource;
    const value: FavoriteStatus = Object.freeze({
      available: true,
      isFavorite: fav,
      toggle: () => toggleFavoriteInCollection(identity, sourceClass),
    });
    cache.current = { key: cacheKey, value };
    return value;
  }, []);

  return useSyncExternalStore(subscribeBoth, getSnapshot, getSnapshot);
}
