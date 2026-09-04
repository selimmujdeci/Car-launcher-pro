/**
 * musicLyricsEntry.ts — MUSIC F16 · Şarkı sözü kimliği + kayıt şeması (SAF).
 *
 * ── ÖLÇÜLEN GERÇEK (F16 denetimi) ──────────────────────────────────────────
 * Repoda bir lyrics/altyazı otoritesi YOKTU (`grep -ri lyric` sıfır sonuç,
 * hem `src/` hem `android/`). Kaynak taraması:
 *   · LOCAL (media3 1.4.1 `Id3Decoder` bayt kodu doğrulandı) → USLT/SYLT için
 *     ÖZEL tipli çerçeve YOK, ikisi de `BinaryFrame`e (ham bayt) düşüyor.
 *     `TrackLyricsExtractor.java` (F16, yeni) bu ham baytı ID3v2 §4.9/§4.10
 *     spesifikasyonuna göre ELLE çözer. Vorbis `LYRICS`/`UNSYNCEDLYRICS`
 *     yorumu media3'ün `VorbisComment`ı tarafından ZATEN anahtar/değer
 *     olarak çözülüyor (F10.1'in `BPM` okumasıyla AYNI mekanizma) →
 *     AVAILABLE (gerçek, doğrulanmış kaynak).
 *   · Spotify (`api.spotify.com/v1`, `spotifyService.ts`) → genel Web API'de
 *     lyrics kaynağı/uç noktası YOK → UNSUPPORTED.
 *   · YouTube/Piped (`pipedProvider.ts`) → yanıt sözleşmesinde
 *     (`PipedSearchItem`/`PipedAudioStream`/Invidious) lyrics alanı YOK →
 *     UNSUPPORTED.
 *   · Kalıcı lyrics/cache modeli YOKTU (yeni modül).
 *
 * KİMLİK KURALI: F13/F15 ile AYNI ilke — `lyricsKeyFor` F13'ün
 * `favoriteKeyFor`ının kendisidir (yeniden İCAT EDİLMEDİ). Başlık/sanatçı
 * ASLA anahtarın parçası değildir; yanlış parçaya söz TAŞINMASIN diye
 * kimlik LOCAL `libraryId` veya PROVIDER `providerNamespace+providerId`dir.
 *
 * DÜRÜSTLÜK: `format: 'SYNCED'` yalnız GERÇEK milisaniye zaman damgası
 * (SYLT `timestampFormat==2`) taşıyan satırlar için kurulur. Tahmini/MPEG-
 * frame zamanlama ASLA `ms`ye çevrilmez (native taraf zaten reddeder — bkz.
 * `TrackLyricsExtractor.parseSylt`).
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

import { favoriteKeyFor as identityKeyFor } from '../collection/musicCollectionEntry';
import type { CanonicalMediaIdentity } from '../session/mediaIdentityMatching';

export const LYRICS_SCHEMA_VERSION = 1;
/** Sınırsız büyüme YOK — metin BPM/playlist kaydından ağırdır, önbellek dar tutulur. */
export const MAX_LYRICS_CACHE = 150;
/** Bozuk/çöp veriye karşı savunma — gerçek şarkı sözü bu sınırların altında kalır. */
export const MAX_LYRICS_LINES = 3000;
export const MAX_LINE_CHARS = 500;
export const MAX_PLAIN_CHARS = 200_000;

export type LyricsFormat = 'PLAIN' | 'SYNCED';

/**
 * Kanıt kökeni. `NONE` = arandı, bulunamadı (bu bir "henüz bilinmiyor"
 * DEĞİLDİR — bkz. `LyricsAvailability.UNKNOWN` ile karışmaz).
 */
export type LyricsProvenanceSource =
  | 'LOCAL_ID3_USLT' | 'LOCAL_ID3_SYLT' | 'LOCAL_VORBIS_COMMENT' | 'NONE';

export interface LyricsLine {
  /** SYNCED'de gerçek ms damgası; PLAIN'de HER ZAMAN `null` (uydurulmaz). */
  readonly ms: number | null;
  readonly text: string;
}

/** Kalıcı/önbellek kaydı — parça kimliği DIŞINDA sorgu/konum/ses metni TAŞIMAZ. */
export interface LyricsResult {
  readonly schemaVersion: typeof LYRICS_SCHEMA_VERSION;
  /** Kararlı anahtar — bkz. `lyricsKeyFor`. */
  readonly key: string;
  readonly format: LyricsFormat;
  readonly lines: readonly LyricsLine[];
  readonly source: Exclude<LyricsProvenanceSource, 'NONE'>;
  readonly fetchedAtMs: number;
  /** Yalnız LOCAL: dosya değişim kuşağı — bayat kanıt kullanılmasın (F10.1 ile AYNI ilke). */
  readonly generationModified: number | null;
}

