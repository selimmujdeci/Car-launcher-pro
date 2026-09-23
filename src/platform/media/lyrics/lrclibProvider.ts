/**
 * lrclibProvider — internetten şarkı sözü (LRCLIB · https://lrclib.net).
 *
 * NEDEN LRCLIB: ücretsiz, anahtarsız, zaman damgalı (LRC) söz verir. F16
 * denetiminde Spotify/YouTube yanıtlarında söz alanı YOKTU; gömülü etiket
 * dışında tek gerçek kaynak budur.
 *
 * DÜRÜSTLÜK (fail-closed): yanlış şarkının sözünü göstermek, hiç söz
 * göstermemekten KÖTÜDÜR. Süre biliniyorsa aday ±3 sn içinde olmak ZORUNDA;
 * bilinmiyorsa başlık + sanatçı normalize edilmiş hâlde BİREBİR tutmalıdır.
 * Aksi hâlde "bulunamadı" denir. Zaman damgası olmayan metin SENKRON sayılmaz.
 *
 * LİSANS: sözlerin telif hakkı hak sahiplerindedir; LRCLIB topluluk
 * veritabanıdır. Geliştirme için uygundur; ticari sürüm öncesi söz lisansı
 * ayrıca değerlendirilmelidir (CLAUDE.md §12). Sonuç diske YAZILMAZ.
 */

import { httpGetJson, type AiHttpResponse } from '../../ai/nativeHttp';

export const LRCLIB_BASE = 'https://lrclib.net/api';
export const LRCLIB_TIMEOUT_MS = 8_000;
/** Süre toleransı — LRCLIB `/api/get` ile aynı mertebe. */
export const DURATION_TOLERANCE_SEC = 3;

export interface LyricsLookupQuery {
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  readonly durationSec: number | null;
}

export interface OnlineLyrics {
  readonly synced: readonly { readonly ms: number; readonly text: string }[] | null;
  readonly plain: string | null;
}

/** NOT_FOUND = arandı, yok · RETRY = ağ/sunucu hatası (sonra yeniden denenebilir). */
export type LyricsLookupOutcome =
  | { readonly kind: 'FOUND'; readonly lyrics: OnlineLyrics }
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'RETRY' };

const NOISE = /\s*[([{][^)\]}]*\b(official|video|audio|lyrics?|klip|visuali[sz]er|hd|4k|mv|resmi)\b[^)\]}]*[)\]}]\s*/gi;

/** Başlıktaki "(Official Video)" gibi gürültüyü atar; sözün kendisine dokunmaz. */
export function cleanTitle(title: string): string {
  return title.replace(NOISE, ' ').replace(/\s{2,}/g, ' ').trim();
}

const norm = (s: string): string =>
  s.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Kimlikten sorgu kurar. Sanatçı yoksa ve başlık "Sanatçı - Başlık" biçimindeyse
 * ayrıştırılır; yine de yoksa `null` (yalnız başlıkla arama yanlış eşleşme üretir).
 */
export function buildLyricsQuery(identity: {
  readonly title: string | null; readonly artist: string | null;
  readonly album: string | null; readonly durationMs: number | null;
}): LyricsLookupQuery | null {
  let title = identity.title ? cleanTitle(identity.title) : '';
  let artist = (identity.artist ?? '').trim();
  const split = splitArtistPrefix(title);
  if (split && !artist) {
    [artist, title] = split;
  } else if (split && norm(split[0]).startsWith(norm(artist))) {
    /* SAHA 2026-09-23: YouTube indirmelerinde etikette sanatçı VARKEN başlık
       yine "Sanatçı - Başlık" gelir ("Rojbin Kizil - LAWO DİNO"); önekli başlık
       LRCLIB'de 0 sonuç verdi, öneksiz aynı sorgu 3 eşleşme buldu. */
    title = split[1];
  }
  if (!title || !artist) return null;
  const durationSec = identity.durationMs && identity.durationMs > 0 ? Math.round(identity.durationMs / 1000) : null;
  return { title, artist, album: identity.album?.trim() || null, durationSec };
}

/** "Sanatçı - Başlık" ayırıcısı: boşluklu - – — veya -- ("feat. X -- Başlık"). */
const ARTIST_SEPARATOR = /\s+(?:--|[-–—])\s+/;

/** İlk ayırıcıdan böler; iki taraf da doluysa [sol, sağ], değilse `null`. */
function splitArtistPrefix(title: string): [string, string] | null {
  const m = ARTIST_SEPARATOR.exec(title);
  if (!m) return null;
  const left = title.slice(0, m.index).trim();
  const right = title.slice(m.index + m[0].length).trim();
  return left && right ? [left, right] : null;
}

