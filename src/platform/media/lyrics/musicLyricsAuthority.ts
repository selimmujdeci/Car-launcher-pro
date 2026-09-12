/**
 * musicLyricsAuthority.ts — MUSIC F16 · TEK şarkı sözü otoritesi.
 *
 * SAHİPLİK (CLAUDE.md §ONE DOMAIN = ONE AUTHORITY):
 *   SAHİP OLUR: lyrics kaynağını çözme (native gömülü etiket) · provenance ·
 *   plain/synced ayrımı · zamanlanmış satır normalize etme · bounded cache ·
 *   freshness (dosya değişince eski kanıt düşer) · aktif satır projeksiyonu.
 *   SAHİP OLMAZ: playback truth (F0) · PlayQueue/ListeningSession (F3) —
 *   yalnız `getListeningSession()`i OKUR · MusicIndex (F2)'nin ikinci kopyası
 *   DEĞİLDİR, yalnız `generationModified` için OKUR.
 *
 * SENKRON PROJEKSİYON: ikinci bir playback clock/timer/polling KURULMAZ.
 * `activeLyricsLineIndex` SAF bir fonksiyondur — mevcut playback pozisyonunu
 * (Now Playing'in ZATEN sahip olduğu `music.progress.positionSec`, F7.3'ün
 * mevcut interpolasyon döngüsünden gelir) PARAMETRE olarak alır, kendi
 * zamanlayıcısını KURMAZ. Seek → pozisyon değişir → aynı saf fonksiyon aynı
 * turda yeni indeksi verir (ikinci "aktif satır" gerçeği İCAT EDİLMEZ).
 *
 * KALICILIK: `safeStorage.getItem/setItem` — F13/F15 ile AYNI desen, AYRI
 * anahtar (`caros.music.f16.lyrics.v1`). Yalnız LOCAL kaynaklı (bizim kendi
 * dosyamızdan çıkardığımız) sonuçlar kalıcı olur — üçüncü taraf sağlayıcı
 * ToS'u burada söz konusu DEĞİLDİR (bugün hiçbir sağlayıcı bağlı değil, §9).
 *
 * PERFORMANS: aktif satır arama İKİLİ ARAMADIR (O(log n)) — her render
 * turunda tüm satırları taramaz (§12).
 */

import { safeStorage } from '../../../utils/safeStorage';
import { getMusicLibrarySnapshot } from '../musicIndex';
import type { CanonicalMediaIdentity } from '../session/mediaIdentityMatching';
import type { SourceClass } from '../authority/sourceCapabilities';
import {
  LYRICS_SCHEMA_VERSION, MAX_LYRICS_CACHE,
  lyricsKeyFor, makeLyricsResult, parseLyricsResult,
  sanitizePlainText, sanitizeSyncedLines,
  type LyricsResult, type LyricsLine, type LyricsFormat, type LyricsAvailability,
} from './musicLyricsEntry';
import {
  noteResolved, noteUnknown, noteCacheHit, noteCacheMiss, noteCacheStaleDropped,
  noteIdentityMismatchRejected, noteParseFailure, noteFakeSyncPrevented,
  notePersistWriteFailure, notePersistLoadRejectedRecord, noteSyncProjectionLatency,
} from './musicLyricsTelemetry';

const STORAGE_KEY = 'caros.music.f16.lyrics.v1';

/** `null` = arandı, bulunamadı (dürüst NEGATİF sonuç — her açılışta yeniden native'e sorulmaz). */
type CacheValue = LyricsResult | null;

let cache = new Map<string, CacheValue>();
let loaded = false;
const subs = new Set<() => void>();

function notify(): void { subs.forEach((fn) => fn()); }

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  let raw: unknown = null;
  try { raw = safeStorage.getItem(STORAGE_KEY); } catch { raw = null; }
  if (typeof raw !== 'string' || !raw) return;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return; }
  const list = parsed && typeof parsed === 'object' ? (parsed as { records?: unknown }).records : null;
  if (!Array.isArray(list)) return;
  for (const item of list) {
    const r = parseLyricsResult(item);
    if (r === null) { notePersistLoadRejectedRecord(); continue; }
    cache.set(r.key, r);
  }
}

/** Yalnız LOCAL kaynaklı POZİTİF sonuçlar kalıcı olur (§9 — sağlayıcı ToS'u yoksa cache YOK). */
function persist(): void {
  try {
    const records = Array.from(cache.values()).filter(
      (v): v is LyricsResult => v !== null && v.source.startsWith('LOCAL_'),
    ).slice(-MAX_LYRICS_CACHE);
    safeStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: LYRICS_SCHEMA_VERSION, records }));
  } catch {
    notePersistWriteFailure();
  }
}

