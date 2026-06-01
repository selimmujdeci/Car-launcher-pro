/**
 * Internet Archive sağlayıcısı — devasa açık ses arşivi, kimlik gerektirmez.
 *
 * Arama: /advancedsearch.php?q=(QUERY) AND mediatype:(audio)&output=json
 * Her sonuç bir "item"; gerçek ses dosyası item içinde olduğundan stream URL'si
 * ARAMA anında çözülmez (her sonuç için ayrı metadata isteği pahalı olurdu).
 * Bunun yerine streamUrl bir SENTINEL taşır: "archive://<identifier>".
 * carosMediaLayer._playTrack bunu görüp çalmadan hemen önce resolveArchiveStream()
 * ile gerçek MP3 URL'sine çevirir (yalnızca çalınan parça için tek istek).
 */
import type { MediaProvider, UnifiedTrack } from './providers';
import { timeoutSignal } from './providers';

const ARCHIVE = 'https://archive.org';

/** streamUrl bu önekle başlıyorsa Internet Archive item'ıdır (çalmadan önce çözülür). */
export const ARCHIVE_SCHEME = 'archive://';

export const archiveProvider: MediaProvider = {
  id: 'archive',
  async search(query, signal) {
    const q = query.trim();
    if (!q) return [];
    try {
      const params = new URLSearchParams({
        q:      `(${q}) AND mediatype:(audio)`,
        rows:   '20',
        page:   '1',
        output: 'json',
      });
      // fl[] tekrar eden anahtar — URLSearchParams ile elle ekle
      params.append('fl[]', 'identifier');
      params.append('fl[]', 'title');
      params.append('fl[]', 'creator');
      const res = await fetch(`${ARCHIVE}/advancedsearch.php?${params.toString()}`, { signal });
      if (!res.ok) return [];
      const json = await res.json();
      const docs = (json?.response?.docs ?? []) as any[];
      return docs
        .filter((d) => d.identifier)
        .slice(0, 20)
        .map((d): UnifiedTrack => {
          const creator = Array.isArray(d.creator) ? d.creator[0] : d.creator;
          return {
            id:         `archive-${d.identifier}`,
            providerId: 'archive',
            title:      (typeof d.title === 'string' ? d.title : d.title?.[0])?.trim() || d.identifier,
            subtitle:   (typeof creator === 'string' ? creator.trim() : '') || 'Internet Archive',
            artwork:    `${ARCHIVE}/services/img/${encodeURIComponent(d.identifier)}`,
            streamUrl:  `${ARCHIVE_SCHEME}${d.identifier}`,
          };
        });
    } catch {
      return [];
    }
  },
};

/**
 * Bir Internet Archive item'ının çalınabilir ses dosyası URL'sini çözer.
 * MP3 tercih edilir; yoksa ogg/m4a/flac. Bulunamazsa null.
 */
export async function resolveArchiveStream(identifier: string): Promise<string | null> {
  try {
    const res = await fetch(`${ARCHIVE}/metadata/${encodeURIComponent(identifier)}`, {
      signal: timeoutSignal(6000),
    });
    if (!res.ok) return null;
    const json  = await res.json();
    const files = (json?.files ?? []) as any[];
    const pick =
      files.find((f) => /mp3/i.test(f.format ?? '') || /\.mp3$/i.test(f.name ?? '')) ??
      files.find((f) => /\.(ogg|m4a|flac|wav)$/i.test(f.name ?? ''));
    if (!pick?.name) return null;
    return `${ARCHIVE}/download/${encodeURIComponent(identifier)}/${encodeURIComponent(pick.name)}`;
  } catch {
    return null;
  }
}
