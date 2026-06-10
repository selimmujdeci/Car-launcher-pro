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
  'https://api.piped.private.coffee',  // ✅ canlı (2026-06-10 test: 200 + CORS:*)
  'https://pipedapi.kavin.rocks',      // 502 — backend toparlarsa
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.reallyaweso.me',
  'https://piped-api.lunar.icu',
];

/* Invidious yedek havuzu — Piped ekosistemi 2026'da büyük ölçüde çöktü (test:
 * 5 instance'tan 4'ü 502). Tek canlı Piped instance'ına bağımlılık kırılgan;
 * Invidious bağımsız ikinci ağ: hem arama (/api/v1/search) hem ses akışı
 * (/api/v1/videos/<id> → adaptiveFormats) verir. melmac doğrulandı (200 +
 * CORS:*); diğerleri PowerShell UA'sına 403 verdi — tarayıcı UA'lı WebView'den
 * çalışabilir, paralel yarışta ölü instance canlıyı bloklamaz. */
const INVIDIOUS_INSTANCES = [
  'https://iv.melmac.space',           // ✅ canlı (2026-06-10 test: 200 + CORS:*)
  'https://yewtu.be',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
];

/** streamUrl bu önekle başlıyorsa YouTube/Piped item'ıdır (çalmadan önce çözülür). */
export const PIPED_SCHEME = 'piped://';

// Instance başına timeout: ölü/yavaş instance tüm aramayı kilitlemesin. Head unit ağı
// sık sık YAVAŞ → tek canlı instance'a (private.coffee) ulaşmak için biraz daha cömert
// süre verilir (4s'de yavaş ama çalışan instance koparılıyordu → "bulamıyor").
const SEARCH_PER_INSTANCE_MS = 6000;
const STREAM_PER_INSTANCE_MS = 9000;

type Pool = 'piped' | 'invidious';
const _sticky: Record<Pool, string> = { piped: '', invidious: '' };

/** Çalışan instance'ı önce deneyecek şekilde sıralı liste (havuz başına sticky). */
function _ordered(pool: Pool): string[] {
  const list = pool === 'piped' ? INSTANCES : INVIDIOUS_INSTANCES;
  const s = _sticky[pool];
  if (!s) return list;
  return [s, ...list.filter((i) => i !== s)];
}

/** Dış sinyal + instance-başına timeout'u birleştiren AbortSignal.
 *  Eski WebView'de (Chrome <66) AbortController yoktur — timeout'suz devam
 *  edilir (arama hiç çalışmamaktan iyidir); fetch signal: undefined kabul eder. */
function _perInstanceSignal(outer: AbortSignal | undefined, ms: number): AbortSignal | undefined {
  if (typeof AbortController === 'undefined') return outer;
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
  pool: Pool,
  fn: (base: string, signal: AbortSignal | undefined) => Promise<T | null>,
  signal?: AbortSignal,
  perInstanceMs: number = SEARCH_PER_INSTANCE_MS,
): Promise<T | null> {
  if (signal?.aborted) return null;
  const bases = _ordered(pool);
  if (!bases.length) return null;
  return new Promise<T | null>((resolve) => {
    let remaining = bases.length;
    let settled = false;
    const done = (r: T | null, base?: string) => {
      if (settled) return;
      if (r !== null) { settled = true; if (base) _sticky[pool] = base; resolve(r); return; }
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

/** UnifiedTrack kurucusu — Piped ve Invidious sonuçları aynı şemaya iner.
 *  streamUrl sentinel'i (piped://<id>) kaynaktan bağımsız: çalma anında
 *  resolvePipedStream her iki havuzu da dener. */
function _track(vid: string, title?: string, uploader?: string, artwork?: string): UnifiedTrack {
  return {
    id:         `youtube-${vid}`,
    providerId: 'youtube',
    title:      title?.trim() || 'Parça',
    subtitle:   uploader?.trim() || 'YouTube',
    artwork,
    streamUrl:  `${PIPED_SCHEME}${vid}`,
  };
}

export const pipedProvider: MediaProvider = {
  id: 'youtube',
  async search(query, signal) {
    const q = query.trim();
    if (!q) return [];
    const fetchItems = (filter: string) => _tryInstances('piped', async (base, sig) => {
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
    if (items) {
      return items
        .filter((t) => typeof t.url === 'string' && t.url.includes('/watch?v='))
        .map((t) => _track(
          _videoId(t.url),
          t.title,
          t.uploaderName,
          typeof t.thumbnail === 'string' ? t.thumbnail : undefined,
        ))
        .filter((t) => t.streamUrl !== PIPED_SCHEME)
        .slice(0, 20);
    }

    // ── Invidious fallback — tüm Piped instance'ları düştüyse ──
    const invItems = await _tryInstances('invidious', async (base, sig) => {
      const res = await fetch(`${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`, { signal: sig });
      if (!res.ok) return null;
      const json = await res.json();
      const arr  = (Array.isArray(json) ? json : []).filter(
        (v: any) => v?.type === 'video' && typeof v?.videoId === 'string' && v.videoId,
      );
      return arr.length ? (arr as any[]) : null;
    }, signal);
    if (!invItems) return [];
    return invItems
      .map((v) => _track(
        v.videoId,
        v.title,
        v.author,
        // Thumbnail instance'tan değil doğrudan YouTube CDN'den — instance ölse de görsel yaşar
        `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
      ))
      .slice(0, 20);
  },
};

/**
 * Bir YouTube/Piped video'sunun çalınabilir ses akışı URL'sini çözer.
 * En yüksek bitrate'li audio stream'i seçer. Bulunamazsa (bot-engeli vb.) null.
 */
export async function resolvePipedStream(videoId: string): Promise<string | null> {
  if (!videoId) return null;
  const fromPiped = await _tryInstances('piped', async (base, sig) => {
    const res = await fetch(`${base}/streams/${videoId}`, { signal: sig });
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.error) return null;
    const audio = (json?.audioStreams ?? []) as any[];
    if (!audio.length) return null;
    const best = audio.slice().sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
    return best?.url ?? null;
  }, undefined, STREAM_PER_INSTANCE_MS);
  if (fromPiped) return fromPiped;

  // ── Invidious fallback — adaptiveFormats içinden en yüksek bitrate'li ses ──
  // Not: Invidious bitrate alanı string döner; Number() ile normalize edilir.
  return _tryInstances('invidious', async (base, sig) => {
    const res = await fetch(`${base}/api/v1/videos/${videoId}`, { signal: sig });
    if (!res.ok) return null;
    const json = await res.json();
    const fmts = ((json?.adaptiveFormats ?? []) as any[]).filter(
      (f) => typeof f?.type === 'string' && f.type.startsWith('audio/') && typeof f?.url === 'string' && f.url,
    );
    if (!fmts.length) return null;
    const best = fmts.slice().sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0))[0];
    return best?.url ?? null;
  }, undefined, STREAM_PER_INSTANCE_MS);
}