function cacheSet(key: string, value: CacheValue): void {
  cache.set(key, value);
  while (cache.size > MAX_LYRICS_CACHE) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  if (value !== null) persist();
  notify();
}

export function subscribeLyricsCache(listener: () => void): () => void {
  ensureLoaded();
  subs.add(listener);
  return () => subs.delete(listener);
}

/* ── Senkron okuma (native çağrısı YOK) ──────────────────────────────────── */

export interface LyricsQueryResult {
  readonly availability: LyricsAvailability;
  readonly result: LyricsResult | null;
}

const UNKNOWN_RESULT: LyricsQueryResult = Object.freeze({ availability: 'UNKNOWN', result: null });
const UNAVAILABLE_RESULT: LyricsQueryResult = Object.freeze({ availability: 'UNAVAILABLE', result: null });

/**
 * Yalnız ÖNBELLEKTEN okur — native çağırmaz, senkrondur.
 * Kimlik kanıtsızsa (§3 fail-closed) `UNAVAILABLE` döner.
 */
export function peekLyrics(identity: CanonicalMediaIdentity | null): LyricsQueryResult {
  ensureLoaded();
  const key = identity ? lyricsKeyFor(identity) : null;
  if (key === null) { noteIdentityMismatchRejected(); return UNAVAILABLE_RESULT; }
  if (!cache.has(key)) { noteCacheMiss(); noteUnknown(); return UNKNOWN_RESULT; }
  noteCacheHit();
  const value = cache.get(key)!;
  if (value === null) return UNAVAILABLE_RESULT;
  /* Dosya değiştiyse (generationModified ilerledi) bayat kanıt KULLANILMAZ. */
  if (value.source.startsWith('LOCAL_') && identity!.libraryId) {
    const track = getMusicLibrarySnapshot().tracks.find((t) => t.id === identity!.libraryId);
    if (track && track.generationModified !== value.generationModified) {
      cache.delete(key);
      noteCacheStaleDropped();
      return UNKNOWN_RESULT;
    }
  }
  return Object.freeze({ availability: 'AVAILABLE', result: value });
}

/* ── Asenkron çözümleme (yalnız LOCAL + cache miss'te native çağırır) ────── */

/** Test/DI dikişi — gerçek native çağrısı yerine geçer. */
let _nativeReader: ((uris: string[]) => Promise<{
  results: readonly { uri: string; plain: string | null; synced: readonly { ms: number; text: string }[] | null; source: string }[];
}>) | null = null;

export function _setNativeLyricsReaderForTest(fn: typeof _nativeReader): void { _nativeReader = fn; }

async function readNative(uri: string): ReturnType<NonNullable<typeof _nativeReader>> {
  if (_nativeReader) return _nativeReader([uri]);
  const { CarLauncher } = await import('../../nativePlugin');
  return CarLauncher.readEmbeddedLyrics({ uris: [uri] });
}

/**
 * Kimliğin lyrics'ini çözer — önce önbellek, sonra (yalnız LOCAL + gerçek
 * `contentUri` varsa) native gömülü etiket okuması. PROVIDER kaynaklarda
 * bugün BAĞLI hiçbir lyrics sağlayıcısı YOK (§1 ölçümü) — native ÇAĞRILMAZ,
 * dürüstçe `UNAVAILABLE` döner (uydurma/varsayım YOK).
 */
