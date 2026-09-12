/**
 * searchTelemetry.ts — F5 · Arama kanıt deposu (bounded, salt gözlem).
 *
 * GİZLİLİK (CLAUDE.md gözlemlenebilirlik kuralı 6): **sorgu metni BURAYA
 * GİRMEZ.** Kullanıcının ne aradığı kişisel veridir; yalnız uzunluk, adet,
 * durum ve süre tutulur. Parça başlığı · sanatçı · URI de taşınmaz.
 *
 * DÜRÜSTLÜK: ölçülmemiş alan `null` kalır — sahte 0 üretilmez.
 *
 * OTORİTE SINIRI: telemetri arama SONUCUNU ETKİLEMEZ; sayaçlar hiçbir sıralama
 * veya seçim kararına geri beslenmez.
 */
import type { ProviderId } from '../providers';

const CAP = 64;
/** Saklanan en fazla kaynak-turu kaydı. */
export const MAX_SOURCE_RECORDS = 24;

function push(buf: Float64Array, count: number, value: number): number {
  buf[count % CAP] = value; return count + 1;
}
function percentile(buf: Float64Array, count: number, p: number): number | null {
  const n = Math.min(count, CAP); if (n === 0) return null;
  const copy = Array.from(buf.subarray(0, n)).sort((a, b) => a - b);
  return copy[Math.min(n - 1, Math.ceil(n * p) - 1)] ?? null;
}

const localMs = new Float64Array(CAP);
const providerMs = new Float64Array(CAP);
const firstResultMs = new Float64Array(CAP);
const completeMs = new Float64Array(CAP);
const projectionMs = new Float64Array(CAP);
const indexLookupMs = new Float64Array(CAP);
let localN = 0; let providerN = 0; let firstN = 0; let completeN = 0;
let projectionN = 0; let indexLookupN = 0;

export interface SearchCounters {
  queries: number;
  emptyQueries: number;
  rawResults: number;
  normalizedResults: number;
  dedupMerged: number;
  dedupAmbiguousKept: number;
  staleResultDrops: number;
  cancellations: number;
  providerFailures: number;
  providerUnsupportedSkips: number;
  providerUnavailableSkips: number;
  indexBuilds: number;
  selections: number;
  selectionRejected: number;
  /* F5.1 · Sesli hat + kayıt defteri + eski yol */
  voiceQueries: number;
  voiceAutoPlayed: number;
  voiceAmbiguousHeld: number;
  legacySearchCalls: number;
}

const EMPTY_COUNTERS = (): SearchCounters => ({
  queries: 0, emptyQueries: 0, rawResults: 0, normalizedResults: 0,
  dedupMerged: 0, dedupAmbiguousKept: 0, staleResultDrops: 0, cancellations: 0,
  providerFailures: 0, providerUnsupportedSkips: 0, providerUnavailableSkips: 0,
  indexBuilds: 0, selections: 0, selectionRejected: 0,
  voiceQueries: 0, voiceAutoPlayed: 0, voiceAmbiguousHeld: 0, legacySearchCalls: 0,
});

/** Bir kaynağın tek arama turundaki sonucu — PII taşımaz. */
export interface SourceRunRecord {
  readonly providerId: ProviderId;
  readonly outcome: 'OK' | 'EMPTY' | 'FAILED' | 'TIMEOUT' | 'SKIPPED_UNSUPPORTED' | 'SKIPPED_UNAVAILABLE';
  readonly resultCount: number;
  readonly elapsedMs: number | null;
  readonly generation: number;
}

const _counters: SearchCounters = EMPTY_COUNTERS();
const _sourceRuns: SourceRunRecord[] = [];

let _lastGeneration = 0;
let _lastState: string | null = null;
let _lastQueryLength: number | null = null;
let _lastEligibleSources: readonly ProviderId[] = [];
let _lastIndexRows: number | null = null;
let _lastFinalCount: number | null = null;
/** Son sıralamanın gerekçe özeti — sorgu metni DEĞİL, yalnız sinyal adları. */
let _lastRankingSignals: readonly string[] = [];

/* ── Yazma kapıları (hepsi fail-soft) ────────────────────────────────────── */

export function noteQueryStarted(input: {
  readonly generation: number; readonly queryLength: number;
  readonly eligible: readonly ProviderId[];
}): void {
  try {
    _counters.queries += 1;
    if (input.queryLength === 0) _counters.emptyQueries += 1;
    _lastGeneration = input.generation;
    _lastQueryLength = input.queryLength;
    _lastEligibleSources = Object.freeze([...input.eligible]);
    _lastState = 'SEARCHING';
  } catch { /* fail-soft */ }
}

