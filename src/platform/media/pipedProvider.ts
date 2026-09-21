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
import { CapacitorHttp } from '@capacitor/core';
import { isNative } from '../bridge';

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

/* ── Harici yanıt sözleşmeleri (GÜVENİLMEZ — her alan opsiyonel) ────────────
   Piped ve Invidious topluluk instance'larıdır: sürümleri farklı, alanları
   eksik/farklı tipte gelebilir (ör. Invidious `bitrate`i STRING döndürür).
   Bu arayüzler yanıtı BELGELER, garanti etmez — tüm erişimler korumalı. */

interface PipedSearchItem {
  /** `/watch?v=<id>` biçiminde göreli yol. */
  url?:          unknown;
  title?:        string;
  uploaderName?: string;
  thumbnail?:    unknown;
}

interface PipedAudioStream {
  url?:     string;
  bitrate?: number;
}

/** Muxed (video+ses birlikte) akış — audioStreams boşken ses YEDEĞİ olarak kullanılır. */
interface PipedVideoStream {
  url?:       string;
  videoOnly?: boolean;
}

interface InvidiousVideo {
  type?:    unknown;
  videoId?: string;
  title?:   string;
  author?:  string;
}

interface InvidiousFormat {
  type?:    unknown;
  url?:     unknown;
  /** Invidious bunu STRING döndürür — Number() ile normalize edilir. */
  bitrate?: string | number;
}

/** Invidious muxed (video+ses) akışı — adaptiveFormats'ta audio/* yokken YEDEK. */
interface InvidiousFormatStream {
  type?: unknown;
  url?:  unknown;
}

type Pool = 'piped' | 'invidious';
const _sticky: Record<Pool, string> = { piped: '', invidious: '' };

/** Çalışan instance'ı önce deneyecek şekilde sıralı liste (havuz başına sticky). */
function _ordered(pool: Pool): string[] {
  const list = pool === 'piped' ? INSTANCES : INVIDIOUS_INSTANCES;
  const s = _sticky[pool];
  if (!s) return list;
  return [s, ...list.filter((i) => i !== s)];
}

/**
 * JSON GET — CORS'u AŞAR (saha kusuru 2026-09-05, gerçek cihazda ÖLÇÜLDÜ).
 *
 * KÖK NEDEN: bu dosyanın tüm istekleri düz `fetch()` kullanıyordu. Android
 * WebView'de sayfa origin'i `https://localhost`tur; Piped/Invidious topluluk
 * instance'ları (`piped-api.lunar.icu`, `pipedapi.kavin.rocks` …) hiçbiri
 * `Access-Control-Allow-Origin` başlığı DÖNMÜYOR. Sonuç CDP ile canlı görüldü:
 * **HER instance, her istek** `blocked by CORS policy` ile ERR_FAILED
 * düşüyordu — arama BAZEN sonuç veriyordu (bazı yollar farklı davranıyor
 * olabilir) ama ses akışı çözümü (`resolvePipedStream`) native cihazda
 * SİSTEMATİK olarak `audio_fallback_no_stream`e düşüyordu.
 *
 * DOĞRU YOL: `@capacitor/core`nun native HTTP köprüsü (`CapacitorHttp`).
 * Bu, native Android/iOS HTTP istemcisiyle YAPILAN GERÇEK bir ağ çağrısıdır —
 * tarayıcının same-origin/CORS politikasına TABİ DEĞİLDİR (WebView `fetch`
 * değil, bridge üzerinden native koda gider). `@capacitor/core`da HER ZAMAN
 * kayıtlıdır; global `CapacitorHttp.enabled` bayrağı yalnız `window.fetch`i
 * PATCH'lemeyi kontrol eder — burada o bayrağa hiç DOKUNULMADI (uygulamanın
 * geri kalanındaki `fetch` davranışı BİREBİR aynı kalır, yalnız BU dosyanın
 * istekleri native köprüden geçer).
 *
 * Web'de (tarayıcı önizleme) `isNative` false olduğunda düz `fetch`e
 * DÜŞÜLÜR — CapacitorHttp'nin web implementasyonu zaten yalnız `fetch`i
 * sarmalar, bu yüzden davranış değişmez.
 */
