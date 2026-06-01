/**
 * CarOS Media Layer — sağlayıcı (provider) tipleri.
 *
 * Katman mimarisi:
 *   Backend kaynaklar (MediaSession / Spotify Connect / HTML5 stream / yerel)
 *     → Provider'lar (arama)  →  carosMediaLayer (birleştirme + yönlendirme)
 *       → UI (MediaScreen yalnızca katmanla konuşur)
 *
 * Her UnifiedTrack tek bir çalma tanımı taşır (streamUrl | spotifyUri | localIndex);
 * carosMediaLayer.playMedia() doğru backend'e yönlendirir.
 */

export type ProviderId = 'spotify' | 'audius' | 'radio' | 'local' | 'stream' | 'jamendo' | 'archive' | 'youtube';

export interface UnifiedTrack {
  id:         string;
  providerId: ProviderId;
  title:      string;
  subtitle:   string;
  artwork?:   string;
  /* ── Çalma tanımı (yalnızca biri dolu) ── */
  streamUrl?:         string;  // radio / audius / özel akış → HTML5 stream player
  spotifyUri?:        string;  // spotify → Connect API
  spotifyDurationMs?: number;
  localIndex?:        number;  // cihaz müziği → playAtIndex
}

/** Ağ tabanlı catalog/radyo sağlayıcısı arabirimi. */
export interface MediaProvider {
  id:     Extract<ProviderId, 'audius' | 'radio' | 'jamendo' | 'archive' | 'youtube'>;
  search: (query: string, signal: AbortSignal) => Promise<UnifiedTrack[]>;
}

/** Belirtilen ms sonra abort eden sinyal — yavaş/kopuk ağda UI donmaz (fail-soft). */
export function timeoutSignal(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}