export async function primeLyricsForCurrentItem(
  identity: CanonicalMediaIdentity | null, sourceClass: SourceClass | null, nowMs = Date.now(),
): Promise<LyricsQueryResult> {
  ensureLoaded();
  const key = identity ? lyricsKeyFor(identity) : null;
  if (key === null || identity === null) { noteIdentityMismatchRejected(); return UNAVAILABLE_RESULT; }

  const cached = peekLyrics(identity);
  if (cached.availability !== 'UNKNOWN') return cached;

  if (sourceClass !== 'LOCAL' || !identity.libraryId) {
    /* Sağlayıcı kaynağı bugün DESTEKLENMİYOR (§1) — native ÇAĞRILMAZ. */
    cacheSet(key, null);
    noteResolved(null, 'NONE', nowMs);
    return UNAVAILABLE_RESULT;
  }
  const track = getMusicLibrarySnapshot().tracks.find((t) => t.id === identity.libraryId);
  if (!track || !track.contentUri) {
    cacheSet(key, null);
    noteResolved(null, 'NONE', nowMs);
    return UNAVAILABLE_RESULT;
  }

  try {
    const res = await readNative(track.contentUri);
    const row = res.results.find((r) => r.uri === track.contentUri) ?? res.results[0] ?? null;
    if (!row || row.source === 'NONE') {
      cacheSet(key, null);
      noteResolved(null, 'NONE', nowMs);
      return UNAVAILABLE_RESULT;
    }
    let lines: readonly LyricsLine[] | null = null;
    let format: LyricsFormat = 'PLAIN';
    if (row.source === 'ID3_SYLT' && row.synced) {
      lines = sanitizeSyncedLines(row.synced);
      format = 'SYNCED';
      if (lines === null) noteFakeSyncPrevented();
    } else if (row.plain) {
      lines = sanitizePlainText(row.plain);
      format = 'PLAIN';
    }
    if (lines === null) {
      noteParseFailure();
      cacheSet(key, null);
      noteResolved(null, 'NONE', nowMs);
      return UNAVAILABLE_RESULT;
    }
    /* Native taraf kaynağı `ID3_USLT`/`ID3_SYLT`/`VORBIS_LYRICS` olarak
       raporlar (bkz. `TrackLyricsExtractor.java` — bugün YALNIZ LOCAL
       okur); kalıcı şema provenance'ı `LOCAL_` önekiyle taşır — burada
       gerçek bir EŞLEME yapılır, ham değer sessizce CAST EDİLMEZ. */
    const sourceMap: Readonly<Record<string, 'LOCAL_ID3_USLT' | 'LOCAL_ID3_SYLT' | 'LOCAL_VORBIS_COMMENT'>> = {
      ID3_USLT: 'LOCAL_ID3_USLT', ID3_SYLT: 'LOCAL_ID3_SYLT', VORBIS_LYRICS: 'LOCAL_VORBIS_COMMENT',
    };
    const mappedSource = sourceMap[row.source];
    if (mappedSource === undefined) {
      noteParseFailure();
      cacheSet(key, null);
      noteResolved(null, 'NONE', nowMs);
      return UNAVAILABLE_RESULT;
    }
    const result = makeLyricsResult(identity, format, lines, mappedSource, nowMs, track.generationModified);
    if (result === null) { noteIdentityMismatchRejected(); return UNAVAILABLE_RESULT; }
    cacheSet(key, result);
    noteResolved(format, result.source, nowMs);
    return Object.freeze({ availability: 'AVAILABLE', result });
  } catch {
    /* Native yoksa (tarayıcı) veya izin reddedildiyse: kanıt YOK, uydurma YOK. */
    noteUnknown();
    return UNKNOWN_RESULT;
  }
}

/* ── Aktif satır projeksiyonu (SAF, ikili arama — §12) ───────────────────── */

/**
 * `positionSec`e karşılık gelen SON satırın indeksini döner (yoksa -1).
 * O(log n) — bounded/indexed arama, her render turunda LİNEER TARAMA YOK.
 * Satırların `ms` değeri MONOTON ARTAN olduğu `sanitizeSyncedLines`te
 * GARANTİ EDİLİR; bu fonksiyon o garantiye güvenir.
 */
export function activeLyricsLineIndex(lines: readonly LyricsLine[], positionSec: number): number {
  if (lines.length === 0 || !Number.isFinite(positionSec) || positionSec < 0) return -1;
  const posMs = positionSec * 1000;
  let lo = 0; let hi = lines.length - 1; let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const ms = lines[mid]!.ms;
    if (ms === null) return -1; // PLAIN satırında aktif satır kavramı YOK
    if (ms <= posMs) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}

/** UI'ın çağırdığı tek giriş noktası — gecikmeyi de ölçer (LAB p50/p95). */
export function getActiveLyricsLine(lines: readonly LyricsLine[], positionSec: number): LyricsLine | null {
  const startedAt = Date.now();
  const idx = activeLyricsLineIndex(lines, positionSec);
  noteSyncProjectionLatency(Date.now() - startedAt);
  return idx >= 0 ? lines[idx]! : null;
}

export function getLyricsCacheSize(): number { ensureLoaded(); return cache.size; }

export function _resetMusicLyricsAuthorityForTest(): void {
  cache = new Map();
  loaded = false;
  subs.clear();
  _nativeReader = null;
  try { safeStorage.removeItem(STORAGE_KEY); } catch { /* test ortamı — yoksay */ }
}