async function _getJson(url: string, signal: AbortSignal | undefined): Promise<unknown | null> {
  if (isNative) {
    // CapacitorHttp AbortSignal ALMAZ — dış iptali kendi race'imizle uygularız.
    if (signal?.aborted) return null;
    const req = CapacitorHttp.get({ url });
    const aborted = new Promise<null>((resolve) => {
      if (!signal) return;
      signal.addEventListener('abort', () => resolve(null), { once: true });
    });
    try {
      const res = await Promise.race([req, aborted]);
      if (res === null) return null;                    // iptal edildi
      if (res.status < 200 || res.status >= 300) return null;
      return res.data ?? null;                          // JSON content-type ise ZATEN ayrıştırılmış
    } catch { return null; }
  }
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
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
      const json = await _getJson(`${base}/search?q=${encodeURIComponent(q)}&filter=${filter}`, sig);
      const arr  = ((json as { items?: unknown })?.items ?? []) as PipedSearchItem[];
      return arr.length ? arr : null; // boşsa diğer instance'ı dene
    }, signal);
    // Genel YouTube video araması — normal YouTube'da ne aranıp bulunuyorsa aynısı:
    // müzik, haber, analiz, takip edilen kanal videoları, vlog vb. (müzik-only DEĞİL).
    // Boşsa müzik aramasına düş (nadir; bazı instance'larda 'videos' boş dönebilir).
    let items = await fetchItems('videos');
    if (!items) items = await fetchItems('music_songs');
    if (items) {
      return items
        .filter((t): t is PipedSearchItem & { url: string } =>
          typeof t.url === 'string' && t.url.includes('/watch?v='))
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
      const json = await _getJson(`${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`, sig);
      if (json === null) return null;
      const arr  = (Array.isArray(json) ? json : [] as InvidiousVideo[]).filter(
        (v: InvidiousVideo): v is InvidiousVideo & { videoId: string } =>
          v?.type === 'video' && typeof v?.videoId === 'string' && Boolean(v.videoId),
      );
      return arr.length ? arr : null;
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
 *
 * MUXED YEDEK (2026-09-05 gerçek cihazda ölçüldü — TARKAN "Bir Oluruz Yolunda",
 * videoId EBwjmeDoE6A): bazı içerikler için YouTube ayrı audio-only akışı
 * ÇIKARTMAYA izin vermiyor — `audioStreams: []` gelir (CORS/id hatası DEĞİL,
 * gerçek cihazdan native köprüyle 200 OK ile doğrulandı) ama `videoStreams`
 * içinde `videoOnly:false` (ses gömülü, klasik itag 18 mp4) bir akış hâlâ VAR.
 * `<audio>` elementi video+ses muxed bir mp4'ü de oynatabilir (yalnız ses
 * izini kullanır) — bu yüzden audioStreams boşsa bu muxed akışa DÜŞÜLÜR.
 * Aynı kök neden Invidious'ta `formatStreams` (adaptiveFormats'ın muxed
 * karşılığı) için de geçerli — orada da aynı yedek uygulanır.
 */
export async function resolvePipedStream(videoId: string): Promise<string | null> {
  if (!videoId) return null;
  const fromPiped = await _tryInstances('piped', async (base, sig) => {
    const json = await _getJson(`${base}/streams/${videoId}`, sig) as
      { error?: unknown; audioStreams?: PipedAudioStream[]; videoStreams?: PipedVideoStream[] } | null;
    if (json === null || json.error) return null;
    const audio = (json.audioStreams ?? []) as PipedAudioStream[];
    if (audio.length) {
      const best = audio.slice().sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
      if (best?.url) return best.url;
    }
    const muxed = ((json.videoStreams ?? []) as PipedVideoStream[]).find(
      (v): v is PipedVideoStream & { url: string } =>
        v.videoOnly === false && typeof v.url === 'string' && Boolean(v.url),
    );
    return muxed?.url ?? null;
  }, undefined, STREAM_PER_INSTANCE_MS);
  if (fromPiped) return fromPiped;

  // ── Invidious fallback — adaptiveFormats içinden en yüksek bitrate'li ses ──
  // Not: Invidious bitrate alanı string döner; Number() ile normalize edilir.
  return _tryInstances('invidious', async (base, sig) => {
    const json = await _getJson(`${base}/api/v1/videos/${videoId}`, sig) as
      { adaptiveFormats?: InvidiousFormat[]; formatStreams?: InvidiousFormatStream[] } | null;
    if (json === null) return null;
    const fmts = ((json.adaptiveFormats ?? []) as InvidiousFormat[]).filter(
      (f): f is InvidiousFormat & { url: string } =>
        typeof f?.type === 'string' && f.type.startsWith('audio/')
        && typeof f?.url === 'string' && Boolean(f.url),
    );
    if (fmts.length) {
      const best = fmts.slice().sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0))[0];
      if (best?.url) return best.url;
    }
    const muxed = ((json.formatStreams ?? []) as InvidiousFormatStream[]).find(
      (f): f is InvidiousFormatStream & { url: string } => typeof f?.url === 'string' && Boolean(f.url),
    );
    return muxed?.url ?? null;
  }, undefined, STREAM_PER_INSTANCE_MS);
}
