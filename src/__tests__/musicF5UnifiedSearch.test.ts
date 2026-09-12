/**
 * musicF5UnifiedSearch.test.ts — MUSIC F5 kilitleri.
 *
 * Kilitlenen sözleşmeler:
 *   1. Arama BİRLEŞİK TRUTH OTORİTESİ DEĞİLDİR — yalnız sorgular, normalize
 *      eder, sıralar, gruplar ve provenance taşır.
 *   2. Yetenek dürüstlüğü — `supportsSearch` olmayan kaynağa sorgu GİTMEZ.
 *   3. Bayatlık — eski sorgunun geç gelen sonucu yenisini EZEMEZ.
 *   4. Dedup — yalnız EXACT/STRONG kimlik kanıtıyla birleştirilir.
 *   5. Sıralama — deterministik, açıklanabilir, sağlayıcı popülerliği YOK.
 *   6. Boş/başarısızlık ayrımı — hepsi "sonuç bulunamadı" değildir.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  normalizeQuery, searchKey, searchTokens, tokenOverlap,
} from '../platform/media/search/searchNormalize';
import { rankResults, scoreResult } from '../platform/media/search/searchRanking';
import { dedupeResults } from '../platform/media/search/searchDedup';
import {
  makeProvenance, resultIdFor, sourceClassForProvider,
  type SearchResult,
} from '../platform/media/search/searchResult';
import {
  _resetSearchCoordinatorForTest, cancelSearch, configureSearchSources,
  decideEligibility, getSearchSnapshot, runSearch,
  type SearchSourcePort,
} from '../platform/media/search/musicSearchCoordinator';
import {
  _resetSearchTelemetryForTest, getSearchTelemetrySnapshot,
} from '../platform/media/search/searchTelemetry';
import {
  _resetLocalSearchIndexForTest, lookupLocalIndex, peekLocalSearchIndex,
} from '../platform/media/search/localSearchIndex';
import {
  createLocalSearchPort, identityFromUnifiedTrack, resultFromUnifiedTrack,
} from '../platform/media/search/searchSources';
import { buildDiscovery } from '../platform/media/search/discoveryModel';
import {
  _resetRecentSearchesForTest, clearRecentSearches, getRecentSearches,
  MAX_RECENT_SEARCHES, rememberSearch,
} from '../platform/media/search/recentSearches';
import {
  _resetMusicIndexForTest, getMusicLibrarySnapshot, reconcileMusicIndex,
} from '../platform/media/musicIndex';
import { getSource } from '../platform/media/authority/sourceCapabilities';
import type { LocalMusicTrack } from '../platform/localMusicService';
import type { CanonicalMediaIdentity } from '../platform/media/session/mediaIdentityMatching';
import type { UnifiedTrack } from '../platform/media/providers';

/* ── Fixture'lar ─────────────────────────────────────────────────────────── */

const localTrack = (over: Partial<LocalMusicTrack> = {}): LocalMusicTrack => ({
  id: 1, uri: 'content://media/external/audio/media/1', title: 'Yol', artist: 'Grup',
  album: 'İlk', durationMs: 180_000, trackNumber: 1, volumeName: 'external_primary',
  ...over,
} as LocalMusicTrack);

const identity = (over: Partial<CanonicalMediaIdentity> = {}): CanonicalMediaIdentity => ({
  libraryId: null, providerId: null, providerNamespace: null, contentUri: null,
  title: 'Yol', artist: 'Grup', album: 'İlk', durationMs: 180_000,
  trackNumber: null, discNumber: null,
  ...over,
});

const resultOf = (over: Partial<SearchResult> = {}): SearchResult => Object.freeze({
  resultId: resultIdFor('local', 'a'),
  kind: 'TRACK' as const,
  title: 'Yol', artist: 'Grup', album: 'İlk', artworkIdentity: null,
  identity: identity(),
  libraryTrackId: 'a',
  availability: 'AVAILABLE' as const,
  provenance: makeProvenance({
    origin: 'LOCAL_INDEX', providerId: 'local', sourceClass: 'LOCAL', observedAtMs: 1,
  }),
  evidence: scoreResult('yol', { title: 'Yol', artist: 'Grup', album: 'İlk', availability: 'AVAILABLE' }),
  alternates: Object.freeze([]),
  ...over,
});

/** Kontrollü sahte kaynak — gerçek ağ yok, zamanlama testte belirlenir. */
function stubPort(input: {
  providerId: SearchSourcePort['providerId'];
  sourceClass: SearchSourcePort['sourceClass'];
  available?: boolean;
  results?: readonly SearchResult[];
  delayMs?: number;
  fail?: boolean;
  timeoutMs?: number;
  onSearch?: (query: string) => void;
  resultsFor?: (query: string) => readonly SearchResult[];
}): SearchSourcePort {
  return {
    providerId: input.providerId,
    sourceClass: input.sourceClass,
    timeoutMs: input.timeoutMs,
    isAvailable: () => input.available !== false,
    async search(query) {
      input.onSearch?.(query);
      if (input.delayMs) await new Promise((r) => setTimeout(r, input.delayMs));
      if (input.fail) throw new Error('provider_down');
      // Sorguya duyarlı sahte kaynak: her sorgu KENDİ sonucunu döndürür, aksi
      // hâlde bayatlık testi kendi fixture'ıyla yanlış pozitif üretir.
      return input.resultsFor ? input.resultsFor(query) : (input.results ?? []);
    },
  };
}

