/**
 * Jamendo sağlayıcısı — ücretsiz / Creative Commons müzik, tam parça yasal stream.
 *
 * Açık API; SECRET gerektirmez ama ücretsiz bir `client_id` ister. client_id
 * BYOK olarak çözülür (bkz. mediaCredentials.ts): kullanıcı ayarı > VITE env >
 * yalnız DEV fallback. Production'da hiçbiri yoksa arama sessizce devre dışı
 * kalır (fail-soft) — gömülü merkezi kimlik yok (CLAUDE.md ticari satış kuralı).
 *
 * Kayıt: https://devportal.jamendo.com → "Create new app" → Client ID.
 * Arama: /v3.0/tracks/?client_id=...&search=QUERY&audioformat=mp32
 * track.audio → doğrudan çalınabilir MP3 URL'si (HTML5 stream player).
 */
import type { MediaProvider, UnifiedTrack } from './providers';
import { getJamendoClientId } from './mediaCredentials';

const API = 'https://api.jamendo.com/v3.0';

export const jamendoProvider: MediaProvider = {
  id: 'jamendo',
  async search(query, signal) {
    const q = query.trim();
    const clientId = getJamendoClientId();
    if (!q || !clientId) return [];
    try {
      const params = new URLSearchParams({
        client_id:   clientId,
        format:      'json',
        limit:       '20',
        search:      q,
        audioformat: 'mp32',
        order:       'popularity_total',
      });
      const res = await fetch(`${API}/tracks/?${params.toString()}`, { signal });
      if (!res.ok) return [];
      const json    = await res.json();
      const results = (json?.results ?? []) as any[];
      return results
        .filter((t) => t.audio)
        .slice(0, 20)
        .map((t): UnifiedTrack => ({
          id:         `jamendo-${t.id}`,
          providerId: 'jamendo',
          title:      t.name?.trim() || 'Parça',
          subtitle:   t.artist_name?.trim() || 'Jamendo',
          artwork:    t.album_image || t.image || undefined,
          streamUrl:  t.audio,
        }));
    } catch {
      return [];
    }
  },
};
