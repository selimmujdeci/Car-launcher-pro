/**
 * YouTube sağlayıcısı — Piped (açık kaynak, anahtarsız YouTube proxy'si) üzerinden.
 *
 * Her Türkçe şarkı YouTube'da var; Piped hem ARAMA hem doğrudan SES AKIŞI URL'si
 * verir → uygulama içinde (stream player) çalar, harici uygulamaya gidilmez,
 * Premium/hesap gerekmez.
 *
 * Dayanıklılık: tek instance kararsız olabilir → liste sırayla denenir, çalışan
 * instance "yapışkan" tutulur (biri düşerse diğerine geçer). Arama hızlı kalsın
 * diye stream URL'si SENTINEL taşır ("piped://<videoId>"); gerçek ses URL'si
 * yalnızca çalınan parça için resolvePipedStream() ile çözülür.
 *
 * ⚠️ YouTube'un bot-engeli (LOGIN_REQUIRED) bazı IP/instance'larda stream
 * çıkarmayı bloklar. Çözüm bulunamazsa fail-soft: parça sessizce atlanır.
 */
import type { MediaProvider, UnifiedTrack } from './providers';
import { timeoutSignal } from './providers';

// Aday Piped API instance'ları (sırayla denenir). Sağlık zamanla değişir.
const INSTANCES = [
  'https://api.piped.private.coffee',
  'https://pipedapi.kavin.rocks',
  'https://piapi.ggtyler.dev',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.r4fo.com',
  'https://pipedapi.ducks.party',
  'https://pipedapi.nosebs.ru',
];

/** streamUrl bu önekle başlıyorsa YouTube/Piped item'ıdır (çalmadan önce çözülür). */
export const PIPED_SCHEME = 'piped://';

let _stickyInstance = '';

/** Çalışan instance'ı önce deneyecek şekilde sıralı liste. */
function _ordered(): string[] {
  if (!_stickyInstance) return INSTANCES;
  return [_stickyInstance, ...INSTANCES.filter((i) => i !== _stickyInstance)];
}

/** Bir işlemi instance'lar üzerinde sırayla dener; ilk null-olmayan sonucu döner. */
async function _tryInstances<T>(
  fn: (base: string) => Promise<T | null>,
  signal?: AbortSignal,
): Promise<T | null> {
  for (const base of _ordered()) {
    if (signal?.aborted) return null;
    try {
      const r = await fn(base);
      if (r !== null) { _stickyInstance = base; return r; }
    } catch { /* sonraki instance */ }
  }
  return null;
}

function _videoId(watchUrl: string): string {
  const qs = watchUrl.split('?')[1] ?? '';
  return new URLSearchParams(qs).get('v') ?? '';
}

export const pipedProvider: MediaProvider = {
  id: 'youtube',
  async search(query, signal) {
    const q = query.trim();
    if (!q) return [];
    const items = await _tryInstances(async (base) => {
      const res = await fetch(`${base}/search?q=${encodeURIComponent(q)}&filter=music_songs`, { signal });
      if (!res.ok) return null;
      const json = await res.json();
      const arr  = (json?.items ?? []) as any[];
      return arr.length ? arr : null; // boşsa diğer instance'ı dene
    }, signal);
    if (!items) return [];
    return items
      .filter((t) => typeof t.url === 'string' && t.url.includes('/watch?v='))
      .map((t): UnifiedTrack => {
        const vid = _videoId(t.url);
        return {
          id:         `youtube-${vid}`,
          providerId: 'youtube',
          title:      t.title?.trim() || 'Parça',
          subtitle:   t.uploaderName?.trim() || 'YouTube',
          artwork:    typeof t.thumbnail === 'string' ? t.thumbnail : undefined,
          streamUrl:  `${PIPED_SCHEME}${vid}`,
        };
      })
      .filter((t) => t.streamUrl !== PIPED_SCHEME)
      .slice(0, 20);
  },
};

/**
 * Bir YouTube/Piped video'sunun çalınabilir ses akışı URL'sini çözer.
 * En yüksek bitrate'li audio stream'i seçer. Bulunamazsa (bot-engeli vb.) null.
 */
export async function resolvePipedStream(videoId: string): Promise<string | null> {
  if (!videoId) return null;
  return _tryInstances(async (base) => {
    const res = await fetch(`${base}/streams/${videoId}`, { signal: timeoutSignal(8000) });
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.error) return null;
    const audio = (json?.audioStreams ?? []) as any[];
    if (!audio.length) return null;
    const best = audio.slice().sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
    return best?.url ?? null;
  });
}