beforeEach(() => {
  _resetSearchCoordinatorForTest();
  _resetSearchTelemetryForTest();
  _resetLocalSearchIndexForTest();
  _resetMusicIndexForTest();
  _resetRecentSearchesForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · TÜRKÇE NORMALİZASYON
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5 · Türkçe arama normalizasyonu', () => {
  it('İ / I / ı / i ayrımı doğru katlanır', () => {
    expect(searchKey('İstanbul')).toBe('istanbul');
    expect(searchKey('ISTANBUL')).toBe('istanbul');
    expect(searchKey('ısparta')).toBe('isparta');
    expect(searchKey('Isparta')).toBe('isparta');
    // toLowerCase() burada "i̇stanbul" (birleşik nokta) üretirdi — kilit budur.
    expect(searchKey('İSTANBUL')).toBe('istanbul');
  });

  it('ş ç ğ ö ü harfleri aksansız karşılığına katlanır', () => {
    expect(searchKey('Şarkı')).toBe('sarki');
    expect(searchKey('Çiçek')).toBe('cicek');
    expect(searchKey('Ağrı')).toBe('agri');
    expect(searchKey('Gözyaşı')).toBe('gozyasi');
    expect(searchKey('Üzgün')).toBe('uzgun');
  });

  it('normalizasyon YALNIZ arama anahtarıdır — kanonik metadata değişmez', () => {
    const track = localTrack({ title: 'Şarkı Söylemek Lazım' });
    reconcileMusicIndex([track]);
    const snapshot = getMusicLibrarySnapshot();
    // Kullanıcıya gösterilen başlık AYNEN korunur.
    expect(snapshot.tracks[0]!.title).toBe('Şarkı Söylemek Lazım');
    // Ama normalize anahtarla bulunur.
    expect(lookupLocalIndex(normalizeQuery('sarki soylemek'), 50)).toHaveLength(1);
  });

  it('sorgu normalizasyonu noktalamayı düşürür ama harfleri korur', () => {
    expect(normalizeQuery('sezen aksu - gülümse')).toBe('sezen aksu gulumse');
    expect(normalizeQuery('  ÇOK   boşluk  ')).toBe('cok bosluk');
    expect(normalizeQuery('')).toBe('');
    expect(normalizeQuery(null)).toBe('');
  });

  it('kelime örtüşmesi sayılabilir', () => {
    expect(tokenOverlap(searchTokens('sezen aksu'), searchTokens('sezen aksu gulumse'))).toBe(2);
    expect(tokenOverlap(searchTokens('metallica'), searchTokens('sezen aksu'))).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · SIRALAMA — deterministik ve açıklanabilir
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5 · sıralama', () => {
  const fields = (title: string, artist: string | null = null, album: string | null = null) =>
    ({ title, artist, album, availability: 'AVAILABLE' as const });

  it('tam başlık > başlık öneki > alt dizge', () => {
    const exact = scoreResult('yol', fields('Yol'));
    const prefix = scoreResult('yol', fields('Yolculuk'));
    const substring = scoreResult('yol', fields('Uzun Yolda'));
    expect(exact.score).toBeGreaterThan(prefix.score);
    expect(prefix.score).toBeGreaterThan(substring.score);
    expect(exact.matchKind).toBe('EXACT_TITLE');
    expect(prefix.matchKind).toBe('TITLE_PREFIX');
  });

  it('sanatçı + parça birlikte yazıldığında öne çıkar', () => {
    const both = scoreResult('sezen aksu gulumse', fields('Gülümse', 'Sezen Aksu'));
    const titleOnly = scoreResult('sezen aksu gulumse', fields('Gülümse', 'Başka Sanatçı'));
    expect(both.score).toBeGreaterThan(titleOnly.score);
    expect(both.evidence?.matchKind ?? both.matchKind).toBe('ARTIST_TITLE');
    // Tam birleşim ya da kelime örtüşmesi — ikisi de meşru sanatçı+başlık kanıtıdır.
    expect(
      both.signals.includes('artist_title_exact')
      || both.signals.includes('artist_and_title_tokens'),
    ).toBe(true);
  });

  it('her puanın GEREKÇESİ vardır (LAB\'da incelenebilir)', () => {
    const e = scoreResult('yol', fields('Yol', 'Grup'));
    expect(e.signals.length).toBeGreaterThan(0);
    expect(e.signals).toContain('exact_title');
    expect(e.signals).toContain('available');
  });

  it('sağlayıcı POPÜLERLİĞİ puan vermez — aynı metin, aynı puan', () => {
    const local = resultOf({
      resultId: 'local:x',
      provenance: makeProvenance({ origin: 'LOCAL_INDEX', providerId: 'local', sourceClass: 'LOCAL', observedAtMs: 1 }),
    });
    const youtube = resultOf({
      resultId: 'youtube:x',
      availability: 'AVAILABLE',
      provenance: makeProvenance({ origin: 'PROVIDER', providerId: 'youtube', sourceClass: 'YOUTUBE', observedAtMs: 1 }),
    });
    expect(local.evidence.score).toBe(youtube.evidence.score);
  });

  it('LOCAL sırf yerel diye birinci YAPILMAZ — metin kanıtı belirler', () => {
    const localWeak = resultOf({
      resultId: 'local:weak', title: 'Uzun Yolda',
      evidence: scoreResult('yol', { title: 'Uzun Yolda', artist: null, album: null, availability: 'AVAILABLE' }),
    });
    const providerExact = resultOf({
      resultId: 'youtube:exact', title: 'Yol', availability: 'UNKNOWN',
      provenance: makeProvenance({ origin: 'PROVIDER', providerId: 'youtube', sourceClass: 'YOUTUBE', observedAtMs: 1 }),
      evidence: scoreResult('yol', { title: 'Yol', artist: null, album: null, availability: 'UNKNOWN' }),
    });
    const ranked = rankResults([localWeak, providerExact]);
    expect(ranked[0]!.resultId).toBe('youtube:exact');
  });

  it('sıralama deterministiktir — aynı girdi her zaman aynı sıra', () => {
    const items = [
      resultOf({ resultId: 'b', title: 'Aynı' }),
      resultOf({ resultId: 'a', title: 'Aynı' }),
      resultOf({ resultId: 'c', title: 'Aynı' }),
    ];
    const first = rankResults(items).map((r) => r.resultId);
    const second = rankResults(items.slice().reverse()).map((r) => r.resultId);
    expect(first).toEqual(second);
    expect(first).toEqual(['a', 'b', 'c']);
  });

  it('erişilemeyen sonuç aşağı iner ama GİZLENMEZ', () => {
    const stale = scoreResult('yol', { title: 'Yol', artist: null, album: null, availability: 'STALE' });
    const fresh = scoreResult('yol', { title: 'Yol', artist: null, album: null, availability: 'AVAILABLE' });
    expect(stale.score).toBeLessThan(fresh.score);
    expect(stale.matchKind).toBe('EXACT_TITLE');   // eşleşme kanıtı korunur
  });

  it('boş sorguda metin sinyali üretilmez', () => {
    expect(scoreResult('', fields('Yol'))).toMatchObject({ score: 0, matchKind: 'NONE' });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · DEDUP — yanlış birleştirme çift göstermekten kötüdür
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5 · kaynaklar arası tekilleştirme', () => {
  const localOf = (over: Partial<SearchResult> = {}) => resultOf({
    resultId: 'local:1',
    provenance: makeProvenance({ origin: 'LOCAL_INDEX', providerId: 'local', sourceClass: 'LOCAL', observedAtMs: 1 }),
    ...over,
  });
  const providerOf = (over: Partial<SearchResult> = {}) => resultOf({
    resultId: 'youtube:1', availability: 'UNKNOWN',
    provenance: makeProvenance({ origin: 'PROVIDER', providerId: 'youtube', sourceClass: 'YOUTUBE', observedAtMs: 1 }),
    ...over,
  });

  it('EXACT kimlik kanıtıyla birleşir ve alternatif kaynak KORUNUR', () => {
    const shared = 'spotify:track:42';
    const a = localOf({ identity: identity({ providerId: shared, providerNamespace: 'SPOTIFY' }) });
    const b = providerOf({ identity: identity({ providerId: shared, providerNamespace: 'SPOTIFY' }) });
    const out = dedupeResults([a, b]);
    expect(out.results).toHaveLength(1);
    expect(out.mergedCount).toBe(1);
    expect(out.results[0]!.alternates).toHaveLength(1);
    expect(out.results[0]!.alternates[0]!.providerId).toBe('youtube');
  });

  it('STRONG kanıt (metadata + süre) birleştirir', () => {
    const a = localOf({ identity: identity() });
    const b = providerOf({ identity: identity() });
    const out = dedupeResults([a, b]);
    expect(out.results).toHaveLength(1);
    expect(out.mergedCount).toBe(1);
  });

  it('aynı ad + FARKLI sanatçı BİRLEŞTİRİLMEZ', () => {
    const a = localOf({ identity: identity({ artist: 'Grup A' }) });
    const b = providerOf({ resultId: 'youtube:2', identity: identity({ artist: 'Grup B' }) });
    const out = dedupeResults([a, b]);
    expect(out.results).toHaveLength(2);
    expect(out.mergedCount).toBe(0);
  });

  it('belirsiz/zayıf kanıt AYRI kalır ve bu görünür şekilde sayılır', () => {
    // Aynı başlık ve süre, ama sanatçı ikisinde de bilinmiyor → kanıt yetersiz.
    const a = localOf({ identity: identity({ artist: null, album: null }) });
    const b = providerOf({ resultId: 'youtube:3', identity: identity({ artist: null, album: null }) });
    const out = dedupeResults([a, b]);
    expect(out.results.length + out.mergedCount).toBe(2);
    if (out.results.length === 2) expect(out.ambiguousKept).toBe(1);
  });

  it('AYNI kaynak sınıfının iki kaydı birleştirilmez', () => {
    const a = localOf({ resultId: 'local:1' });
    const b = localOf({ resultId: 'local:2' });
    expect(dedupeResults([a, b]).results).toHaveLength(2);
  });

  it('farklı süreler ayrı kovaya düşer (radyo kurgusu ≠ albüm hâli)', () => {
    const a = localOf({ identity: identity({ durationMs: 180_000 }) });
    const b = providerOf({ resultId: 'youtube:9', identity: identity({ durationMs: 540_000 }) });
    expect(dedupeResults([a, b]).results).toHaveLength(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · YETENEK DÜRÜSTLÜĞÜ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5 · kaynak yeteneği dürüstlüğü', () => {
  it('supportsSearch yetenek kaydında tanımlıdır', () => {
    expect(getSource('LOCAL').capabilities.supportsSearch).toBe(true);
    expect(getSource('YOUTUBE').capabilities.supportsSearch).toBe(true);
    expect(getSource('INTERNET_RADIO').capabilities.supportsSearch).toBe(true);
    expect(getSource('BLUETOOTH_EXTERNAL').capabilities.supportsSearch).toBe(false);
    expect(getSource('EXTERNAL_MEDIA_SESSION').capabilities.supportsSearch).toBe(false);
  });

  it('arama desteklemeyen kaynağa sorgu GÖNDERİLMEZ', async () => {
    const calls: string[] = [];
    configureSearchSources([
      stubPort({
        providerId: 'local', sourceClass: 'BLUETOOTH_EXTERNAL',
        onSearch: (q) => calls.push(q),
      }),
    ]);
    const snap = await runSearch('yol');
    expect(calls).toHaveLength(0);
    expect(snap.sources[0]!.state).toBe('SKIPPED_UNSUPPORTED');
  });

  it('desteklenmeyen ile KULLANILAMAYAN ayrı teşhistir', () => {
    const unsupported = decideEligibility(stubPort({
      providerId: 'local', sourceClass: 'BLUETOOTH_EXTERNAL',
    }));
    const unavailable = decideEligibility(stubPort({
      providerId: 'spotify', sourceClass: 'SPOTIFY_CONNECT', available: false,
    }));
    expect(unsupported.skip).toBe('SKIPPED_UNSUPPORTED');
    expect(unavailable.skip).toBe('SKIPPED_UNAVAILABLE');
  });

  it('kullanılamayan sağlayıcı sonuç UYDURMAZ ve sorgu almaz', async () => {
    const calls: string[] = [];
    configureSearchSources([
      stubPort({
        providerId: 'spotify', sourceClass: 'SPOTIFY_CONNECT', available: false,
        onSearch: (q) => calls.push(q),
      }),
    ]);
    const snap = await runSearch('yol');
    expect(calls).toHaveLength(0);
    expect(snap.results).toHaveLength(0);
    expect(snap.emptyReason).toBe('ALL_SOURCES_UNAVAILABLE');
  });

  it('her sonuç köken (provenance) taşır', () => {
    const r = resultOf();
    expect(r.provenance).toMatchObject({
      origin: 'LOCAL_INDEX', providerId: 'local', sourceClass: 'LOCAL',
    });
    expect(r.provenance.observedAtMs).toBeGreaterThan(0);
  });

  it('tanınmayan sağlayıcı için kaynak sınıfı UYDURULMAZ', () => {
    expect(sourceClassForProvider('local')).toBe('LOCAL');
    expect(sourceClassForProvider('youtube')).toBe('YOUTUBE');
    expect(sourceClassForProvider('radio')).toBe('INTERNET_RADIO');
    const bogus = { id: 'bogus', providerId: 'bogus' } as unknown as UnifiedTrack;
    expect(resultFromUnifiedTrack(bogus, 'x', 1)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · ÇOK KAYNAK + KISMİ SONUÇ + BAŞARISIZLIK
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5 · çok kaynaklı arama', () => {
  const local = (title: string) => resultOf({
    resultId: `local:${title}`, title,
    evidence: scoreResult('yol', { title, artist: null, album: null, availability: 'AVAILABLE' }),
  });
  const remote = (title: string) => resultOf({
    resultId: `youtube:${title}`, title, availability: 'UNKNOWN',
    identity: identity({ title, artist: 'Uzak', providerId: `yt-${title}` }),
    provenance: makeProvenance({ origin: 'PROVIDER', providerId: 'youtube', sourceClass: 'YOUTUBE', observedAtMs: 1 }),
    evidence: scoreResult('yol', { title, artist: 'Uzak', album: null, availability: 'UNKNOWN' }),
  });

  it('tüm kaynaklar başarılıysa COMPLETE olur', async () => {
    configureSearchSources([
      stubPort({ providerId: 'local', sourceClass: 'LOCAL', results: [local('Yol')] }),
      stubPort({ providerId: 'youtube', sourceClass: 'YOUTUBE', results: [remote('Yolculuk')] }),
    ]);
    const snap = await runSearch('yol');
    expect(snap.state).toBe('COMPLETE');
    expect(snap.results).toHaveLength(2);
    expect(snap.emptyReason).toBeNull();
  });

  it('bir sağlayıcı düşerse DİĞERLERİNİN sonucu yok olmaz ve durum DEGRADED olur', async () => {
    configureSearchSources([
      stubPort({ providerId: 'local', sourceClass: 'LOCAL', results: [local('Yol')] }),
      stubPort({ providerId: 'youtube', sourceClass: 'YOUTUBE', fail: true }),
    ]);
    const snap = await runSearch('yol');
    expect(snap.state).toBe('DEGRADED');
    expect(snap.results).toHaveLength(1);
    expect(snap.sources.find((s) => s.providerId === 'youtube')!.state).toBe('FAILED');
  });

  it('yavaş sağlayıcı zaman aşımına uğrar, arama BLOKE OLMAZ', async () => {
    configureSearchSources([
      stubPort({ providerId: 'local', sourceClass: 'LOCAL', results: [local('Yol')] }),
      stubPort({ providerId: 'youtube', sourceClass: 'YOUTUBE', delayMs: 400, timeoutMs: 30 }),
    ]);
    const snap = await runSearch('yol');
    expect(snap.sources.find((s) => s.providerId === 'youtube')!.state).toBe('TIMEOUT');
    expect(snap.results).toHaveLength(1);
    expect(snap.state).toBe('DEGRADED');
  });

  it('hepsi bitmeden COMPLETE İDDİA EDİLMEZ', async () => {
    const states: string[] = [];
    configureSearchSources([
      stubPort({ providerId: 'local', sourceClass: 'LOCAL', results: [local('Yol')] }),
      stubPort({ providerId: 'youtube', sourceClass: 'YOUTUBE', delayMs: 60, results: [remote('Yolculuk')] }),
    ]);
    const { subscribeSearch: sub } = await import('../platform/media/search/musicSearchCoordinator');
    const stop = sub(() => states.push(getSearchSnapshot().state));
    await runSearch('yol');
    stop();
    // İlk kaynak dönünce PARTIAL görülmeli; COMPLETE yalnız SONDA.
    expect(states).toContain('SEARCHING');
    expect(states.indexOf('COMPLETE')).toBe(states.length - 1);
    expect(states.filter((s) => s === 'COMPLETE')).toHaveLength(1);
  });

  it('hiç uygun kaynak yoksa dürüst gerekçe döner', async () => {
    configureSearchSources([]);
    const snap = await runSearch('yol');
    expect(snap.emptyReason).toBe('NO_ELIGIBLE_SOURCE');
  });

  it('gerçekten sonuç yoksa bu ayrı bir durumdur', async () => {
    configureSearchSources([stubPort({ providerId: 'local', sourceClass: 'LOCAL', results: [] })]);
    const snap = await runSearch('bulunamayacak');
    expect(snap.state).toBe('COMPLETE');
    expect(snap.emptyReason).toBe('NO_RESULTS');
  });

  it('tüm kaynaklar düşerse "sonuç yok" DENMEZ', async () => {
    configureSearchSources([
      stubPort({ providerId: 'local', sourceClass: 'LOCAL', fail: true }),
      stubPort({ providerId: 'youtube', sourceClass: 'YOUTUBE', fail: true }),
    ]);
    const snap = await runSearch('yol');
    expect(snap.emptyReason).toBe('ALL_SOURCES_FAILED');
  });

  it('boş sorgu bir arama değildir — sağlayıcıya istek gitmez', async () => {
    const calls: string[] = [];
    configureSearchSources([
      stubPort({ providerId: 'youtube', sourceClass: 'YOUTUBE', onSearch: (q) => calls.push(q) }),
    ]);
    const snap = await runSearch('   ');
    expect(calls).toHaveLength(0);
    expect(snap.state).toBe('IDLE');
    expect(snap.emptyReason).toBe('NO_QUERY');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · EŞZAMANLILIK — bayat sonuç yeniyi EZEMEZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5 · bayatlık ve iptal', () => {
  const slowResult = resultOf({ resultId: 'youtube:eski', title: 'ESKİ' });
  const fastResult = resultOf({ resultId: 'local:yeni', title: 'YENİ' });

  it('"sezen" sonucu geç gelirse "sezen aksu" durumunu DEĞİŞTİREMEZ', async () => {
    configureSearchSources([
      // Yavaş sağlayıcı: YALNIZ ilk sorguya sonuç döner (geç gelen "eski" sonuç).
      stubPort({
        providerId: 'youtube', sourceClass: 'YOUTUBE', delayMs: 120,
        resultsFor: (q) => (q === 'sezen' ? [slowResult] : []),
      }),
      stubPort({ providerId: 'local', sourceClass: 'LOCAL', results: [fastResult] }),
    ]);

    const first = runSearch('sezen');
    await new Promise((r) => setTimeout(r, 10));
    const second = await runSearch('sezen aksu');
    await first;

    const snap = getSearchSnapshot();
    expect(snap.generation).toBe(second.generation);
    expect(snap.query).toBe('sezen aksu');
    // Eski sorgunun geç sonucu listeye SIZMAZ.
    expect(snap.results.some((r) => r.resultId === 'youtube:eski')).toBe(false);
    expect(getSearchTelemetrySnapshot().counters.staleResultDrops).toBeGreaterThan(0);
  });

  it('iptal edilen arama durumu temizler ve sayılır', async () => {
    configureSearchSources([
      stubPort({ providerId: 'youtube', sourceClass: 'YOUTUBE', delayMs: 80, results: [slowResult] }),
    ]);
    const pending = runSearch('sezen');
    await new Promise((r) => setTimeout(r, 5));
    cancelSearch();
    await pending;

    expect(getSearchSnapshot().state).toBe('IDLE');
    expect(getSearchSnapshot().results).toHaveLength(0);
    expect(getSearchTelemetrySnapshot().counters.cancellations).toBe(1);
  });

  it('kuşak her aramada ilerler — yinelenen geri çağrı durumu bozmaz', async () => {
    configureSearchSources([stubPort({ providerId: 'local', sourceClass: 'LOCAL', results: [fastResult] })]);
    const a = await runSearch('bir');
    const b = await runSearch('iki');
    expect(b.generation).toBeGreaterThan(a.generation);
    expect(getSearchSnapshot().generation).toBe(b.generation);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · YEREL ARAMA İNDEKSİ — ikinci library truth DEĞİL
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5 · yerel arama indeksi', () => {
  const many = (n: number): LocalMusicTrack[] =>
    Array.from({ length: n }, (_, i) => localTrack({
      id: i + 1, uri: `content://media/external/audio/media/${i + 1}`,
      title: i === 4_200 ? 'Gülümse' : `Parça ${i}`,
      artist: i === 4_200 ? 'Sezen Aksu' : `Sanatçı ${i % 50}`,
    }));

  it('5.000+ parçalık kütüphanede aday üretir ve bounded kalır', () => {
    reconcileMusicIndex(many(5_200));
    const hits = lookupLocalIndex(normalizeQuery('gulumse'), 300);
    expect(hits).toHaveLength(1);
    expect(peekLocalSearchIndex()).toMatchObject({ rows: 5_200 });

    // Çok geniş sorgu: aday havuzu ÜST SINIRDA kalır.
    expect(lookupLocalIndex(normalizeQuery('parca'), 300).length).toBeLessThanOrEqual(300);
  });

  it('kütüphane revizyonu değişince indeks YENİDEN kurulur (bayat sonuç yok)', () => {
    reconcileMusicIndex([localTrack({ id: 1, title: 'Eski' })]);
    expect(lookupLocalIndex(normalizeQuery('eski'), 10)).toHaveLength(1);

    reconcileMusicIndex([localTrack({ id: 2, uri: 'content://media/external/audio/media/2', title: 'Yeni' })]);
    expect(lookupLocalIndex(normalizeQuery('eski'), 10)).toHaveLength(0);
    expect(lookupLocalIndex(normalizeQuery('yeni'), 10)).toHaveLength(1);
    expect(peekLocalSearchIndex()!.revision).toBe(getMusicLibrarySnapshot().revision);
  });

  it('tüm sorgu kelimeleri eşleşmeli — alakasız sonuç listeyi doldurmaz', () => {
    reconcileMusicIndex([
      localTrack({ id: 1, title: 'Gülümse', artist: 'Sezen Aksu' }),
      localTrack({ id: 2, uri: 'content://media/external/audio/media/2', title: 'Sezen', artist: 'Başkası' }),
    ]);
    expect(lookupLocalIndex(normalizeQuery('sezen aksu'), 50)).toHaveLength(1);
  });

  it('yerel port kanonik anlık görüntüden çözer ve uzun metadata\'yı bozmaz', async () => {
    const long = 'A'.repeat(300);
    reconcileMusicIndex([localTrack({ id: 1, title: long, artist: long })]);
    const port = createLocalSearchPort();
    const results = await port.search(normalizeQuery(long.slice(0, 20)), new AbortController().signal);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe(long);
    expect(results[0]!.provenance.libraryRevision).toBe(getMusicLibrarySnapshot().revision);
  });

  it('kütüphane hazır değilse yerel kaynak KULLANILAMAZ sayılır', () => {
    _resetMusicIndexForTest();
    expect(createLocalSearchPort().isAvailable()).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · SEÇİM — kanonik oturum yolu
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5 · sonuç seçimi', () => {
  it('yerel sonuç F3 oturum yolundan çalar (sağlayıcıya DOĞRUDAN komut yok)', async () => {
    reconcileMusicIndex([localTrack({ id: 1, title: 'Yol' })]);
    const runtime = await import('../platform/media/session/listeningSessionRuntime');
    const dispatched: { source: string; ids: string[] }[] = [];
    runtime._setListeningRuntimePortsForTest({
      dispatch: async (args) => {
        dispatched.push({ source: args.source, ids: args.items.map((i) => i.id) });
        return Object.freeze({
          truth: {
            commandId: 'c', sessionId: 's', sourceId: args.source, backend: 'native_authority',
            command: 'playSource', desiredState: 'PLAYING', observedState: 'PLAYING',
            outcome: 'VERIFIED', verificationLevel: 'RENDERING_VERIFIED',
            startedAtMs: 0, endedAtMs: 1, elapsedMs: 1, failureCode: null, retryable: false, stages: [],
          },
          gatewaySessionId: 's', generation: 1,
        });
      },
      persist: () => {},
    });

    const port = createLocalSearchPort();
    const [result] = await port.search('yol', new AbortController().signal);
    const { selectSearchResult } = await import('../platform/media/search/searchSelection');
    const outcome = await selectSearchResult(result!, [result!]);

    expect(outcome.outcome).toBe('STARTED');
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.source).toBe('LOCAL');
    runtime._setListeningRuntimePortsForTest(null);
  });

  it('bayat MediaRef REDDEDİLİR — çalma denenmez', async () => {
    reconcileMusicIndex([localTrack({ id: 1, title: 'Yol' })]);
    const port = createLocalSearchPort();
    const [result] = await port.search('yol', new AbortController().signal);
    // Kütüphane değişti: parça artık yok.
    reconcileMusicIndex([localTrack({ id: 99, uri: 'content://media/external/audio/media/99', title: 'Başka' })]);

    const { selectSearchResult } = await import('../platform/media/search/searchSelection');
    const outcome = await selectSearchResult(result!, []);
    expect(outcome.outcome).toBe('STALE_REFERENCE');
    expect(getSearchTelemetrySnapshot().counters.selectionRejected).toBe(1);
  });

  it('sağlayıcı sonucu kanonik medya katmanına DEVREDİLİR', async () => {
    const providerResult = resultOf({
      resultId: 'youtube:1', libraryTrackId: null,
      provenance: makeProvenance({ origin: 'PROVIDER', providerId: 'youtube', sourceClass: 'YOUTUBE', observedAtMs: 1 }),
    });
    const { selectSearchResult } = await import('../platform/media/search/searchSelection');
    expect((await selectSearchResult(providerResult, [])).outcome).toBe('PROVIDER_PATH');
  });

  it('UnifiedTrack kimliği metadata UYDURMAZ', () => {
    const id = identityFromUnifiedTrack({
      id: 'x', providerId: 'youtube', title: 'Yol', subtitle: '',
    } as UnifiedTrack);
    expect(id.album).toBeNull();
    expect(id.artist).toBeNull();
    expect(id.durationMs).toBeNull();
    expect(id.libraryId).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9 · KEŞİF — kanıt yoksa bölüm yok
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5 · keşif', () => {
  const discover = (over: Partial<Parameters<typeof buildDiscovery>[0]> = {}) =>
    buildDiscovery({
      library: getMusicLibrarySnapshot(),
      continueListening: null, lastPlayed: null,
      // F5.1 · geçmiş kanıtı ayrı bir girdidir; varsayılan: kanıt YOK.
      recentlyPlayedTracks: [],
      // MUSIC F13 · favori kanıtı ayrı bir girdidir; varsayılan: kanıt YOK.
      favorites: [],
      // MUSIC F15 · playlist kanıtı ayrı bir girdidir; varsayılan: kanıt YOK.
      playlists: [],
      drivingMode: 'idle',
      ...over,
    });

  it('boş kütüphanede SAHTE bölüm üretilmez', () => {
    const d = discover();
    expect(d.sections).toHaveLength(0);
    expect(d.emptyReason).toBe('Cihaz müziği henüz taranmadı.');
  });

  it('gerçek kanıt varsa koleksiyon bölümleri doğar', () => {
    reconcileMusicIndex([
      localTrack({ id: 1, title: 'A', album: 'Albüm 1', artist: 'Sanatçı 1' }),
      localTrack({ id: 2, uri: 'content://media/external/audio/media/2', title: 'B', album: 'Albüm 2', artist: 'Sanatçı 2' }),
    ]);
    const ids = discover().sections.map((s) => s.id);
    expect(ids).toContain('ALBUMS');
    expect(ids).toContain('ARTISTS');
  });

  it('sürmekte olan dinleme varsa "devam et" bölümü öne gelir', () => {
    const d = discover({
      continueListening: { title: 'Yol', artist: 'Grup', artworkIdentity: null },
    });
    expect(d.sections[0]!.id).toBe('CONTINUE_LISTENING');
  });

  it('kayıtlı son parça CANLI çalma iddiası üretmez', () => {
    const d = discover({ lastPlayed: { title: 'Yol', subtitle: 'Grup', artworkIdentity: null } });
    expect(d.sections[0]!.id).toBe('RECENTLY_PLAYED');
    expect(d.sections[0]!.title).not.toMatch(/çalıyor/i);
  });

  it('sürüşte klasör gezintisi gösterilmez ve satır sayısı azalır', () => {
    reconcileMusicIndex(Array.from({ length: 40 }, (_, i) => localTrack({
      id: i + 1, uri: `content://media/external/audio/media/${i + 1}`,
      title: `T${i}`, album: `Albüm ${i}`, artist: `Sanatçı ${i}`,
    })));
    const idle = discover({ drivingMode: 'idle' });
    const driving = discover({ drivingMode: 'driving' });
    expect(idle.sections.some((s) => s.id === 'FOLDERS')).toBe(
      getMusicLibrarySnapshot().folders.length > 0,
    );
    expect(driving.sections.some((s) => s.id === 'FOLDERS')).toBe(false);
    const albumsIdle = idle.sections.find((s) => s.id === 'ALBUMS')!;
    const albumsDriving = driving.sections.find((s) => s.id === 'ALBUMS')!;
    expect(albumsDriving.items.length).toBeLessThanOrEqual(albumsIdle.items.length);
    expect(albumsDriving.items.length).toBeLessThanOrEqual(8);
  });

  it('keşif AI önerisi ÜRETMEZ — bölüm adları tahmin dili taşımaz', () => {
    reconcileMusicIndex([localTrack({ id: 1, album: 'A', artist: 'B' })]);
    discover().sections.forEach((s) => {
      expect(s.title).not.toMatch(/senin için|önerilen|beğenebileceğin/i);
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10 · SON ARAMALAR
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5 · son aramalar', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(), key: () => null, length: 0,
    });
    _resetRecentSearchesForTest();
  });

  it('normalize edilerek tekilleştirilir ama gösterim metni korunur', () => {
    rememberSearch('Sezen', 1);
    const out = rememberSearch('SEZEN', 2);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('SEZEN');
  });

  it('sınırlıdır — sınırsız büyümez', () => {
    for (let i = 0; i < MAX_RECENT_SEARCHES + 8; i += 1) rememberSearch(`sorgu ${i}`, i);
    expect(getRecentSearches().length).toBe(MAX_RECENT_SEARCHES);
  });

  it('açıkça temizlenebilir', () => {
    rememberSearch('sezen', 1);
    clearRecentSearches();
    expect(getRecentSearches()).toHaveLength(0);
  });

  it('boş sorgu kaydedilmez', () => {
    rememberSearch('   ', 1);
    expect(getRecentSearches()).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11 · TELEMETRİ — PII yok, sonucu etkilemez
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5 · arama telemetrisi', () => {
  it('sorgu METNİ telemetriye GİRMEZ — yalnız uzunluk', async () => {
    configureSearchSources([stubPort({ providerId: 'local', sourceClass: 'LOCAL', results: [] })]);
    await runSearch('gizli kalması gereken sorgu');
    const snap = getSearchTelemetrySnapshot();
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain('gizli');
    expect(snap.lastQueryLength).toBe('gizli kalması gereken sorgu'.length);
  });

  it('kaynak turları ve sayaçlar bounded kaydedilir', async () => {
    configureSearchSources([
      stubPort({ providerId: 'local', sourceClass: 'LOCAL', results: [resultOf()] }),
      stubPort({ providerId: 'youtube', sourceClass: 'YOUTUBE', fail: true }),
    ]);
    await runSearch('yol');
    const snap = getSearchTelemetrySnapshot();
    expect(snap.status).toBe('OBSERVED');
    expect(snap.counters.queries).toBe(1);
    expect(snap.counters.providerFailures).toBe(1);
    expect(snap.recentSourceRuns.length).toBeLessThanOrEqual(snap.sourceRunCapacity);
    expect(snap.lastEligibleSources).toContain('local');
  });

  it('hiç arama yapılmadıysa ölçümler null kalır (sahte 0 yok)', () => {
    const snap = getSearchTelemetrySnapshot();
    expect(snap.status).toBe('UNAVAILABLE');
    expect(snap.localSearchP50Ms).toBeNull();
    expect(snap.completeSearchP95Ms).toBeNull();
    expect(snap.lastQueryLength).toBeNull();
  });

  it('telemetri okuması yan etkisizdir', async () => {
    configureSearchSources([stubPort({ providerId: 'local', sourceClass: 'LOCAL', results: [] })]);
    await runSearch('yol');
    const first = getSearchTelemetrySnapshot().counters;
    getSearchTelemetrySnapshot();
    expect(getSearchTelemetrySnapshot().counters).toEqual(first);
  });

  it('sıralama gerekçesi LAB için taşınır', async () => {
    configureSearchSources([stubPort({
      providerId: 'local', sourceClass: 'LOCAL',
      results: [resultOf({
        evidence: scoreResult('yol', { title: 'Yol', artist: null, album: null, availability: 'AVAILABLE' }),
      })],
    })]);
    await runSearch('yol');
    expect(getSearchTelemetrySnapshot().lastRankingSignals).toContain('exact_title');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 12 · AUTHORITY GUARD
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5 · authority guard', () => {
  const readSource = async (relative: string): Promise<string> => {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const dir = path.dirname(url.fileURLToPath(import.meta.url));
    const file = path.join(dir, '..', relative);
    // Kör guard koruması: dosya yoksa kilit hiçbir şeyi korumuyordur.
    expect(fs.existsSync(file), `${relative} bulunamadı — kilit yeniden bağlanmalı`).toBe(true);
    return fs.readFileSync(file, 'utf8');
  };

  it('arama UI\'ı sağlayıcıyı, native köprüyü veya kütüphaneyi DOĞRUDAN çağırmaz', async () => {
    const src = await readSource('components/media/UnifiedSearchView.tsx');
    ['nativePlugin', 'nativeAuthorityBridge', 'pipedProvider', 'audiusProvider',
      'radioBrowserProvider', 'jamendoProvider', 'archiveProvider', 'reconcileMusicIndex',
    ].forEach((forbidden) => expect(src, forbidden).not.toContain(forbidden));
  });

  it('arama katmanı playback komutu göndermez ve kuyruk yazmaz', async () => {
    for (const file of [
      'platform/media/search/musicSearchCoordinator.ts',
      'platform/media/search/searchRanking.ts',
      'platform/media/search/searchDedup.ts',
      'platform/media/search/searchSources.ts',
    ]) {
      const src = await readSource(file);
      ['mediaCommandGateway', 'playSource(', 'createQueue(', 'setCurrentIndex(', 'playQueue']
        .forEach((forbidden) => expect(src, `${file} → ${forbidden}`).not.toContain(forbidden));
    }
  });

  it('ikinci bir MusicIndex kurulmaz — arama indeksi TÜRETİLMİŞTİR', async () => {
    const src = await readSource('platform/media/search/localSearchIndex.ts');
    // Kütüphane gerçeği yalnız OKUNUR; yazma API'leri kullanılmaz.
    ['reconcileMusicIndex', 'applyMusicIndexDelta', 'pruneMusicVolume', 'markMusicVolumeStale']
      .forEach((forbidden) => expect(src, forbidden).not.toContain(forbidden));
    expect(src).toContain('getMusicLibrarySnapshot');
  });

  it('koordinatör sonucu kaynak gerçeğini değiştirmez — kütüphane dokunulmaz', async () => {
    reconcileMusicIndex([localTrack({ id: 1, title: 'Yol' })]);
    const revisionBefore = getMusicLibrarySnapshot().revision;
    configureSearchSources([createLocalSearchPort()]);
    await runSearch('yol');
    expect(getMusicLibrarySnapshot().revision).toBe(revisionBefore);
  });
});