export function noteSourceRun(record: SourceRunRecord): void {
  try {
    if (record.outcome === 'FAILED' || record.outcome === 'TIMEOUT') _counters.providerFailures += 1;
    if (record.outcome === 'SKIPPED_UNSUPPORTED') _counters.providerUnsupportedSkips += 1;
    if (record.outcome === 'SKIPPED_UNAVAILABLE') _counters.providerUnavailableSkips += 1;
    _counters.rawResults += Math.max(0, record.resultCount);
    if (record.elapsedMs !== null) {
      if (record.providerId === 'local') localN = push(localMs, localN, record.elapsedMs);
      else providerN = push(providerMs, providerN, record.elapsedMs);
    }
    _sourceRuns.push(Object.freeze({ ...record }));
    while (_sourceRuns.length > MAX_SOURCE_RECORDS) _sourceRuns.shift();
  } catch { /* fail-soft */ }
}

export function noteFirstResult(elapsedMs: number): void {
  firstN = push(firstResultMs, firstN, Math.max(0, elapsedMs));
}

export function noteSearchComplete(input: {
  readonly elapsedMs: number; readonly state: string; readonly finalCount: number;
}): void {
  completeN = push(completeMs, completeN, Math.max(0, input.elapsedMs));
  _lastState = input.state;
  _lastFinalCount = input.finalCount;
}

export function noteSearchState(state: string): void { _lastState = state; }

export function noteProjection(input: {
  readonly elapsedMs: number; readonly normalized: number;
  readonly merged: number; readonly ambiguousKept: number;
  readonly topSignals: readonly string[];
}): void {
  try {
    projectionN = push(projectionMs, projectionN, Math.max(0, input.elapsedMs));
    _counters.normalizedResults += Math.max(0, input.normalized);
    _counters.dedupMerged += Math.max(0, input.merged);
    _counters.dedupAmbiguousKept += Math.max(0, input.ambiguousKept);
    _lastRankingSignals = Object.freeze(input.topSignals.slice(0, 8));
  } catch { /* fail-soft */ }
}

/** Bayat sonuç düşürüldü — eski sorgu yenisini EZEMEZ. */
export function noteStaleResultDropped(): void { _counters.staleResultDrops += 1; }
export function noteCancellation(): void { _counters.cancellations += 1; }
export function noteIndexBuild(elapsedMs: number, rows: number): void {
  _counters.indexBuilds += 1;
  _lastIndexRows = rows;
  indexLookupN = push(indexLookupMs, indexLookupN, Math.max(0, elapsedMs));
}
export function noteIndexLookup(elapsedMs: number, _hits: number): void {
  indexLookupN = push(indexLookupMs, indexLookupN, Math.max(0, elapsedMs));
}
/* ── F5.1 kapıları ───────────────────────────────────────────────────────── */

let _registeredProviders = 0;
let _excludedProviders = 0;
const voiceSearchMs = new Float64Array(CAP);
const voiceSelectionMs = new Float64Array(CAP);
let voiceSearchN = 0; let voiceSelectionN = 0;

export function noteRegistry(registered: number, excluded: number): void {
  _registeredProviders = registered;
  _excludedProviders = excluded;
}

export function noteVoiceSearch(elapsedMs: number, _resultCount: number): void {
  _counters.voiceQueries += 1;
  voiceSearchN = push(voiceSearchMs, voiceSearchN, Math.max(0, elapsedMs));
}

export function noteVoiceSelection(elapsedMs: number, started: boolean): void {
  if (started) _counters.voiceAutoPlayed += 1;
  voiceSelectionN = push(voiceSelectionMs, voiceSelectionN, Math.max(0, elapsedMs));
}

/** Belirsizlik nedeniyle otomatik çalma YAPILMADI — bu bir koruma kanıtıdır. */
export function noteVoiceAmbiguousHeld(): void { _counters.voiceAmbiguousHeld += 1; }

const discoveryMs = new Float64Array(CAP);
let discoveryN = 0;
let _discoverySections: number | null = null;
let _discoveryRows: number | null = null;
let _discoverySuppressed: number | null = null;

/** Keşif projeksiyonu ölçümü — kanıt yokluğuyla BASTIRILAN bölüm sayısı dâhil. */
export function noteDiscoveryProjection(input: {
  readonly elapsedMs: number; readonly sections: number;
  readonly rows: number; readonly suppressed: number;
}): void {
  try {
    discoveryN = push(discoveryMs, discoveryN, Math.max(0, input.elapsedMs));
    _discoverySections = input.sections;
    _discoveryRows = input.rows;
    _discoverySuppressed = input.suppressed;
  } catch { /* fail-soft */ }
}