/** "[mm:ss.xx]" damgalı LRC metnini sıralı satırlara çevirir; damga yoksa `null`. */
export function parseLrc(lrc: string): { ms: number; text: string }[] | null {
  const out: { ms: number; text: string }[] = [];
  for (const raw of lrc.split(/\r\n|\r|\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (stamps.length === 0) continue;   // [ar:..] gibi etiketler ve damgasız satırlar
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) : 0;
      out.push({ ms: Number(m[1]) * 60_000 + Number(m[2]) * 1000 + frac, text });
    }
  }
  if (out.length === 0) return null;
  return out.sort((a, b) => a.ms - b.ms);
}

interface LrclibItem {
  readonly trackName?: unknown; readonly artistName?: unknown; readonly duration?: unknown;
  readonly instrumental?: unknown; readonly plainLyrics?: unknown; readonly syncedLyrics?: unknown;
}

/** Aday listesinden GÜVENLİ eşleşmeyi seçer; yoksa `null` (uydurma YOK). */
export function pickLrclibMatch(items: readonly LrclibItem[], q: LyricsLookupQuery): OnlineLyrics | null {
  const wantTitle = norm(q.title);
  const wantArtist = norm(q.artist);
  const candidates = items.filter((it) => {
    if (it.instrumental === true) return false;
    const hasText = (typeof it.syncedLyrics === 'string' && it.syncedLyrics.trim())
      || (typeof it.plainLyrics === 'string' && it.plainLyrics.trim());
    if (!hasText) return false;
    if (q.durationSec !== null) {
      if (typeof it.duration !== 'number' || Math.abs(it.duration - q.durationSec) > DURATION_TOLERANCE_SEC) return false;
      /* "Sezen Aksu" ↔ "Sezen Aksu & Onur" gibi ortak kayıtlar: içerme iki yönlü. */
      const got = typeof it.artistName === 'string' ? norm(it.artistName) : '';
      return got.length > 0 && (got.includes(wantArtist) || wantArtist.includes(got));
    }
    return typeof it.trackName === 'string' && typeof it.artistName === 'string'
      && norm(it.trackName) === wantTitle && norm(it.artistName) === wantArtist;
  });
  /* Senkron olan tercih edilir; aynı değerde LRCLIB sırası korunur. */
  const best = candidates.find((c) => typeof c.syncedLyrics === 'string' && c.syncedLyrics.trim()) ?? candidates[0];
  if (!best) return null;
  const synced = typeof best.syncedLyrics === 'string' ? parseLrc(best.syncedLyrics) : null;
  const plain = typeof best.plainLyrics === 'string' && best.plainLyrics.trim() ? best.plainLyrics : null;
  if (!synced && !plain) return null;
  return { synced, plain };
}

export type LyricsHttpGet = (url: string, headers: Record<string, string>, timeoutMs: number) => Promise<AiHttpResponse>;

/** LRCLIB araması — ağ hatası `RETRY`, eşleşme yoksa `NOT_FOUND`. */
export async function lookupLrclib(q: LyricsLookupQuery, httpGet: LyricsHttpGet = httpGetJson): Promise<LyricsLookupOutcome> {
  const params = new URLSearchParams({ track_name: q.title, artist_name: q.artist });
  if (q.album) params.set('album_name', q.album);
  let res: AiHttpResponse;
  try {
    res = await httpGet(`${LRCLIB_BASE}/search?${params.toString()}`, {
      'User-Agent': 'CarOS-Pro', Accept: 'application/json',
    }, LRCLIB_TIMEOUT_MS);
  } catch {
    return { kind: 'RETRY' };
  }
  if (res.status === 404) return { kind: 'NOT_FOUND' };
  if (!res.ok) return { kind: 'RETRY' };
  let body: unknown;
  try { body = await res.json(); } catch { return { kind: 'RETRY' }; }
  if (!Array.isArray(body)) return { kind: 'NOT_FOUND' };
  const match = pickLrclibMatch(body as LrclibItem[], q);
  /* Albüm adı etiketlerde sık farklı yazılır: albümlü arama boş dönerse albümsüz bir kez daha. */
  if (!match && q.album) return lookupLrclib({ ...q, album: null }, httpGet);
  return match ? { kind: 'FOUND', lyrics: match } : { kind: 'NOT_FOUND' };
}