export type LyricsAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';

/** `getListeningSession().currentItem` ile AYNI kimlik — yeni bir kimlik İCAT EDİLMEZ. */
export const lyricsKeyFor = identityKeyFor;

/**
 * Native'den gelen ham satırları GÜVENLİ sınırlara indirger.
 *
 * Aşırı büyük/çok satırlı sonuç gerçek şarkı sözü DEĞİL, bozuk/çöp veri
 * belirtisidir — bu durumda KISMİ/BOZUK metin göstermek yerine dürüstçe
 * `null` (bulunamadı) dönmek tercih edilir (fail-closed, §5).
 */
export function sanitizeSyncedLines(
  raw: readonly { readonly ms: number; readonly text: string }[],
): readonly LyricsLine[] | null {
  if (raw.length === 0 || raw.length > MAX_LYRICS_LINES) return null;
  const out: LyricsLine[] = [];
  let lastMs = -1;
  for (const r of raw) {
    if (!Number.isFinite(r.ms) || r.ms < 0) return null;
    if (typeof r.text !== 'string' || r.text.length > MAX_LINE_CHARS) return null;
    /* SYLT çerçevesi ZATEN zaman sırasıyla gelir; burada yeniden garanti
       edilir — aktif satır projeksiyonu (`activeLyricsLineIndex`) ikili
       arama kullanır ve MONOTON artan `ms` varsayar. */
    if (r.ms < lastMs) return null;
    lastMs = r.ms;
    out.push({ ms: r.ms, text: r.text });
  }
  return Object.freeze(out);
}

/** Düz metni satırlara böler ve sınırlar — aşırı büyük/çok satırlı metin REDDEDİLİR. */
export function sanitizePlainText(raw: string): readonly LyricsLine[] | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_PLAIN_CHARS) return null;
  const rawLines = raw.split(/\r\n|\r|\n/);
  if (rawLines.length > MAX_LYRICS_LINES) return null;
  const out: LyricsLine[] = [];
  for (const line of rawLines) {
    if (line.length > MAX_LINE_CHARS) return null;
    out.push({ ms: null, text: line });
  }
  return Object.freeze(out);
}

export function makeLyricsResult(
  identity: CanonicalMediaIdentity,
  format: LyricsFormat,
  lines: readonly LyricsLine[],
  source: Exclude<LyricsProvenanceSource, 'NONE'>,
  nowMs: number,
  generationModified: number | null,
): LyricsResult | null {
  const key = lyricsKeyFor(identity);
  if (key === null) return null;
  return Object.freeze({
    schemaVersion: LYRICS_SCHEMA_VERSION, key, format, lines: Object.freeze([...lines]),
    source, fetchedAtMs: nowMs, generationModified,
  });
}

/** Fail-closed kalıcı kayıt ayrıştırıcı — şema/alan uyuşmazlığında `null`. */
export function parseLyricsResult(raw: unknown): LyricsResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== LYRICS_SCHEMA_VERSION) return null;
  if (typeof r.key !== 'string' || r.key.length === 0) return null;
  if (r.format !== 'PLAIN' && r.format !== 'SYNCED') return null;
  if (r.source !== 'LOCAL_ID3_USLT' && r.source !== 'LOCAL_ID3_SYLT' && r.source !== 'LOCAL_VORBIS_COMMENT') return null;
  if (typeof r.fetchedAtMs !== 'number' || !Number.isFinite(r.fetchedAtMs)) return null;
  if (r.generationModified !== null && typeof r.generationModified !== 'number') return null;
  if (!Array.isArray(r.lines) || r.lines.length === 0 || r.lines.length > MAX_LYRICS_LINES) return null;
  const lines: LyricsLine[] = [];
  for (const item of r.lines) {
    if (typeof item !== 'object' || item === null) return null;
    const l = item as Record<string, unknown>;
    if (typeof l.text !== 'string' || l.text.length > MAX_LINE_CHARS) return null;
    if (l.ms !== null && (typeof l.ms !== 'number' || !Number.isFinite(l.ms) || l.ms < 0)) return null;
    lines.push({ ms: l.ms === null ? null : (l.ms as number), text: l.text });
  }
  return Object.freeze({
    schemaVersion: LYRICS_SCHEMA_VERSION, key: r.key, format: r.format,
    lines: Object.freeze(lines), source: r.source,
    fetchedAtMs: r.fetchedAtMs, generationModified: r.generationModified as number | null,
  });
}
