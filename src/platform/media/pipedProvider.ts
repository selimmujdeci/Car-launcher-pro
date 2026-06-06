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

// Aday Piped API instance'ları. Sağlık zamanla değişir; ölü instance'ın canlıyı
// bloklamaması için PARALEL yarışırlar (aşağıda _tryInstances). Liste 2026-06
// canlılık testiyle tazelendi: tam ölü (DNS/connection-refused) olanlar çıkarıldı,
// canlı + geçici 502 (toparlayabilir) olanlar bırakıldı. Canlı olan başta.
const INSTANCES = [
  'https://api.piped.private.coffee',  // ✅ canlı (test: 200 + CORS:*)
  'https://pipedapi.kavin.rocks',      // 502 — backend toparlarsa
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.reallyaweso.me',
  'https://piped-api.lunar.icu',
];

/** streamUrl bu önekle başlıyorsa YouTube/Piped item'ıdır (çalmadan önce çözülür). */
export const PIPED_SCHEME = 'piped://';

// Instance başına timeout: ölü/yavaş instance tüm aramayı kilitlemesin. Head unit ağı
// sık sık YAVAŞ → tek canlı instance'a (private.coffee) ulaşmak için biraz daha cömert
// süre verilir (4s'de yavaş ama çalışan instance koparılıyordu → "bulamıyor").
const SEARCH_PER_INSTANCE_MS = 6000;
const STREAM_PER_INSTANCE_MS = 9000;

let _stickyInstance = '';

/** Çalışan instance'ı önce deneyecek şekilde sıralı liste. */
function _ordered(): string[] {
  if (!_stickyInstance) return INSTANCES;
  return [_stickyInstance, ...INSTANCES.filter((i) => i !== _stickyInstance)];
}

/** Dış sinyal + instance-başına timeout'u birleştiren AbortSignal. */
function _perInstanceSignal(outer: AbortSignal | undefined, ms: number): AbortSignal {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  if (outer) {
    if (outer.aborted) c.abort();
    else outer.addEventListener('abort', () => { clearTimeout(t); c.abort(); }, { once: true });
  }
  return c.signal;
}

/**
 * Bir işlemi TÜM instance'larda PARALEL dener; ilk null-olmayan sonucu hemen döner.
 * Ölü/asılı instance artık canlıyı bloklamaz (eski sıralı tek-timeout-bütçesi yerine).
 * Her instance kendi timeout'unu alır; ilk başarılı "sticky" olur.
 */
async function _tryInstances<T>(
  fn: (base: string, signal: AbortSignal) => Promise<T | null>,
  signal?: AbortSignal,
  perInstanceMs: number = SEARCH_PER_INSTANCE_MS,
): Promise<T | null> {
  if (signal?.aborted) return null;
  const bases = _ordered();
  if (!bases.length) return null;
  return new Promise<T | null>((resolve) => {
    let remaining = bases.length;
    let settled = false;
    const done = (r: T | null, base?: string) => {
      if (settled) return;
      if (r !== null) { settled = true; if (base) _stickyInstance = base; resolve(r); return; }
      if (--remaining === 0) { settled = true; resolve(null); }
    };
    for (const base of bases) {
      const sig = _perInstanceSignal(signal, perInstanceMs);
      Promise.resolve()
        .then(() => fn(base, sig))
        .then((r) => done(r, base))
        .catch(() => done(null));
    }
  });
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
    const fetchItems = (filter: string) => _tryInstances(async (base, sig) => {
      const res = await fetch(`${base}/search?q=${encodeURIComponent(q)}&filter=${filter}`, { signal: sig });
      if (!res.ok) return null;
      const json = await res.json();
      const arr  = (json?.items ?? []) as any[];
      return arr.length ? arr : null; // boşsa diğer instance'ı dene
    }, signal);
    // Genel YouTube video araması — normal YouTube'da ne aranıp bulunuyorsa aynısı:
    // müzik, haber, analiz, takip edilen kanal videoları, vlog vb. (müzik-only DEĞİL).
    // Boşsa müzik aramasına düş (nadir; bazı instance'larda 'videos' boş dönebilir).
    let items = await fetchItems('videos');
    if (!items) items = await fetchItems('music_songs');
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
  return _tryInstances(async (base, sig) => {
    const res = await fetch(`${base}/streams/${videoId}`, { signal: sig });
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.error) return null;
    const audio = (json?.audioStreams ?? []) as any[];
    if (!audio.length) return null;
    const best = audio.slice().sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
    return best?.url ?? null;
  }, undefined, STREAM_PER_INSTANCE_MS);
}