/**
 * Eski (kanonik olmayan) arama yolunun çağrıldığı gözlendi.
 *
 * Sıfırdan büyük olması, bir yerde hâlâ ikinci bir orkestrasyonun kullanıldığını
 * gösterir ve LAB'da GÖRÜNÜR — sessiz bir mimari kaçak bırakılmaz.
 */
export function noteLegacySearchCall(): void { _counters.legacySearchCalls += 1; }

export function noteSelection(accepted: boolean): void {
  if (accepted) _counters.selections += 1;
  else _counters.selectionRejected += 1;
}

/* ── Okuma ───────────────────────────────────────────────────────────────── */

export interface SearchTelemetrySnapshot {
  readonly status: 'OBSERVED' | 'UNAVAILABLE';
  readonly counters: Readonly<SearchCounters>;
  readonly localSearchP50Ms: number | null;
  readonly localSearchP95Ms: number | null;
  readonly providerSearchP50Ms: number | null;
  readonly providerSearchP95Ms: number | null;
  readonly firstResultP50Ms: number | null;
  readonly completeSearchP50Ms: number | null;
  readonly completeSearchP95Ms: number | null;
  readonly projectionP50Ms: number | null;
  readonly indexLookupP50Ms: number | null;
  readonly indexLookupP95Ms: number | null;
  readonly lastGeneration: number;
  readonly lastState: string | null;
  /** Sorgu METNİ değil, yalnız uzunluğu (gizlilik). */
  readonly lastQueryLength: number | null;
  readonly lastEligibleSources: readonly ProviderId[];
  readonly lastIndexRows: number | null;
  readonly lastFinalCount: number | null;
  readonly lastRankingSignals: readonly string[];
  readonly recentSourceRuns: readonly SourceRunRecord[];
  readonly sourceRunCapacity: number;
  /* F5.1 */
  readonly registeredProviders: number;
  readonly excludedProviders: number;
  readonly voiceSearchP50Ms: number | null;
  readonly voiceSelectionP50Ms: number | null;
  readonly discoveryProjectionP50Ms: number | null;
  readonly discoverySections: number | null;
  readonly discoveryRows: number | null;
  readonly discoverySuppressedSections: number | null;
}

export function getSearchTelemetrySnapshot(): SearchTelemetrySnapshot {
  return Object.freeze({
    status: _counters.queries > 0 ? 'OBSERVED' as const : 'UNAVAILABLE' as const,
    counters: { ..._counters },
    localSearchP50Ms: percentile(localMs, localN, .5),
    localSearchP95Ms: percentile(localMs, localN, .95),
    providerSearchP50Ms: percentile(providerMs, providerN, .5),
    providerSearchP95Ms: percentile(providerMs, providerN, .95),
    firstResultP50Ms: percentile(firstResultMs, firstN, .5),
    completeSearchP50Ms: percentile(completeMs, completeN, .5),
    completeSearchP95Ms: percentile(completeMs, completeN, .95),
    projectionP50Ms: percentile(projectionMs, projectionN, .5),
    indexLookupP50Ms: percentile(indexLookupMs, indexLookupN, .5),
    indexLookupP95Ms: percentile(indexLookupMs, indexLookupN, .95),
    lastGeneration: _lastGeneration,
    lastState: _lastState,
    lastQueryLength: _lastQueryLength,
    lastEligibleSources: _lastEligibleSources,
    lastIndexRows: _lastIndexRows,
    lastFinalCount: _lastFinalCount,
    lastRankingSignals: _lastRankingSignals,
    recentSourceRuns: _sourceRuns.slice(),
    sourceRunCapacity: MAX_SOURCE_RECORDS,
    registeredProviders: _registeredProviders,
    excludedProviders: _excludedProviders,
    voiceSearchP50Ms: percentile(voiceSearchMs, voiceSearchN, .5),
    voiceSelectionP50Ms: percentile(voiceSelectionMs, voiceSelectionN, .5),
    discoveryProjectionP50Ms: percentile(discoveryMs, discoveryN, .5),
    discoverySections: _discoverySections,
    discoveryRows: _discoveryRows,
    discoverySuppressedSections: _discoverySuppressed,
  });
}

export function _resetSearchTelemetryForTest(): void {
  Object.assign(_counters, EMPTY_COUNTERS());
  _sourceRuns.length = 0;
  localN = 0; providerN = 0; firstN = 0; completeN = 0; projectionN = 0; indexLookupN = 0;
  _lastGeneration = 0; _lastState = null; _lastQueryLength = null;
  _lastEligibleSources = []; _lastIndexRows = null; _lastFinalCount = null;
  _lastRankingSignals = [];
  _registeredProviders = 0; _excludedProviders = 0;
  voiceSearchN = 0; voiceSelectionN = 0;
  discoveryN = 0; _discoverySections = null; _discoveryRows = null;
  _discoverySuppressed = null;
}
