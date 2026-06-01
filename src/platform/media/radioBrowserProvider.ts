/**
 * Radio Browser sağlayıcısı — açık API, kimlik gerektirmez, 50.000+ internet radyosu.
 *
 * Arama: {host}/json/stations/search?name=...&limit=20&hidebroken=true&order=clickcount&reverse=true
 * Station.url_resolved → doğrudan çalınabilir stream URL'si (HTML5 stream player).
 */
import type { MediaProvider, UnifiedTrack } from './providers';

// Round-robin mirror; tek host down olsa bile genelde erişilir
const HOST = 'https://de1.api.radio-browser.info';

export const radioBrowserProvider: MediaProvider = {
  id: 'radio',
  async search(query, signal) {
    const q = query.trim();
    if (!q) return [];
    try {
      const params = new URLSearchParams({
        name:       q,
        limit:      '20',
        hidebroken: 'true',
        order:      'clickcount',
        reverse:    'true',
      });
      const res = await fetch(`${HOST}/json/stations/search?${params.toString()}`, { signal });
      if (!res.ok) return [];
      const items = (await res.json()) as any[];
      return items
        .filter((s) => s.url_resolved)
        .slice(0, 20)
        .map((s): UnifiedTrack => ({
          id:         `radio-${s.stationuuid}`,
          providerId: 'radio',
          title:      s.name?.trim() || 'Radyo',
          subtitle:   [s.country, s.tags?.split(',')[0]].filter(Boolean).join(' • ') || 'Radyo',
          artwork:    s.favicon || undefined,
          streamUrl:  s.url_resolved,
        }));
    } catch {
      return [];
    }
  },
};
